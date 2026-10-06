FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch

FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm install --offline --frozen-lockfile
RUN pnpm exec prisma generate
RUN pnpm build
RUN pnpm prune --prod

FROM node:22-alpine AS runtime
WORKDIR /app
RUN addgroup -S civiclink && adduser -S civiclink -G civiclink
COPY --from=build --chown=civiclink:civiclink /app/package.json ./package.json
COPY --from=build --chown=civiclink:civiclink /app/node_modules ./node_modules
COPY --from=build --chown=civiclink:civiclink /app/dist ./dist
COPY --from=build --chown=civiclink:civiclink /app/prisma ./prisma
USER civiclink
ENV NODE_ENV=production
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s CMD wget -qO- http://127.0.0.1:4000/healthz || exit 1
CMD ["node", "dist/server.js"]
