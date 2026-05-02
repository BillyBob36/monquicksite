/**
 * Healthcheck endpoint pour Coolify/Traefik/Cloudflare.
 * Renvoie 200 OK si le process répond, 503 si la DB est down.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET() {
  try {
    // Smoke test : un round-trip a la DB pour valider que tout fonctionne
    await prisma.$queryRaw`SELECT 1`
    return NextResponse.json({ status: 'ok', timestamp: new Date().toISOString() })
  } catch (err) {
    return NextResponse.json(
      { status: 'error', error: err instanceof Error ? err.message : 'unknown' },
      { status: 503 },
    )
  }
}

// Pas de cache, toujours frais
export const dynamic = 'force-dynamic'
