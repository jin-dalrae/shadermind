FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js database.json ./
COPY public ./public

ENV PORT=8080
ENV AUTOPILOT=true
ENV AUTOPILOT_INTERVAL_MS=45000
ENV AUTOPILOT_SEED_CYCLES=3

EXPOSE 8080

CMD ["node", "server.js"]