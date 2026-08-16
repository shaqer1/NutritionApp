"""Auth dependency: verify a Firebase ID token and return the uid.

In local dev with DEV_NO_AUTH=true, verification is skipped and a fixed
'dev-user' uid is returned so you can exercise the API without Firebase.

Beyond a valid token, the caller's email must also appear in the
`config/access` Firestore doc (`allowed_emails` array) — manage that list
from the Firebase Console (Firestore Data tab) without redeploying.

That same doc holds an optional `roles` map — `{email: {"isAiAdmin": bool,
"isAppAdmin": bool}}` — checked by `require_ai_prompt_admin` to gate who can
edit the shared AI standing notes. Simple boolean flags for now; expand the
map (new flag names, per-role scopes, etc.) without touching this file's
caching/lookup plumbing.
"""
import time

from fastapi import Depends, Header, HTTPException, status

from .config import Settings, get_settings

_firebase_ready = False
_access_cache: dict | None = None
_access_cache_at = 0.0
_ACCESS_CACHE_TTL_SECONDS = 60


def _ensure_firebase() -> None:
    global _firebase_ready
    if _firebase_ready:
        return
    import firebase_admin  # lazy import so offline/stub dev needs no creds

    if not firebase_admin._apps:
        firebase_admin.initialize_app()
    _firebase_ready = True


def _get_access_doc(settings: Settings) -> dict:
    """Cached `{"emails": set[str], "roles": dict[str, dict[str, bool]]}`,
    refreshed at most once per _ACCESS_CACHE_TTL_SECONDS."""
    global _access_cache, _access_cache_at
    now = time.monotonic()
    if _access_cache is None or now - _access_cache_at > _ACCESS_CACHE_TTL_SECONDS:
        from google.cloud import firestore

        fs = firestore.Client(project=settings.gcp_project)
        doc = fs.collection("config").document("access").get()
        data = doc.to_dict() or {}
        _access_cache = {
            "emails": set(data.get("allowed_emails", [])),
            "roles": data.get("roles", {}),
        }
        _access_cache_at = now
    return _access_cache


def _is_allowed(email: str | None, settings: Settings) -> bool:
    if not email:
        return False
    return email in _get_access_doc(settings)["emails"]


def _roles_for(email: str | None, settings: Settings) -> dict:
    if not email:
        return {}
    return _get_access_doc(settings)["roles"].get(email, {})


def current_identity(
    authorization: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> tuple[str, str]:
    """Returns (uid, email). Powers current_uid and the role-gated
    dependencies below — kept private-ish (not a route dependency on its
    own) since most routes only need the uid half."""
    if settings.dev_no_auth:
        return "dev-user", "dev-user@local"

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token",
        )
    token = authorization.split(" ", 1)[1]

    _ensure_firebase()
    from firebase_admin import auth as fb_auth

    try:
        decoded = fb_auth.verify_id_token(token)
    except Exception as exc:  # invalid/expired token
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
        ) from exc

    email = decoded.get("email")
    if not _is_allowed(email, settings):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized",
        )
    return decoded["uid"], email


def current_uid(identity: tuple[str, str] = Depends(current_identity)) -> str:
    return identity[0]


def current_roles(
    identity: tuple[str, str] = Depends(current_identity),
    settings: Settings = Depends(get_settings),
) -> dict:
    """Dev mode is treated as holding every role, matching how DEV_NO_AUTH
    already bypasses the allowlist check entirely."""
    if settings.dev_no_auth:
        return {"isAiAdmin": True, "isAppAdmin": True}
    _uid, email = identity
    return _roles_for(email, settings)


def require_ai_prompt_admin(roles: dict = Depends(current_roles)) -> None:
    if not (roles.get("isAiAdmin") or roles.get("isAppAdmin")):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Requires the AI Admin or App Admin role",
        )


def require_app_admin(roles: dict = Depends(current_roles)) -> None:
    """Gates user/role management specifically — isAiAdmin alone is not
    enough (that flag only covers AI system-prompt editing)."""
    if not roles.get("isAppAdmin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Requires the App Admin role",
        )
