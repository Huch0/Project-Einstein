# PROJECT_CONSTRUCTION.md

> What developers do in the **project construction** stage to stand up repo structure, configs, and tooling—so implementation can start immediately.

---

## 0) Prereqs (one-time)

* **Node**: v20 LTS (`.nvmrc` = `20`)
* **Package manager**: `pnpm` (via `corepack enable` → `corepack prepare pnpm@latest --activate`)
* **Python**: 3.11+ (`.python-version` = `3.11`)
* **Docker** & **Docker Compose**
* Optional: **VS Code** with extensions (ESLint, Prettier, Python, EditorConfig)

---

## 1) Initialize repo & policies

```bash
git init
git branch -M main
```

Create at repo root:

* `.gitignore` (Node + Python + OS; see template below)
* `.editorconfig` (unified whitespace)
* `LICENSE` (choose: MIT/Apache-2.0)
* `.gitattributes` (normalize line endings)
* `CODEOWNERS` (teams per path, optional)

**Branching & commits**

* Branches: `feat/*`, `fix/*`, `chore/*`, `docs/*`
* Commits: **Conventional Commits** (`feat:`, `fix:`, `refactor:`, …)

---

## 2) Monorepo layout

```bash
mkdir -p frontend backend infra .github/workflows
```

```
repo/
  frontend/                  # Next.js + TS UI
    src/components/
    src/pages/               # or app/ if using App Router
    src/state/
    public/
    package.json
    tsconfig.json
    .env.example
  backend/                   # FastAPI + LangGraph + Celery
    app/
      routers/               # ingest, scene, sim, chat
      models/                # Pydantic schemas
      tools/                 # simulation tool functions
      agent/                 # LangGraph graph + nodes
      pipeline/              # diagram conversion
      sim/                   # pybox2d helpers
      pedagogy/              # YAML content
      main.py
    pyproject.toml
    uv.lock
    .env.example
  infra/
    compose.dev.yml          # local Postgres, Redis, MinIO
    Makefile                 # common dev tasks
  .editorconfig
  .gitignore
  .nvmrc
  .python-version
  .npmrc
  README.md
  PROJECT_CONSTRUCTION.md
  .github/workflows/ci.yml
```

---

## 3) Dependency management

### 3.1 Frontend (Next.js + TS)

```bash
cd frontend
pnpm init
pnpm add next react react-dom
pnpm add -D typescript @types/react @types/node eslint prettier \
          eslint-config-next @typescript-eslint/eslint-plugin \
          @typescript-eslint/parser lint-staged husky
# App deps
pnpm add @tanstack/react-query zustand pixi.js konva planck-js socket.io-client zod
```

**Configs to add**

* `tsconfig.json` (strict true)
* `.eslintrc.cjs` (extends `next/core-web-vitals`)
* `.prettierrc` (2-space, semicolons, singleQuote)
* `package.json` scripts:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint . --ext .ts,.tsx",
    "format": "prettier --write ."
  },
  "lint-staged": {
    "*.{ts,tsx,js,jsx,json,css,md}": ["prettier --write", "eslint --fix"]
  }
}
```

* `husky` hooks:

```bash
pnpm dlx husky init
echo 'pnpm lint-staged' > .husky/pre-commit
```

* `.npmrc`:

```
engine-strict=true
auto-install-peers=true
```

### 3.2 Backend (FastAPI + Celery)

```bash
cd backend
curl -LsSf https://astral.sh/uv/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"   # ensure uv is on PATH
uv add fastapi uvicorn[standard] pydantic-settings \
  celery redis psycopg[binary] sqlalchemy \
  boto3 opencv-python-headless pillow numpy \
  python-multipart orjson loguru
# simulation & agent
uv add box2d-py langchain langgraph
# dev
uv add --dev black isort mypy ruff pytest httpx
```

**Configs to add**

* `pyproject.toml` (Black, Ruff, isort profiles)
* `backend/app/main.py` minimal ASGI app
* `backend/app/models/settings.py` using `pydantic-settings`
* `backend/pytest.ini` (test paths, asyncio mode)

---

## 4) Environment variables

**NEVER commit real secrets.** Commit only `*.env.example` files and ignore actual `.env*`.

### 4.1 Frontend `.env.example`

```
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
NEXT_PUBLIC_WS_URL=ws://localhost:8000/ws
NEXT_PUBLIC_S3_PUBLIC_URL=http://localhost:9000
```

### 4.2 Backend `.env.example`

```
APP_ENV=dev
PORT=8000
DATABASE_URL=postgresql+psycopg://app:app@localhost:5432/app
REDIS_URL=redis://localhost:6379/0
S3_ENDPOINT_URL=http://localhost:9000
S3_ACCESS_KEY_ID=minio
S3_SECRET_ACCESS_KEY=minio123
S3_BUCKET=sim-uploads
JWT_SECRET=change-me
OPENAI_API_KEY=sk-...
LANGCHAIN_API_KEY=
LANGCHAIN_TRACING_V2=false
```

**Loading rules**

* Frontend: Next.js auto-loads `.env.local` / `.env.development`
* Backend: `pydantic-settings` reads `.env`; fail fast if required vars missing

---

## 5) Local infra (Docker Compose)

`infra/compose.dev.yml`

```yaml
services:
  db:
    image: postgres:15
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
      POSTGRES_DB: app
    ports: ["5432:5432"]
    volumes: [dbdata:/var/lib/postgresql/data]
  redis:
    image: redis:7
    ports: ["6379:6379"]
  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minio
      MINIO_ROOT_PASSWORD: minio123
    ports: ["9000:9000", "9001:9001"]
    volumes: [miniodata:/data]
