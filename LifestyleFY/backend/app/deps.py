"""Shared FastAPI dependency providers for services."""
from fastapi import Depends

from .config import Settings, get_settings
from .services.coach import Coach
from .services.food import FoodResolver
from .services.store import Store, get_store

_coach: Coach | None = None
_resolver: FoodResolver | None = None


def store_dep(settings: Settings = Depends(get_settings)) -> Store:
    return get_store(settings)


def resolver_dep(settings: Settings = Depends(get_settings)) -> FoodResolver:
    global _resolver
    if _resolver is None:
        _resolver = FoodResolver(settings, get_store(settings))
    return _resolver


def coach_dep(settings: Settings = Depends(get_settings)) -> Coach:
    global _coach
    if _coach is None:
        _coach = Coach(settings)
    return _coach
