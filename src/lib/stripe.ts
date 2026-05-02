/**
 * Stripe client + helpers pour le flow checkout.
 *
 * Plans :
 *   TWO_YEAR : 9.90 €/mois engagement 24 mois
 *   ONE_YEAR : 17.90 €/mois engagement 12 mois
 *   FLEX     : 29 €/mois sans engagement
 *
 * Pour le supplement domaine premium (cas rare > 12 €/an wholesale OVH),
 * on attache un line item one-time via subscription_data.add_invoice_items
 * pour qu'il soit charge sur la 1ere facture en plus du subscription cycle.
 */

import Stripe from 'stripe'

if (!process.env.STRIPE_SECRET_KEY && process.env.NODE_ENV === 'production') {
  throw new Error('STRIPE_SECRET_KEY env var is required')
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? 'sk_test_placeholder', {
  apiVersion: '2026-04-22.dahlia',
})

export const STRIPE_PLANS = {
  TWO_YEAR: {
    label: 'Engagement 2 ans',
    priceId: process.env.STRIPE_PRICE_2Y!, // a creer dans le Stripe dashboard
    monthlyPriceTtc: 9.9,
    commitment: 24,
  },
  ONE_YEAR: {
    label: 'Engagement 1 an',
    priceId: process.env.STRIPE_PRICE_1Y!,
    monthlyPriceTtc: 17.9,
    commitment: 12,
  },
  FLEX: {
    label: 'Sans engagement',
    priceId: process.env.STRIPE_PRICE_FLEX!,
    monthlyPriceTtc: 29.0,
    commitment: 0,
  },
} as const

export type StripePlanKey = keyof typeof STRIPE_PLANS

/**
 * Cree une session Checkout Stripe pour le signup.
 *
 * @param plan       Le plan choisi par le client
 * @param hostname   Le domaine custom acheter (passe en metadata)
 * @param email      Pre-rempli dans le checkout
 * @param domainSupplementEur  Si > 0, charge en one-time sur la 1ere facture
 */
export async function createCheckoutSession(params: {
  plan: StripePlanKey
  hostname: string
  email: string
  domainSupplementEur?: number
  successUrl: string
  cancelUrl: string
}) {
  const planConfig = STRIPE_PLANS[params.plan]

  // En mode subscription, on peut mixer subscription price + one-time price
  // dans line_items. Stripe charge le one-time sur la 1ere facture, puis
  // continue le subscription cycle.
  type LineItem = NonNullable<Parameters<typeof stripe.checkout.sessions.create>[0]>['line_items'] extends (infer T)[] | undefined ? T : never
  const lineItems: LineItem[] = [
    { price: planConfig.priceId, quantity: 1 },
  ]
  if (params.domainSupplementEur && params.domainSupplementEur > 0) {
    lineItems.push({
      price_data: {
        currency: 'eur',
        product: process.env.STRIPE_PRODUCT_DOMAIN_PREMIUM ?? 'prod_domain_premium',
        unit_amount: Math.round(params.domainSupplementEur * 100),
        // pas de "recurring" -> one-time
      },
      quantity: 1,
    })
  }

  type SubData = NonNullable<Parameters<typeof stripe.checkout.sessions.create>[0]>['subscription_data']
  const subscriptionData: SubData = {
    metadata: {
      hostname: params.hostname,
      plan: params.plan,
      commitment_months: String(planConfig.commitment),
    },
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer_email: params.email,
    line_items: lineItems,
    subscription_data: subscriptionData,
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    locale: 'fr',
    payment_method_types: ['card'],
    automatic_tax: { enabled: true },
    metadata: {
      hostname: params.hostname,
      plan: params.plan,
    },
  })

  return session
}

/**
 * Verifie la signature d'un webhook Stripe.
 * Utilise dans /api/webhooks/stripe pour eviter les fakes events.
 */
export function constructStripeEvent(rawBody: string, signature: string): Stripe.Event {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET env var is required')
  return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)
}
