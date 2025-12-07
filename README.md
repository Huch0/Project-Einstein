# Project Einstein

**AI-Powered Physics Simulation & Educational Platform**

Project Einstein is an interactive physics education platform that combines computer vision, AI agents, and real-time physics simulation to help students understand mechanical systems through visual learning.

---

## 🎯 Features

- **📷 Diagram Upload & Recognition**: Upload physics diagrams and automatically detect objects (masses, pulleys, springs, etc.)
- **🤖 AI Physics Tutor**: GPT-powered conversational agent that explains physics concepts and answers questions
- **⚙️ Real-time Physics Simulation**: Matter.js-based 2D rigid body physics engine with accurate simulation
- **🎨 Interactive Whiteboard**: Visual canvas for creating and manipulating simulation boxes
- **📊 Frame-by-Frame Analysis**: Step through simulation frames to observe motion in detail
- **🔧 Entity Editing**: Modify object properties (mass, position, friction) and re-simulate

---

## 🏗️ Architecture

```
Project-Einstein/
├── frontend/          # Next.js 14 + React + TypeScript
│   ├── src/
│   │   ├── app/              # Next.js app router pages
│   │   ├── components/       # Simulation components (controls, renderer, layer)
│   │   ├── whiteboard/       # Whiteboard canvas & simulation boxes
│   │   ├── lib/              # API clients, utilities, test fixtures
│   │   └── simulation/       # Simulation context & state management
│   └── package.json
│
├── backend/           # FastAPI + Python 3.11+
│   ├── app/
│   │   ├── routers/          # API endpoints (chat, diagram, simulation)
│   │   ├── agent/            # AI agent (tools, labeler, context)
│   │   ├── chat/             # Chat engine & service
│   │   ├── sim/              # Physics scene builder & universal builder
│   │   └── models/           # Settings & configuration
│   ├── sim_worker/           # Node.js Matter.js physics worker
│   └── pyproject.toml
│
└── docs/              # Documentation & specifications
```

---

## 🚀 Quick Start

### Prerequisites

- **Frontend**:
  - Node.js 18+ (for Next.js and Matter.js worker)
  - pnpm (recommended) or npm
  
- **Backend**:
  - Python 3.11+
  - `uv` package manager (recommended) or pip
  - OpenAI API key (for GPT-5 agent features)

---

### 1️⃣ Backend Setup

#### Step 1: Install Dependencies

```bash
cd backend
uv sync --dev
```

Or with pip:
```bash
pip install -e .
```

#### Step 2: Configure Environment Variables

Create a `.env` file in the `backend/` directory:

```bash
cd backend
cp .env.example .env  # if .env.example exists
```

Edit `.env` and add the following:

```env
# Environment
APP_ENV=dev

# OpenAI Configuration
OPENAI_API_KEY=sk-...  # Your OpenAI API key
OPENAI_MODEL=gpt-5 

# Chat Settings
CHAT_SYSTEM_PROMPT=You are Project Einstein, an AI physics tutor...
CHAT_AUDIT_LOG_ENABLED=true
CHAT_AUDIT_LOG_PATH=logs/chat-turns.log

# CORS (must match frontend port)
FRONTEND_ORIGIN=http://localhost:9002
```

**Key Settings**:
- `OPENAI_API_KEY`: Required for AI agent features (GPT-powered chat & entity labeling)
- `FRONTEND_ORIGIN`: Must match the frontend dev server port (default: 9002)
- Without OpenAI key, the backend falls back to an echo engine for testing

#### Step 3: Install Matter.js Worker (Optional)

For physics simulation:

```bash
cd backend/sim_worker
npm install
```

**Note**: If not installed, the backend falls back to an analytic solver.

#### Step 4: Start the Backend Server

```bash
cd backend
uv run uvicorn app.main:app --reload
```

Or without `uv`:
```bash
uvicorn app.main:app --reload
```

**Backend runs at**: `http://127.0.0.1:8000`  
**API Docs**: `http://127.0.0.1:8000/docs` (Swagger UI)

**Health Check**:
```bash
curl http://127.0.0.1:8000/health
```

---

### 2️⃣ Frontend Setup

#### Step 1: Install Dependencies

```bash
cd frontend
pnpm install
```

Or with npm:
```bash
npm install
```

#### Step 2: Start the Development Server

```bash
pnpm run dev
```

Or with npm:
```bash
npm run dev
```

**Frontend runs at**: `http://localhost:9002`

**Available Scripts**:
- `pnpm run dev` - Start Next.js dev server with Turbopack (port 9002)
- `pnpm run build` - Build for production
- `pnpm run start` - Start production server
- `pnpm run lint` - Run ESLint
- `pnpm run test` - Run Vitest tests
- `pnpm run typecheck` - TypeScript type checking

---

### 3️⃣ Full Stack Development

Open two terminals:

**Terminal 1 - Backend**:
```bash
cd backend
uv run uvicorn app.main:app --reload
```

**Terminal 2 - Frontend**:
```bash
cd frontend
pnpm run dev
```

Then open `http://localhost:9002` in your browser.

---

## 📖 Usage

### Basic Workflow

1. **Create a Simulation Box** on the whiteboard canvas
2. **Upload a Physics Diagram** (e.g., Atwood machine, pulley system)
3. **AI Agent Processes** the image:
   - Detects objects (masses, pulleys, ropes)
   - Labels entities with physics properties
   - Builds a physics scene
4. **Run Simulation** to see motion
5. **Chat with AI Tutor** to ask questions about the physics
6. **Edit & Re-simulate** by modifying object properties

