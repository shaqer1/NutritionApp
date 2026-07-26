"""Layered food resolver.

Barcode lookup order (stop at first hit):
    1. Firestore barcode_cache  (free, instant, avoids repeat API calls)
    2. Open Food Facts          (free, no key, great for packaged goods)
    3. Chomp                    (fallback; needs key; only if configured)
    4. -> caller falls back to manual entry

Name search uses Chomp when configured, else returns empty (caller prompts
for manual macros). Open Food Facts also has a search endpoint we use as a
free first pass.
"""
from __future__ import annotations

import re

import httpx

from ..config import Settings
from ..models import FoodItem, Macros
from .categories import category_from_off
from .store import Store

OFF_PRODUCT = "https://world.openfoodfacts.org/api/v2/product/{barcode}.json"
OFF_SEARCH = "https://world.openfoodfacts.org/cgi/search.pl"
CHOMP_BASE = "https://chompthis.com/api/v2/food/branded/barcode.php"
CHOMP_SEARCH = "https://chompthis.com/api/v2/food/branded/name.php"

_UA = {"User-Agent": "personal-nutrition-app/1.0 (single user)"}


def _macros_from_off(nutriments: dict) -> tuple[Macros, str | None]:
    """OFF reports per-100g; we prefer per-serving when present. Returns the
    Macros plus which basis was actually used ("serving" | "100g" | None), so
    callers can be honest about it instead of silently mislabeling 100g data
    as per-serving (confirmed live: OFF sometimes has no _serving keys at all)."""
    basis_seen: str | None = None

    def g(key: str) -> float:
        nonlocal basis_seen
        for suffix, basis in (("_serving", "serving"), ("_100g", "100g")):
            v = nutriments.get(key + suffix)
            if isinstance(v, (int, float)):
                if basis_seen is None:
                    basis_seen = basis
                return float(v)
        return 0.0

    macros = Macros(
        cal=g("energy-kcal"),
        protein=g("proteins"),
        carbs=g("carbohydrates"),
        fat=g("fat"),
        sugar_g=g("sugars"),
        fiber_g=g("fiber"),
        sat_fat_g=g("saturated-fat"),
        sodium_mg=g("sodium") * 1000,  # OFF reports sodium in grams
    )
    return macros, basis_seen


_SERVING_STR_RE = re.compile(r"([\d.]+)\s*([a-zA-Z]+)")


def _parse_serving_str(s) -> tuple[float, str] | None:
    """Parse a leading numeric+unit token, e.g. "15 g" -> (15.0, "g")."""
    if not isinstance(s, str) or not s:
        return None
    m = _SERVING_STR_RE.search(s)
    if not m:
        return None
    try:
        return float(m.group(1)), m.group(2).lower()
    except ValueError:
        return None


def _split_serving_size(s) -> tuple[tuple[float, str] | None, tuple[float, str] | None]:
    """Split a raw OFF serving_size string like "1 bar (40 g)" into
    (info_pair, calc_pair):
      - info_pair is parsed from the text BEFORE "(", e.g. (1.0, "bar") —
        purely a human-facing label, never used in grams/decrement math.
      - calc_pair is parsed from inside the parens, e.g. (40.0, "g") — this
        drives grams tracking, since OFF puts the actual measurable quantity
        there and the prefix is just a container-shape description (confirmed
        live: "1 bar (40 g)", "2 tbsp (30 g)", etc.).
    If there's no "(", the whole string is treated as the calc pair and
    there's no separate informational label."""
    if not isinstance(s, str) or not s:
        return None, None
    if "(" in s:
        prefix, _, rest = s.partition("(")
        inside = rest.split(")")[0]
        return _parse_serving_str(prefix), _parse_serving_str(inside)
    return None, _parse_serving_str(s)


