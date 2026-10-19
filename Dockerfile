# Node.js 20 slim container for Google Cloud Run
FROM node:20-slim

WORKDIR /app

# Copy server package definitions
COPY server/package*.json ./server/

# Install server dependencies
RUN cd server && npm install --omit=dev

# Copy application source code and public web assets
COPY server/ ./server/
COPY public/ ./public/

ENV PORT=8080
EXPOSE 8080

# Start quantitative engine
CMD ["node", "server/server.js"]
