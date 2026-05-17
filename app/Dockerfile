# Stage 1: production dependencies only
FROM node:24-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci --omit=dev

# Stage 2: compile TypeScript
FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# Stage 3: minimal runtime image
FROM node:24-alpine AS runner

WORKDIR /app

ARG PORT=3000
ENV NODE_ENV=production
ENV PORT=${PORT}

RUN apk add --no-cache wget \
  && addgroup -g 1001 appgroup \
  && adduser -u 1001 -G appgroup -D appuser

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./

RUN chown -R appuser:appgroup /app

USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]
