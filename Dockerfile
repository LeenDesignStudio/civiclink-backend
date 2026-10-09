FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
# prisma generate loads prisma.config.ts, which requires this variable. Generate does not connect.
ENV MIGRATION_DATABASE_URL=postgresql://civiclink_owner:build@127.0.0.1:5432/civiclink
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY . .
RUN pnpm install --frozen-lockfile
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
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s CMD node -e "fetch('http://127.0.0.1:4000/healthz').then((res)=>process.exit(res.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
