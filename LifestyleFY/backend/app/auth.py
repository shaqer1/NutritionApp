"""Auth dependency: verify a Firebase ID token and return the uid.

In local dev with DEV_NO_AUTH=true, verification is skipped and a fixed
'dev-user' uid is returned so you can exercise the API without Firebase.

Beyond a valid token, the caller's email must also appear in the
`config/access` Firestore doc (`allowed_emails` array) — manage that list
from the Firebase Console (Firestore Data tab) without redeploying.
"""
import time

from fastapi import Depends, Header, HTTPException, status

from .config import Settings, get_settings

_firebase_ready = False
_allowlist_cache: set[str] | None = None
_allowlist_cache_at = 0.0
_ALLOWLIST_TTL_SECONDS = 60


def _ensure_firebase() -> None:
    global _firebase_ready
    if _firebase_ready:
        return
    import firebase_admin  # lazy import so offline/stub dev needs no creds

    if not firebase_admin._apps:
        firebase_admin.initialize_app()
    _firebase_ready = True


def _is_allowed(email: str | None, settings: Settings) -> bool:
    if not email:
        return False
    global _allowlist_cache, _allowlist_cache_at
    now = time.monotonic()
    if _allowlist_cache is None or now - _allowlist_cache_at > _ALLOWLIST_TTL_SECONDS:
        from google.cloud import firestore

        fs = firestore.Client(project=settings.gcp_project)
        doc = fs.collection("config").document("access").get()
        _allowlist_cache = set(doc.to_dict().get("allowed_emails", [])) if doc.exists else set()
        _allowlist_cache_at = now
    return email in _allowlist_cache


def current_uid(
    authorization: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> str:
    if settings.dev_no_auth:
        return "dev-user"

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

    if not _is_allowed(decoded.get("email"), settings):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized",
        )
    return decoded["uid"]
