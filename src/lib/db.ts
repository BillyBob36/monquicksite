/**
 * Prisma client singleton — partagé pour tout le runtime Next.js.
 * En dev (HMR), Next reload les modules et créerait sinon une nouvelle
 * instance Prisma à chaque hot-reload, ce qui sature les connexions PG.
 *
 * Prisma 7+ : on doit passer un adapter (pg) explicite, plus de URL directe.
 */
import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL env var is required')
  }
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  })
}

export const prisma = globalForPrisma.prisma ?? createClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
