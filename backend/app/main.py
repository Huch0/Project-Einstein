"""FastAPI entry point for Project Einstein backend."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .models.settings import settings
from .routers import chat
from .routers import diagram as diagram_router

app = FastAPI(title="Project Einstein API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ALLOW_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chat.router)
app.include_router(diagram_router.router)


@app.get("/health", tags=["health"])
async def health() -> dict[str, str]:
    """Basic health-check endpoint."""
    return {"status": "ok", "env": settings.APP_ENV}
