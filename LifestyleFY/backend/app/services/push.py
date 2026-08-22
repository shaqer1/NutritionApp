"""Web push notification sends via Firebase Cloud Messaging.

Reads device tokens from the Store, sends through firebase-admin, and prunes
any token FCM reports as dead so a stale registration doesn't get retried
forever.
"""
from __future__ import annotations

import logging

from .store import Store

log = logging.getLogger(__name__)

_firebase_ready = False

# FCM error codes that mean the token is permanently gone — safe to prune.
_DEAD_TOKEN_CODES = {"NOT_FOUND", "UNREGISTERED", "INVALID_ARGUMENT"}


def ensure_firebase_ready() -> None:
    """Lazily initializes the firebase_admin app (mirrors app/auth.py's
    _ensure_firebase) — shared so other modules (e.g. the admin
    revoke-by-email route) don't need their own copy."""
    global _firebase_ready
    if _firebase_ready:
        return
    import firebase_admin

    if not firebase_admin._apps:
        firebase_admin.initialize_app()
    _firebase_ready = True


def send_to_user(store: Store, uid: str, title: str, body: str, data: dict[str, str] | None = None) -> None:
    tokens = store.list_device_tokens(uid)
    if tokens:
        _send(store, uid, tokens, title, body, data)


def send_to_users(store: Store, uids: list[str], title: str, body: str,
                  data: dict[str, str] | None = None) -> None:
    for uid in uids:
        send_to_user(store, uid, title, body, data)


def _send(store: Store, uid: str, tokens: list[str], title: str, body: str,
         data: dict[str, str] | None) -> None:
    if store.stub:
        return  # no real FCM calls in stub/offline mode
    ensure_firebase_ready()
    from firebase_admin import messaging

    message = messaging.MulticastMessage(
        tokens=tokens,
        notification=messaging.Notification(title=title, body=body),
        data=data or {},
    )
    response = messaging.send_each_for_multicast(message)
    for token, result in zip(tokens, response.responses):
        if result.success:
            continue
        code = getattr(result.exception, "code", "")
        if code in _DEAD_TOKEN_CODES:
            store.remove_device_token(uid, token)
        else:
            log.warning("FCM send failed for uid=%s token=%s: %s", uid, token, result.exception)