### Example: Atwood Machine

1. Upload an image showing two masses connected by a rope over a pulley
2. Agent detects: 2 masses, 1 pulley, rope constraint
3. Simulation shows the heavier mass descending
4. Ask: "Why does mass A accelerate faster?"
5. AI explains: "The net force is (m_a - m_b) * g..."

---

## 🧪 Testing

### Backend Tests

```bash
cd backend
uv run pytest
```

Or:
```bash
pytest
```

### Frontend Tests

```bash
cd frontend
pnpm run test
```

---

## 🛠️ Key Technologies

### Frontend
- **Next.js 14** (App Router, React Server Components)
- **TypeScript** (Type-safe development)
- **Matter.js** (2D physics engine)
- **Tailwind CSS** (Styling)
- **Radix UI** (Accessible components)
- **Zustand** (State management for whiteboard)

### Backend
- **FastAPI** (High-performance async API)
- **OpenAI API** (GPT-4/5 for AI agent)
- **Pydantic** (Data validation)
- **Pillow** (Image processing)
- **HTTPX** (Async HTTP client)

---

## 📂 Project Structure Details

### Frontend (`/frontend`)

```
src/
├── app/                    # Next.js app router
│   ├── page.tsx           # Main dashboard page
│   └── layout.tsx         # Root layout
├── components/
│   └── simulation/        # Simulation components
│       ├── simulation-layer.tsx      # Matter.js integration layer
│       ├── simulation-renderer.tsx   # Canvas rendering
│       ├── simulation-controls.tsx   # Playback controls
│       └── agent-chat-panel.tsx      # AI chat interface
├── whiteboard/
│   ├── components/
│   │   └── simulation-box-node.tsx   # Simulation box component
│   ├── context.ts         # Whiteboard state (Zustand)
│   └── types.ts           # Type definitions
├── lib/
│   ├── api.ts             # Backend API client
│   ├── agent-api.ts       # Agent-specific API calls
│   └── test-fixtures.ts   # Sample simulation data
└── simulation/
    └── SimulationContext.tsx  # Global simulation state
```

### Backend (`/backend`)

```
app/
├── main.py                # FastAPI application entry point
├── routers/
│   ├── unified_chat.py    # Chat API endpoints
│   ├── diagram.py         # Image upload & parsing
│   ├── init_sim.py        # Simulation initialization
│   └── run_sim.py         # Simulation execution
├── agent/
│   ├── tool_registry.py   # Available tools for agent
│   ├── labeler.py         # GPT-powered entity labeling
│   └── agent_context.py   # Conversation context management
├── chat/
│   ├── engine.py          # Chat engine (OpenAI, Echo)
│   ├── service.py         # Chat orchestration
│   └── schemas.py         # Pydantic models
├── sim/
│   ├── universal_builder.py  # Scene construction
│   └── schema.py          # Scene data schemas
└── models/
    └── settings.py        # Configuration (env variables)
```

---

## 🔧 Configuration

### Backend Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `APP_ENV` | Environment (dev/prod) | `dev` |
| `OPENAI_API_KEY` | OpenAI API key | (required for AI features) |
| `OPENAI_MODEL` | GPT model name | `gpt-4o` |
| `FRONTEND_ORIGIN` | CORS allowed origin | `http://localhost:9002` |
| `CHAT_AUDIT_LOG_ENABLED` | Enable chat logging | `true` |
| `CHAT_AUDIT_LOG_PATH` | Log file path | `logs/chat-turns.log` |

### Frontend Configuration

- **Dev Server Port**: 9002 (configured in `package.json`)
- **Backend API URL**: Defaults to `http://127.0.0.1:8000`
- **Turbopack**: Enabled for faster development builds

---

## 🐛 Troubleshooting

### Backend Issues

**Problem**: `ModuleNotFoundError` when running uvicorn  
**Solution**: Make sure you're in the `backend/` directory and dependencies are installed:
```bash
cd backend
uv sync --dev
```

**Problem**: CORS errors in browser  
**Solution**: Check that `FRONTEND_ORIGIN` in `.env` matches your frontend port (9002)

**Problem**: OpenAI API errors  
**Solution**: Verify `OPENAI_API_KEY` is set correctly in `.env`

### Frontend Issues

**Problem**: Cannot connect to backend  
**Solution**: Ensure backend is running on port 8000:
```bash
curl http://127.0.0.1:8000/health
```

**Problem**: `pnpm: command not found`  
**Solution**: Install pnpm globally:
```bash
npm install -g pnpm
```

**Problem**: Physics simulation not rendering  
**Solution**: Check browser console for errors. Try reinstalling `backend/sim_worker`:
```bash
cd backend/sim_worker
npm install
```

---

## 📝 API Documentation

Once the backend is running, visit:
- **Swagger UI**: `http://127.0.0.1:8000/docs`
- **ReDoc**: `http://127.0.0.1:8000/redoc`

### Key Endpoints

- `POST /chat` - Send message to AI agent
- `POST /diagram/upload` - Upload physics diagram image
- `POST /init_sim` - Initialize simulation from image
- `POST /run_sim` - Execute physics simulation
- `GET /health` - Health check

---

## 🔗 Additional Resources

- **Frontend README**: [frontend/README.md](frontend/README.md)
- **Backend README**: [backend/README.md](backend/README.md)
- **Documentation**: [docs/](docs/)
- **Architecture Spec**: [backend/ARCHITECTURE_V04.md](backend/ARCHITECTURE_V04.md)

---

