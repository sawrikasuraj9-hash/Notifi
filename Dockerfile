FROM node:20-slim

# Install system dependencies (ffmpeg for media, git, curl)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    git \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# node:20-slim already provides a non-root "node" user with UID 1000 (matches Hugging Face Spaces)
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm config set allow-git all && npm install

# Copy project source
COPY . .

# Build frontend production bundle
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000 7860 8080

# Give permissions to user
RUN chown -R node:node /app
USER node

# Run application server
CMD ["npm", "start"]
