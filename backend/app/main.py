"""FastAPI entry point for Project Einstein backend (v0.4)."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .models.settings import settings
from .routers import unified_chat  # Unified Ask/Agent chat router
from .routers import diagram as diagram_router

app = FastAPI(title="Project Einstein API", version="0.4.0")

# CORS middleware - must be added before routes
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ALLOW_ORIGINS or ["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["*"],
    max_age=3600,  # Cache preflight for 1 hour
)

# v0.4 Unified Chat Router (replaces chat.py and agent.py)
app.include_router(unified_chat.router)

# Legacy diagram endpoint (kept for compatibility)
app.include_router(diagram_router.router)


@app.get("/health", tags=["health"])
async def health() -> dict[str, str]:
    """Basic health-check endpoint."""
    return {"status": "ok", "env": settings.APP_ENV}
