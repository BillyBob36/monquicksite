/**
 * Page tenant — affichee quand un visiteur arrive sur un domaine custom.
 *
 * Le proxy.ts reecrit `salonjeanparis.fr/` en `/sites/salon-jean-paris/` et
 * pose le slug en header `x-tenant-slug`. On peut aussi le lire depuis l'URL.
 *
 * V1 squelette : on charge le tenant en DB, on rend un layout placeholder.
 * V1.5 : on appliquera les overrides_json (intro, services, photos, etc.).
 */

import { getTenantBySlug } from '@/lib/tenant'
import { notFound } from 'next/navigation'

interface PageProps {
  params: Promise<{ tenant: string }>
}

export default async function TenantHome({ params }: PageProps) {
  const { tenant: slug } = await params
  const tenant = await getTenantBySlug(slug)
  if (!tenant) notFound()

  const intro = (tenant.intro ?? {}) as { title?: string; subtitle?: string; description?: string }

  return (
    <main className="min-h-screen bg-stone-50 text-stone-900">
      <section className="relative bg-stone-900 text-white py-32 px-6 text-center">
        <h1 className="text-5xl font-light tracking-wide">
          {intro.title ?? tenant.name}
        </h1>
        {intro.subtitle && <p className="text-xl mt-4 opacity-80">{intro.subtitle}</p>}
        {tenant.city && <p className="text-sm mt-6 uppercase tracking-widest opacity-60">{tenant.city}</p>}
      </section>

      <section className="max-w-4xl mx-auto py-20 px-6">
        <p className="text-lg leading-relaxed text-stone-700">
          {intro.description ?? `Bienvenue chez ${tenant.name}.`}
        </p>
      </section>

      {tenant.phone && (
        <footer className="bg-stone-100 py-12 text-center">
          <a href={`tel:${tenant.phone}`} className="text-2xl font-semibold underline">
            {tenant.phone}
          </a>
          {tenant.address && <p className="mt-3 text-stone-600">{tenant.address}</p>}
        </footer>
      )}
    </main>
  )
}

export async function generateMetadata({ params }: PageProps) {
  const { tenant: slug } = await params
  const t = await getTenantBySlug(slug)
  if (!t) return {}
  return {
    title: t.name,
    description: (t.intro as { description?: string } | null)?.description ?? `Salon de coiffure ${t.name}${t.city ? ' à ' + t.city : ''}`,
  }
}
