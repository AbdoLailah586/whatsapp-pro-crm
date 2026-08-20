# ==========================================
# WhatsApp Pro Enterprise - Production Dockerfile
# Optimized for Koyeb / Render / Railway / VPS
# ==========================================

FROM node:20-bookworm-slim

# Set environment
ENV NODE_ENV=production
ENV PORT=3000

# Install FFmpeg and build essentials for audio processing (Opus PTT)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files first for Docker layer caching
COPY package*.json ./

# Install production dependencies
RUN npm install --omit=dev

# Copy application source
COPY . .

# Create necessary directories
RUN mkdir -p data auth_info src/public/uploads

# Expose web application port
EXPOSE 3000

# Start server
CMD ["node", "src/index.js"]
