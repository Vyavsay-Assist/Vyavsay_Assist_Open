FROM node:20-slim

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy source and build
COPY tsconfig.json ./
COPY src/ ./src/
COPY database/ ./database/
RUN npm run build

# Create auth sessions directory
RUN mkdir -p /app/auth_sessions_v2

EXPOSE 3005

ENV NODE_ENV=production
ENV PORT=3005

CMD ["node", "dist/server.js"]
