/**
 * Tenant resolution : hostname -> tenant slug, avec cache LRU en memoire.
 *
 * Le proxy.ts fait UN appel a `resolveTenantSlug(host)` par requete HTTP.
 * Sans cache, on tape Postgres a chaque page chargee → bottleneck garanti
 * a 1k+ sites. Cache LRU 1024 entrees, TTL 5 min.
 */

import { prisma } from './db'
import { TenantStatus } from '@/generated/prisma/enums'

interface CacheEntry {
  slug: string | null // null = hostname connu mais pas de tenant actif (404 cached)
  expiresAt: number
}

const CACHE_SIZE = 1024
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 min

// Map JS preserve l'ordre d'insertion → utilisable comme LRU naive.
const cache = new Map<string, CacheEntry>()

function cacheGet(key: string): string | null | undefined {
  const entry = cache.get(key)
  if (!entry) return undefined
  if (Date.now() > entry.expiresAt) {
    cache.delete(key)
    return undefined
  }
  // Touch : reposition en fin (LRU recency)
  cache.delete(key)
  cache.set(key, entry)
  return entry.slug
}

function cacheSet(key: string, slug: string | null) {
  // Evict le plus ancien si full
  if (cache.size >= CACHE_SIZE) {
    const firstKey = cache.keys().next().value
    if (firstKey) cache.delete(firstKey)
  }
  cache.set(key, { slug, expiresAt: Date.now() + CACHE_TTL_MS })
}

/**
 * Invalidate une entree du cache (a appeler depuis l'API admin quand un
 * tenant change de hostname ou est supprime).
 */
export function invalidateTenant(hostname: string) {
  cache.delete(hostname.toLowerCase())
}

/**
 * Resout un hostname en slug de tenant.
 * Retourne null si hostname inconnu OU tenant pas en LIVE.
 */
export async function resolveTenantSlug(hostname: string): Promise<string | null> {
  const key = hostname.toLowerCase()
  const cached = cacheGet(key)
  if (cached !== undefined) return cached

  try {
    const tenant = await prisma.tenant.findUnique({
      where: { hostname: key },
      select: { slug: true, status: true },
    })

    const slug =
      tenant && (tenant.status === TenantStatus.LIVE || tenant.status === TenantStatus.PROVISIONING)
        ? tenant.slug
        : null

    cacheSet(key, slug)
    return slug
  } catch (err) {
    // En cas d'erreur DB (postgres down), on cache pas et on log
    console.error('[tenant] DB error resolving hostname', key, err)
    return null
  }
}

/**
 * Charge un tenant complet par slug (utilise par les pages /sites/[tenant]).
 */
export async function getTenantBySlug(slug: string) {
  return prisma.tenant.findUnique({
    where: { slug },
  })
}
