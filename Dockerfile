FROM node:20-alpine AS client-builder
WORKDIR /app/client
COPY client/package*.json ./
RUN npm install
COPY client/ ./
RUN npm run build

FROM node:20-alpine
WORKDIR /app

# Install server deps
COPY server/package*.json ./server/
RUN cd server && npm install --production

# Copy server source
COPY server/ ./server/

# Copy built React client
COPY --from=client-builder /app/client/dist ./client/dist

ENV DATA_DIR=/app/data
ENV PORT=3001

EXPOSE 3001
CMD ["node", "server/index.js"]
