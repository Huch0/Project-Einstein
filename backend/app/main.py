"""FastAPI entry point for Project Einstein backend (v0.5)."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .models.settings import settings
from .routers import unified_chat  # Unified Ask/Agent chat router
from .routers import diagram as diagram_router
from .routers import init_sim  # v0.5: Automated initialization
from .routers import run_sim   # v0.5: Simulation execution

app = FastAPI(title="Project Einstein API", version="0.5.0")

# CORS middleware - must be added before routes
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ALLOW_ORIGINS or ["http://localhost:9002"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["*"],
    max_age=3600,  # Cache preflight for 1 hour
)

# v0.4 Unified Chat Router (replaces chat.py and agent.py)
app.include_router(unified_chat.router)

# v0.5 New Workflow Routers
app.include_router(init_sim.router)  # Automated initialization
app.include_router(run_sim.router)   # Simulation execution

# Legacy diagram endpoint (kept for compatibility)
app.include_router(diagram_router.router)


@app.get("/health", tags=["health"])
async def health() -> dict[str, str]:
    """Basic health-check endpoint."""
    return {"status": "ok", "env": settings.APP_ENV}
