/**
 * monquicksite — Next.js 16 Proxy (formerly middleware)
 *
 * Routing multi-tenant par hostname :
 *   - monsitehq.com / www.monsitehq.com → marketing landing (route group `(marketing)`)
 *   - outil.monsitehq.com               → agency admin (route group `(agency-admin)`)
 *   - {anything}.monsitehq.com (sous-domaines clients) → tenant site
 *   - {custom-domain.fr} (Cloudflare for SaaS proxied)  → tenant site
 *
 * Pour les tenants : on rewrite vers /sites/[slug]/... où [slug] est resolu en
 * DB par hostname (avec cache LRU pour eviter un PG lookup par requete).
 */

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { resolveTenantSlug } from '@/lib/tenant'

const PRIMARY_DOMAIN = process.env.PRIMARY_DOMAIN ?? 'monsitehq.com'
const AGENCY_HOSTNAME = process.env.AGENCY_HOSTNAME ?? `outil.${PRIMARY_DOMAIN}`
const FALLBACK_INTERNAL_HOSTNAME =
  process.env.FALLBACK_INTERNAL_HOSTNAME ?? `customers.${PRIMARY_DOMAIN}`

export async function proxy(request: NextRequest) {
  const url = request.nextUrl
  const hostHeader = request.headers.get('host') ?? ''
  const hostname = hostHeader.split(':')[0].toLowerCase()

  // =========================================================================
  // 1) Bypass : assets statiques, _next, api, favicon — pas de routing tenant
  // =========================================================================
  if (
    url.pathname.startsWith('/_next/') ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/static/') ||
    url.pathname === '/favicon.ico' ||
    url.pathname === '/robots.txt' ||
    url.pathname === '/sitemap.xml'
  ) {
    return NextResponse.next()
  }

  // =========================================================================
  // 2) Domaine primaire : marketing + landing
  // =========================================================================
  if (hostname === PRIMARY_DOMAIN || hostname === `www.${PRIMARY_DOMAIN}`) {
    // Le route group (marketing) est la home/landing. Rewrite explicite
    // vers /(marketing)/... — Next gere automatiquement les groupes mais on
    // peut les rendre explicites si jamais on veut isoler le rendu.
    return NextResponse.next()
  }

  // =========================================================================
  // 3) Agency admin (toi, equipe) sur outil.monsitehq.com
  // =========================================================================
  if (hostname === AGENCY_HOSTNAME) {
    const newUrl = url.clone()
    newUrl.pathname = `/agency-admin${url.pathname}`
    return NextResponse.rewrite(newUrl)
  }

  // =========================================================================
  // 4) Fallback origin Cloudflare (jamais accede directement par un humain
  //    en prod normalement, mais sert pour healthchecks Cloudflare)
  // =========================================================================
  if (hostname === FALLBACK_INTERNAL_HOSTNAME) {
    if (url.pathname === '/cf-health') {
      return new NextResponse('ok', { status: 200 })
    }
    return new NextResponse('No tenant for this host', { status: 404 })
  }

  // =========================================================================
  // 5) Custom domain client (acheté chez OVH, proxy par Cloudflare for SaaS)
  //    OU sous-domaine de prevue (tenant.monsitehq.com pour staging)
  // =========================================================================
  const tenantSlug = await resolveTenantSlug(hostname)
  if (!tenantSlug) {
    // Hostname inconnu : 404 propre
    return new NextResponse('Site introuvable', { status: 404 })
  }

  const newUrl = url.clone()
  newUrl.pathname = `/sites/${tenantSlug}${url.pathname}`
  // On passe le slug en header pour que les server components puissent y
  // acceder sans avoir a re-resoudre.
  const response = NextResponse.rewrite(newUrl)
  response.headers.set('x-tenant-slug', tenantSlug)
  return response
}

export const config = {
  // Match TOUT sauf les patterns deja exclus dans le code (defense en
  // profondeur). Le matcher Next.js est moins flexible que les checks JS.
  matcher: [
    /*
     * Match tous les paths sauf :
     * - api routes  (gerees a part)
     * - _next/static
     * - _next/image
     * - favicon, robots, sitemap
     */
    '/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)',
  ],
}
