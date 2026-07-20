"""FastAPI entrypoint. Run: uvicorn app.main:app --reload --port 8080"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .routes import router

settings = get_settings()

app = FastAPI(title="Nutrition API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_list,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.get("/")
def root():
    return {"service": "nutrition-api", "stubs": settings.use_stubs,
            "no_auth": settings.dev_no_auth}
