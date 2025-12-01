#!/bin/bash
# Frontend server startup script for external access

echo "🚀 Starting Project Einstein Frontend (External Access Mode)"
echo "📍 Frontend will be accessible at: http://141.223.91.181:9002"
echo "🔗 Backend API: http://141.223.91.181:8000"
echo ""

cd "$(dirname "$0")"

# Check if .env.local file exists
if [ ! -f ".env.local" ]; then
    echo "❌ Error: .env.local file not found!"
    echo "Creating default .env.local..."
    cat > .env.local << EOF
NEXT_PUBLIC_API_URL=http://141.223.91.181:8000
NEXT_PUBLIC_BACKEND_URL=http://141.223.91.181:8000
EOF
    echo "✅ Created .env.local"
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    pnpm install
fi

# Start Next.js on 0.0.0.0:9002
echo "Starting Next.js on 0.0.0.0:9002..."
pnpm dev --hostname 0.0.0.0 --port 9002
