# Project Einstein Backend

FastAPI service powering chat, tutoring, simulation, and supporting APIs for Project Einstein.

---

## Contents

- [Project Einstein Backend](#project-einstein-backend)
  - [Contents](#contents)
  - [Prerequisites](#prerequisites)
  - [Environment Setup](#environment-setup)
  - [Running the API](#running-the-api)
  - [Chat Subsystem Overview](#chat-subsystem-overview)
  - [Testing Conversation Flows](#testing-conversation-flows)
  - [Extending the Chat Engine](#extending-the-chat-engine)
  - [Tests](#tests)

---

## Prerequisites

- Python 3.11+
- `uv` package manager (recommended) or `pip`
- OpenAI API key (optional; required for GPT responses)

---

## Environment Setup

Install dependencies and prepare local configuration:

```bash
cd backend
uv sync --dev  # or: pip install -e .
```

Create `backend/.env` (loaded automatically) and populate it with secrets and overrides:

```bash
cp .env.example .env  # create one if needed

cat <<'EOF' >> .env
APP_ENV=dev
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
CHAT_SYSTEM_PROMPT=You are Project Einstein...
FRONTEND_ORIGIN=http://localhost:9002
CHAT_AUDIT_LOG_ENABLED=true
CHAT_AUDIT_LOG_PATH=logs/chat-turns.log
EOF
```

Key settings live in `app/models/settings.py`. They all support environment overrides and sensible defaults for local development. `FRONTEND_ORIGIN` feeds the CORS allow-list so keep it in sync with the dev server port (default `pnpm run dev` → `9002`). Use `CHAT_AUDIT_LOG_ENABLED`/`CHAT_AUDIT_LOG_PATH` to control chat audit logging.

---

## Running the API

Launch the FastAPI app in autoreload mode:

```bash
uv run uvicorn app.main:app --reload
# or without uv: uvicorn app.main:app --reload
```

The service listens on `http://127.0.0.1:8000`. Interactive docs are available at `http://127.0.0.1:8000/docs`.

Health check:

```bash
curl http://127.0.0.1:8000/health
```

---

## Rapier worker (optional, for real physics)

We ship a tiny Node-based worker under `backend/sim_worker/` that runs the Rapier 2D engine. If it's not installed, the backend will fall back to an analytic solver so you still see motion.

Install once:

```powershell
cd backend/sim_worker
npm install
```

Notes:

- If you see an error like `Cannot find module ...@dimforge/rapier2d/exports imported from .../rapier.js`, you're using Node's ESM loader directly with the non-compat build. Our worker uses `@dimforge/rapier2d-compat`, which resolves correctly on Node 18/20/22. Re-run `npm install` inside `backend/sim_worker`.
- Node 18+ is recommended. If you switch Node versions, reinstall the worker dependencies.

The Python backend will automatically spawn this worker when `simulate=1` is passed to `/diagram/parse`.

---

## Chat Subsystem Overview

New chat-focused modules live under `app/chat/` and integrate with FastAPI via `app/routers/chat.py`.

- `chat/schemas.py` — Pydantic models for chat messages, turn requests/responses, and conversation state.
- `chat/repository.py` — In-memory store for conversations; swap with a database-backed repo later.
- `chat/engine.py` — Pluggable engines. Ships with `OpenAIChatEngine` (GPT completions) and `EchoChatEngine` fallback.
- `chat/service.py` — Orchestrates repositories and engines, ensuring conversation lifecycle and validation.

Routing glue (`app/routers/chat.py`) wires the service into FastAPI and chooses the engine at startup based on available settings.

---

## Testing Conversation Flows

1. Start the server (see [Running the API](#running-the-api)).
2. Open Swagger UI at `http://127.0.0.1:8000/docs`.
3. Expand `POST /chat` → **Try it out**.
4. Use the default body (note `conversation_id: null`) and submit.
   - Response contains the assistant turn and `conversation.id`.
5. Copy the conversation ID and send additional turns by pasting it back into the request body.

You can also inspect conversations with:

- `GET /chat/{conversation_id}` — Return a specific conversation.
- `GET /chat` — List all conversations (dev helper).

Without an OpenAI key, the server falls back to the echo engine so local development remains deterministic.

---

## Extending the Chat Engine

- Add new engines by implementing the `ChatEngine` protocol in `chat/engine.py` and wiring them up in `routers/chat.py`.
- Future work: integrate agentic workflows, simulations, or tool-calling by enriching the engine implementation and repository layer.
- Remember to augment schemas/tests when adding new message types or metadata.

---

## Tests

```bash
uv run pytest
# or: pytest
```

Tests currently cover health checks; add coverage alongside new features (e.g., service-level chat tests, repository behavior).
