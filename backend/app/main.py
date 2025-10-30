"""FastAPI entry point for Project Einstein backend (v0.4)."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .models.settings import settings
from .routers import unified_chat  # Unified Ask/Agent chat router
from .routers import diagram as diagram_router

app = FastAPI(title="Project Einstein API", version="0.4.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ALLOW_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# v0.4 Unified Chat Router (replaces chat.py and agent.py)
app.include_router(unified_chat.router)

# Legacy diagram endpoint (kept for compatibility)
app.include_router(diagram_router.router)


@app.get("/health", tags=["health"])
async def health() -> dict[str, str]:
    """Basic health-check endpoint."""
    return {"status": "ok", "env": settings.APP_ENV}
