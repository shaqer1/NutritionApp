#!/usr/bin/env python3
"""One-off maintenance: wipe the shared Firestore `barcode_cache` collection.

Cached entries written before the Chomp key was live (or before fields like
brand/serving/category existed) will shadow fresh re-fetches forever, since
FoodResolver.resolve_barcode checks the cache first. Run this after adding a
new source/field to force every barcode to be re-resolved from scratch.

Has no effect when USE_STUBS=true — that cache is just an in-memory dict on
the Store instance, cleared by restarting the backend process instead.

Usage (from LifestyleFY/backend/):
    python scripts/reset_barcode_cache.py --yes
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import get_settings  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--yes", action="store_true",
                        help="Actually delete. Without this, just counts docs.")
    args = parser.parse_args()

    settings = get_settings()
    if settings.use_stubs:
        print("USE_STUBS=true — nothing to reset in Firestore. "
              "Just restart the backend process to clear the in-memory cache.")
        return

    from google.cloud import firestore
    client = firestore.Client(project=settings.gcp_project)
    docs = list(client.collection("barcode_cache").stream())

    if not args.yes:
        print(f"Would delete {len(docs)} doc(s) from barcode_cache "
              f"(project={settings.gcp_project}). Re-run with --yes to confirm.")
        return

    batch = client.batch()
    for i, doc in enumerate(docs, start=1):
        batch.delete(doc.reference)
        if i % 500 == 0:  # Firestore batch limit
            batch.commit()
            batch = client.batch()
    batch.commit()
    print(f"Deleted {len(docs)} doc(s) from barcode_cache.")


if __name__ == "__main__":
    main()
