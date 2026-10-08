# syntax=docker/dockerfile:1

# 1. Install all dependencies (needed to compile).
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci

# 2. Compile TypeScript to dist/.
FROM deps AS build
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

# 3. Production dependencies only.
FROM node:24-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev

# 4. Runtime image: compiled code and production dependencies, run as the non-root node user.
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health/ready > /dev/null || exit 1
# Migrate, seed (idempotent), then replace the shell with node so it receives SIGTERM.
CMD ["sh", "-c", "node dist/infrastructure/database/migrator.js && node dist/infrastructure/database/seed/seed.js && exec node dist/main.js"]