def _serving_info(p: dict) -> tuple[float | None, str | None, float | None, str | None]:
    """Fallback chain for serving info. Returns (calc_qty, calc_unit,
    info_qty, info_unit).

    calc_* drives grams/decrement math, preferring explicit
    serving_quantity + serving_quantity_unit (OFF's own parsed numeric
    fields) over parsing serving_size text ourselves. info_* is the
    human-facing "1 bar" style label, always parsed from serving_size text
    (never from serving_quantity, which has no such prefix) and only ever
    for display. OFF's data is community-edited and fields drift (confirmed
    live: the same barcode had serving_size vs. serving_size_imported
    populated at different points in the same session), so we try both."""
    info_pair, calc_from_text = _split_serving_size(p.get("serving_size"))
    if info_pair is None:
        info_pair, calc_from_text2 = _split_serving_size(p.get("serving_size_imported"))
        calc_from_text = calc_from_text or calc_from_text2

    calc_pair = None
    sq, su = p.get("serving_quantity"), p.get("serving_quantity_unit")
    if sq not in (None, "") and su:
        try:
            calc_pair = (float(sq), str(su).lower())
        except (TypeError, ValueError):
            calc_pair = None
    calc_pair = calc_pair or calc_from_text

    return (
        calc_pair[0] if calc_pair else None, calc_pair[1] if calc_pair else None,
        info_pair[0] if info_pair else None, info_pair[1] if info_pair else None,
    )


