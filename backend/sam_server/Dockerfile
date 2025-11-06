# =====================================================================
# 🧠 Stage 1 — Base image with CUDA 12.1 runtime and Python environment
# =====================================================================
FROM nvidia/cuda:12.1.1-runtime-ubuntu22.04

# Avoid interactive prompts
ENV DEBIAN_FRONTEND=noninteractive

# =====================================================================
# 📦 System setup
# =====================================================================
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        python3 \
        python3-pip \
        python3-venv \
        git \
        libglib2.0-0 \
        libsm6 \
        libxrender1 \
        libxext6 && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# =====================================================================
# 🔧 Copy dependency list and install Python packages
# =====================================================================
COPY requirements-cu121.txt .

# Use pip cache smartly (no .venv inside Docker)
RUN pip install --upgrade pip && \
    pip install --no-cache-dir -r requirements-cu121.txt

# =====================================================================
# 🧾 Copy project files
# =====================================================================
COPY . .

# =====================================================================
# ⚙️ Environment setup
# =====================================================================
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app
EXPOSE 9001

# =====================================================================
# 🚀 Run the FastAPI server
# =====================================================================
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "9001"]
