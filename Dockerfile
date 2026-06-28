FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js database.json ./
COPY lib ./lib
COPY storage ./storage
COPY scripts ./scripts
COPY public ./public

ENV PORT=8080
ENV AUTOPILOT=true
ENV AUTOPILOT_INTERVAL_MS=0
ENV AUTOPILOT_SEED_CYCLES=3
ENV GENERATION_MODE=fast
ENV EVOLUTION_ASYNC=true

EXPOSE 8080

CMD ["node", "server.js"]