class FoodResolver:
    def __init__(self, settings: Settings, store: Store):
        self.s = settings
        self.store = store

    async def resolve_barcode(self, barcode: str) -> tuple[FoodItem | None, str]:
        """Returns (item, matched_source). matched_source in
        {cache, off, chomp, none}."""
        cached = self.store.cache_get(barcode)
        if cached:
            return FoodItem(**cached), "cache"

        item = await self._off_barcode(barcode)
        if item:
            self.store.cache_put(barcode, item.model_dump())
            return item, "off"

        if self.s.chomp_api_key and not self.s.use_stubs:
            item = await self._chomp_barcode(barcode)
            if item:
                self.store.cache_put(barcode, item.model_dump())
                return item, "chomp"

        return None, "none"

    async def search(self, query: str, limit: int = 8) -> list[FoodItem]:
        results = await self._off_search(query, limit)
        if results:
            return results
        if self.s.chomp_api_key and not self.s.use_stubs:
            return await self._chomp_search(query, limit)
        return []

    # ---------- Open Food Facts ----------
    async def _fetch_off_raw(self, barcode: str) -> dict | None:
        """Full raw OFF product dict for a barcode, or None if not found."""
        try:
            async with httpx.AsyncClient(timeout=8, headers=_UA) as c:
                r = await c.get(OFF_PRODUCT.format(barcode=barcode),
                                params={"lc": "en", "cc": "us"})
            data = r.json()
        except (httpx.HTTPError, ValueError):
            return None
        if data.get("status") != 1:
            return None
        return data["product"]

    async def raw_product(self, barcode: str) -> dict | None:
        """Full raw OFF product dict, fetched live (no caching — see plan notes:
        OFF is free and this is only ever called on an explicit user action)."""
        return await self._fetch_off_raw(barcode)

    async def _off_barcode(self, barcode: str) -> FoodItem | None:
        p = await self._fetch_off_raw(barcode)
        if p is None:
            return None
        name = p.get("product_name") or p.get("generic_name") or "Unknown"
        macros, basis = _macros_from_off(p.get("nutriments", {}))
        serving_qty, serving_unit, serving_size_qty, serving_size_unit = _serving_info(p)
        return FoodItem(
            name=name, barcode=barcode,
            per_serving=macros,
            macros_basis=basis,
            source="off",
            brand=p.get("brands") or None,
            serving_size=p.get("serving_size") or p.get("serving_size_imported") or None,
            serving_size_qty=serving_size_qty,
            serving_size_unit=serving_size_unit,
            serving_qty=serving_qty,
            serving_unit=serving_unit,
            serving_qty_g=serving_qty if serving_unit == "g" else None,
            image_url=p.get("image_front_url") or p.get("image_url") or None,
            nutrition_grade=p.get("nutriscore_grade") or None,
            category=category_from_off(p.get("pnns_groups_1"), p.get("categories_tags")))

    async def _off_search(self, query: str, limit: int) -> list[FoodItem]:
        params = {
            "search_terms": query, "search_simple": 1, "action": "process",
            "json": 1, "page_size": limit,
            "fields": "product_name,code,nutriments,brands,serving_size,"
                      "serving_size_imported,serving_quantity,serving_quantity_unit,"
                      "image_front_url,nutriscore_grade,pnns_groups_1,categories_tags",
        }
        try:
            async with httpx.AsyncClient(timeout=8, headers=_UA) as c:
                r = await c.get(OFF_SEARCH, params=params)
            data = r.json()
        except (httpx.HTTPError, ValueError):
            return []
        out = []
        for p in data.get("products", [])[:limit]:
            if not p.get("product_name"):
                continue
            macros, basis = _macros_from_off(p.get("nutriments", {}))
            serving_qty, serving_unit, serving_size_qty, serving_size_unit = _serving_info(p)
            out.append(FoodItem(
                name=p["product_name"], barcode=p.get("code"),
                per_serving=macros,
                macros_basis=basis,
                source="off",
                brand=p.get("brands") or None,
                serving_size=p.get("serving_size") or p.get("serving_size_imported") or None,
                serving_size_qty=serving_size_qty,
                serving_size_unit=serving_size_unit,
                serving_qty=serving_qty,
                serving_unit=serving_unit,
                serving_qty_g=serving_qty if serving_unit == "g" else None,
                image_url=p.get("image_front_url") or None,
                nutrition_grade=p.get("nutriscore_grade") or None,
                category=category_from_off(p.get("pnns_groups_1"), p.get("categories_tags"))))
        return out

    # ---------- Chomp ----------
    async def _chomp_barcode(self, barcode: str) -> FoodItem | None:
        params = {"api_key": self.s.chomp_api_key, "code": barcode}
        try:
            async with httpx.AsyncClient(timeout=8, headers=_UA) as c:
                r = await c.get(CHOMP_BASE, params=params)
            data = r.json()
        except (httpx.HTTPError, ValueError):
            return None
        return self._parse_chomp(data, barcode)

    async def _chomp_search(self, query: str, limit: int) -> list[FoodItem]:
        params = {"api_key": self.s.chomp_api_key, "name": query, "limit": limit}
        try:
            async with httpx.AsyncClient(timeout=8, headers=_UA) as c:
                r = await c.get(CHOMP_SEARCH, params=params)
            data = r.json()
        except (httpx.HTTPError, ValueError):
            return []
        items = data.get("items") or data.get("food") or []
        out = [self._parse_chomp({"items": [it]}, it.get("barcode")) for it in items]
        return [i for i in out if i][:limit]

    @staticmethod
    def _parse_chomp(data: dict, barcode: str | None) -> FoodItem | None:
        items = data.get("items") or data.get("food") or []
        if not items:
            return None
        it = items[0]
        n = it.get("nutrients", {}) or {}

        def num(*keys) -> float:
            for k in keys:
                v = n.get(k)
                if isinstance(v, dict):
                    v = v.get("per_serving") or v.get("amount")
                if isinstance(v, (int, float)):
                    return float(v)
            return 0.0

        def txt(*keys) -> str | None:
            for k in keys:
                v = it.get(k)
                if isinstance(v, str) and v:
                    return v
            return None

        serving_grams_raw = it.get("serving_size_g") or it.get("serving_weight_grams")
        try:
            serving_grams = float(serving_grams_raw) if serving_grams_raw not in (None, "") else None
        except (TypeError, ValueError):
            serving_grams = None

        return FoodItem(
            name=it.get("name", "Unknown"), barcode=barcode,
            per_serving=Macros(
                cal=num("calories", "energy"),
                protein=num("protein"),
                carbs=num("carbohydrate", "carbohydrates", "carbs"),
                fat=num("fat", "total_fat"),
                sugar_g=num("sugar", "sugars"),
                fiber_g=num("fiber", "dietary_fiber"),
                sat_fat_g=num("saturated_fat", "sat_fat"),
                sodium_mg=num("sodium"),  # unit unverified against a live key
            ),
            source="chomp",
            brand=txt("brand", "brand_name", "manufacturer"),
            serving_size=txt("serving_size", "serving"),
            serving_qty=serving_grams,
            serving_unit="g" if serving_grams is not None else None,
            serving_qty_g=serving_grams,
            image_url=txt("image", "image_url", "img_url", "thumb"),
            nutrition_grade=None)
