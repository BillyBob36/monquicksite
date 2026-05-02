# =============================================================================
# monquicksite — Production Dockerfile (Next.js 16 standalone build)
# =============================================================================
# Coolify build : docker build -t monquicksite . && docker run ...
# Build size optimise : multi-stage avec output: 'standalone' dans next.config
# =============================================================================

# ----------- Stage 1 : deps -----------
FROM node:22-alpine AS deps

WORKDIR /app
COPY package.json package-lock.json* ./
# --include=dev : Next.js 16 + Tailwind v4 ont besoin des devDependencies
# (@tailwindcss/postcss notamment) au moment du build pour resoudre les CSS.
RUN npm ci --include=dev --no-audit --no-fund

# ----------- Stage 2 : builder -----------
FROM node:22-alpine AS builder

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generer le client Prisma (depend de schema.prisma)
RUN npx prisma generate

# Build Next.js (mode standalone pour minimiser l'image finale)
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ----------- Stage 3 : runner -----------
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Utilisateur non-root pour la securite
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# Output standalone : Next.js copie uniquement le minimum necessaire
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Prisma schema + generated client (necessaire au runtime pour migrations)
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/src/generated ./src/generated

USER nextjs

EXPOSE 3000

# Healthcheck pour Coolify (utilise par Traefik/Caddy en frontal).
# 127.0.0.1 (pas localhost) car busybox wget d'Alpine resout localhost en
# IPv6 [::1] et Next.js ecoute par defaut sur IPv4 0.0.0.0 -> Connection refused.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
