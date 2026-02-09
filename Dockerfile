# Multi-stage Dockerfile for deploying the Node + Python (Whisper) app
FROM node:20-bullseye AS base

# Install system deps (ffmpeg, python3, pip)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    python3-pip \
    python3-venv \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy node files
COPY package*.json ./
RUN npm ci --only=production

# Copy Python requirements and install
COPY requirements.txt ./
RUN python3 -m pip install --upgrade pip setuptools wheel && \
    python3 -m pip install --no-cache-dir -r requirements.txt || true

# Copy app
COPY . .

ENV PATH="/app/node_modules/.bin:$PATH"

# Expose default port for some hosts (not required for Telegram bots)
EXPOSE 3000

CMD ["npm", "start"]
