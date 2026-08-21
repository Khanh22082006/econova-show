# Base image
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package descriptors first for caching
COPY package.json ./

# Install dependencies (production only)
RUN npm install --omit=dev

# Copy application source code
COPY . .

# Environment configuration
ENV NODE_ENV=production
ENV PORT=3000

# Expose port
EXPOSE 3000

# Start server
CMD ["node", "src/server.js"]
