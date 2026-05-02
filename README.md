# monquicksite

SaaS d'auto-deployment de sites web pour coiffeurs FR. Demo IS the trial : on
envoie un cold email avec une démo pré-construite, le coiffeur peut basculer
sa démo en site vraiment en ligne en moins de 5 minutes via Stripe Checkout.

## Architecture

```
Internet
  ↓
Cloudflare for SaaS         ← gestion custom hostnames clients
  ↓                           (TLS auto + WAF + DDoS L7 + CDN)
Hetzner cx33 VPS            ← 138.201.152.222 (Falkenstein)
  ↓
Coolify (déploiement)
  ↓
Next.js multi-tenant        ← cette codebase
  ↓
Postgres tenants
```

## Stack

- **Next.js 16** (App Router) + React 19 + TypeScript
- **Tailwind v4** pour le styling
- **Prisma** pour Postgres
- **Auth.js v5** (magic links via Resend)
- **Stripe Checkout** pour les souscriptions
- **OVHcloud Domain API** pour l'achat automatisé de domaines
- **Cloudflare for SaaS API** pour les custom hostnames + TLS

## Logique multi-tenant

Le fichier `src/proxy.ts` (Next.js 16 a renommé `middleware.ts` → `proxy.ts`)
résout le hostname HTTP en un slug de tenant via lookup Postgres avec cache LRU
en mémoire (5 min TTL, 1024 entrées). La requête est ensuite réécrite vers
`/sites/[slug]/...`.

| Hostname | Route |
|---|---|
| `monsitehq.com` | landing marketing |
| `outil.monsitehq.com` | admin agence |
| `customers.monsitehq.com` | Cloudflare for SaaS Fallback Origin |
| `salonjean.fr` (custom client) | rewrite vers `/sites/salon-jean-paris/` |

## Tarification (V1)

| Plan | Prix/mois TTC | Engagement |
|---|---|---|
| 2 ans | 9,90 € | 24 mois |
| 1 an | 17,90 € | 12 mois |
| Flex | 29,00 € | aucun |

## Workflow signup automatisé

1. Stripe webhook `checkout.session.completed` → idempotency check
2. OVHcloud API : achat du domaine (premier moment où l'argent sort)
3. OVHcloud API : `CNAME @` → `customers.monsitehq.com`
4. Cloudflare API : `POST /custom_hostnames` avec le hostname client
5. Postgres : `INSERT tenants` avec status `LIVE`
6. Resend : email de confirmation
7. Site live sous 5 min

## Dev local

```bash
cp .env.example .env
# remplir DATABASE_URL, AUTH_SECRET, etc.
npx prisma generate
npx prisma migrate dev
npm run dev
```

## Deploy

Coolify (sur VPS Hetzner cx33 dédié, séparé du Coolify de l'agence) build
l'image Docker depuis ce repo et expose l'app derrière Cloudflare for SaaS.
Voir `Dockerfile` pour le build multi-stage standalone.

## Structure du repo

```
src/
├── proxy.ts                   ← routing multi-tenant par hostname
├── lib/
│   ├── db.ts                  ← Prisma client singleton
│   ├── tenant.ts              ← lookup hostname → slug + cache LRU
│   ├── cloudflare.ts          ← Cloudflare for SaaS API
│   ├── ovh.ts                 ← OVHcloud Domain API
│   └── stripe.ts              ← Stripe Checkout + plans
├── app/
│   ├── page.tsx               ← landing monsitehq.com
│   ├── api/health/route.ts    ← healthcheck Coolify/CF
│   ├── sites/[tenant]/        ← site rendu d'un client
│   ├── admin/                 ← admin coiffeur (magic link)
│   └── agency-admin/          ← admin agence (toi)
└── generated/prisma/          ← Prisma client généré
prisma/schema.prisma           ← schéma DB (tenants, users, jobs)
```
