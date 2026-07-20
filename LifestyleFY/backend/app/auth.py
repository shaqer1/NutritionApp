"""Auth dependency: verify a Firebase ID token and return the uid.

In local dev with DEV_NO_AUTH=true, verification is skipped and a fixed
'dev-user' uid is returned so you can exercise the API without Firebase.
"""
from fastapi import Depends, Header, HTTPException, status

from .config import Settings, get_settings

_firebase_ready = False


def _ensure_firebase() -> None:
    global _firebase_ready
    if _firebase_ready:
        return
    import firebase_admin  # lazy import so offline/stub dev needs no creds

    if not firebase_admin._apps:
        firebase_admin.initialize_app()
    _firebase_ready = True


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
    return decoded["uid"]
