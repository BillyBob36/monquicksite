/**
 * OVHcloud Domain API client
 *
 * Doc: https://help.ovhcloud.com/csm/en-gb-api-getting-started?id=kb_article_view&sysparm_article=KB0042777
 * API: https://eu.api.ovh.com/console/
 *
 * OVH auth = consumer key + signature SHA-1 sur chaque requete. Plus complexe
 * que Cloudflare/Stripe mais documente. Voir https://github.com/ovh/node-ovh
 *
 * Workflow lors d'un signup :
 *   1. checkDomain(salonjeanparis.fr) → dispo + prix wholesale
 *   2. createCart() + addDomainToCart() + checkoutCart() → achat
 *   3. setDomainNameservers() OU setDnsRecord() → CNAME @ → customers.monsitehq.com
 *   4. (Cloudflare prend le relais via custom_hostnames)
 */

const OVH_ENDPOINT = process.env.OVH_ENDPOINT ?? 'https://eu.api.ovh.com/1.0'

const OVH_APP_KEY = process.env.OVH_APP_KEY
const OVH_APP_SECRET = process.env.OVH_APP_SECRET
const OVH_CONSUMER_KEY = process.env.OVH_CONSUMER_KEY

/**
 * Calcule la signature OVH (SHA-1 hex) requise sur chaque requete.
 * Format : '$1$' + sha1(SECRET+'+'+CK+'+'+METHOD+'+'+URL+'+'+BODY+'+'+TIMESTAMP)
 */
async function ovhSignature(method: string, url: string, body: string, timestamp: number): Promise<string> {
  const data = `${OVH_APP_SECRET}+${OVH_CONSUMER_KEY}+${method}+${url}+${body}+${timestamp}`
  const buf = new TextEncoder().encode(data)
  const hash = await crypto.subtle.digest('SHA-1', buf)
  const hex = Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `$1$${hex}`
}

async function ovhFetch<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!OVH_APP_KEY || !OVH_APP_SECRET || !OVH_CONSUMER_KEY) {
    throw new Error('OVH credentials missing (OVH_APP_KEY, OVH_APP_SECRET, OVH_CONSUMER_KEY)')
  }
  const url = `${OVH_ENDPOINT}${path}`
  const bodyStr = body ? JSON.stringify(body) : ''
  // OVH expects timestamp in seconds, synced with their server
  const timestamp = Math.floor(Date.now() / 1000)
  const signature = await ovhSignature(method, url, bodyStr, timestamp)

  const res = await fetch(url, {
    method,
    headers: {
      'X-Ovh-Application': OVH_APP_KEY,
      'X-Ovh-Consumer': OVH_CONSUMER_KEY,
      'X-Ovh-Timestamp': String(timestamp),
      'X-Ovh-Signature': signature,
      'Content-Type': 'application/json',
    },
    body: bodyStr || undefined,
  })

  const text = await res.text()
  if (!res.ok) {
    throw new Error(`OVH API ${method} ${path} failed: ${res.status} ${text}`)
  }
  return JSON.parse(text) as T
}

/**
 * Verifie disponibilite + recupere prix d'un domaine.
 * STUB pour l'instant — implementation reelle utilise /order/cart endpoint.
 */
export async function checkDomain(_domain: string): Promise<{
  available: boolean
  priceEurHt: number
  priceEurTtc: number
}> {
  // TODO V1 : implementer via cart-based check OVH
  // 1. POST /order/cart → cart_id
  // 2. POST /order/cart/{cart_id}/domain → ajoute, retourne prix + dispo
  // 3. DELETE /order/cart/{cart_id} → cleanup
  throw new Error('checkDomain not implemented yet — use /order/cart endpoints')
}

/**
 * Achete un domaine (etape 3 du flow signup, apres confirmation Stripe).
 * STUB — implementation reelle :
 * 1. POST /order/cart  → cart_id
 * 2. POST /order/cart/{cart_id}/domain
 * 3. POST /order/cart/{cart_id}/checkout → place order
 * 4. Polling /order/{orderId} jusqu'a status=delivered
 */
export async function registerDomain(_domain: string): Promise<{
  domainId: string
  status: string
}> {
  throw new Error('registerDomain not implemented yet')
}

/**
 * Configure les nameservers d'un domaine OVH.
 * Utilise pour faire pointer vers Cloudflare nameservers une fois le domaine
 * acquis. PUT /domain/{serviceName} avec body { nameServers: [...] }
 */
export async function setDomainNameservers(_domain: string, _nameservers: string[]): Promise<void> {
  throw new Error('setDomainNameservers not implemented yet')
}

/**
 * Cree un record DNS dans la zone OVH d'un domaine.
 * Utilise pour le CNAME @ → customers.monsitehq.com avant que Cloudflare
 * for SaaS prenne le relais.
 */
export async function setDnsRecord(_params: {
  domain: string
  type: 'A' | 'CNAME' | 'TXT'
  subdomain?: string
  target: string
}): Promise<void> {
  throw new Error('setDnsRecord not implemented yet')
}

// =============================================================================
// Auth flow OVH (one-time setup, pas dans le runtime)
// =============================================================================

/**
 * Genere une URL de validation OVH a visiter une fois pour obtenir un
 * consumer_key permanent. A utiliser depuis un script de setup.
 *
 * Usage :
 *   const { validationUrl, consumerKey } = await requestOvhCredential()
 *   console.log("Visite cette URL pour valider :", validationUrl)
 *   // Apres validation manuelle, sauvegarder consumerKey en env var
 */
export async function requestOvhCredential(): Promise<{
  validationUrl: string
  consumerKey: string
}> {
  if (!OVH_APP_KEY) throw new Error('OVH_APP_KEY missing')

  const res = await fetch(`${OVH_ENDPOINT}/auth/credential`, {
    method: 'POST',
    headers: {
      'X-Ovh-Application': OVH_APP_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      accessRules: [
        { method: 'GET', path: '/domain/*' },
        { method: 'GET', path: '/order/cart*' },
        { method: 'POST', path: '/order/cart*' },
        { method: 'PUT', path: '/order/cart*' },
        { method: 'DELETE', path: '/order/cart*' },
        { method: 'PUT', path: '/domain/*' },
        { method: 'POST', path: '/domain/*' },
        { method: 'GET', path: '/me' },
      ],
      redirection: process.env.OVH_REDIRECT_URL ?? 'https://monsitehq.com/admin/ovh-callback',
    }),
  })

  if (!res.ok) {
    throw new Error(`OVH credential request failed: ${res.status} ${await res.text()}`)
  }
  const json = (await res.json()) as { validationUrl: string; consumerKey: string }
  return json
}
