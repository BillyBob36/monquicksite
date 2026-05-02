/**
 * Cloudflare for SaaS — Custom Hostnames API client
 *
 * Doc: https://developers.cloudflare.com/api/operations/custom-hostname-for-a-zone-create-custom-hostname
 *
 * Workflow lors d'un signup :
 *   1. addCustomHostname(salonjeanparis.fr) → CF emet le cert + commence verification
 *   2. pollHostnameStatus(id) → on attend status="active" (cert deploye)
 *   3. Une fois active, le site est joignable via https://salonjeanparis.fr
 */

const CF_API = 'https://api.cloudflare.com/client/v4'

const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN
const CF_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID // zone monsitehq.com

if (!CF_TOKEN && process.env.NODE_ENV === 'production') {
  throw new Error('CLOUDFLARE_API_TOKEN env var is required')
}

interface CustomHostname {
  id: string
  hostname: string
  status: 'active' | 'pending' | 'active_redeploying' | 'moved' | 'deleted' | 'pending_deletion' | 'pending_blocked' | 'pending_migration' | 'pending_provisioning' | 'test_pending' | 'test_active' | 'test_active_apex' | 'test_blocked' | 'test_failed' | 'provisioned' | 'blocked'
  ssl: {
    status: string
    method: string
    type: string
    [key: string]: unknown
  }
  verification_errors?: string[]
  ownership_verification?: { type: string; name: string; value: string }
  created_at: string
}

async function cfFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${CF_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${CF_TOKEN}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  const json = (await res.json()) as { success: boolean; result: T; errors?: { message: string }[] }

  if (!json.success) {
    const msg = json.errors?.map((e) => e.message).join('; ') ?? `HTTP ${res.status}`
    throw new Error(`Cloudflare API error: ${msg}`)
  }
  return json.result
}

/**
 * Ajoute un hostname client a Cloudflare for SaaS.
 * Cloudflare va automatiquement valider DNS (CNAME → fallback origin)
 * puis emettre un cert Let's Encrypt en quelques secondes a quelques minutes.
 */
export async function addCustomHostname(hostname: string): Promise<CustomHostname> {
  if (!CF_ZONE_ID) throw new Error('CLOUDFLARE_ZONE_ID env var is required')
  return cfFetch<CustomHostname>(`/zones/${CF_ZONE_ID}/custom_hostnames`, {
    method: 'POST',
    body: JSON.stringify({
      hostname,
      ssl: {
        method: 'http',
        type: 'dv',
        settings: {
          min_tls_version: '1.2',
        },
      },
    }),
  })
}

/**
 * Recupere le statut d'un custom hostname (pour polling pendant provisioning).
 */
export async function getCustomHostname(id: string): Promise<CustomHostname> {
  if (!CF_ZONE_ID) throw new Error('CLOUDFLARE_ZONE_ID env var is required')
  return cfFetch<CustomHostname>(`/zones/${CF_ZONE_ID}/custom_hostnames/${id}`)
}

/**
 * Supprime un custom hostname (utilise quand un client annule sa souscription).
 */
export async function deleteCustomHostname(id: string): Promise<void> {
  if (!CF_ZONE_ID) throw new Error('CLOUDFLARE_ZONE_ID env var is required')
  await cfFetch(`/zones/${CF_ZONE_ID}/custom_hostnames/${id}`, { method: 'DELETE' })
}

/**
 * Poll until le hostname est active OU echec OU timeout.
 * Retourne le hostname final.
 */
export async function waitForHostnameActive(
  id: string,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<CustomHostname> {
  const timeout = options.timeoutMs ?? 5 * 60 * 1000 // 5 min
  const interval = options.intervalMs ?? 5000 // 5 s
  const start = Date.now()

  while (Date.now() - start < timeout) {
    const hostname = await getCustomHostname(id)
    if (hostname.status === 'active' || hostname.status === 'provisioned') {
      return hostname
    }
    if (hostname.status.startsWith('test_failed') || hostname.status === 'blocked') {
      throw new Error(`Hostname ${id} failed: status=${hostname.status}`)
    }
    await new Promise((r) => setTimeout(r, interval))
  }
  throw new Error(`Hostname ${id} did not become active within ${timeout}ms`)
}

/**
 * DNS records utility : crée le CNAME nécessaire pour la verification HTTP
 * (utilisé pour les sous-domaines de monsitehq.com seulement, pas pour les
 * domaines clients chez OVH où on configure depuis l'API OVH).
 */
export async function addDnsRecord(params: {
  type: 'A' | 'CNAME' | 'TXT'
  name: string
  content: string
  proxied?: boolean
}) {
  if (!CF_ZONE_ID) throw new Error('CLOUDFLARE_ZONE_ID env var is required')
  return cfFetch(`/zones/${CF_ZONE_ID}/dns_records`, {
    method: 'POST',
    body: JSON.stringify({
      type: params.type,
      name: params.name,
      content: params.content,
      proxied: params.proxied ?? false,
      ttl: 1, // auto
    }),
  })
}
