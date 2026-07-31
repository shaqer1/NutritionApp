"""ExerciseDB (RapidAPI) client — search + exercise-detail lookups.

Only ever called on a cache miss: almost the entire program (1,520 exercises)
was already migrated into the shared `exercise_cache` Firestore collection,
so Store methods check that cache first (see store.py's
`search_exercise_cache_live`/`get_exercise_details_live`) and only reach here
when nothing matches. Rate limits on the RapidAPI plan: 1,000 requests/hour,
2,000/month — the same limits the old Apps Script UI already surfaced.

Mirrors app/services/food.py's Chomp-call pattern: single-attempt httpx calls,
no retries, swallow HTTP/JSON errors and return None/[] rather than raising.
"""
from __future__ import annotations

import httpx

from ..config import Settings

EXERCISEDB_API_HOST = "edb-with-videos-and-images-by-ascendapi.p.rapidapi.com"
EXERCISEDB_SEARCH_URL = f"https://{EXERCISEDB_API_HOST}/api/v1/exercises/search"
EXERCISEDB_DETAILS_URL = f"https://{EXERCISEDB_API_HOST}/api/v1/exercises/{{exercise_id}}"


class ExerciseDbClient:
    def __init__(self, settings: Settings):
        self.s = settings

    def _headers(self) -> dict:
        return {
            "Content-Type": "application/json",
            "x-rapidapi-host": EXERCISEDB_API_HOST,
            "x-rapidapi-key": self.s.exercisedb_api_key,
        }

    async def search(self, query: str, limit: int = 10) -> list[dict]:
        """Returns raw {exerciseId, name, imageUrl} dicts, or [] on any
        failure (no key configured, network error, rate limit, no results)."""
        if not query or not self.s.exercisedb_api_key:
            return []
        try:
            async with httpx.AsyncClient(timeout=8, headers=self._headers()) as c:
                r = await c.get(EXERCISEDB_SEARCH_URL, params={"search": query})
            data = r.json()
        except (httpx.HTTPError, ValueError):
            return []
        if not isinstance(data, dict) or not data.get("success"):
            return []
        items = data.get("data") or []
        return [
            {"exerciseId": it.get("exerciseId", ""), "name": it.get("name", ""),
             "imageUrl": it.get("imageUrl", "")}
            for it in items[:limit]
        ]

    async def get_details(self, exercise_id: str) -> dict | None:
        """Full exercise record from the API (name/images/instructions/
        muscles/equipment/etc, same shape the migration script wrote into
        exercise_cache), or None on any failure."""
        if not exercise_id or not self.s.exercisedb_api_key:
            return None
        try:
            async with httpx.AsyncClient(timeout=8, headers=self._headers()) as c:
                r = await c.get(EXERCISEDB_DETAILS_URL.format(exercise_id=exercise_id))
            data = r.json()
        except (httpx.HTTPError, ValueError):
            return None
        if not isinstance(data, dict) or not data.get("success") or not data.get("data"):
            return None
        return data["data"]
