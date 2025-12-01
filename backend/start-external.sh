#!/bin/bash
# Backend server startup script for external access

echo "🚀 Starting Project Einstein Backend (External Access Mode)"
echo "📍 Server will be accessible at: http://141.223.91.181:8000"
echo ""

cd "$(dirname "$0")"

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "❌ Error: .env file not found!"
    echo "Please copy .env.example to .env and configure it."
    exit 1
fi

# Start uvicorn with external host binding
echo "Starting uvicorn on 0.0.0.0:8000..."
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# Alternative without reload (for production):
# uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