volumes:
  dbdata:
  miniodata:
```

**Makefile** (in `infra/Makefile`)

```makefile
up:
\tdocker compose -f infra/compose.dev.yml up -d
down:
\tdocker compose -f infra/compose.dev.yml down
logs:
\tdocker compose -f infra/compose.dev.yml logs -f
```

---

## 6) Quality gates

### 6.1 Root pre-commit (Python + general)

```bash
pipx install pre-commit || python -m pip install --user pre-commit
pre-commit install
```

`.pre-commit-config.yaml`

```yaml
repos:
- repo: https://github.com/psf/black
  rev: 24.8.0
  hooks: [{id: black}]
- repo: https://github.com/charliermarsh/ruff-pre-commit
  rev: v0.6.8
  hooks: [{id: ruff}]
- repo: https://github.com/pre-commit/mirrors-mypy
  rev: v1.10.0
  hooks: [{id: mypy, additional_dependencies: ["pydantic", "sqlalchemy"]}]
- repo: https://github.com/pre-commit/pre-commit-hooks
  rev: v4.6.0
  hooks:
    - {id: end-of-file-fixer}
    - {id: trailing-whitespace}
    - {id: check-merge-conflict}
```

### 6.2 Frontend lint & format

* Runs via **husky** `pre-commit` with `lint-staged`

### 6.3 Back-end type checks

```bash
cd backend && uv run mypy app
```

---

## 7) CI (GitHub Actions)

`.github/workflows/ci.yml` (minimal)

```yaml
name: ci
on: [push, pull_request]
jobs:
  build-test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_USER: app
          POSTGRES_PASSWORD: app
          POSTGRES_DB: app
        ports: ["5432:5432"]
        options: >-
          --health-cmd="pg_isready -U app" --health-interval=10s --health-timeout=5s --health-retries=5
    steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with: { node-version: '20' }
    - name: Frontend deps
      run: |
        corepack enable
        corepack prepare pnpm@latest --activate
        cd frontend && pnpm i && pnpm lint
    - uses: actions/setup-python@v5
      with: { python-version: '3.11' }
    - name: Install uv
      env:
        UV_INSTALL_DIR: ${{ runner.temp }}/uv
      run: |
        curl -LsSf https://astral.sh/uv/install.sh | sh
        echo "${{ runner.temp }}/uv/bin" >> $GITHUB_PATH
    - name: Backend deps & tests
      run: |
        cd backend
        uv sync --dev
        uv run pytest -q
```

---

## 8) Git hygiene & security

* **Secret management**: never commit `.env`—only `.env.example`
* Enable **secret scanning** & **dependabot** in repo settings
* Protect `main` with PR reviews & required status checks

---

## 9) First-run checklist

1. `corepack enable` → `pnpm -v`
2. `nvm use` (or install Node 20), `python -V` (3.11)
3. `cp frontend/.env.example frontend/.env.local` and edit URLs
4. `cp backend/.env.example backend/.env` and set secrets
5. `make -C infra up`
6. `cd backend && uv sync --dev && uv run uvicorn app.main:app --reload`
7. `cd frontend && pnpm i && pnpm dev`
8. Visit **[http://localhost:3000](http://localhost:3000)** (frontend) and **[http://localhost:8000/docs](http://localhost:8000/docs)** (API)

---

## 10) Templates

### 10.1 `.gitignore` (root)

```ignore
# Node
node_modules
pnpm-lock.yaml

# Python
__pycache__/
*.py[cod]
.venv/
.venv*/
.poetry/
.mypy_cache/
.pytest_cache/

# Env & secrets
.env
*.env.local
.env.*

# OS/IDE
.DS_Store
.vscode/
.idea/

# Build
dist/
build/
.next/
```

### 10.2 `.editorconfig`

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
indent_style = space
indent_size = 2
trim_trailing_whitespace = true

[*.py]
indent_size = 4
```

---

## 11) Minimal app stubs (optional but handy)

### 11.1 Backend `app/main.py`

```python
from fastapi import FastAPI
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    APP_ENV: str = "dev"
    class Config: env_file = ".env"

settings = Settings()
app = FastAPI(title="Physics Tutor API")

@app.get("/health")
def health():
    return {"status": "ok", "env": settings.APP_ENV}
```

### 11.2 Frontend `package.json` (scripts)

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint . --ext .ts,.tsx",
    "format": "prettier --write ."
  }
}
```

---

## 12) What’s next (after construction)

* Implement **API routers** (`ingest`, `scene`, `sim`, `chat`)
* Implement **LangGraph agent** & **tool bindings**
* Wire **PixiJS** sim layer & **Konva** ink layer
* Add **Playwright** E2E with one canonical scenario

> Once this checklist is complete, the codebase is ready for feature implementation and team onboarding.
