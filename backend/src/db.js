import pg from 'pg'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { refreshLocalEnv } from './env.js'

const { Pool } = pg
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SCHEMA_PATH = path.resolve(__dirname, '../sql/schema.sql')

let pool = null
let activeUrl = null
let schemaInitialized = false

function buildPoolConfig(connectionString) {
  let cleanUrl = connectionString
  try {
    const parsed = new URL(connectionString)
    parsed.searchParams.delete('pgbouncer')
    cleanUrl = parsed.toString()
  } catch {
    // Si falla el parseo estándar se pasa tal cual a pg
  }

  const isLocal =
    cleanUrl.includes('localhost') ||
    cleanUrl.includes('127.0.0.1')

  return {
    connectionString: cleanUrl,
    max: Number(process.env.DB_POOL_MAX) || 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 8000,
    keepAlive: true,
    ssl: isLocal ? false : { rejectUnauthorized: false },
  }
}

function formatDbError(err) {
  if (
    err?.code === 'ENOTFOUND' &&
    typeof err?.hostname === 'string' &&
    err.hostname.startsWith('db.') &&
    err.hostname.endsWith('.supabase.co')
  ) {
    return `El host directo (${err.hostname}) usa solo IPv6 y esta red usa IPv4. En Supabase abre "Connect" → cambia Method a "Session pooler" (host aws-...pooler.supabase.com:5432).`
  }
  return err?.message || String(err)
}

/**
 * Obtiene o inicializa el Pool de PostgreSQL (Supabase / Neon).
 */
export async function getPool() {
  refreshLocalEnv()
  const url = (process.env.DATABASE_URL || '').trim()

  if (!url) {
    const err = new Error(
      'Falta configurar DATABASE_URL con la cadena de conexión PostgreSQL.'
    )
    err.code = 'MISSING_DATABASE_URL'
    throw err
  }

  if (url.startsWith('http://') || url.startsWith('https://')) {
    const err = new Error(
      `DATABASE_URL tiene una URL web (${url}) en lugar de una URI PostgreSQL.`
    )
    err.code = 'INVALID_DATABASE_URL'
    throw err
  }

  if (!url.startsWith('postgres://') && !url.startsWith('postgresql://')) {
    const err = new Error(
      'DATABASE_URL debe comenzar con postgresql:// o postgres://'
    )
    err.code = 'INVALID_DATABASE_URL'
    throw err
  }

  if (url.includes('[YOUR-PASSWORD]')) {
    const err = new Error(
      'Reemplaza [YOUR-PASSWORD] en DATABASE_URL con la contraseña real de tu base de datos.'
    )
    err.code = 'INVALID_DATABASE_URL'
    throw err
  }

  if (!pool || activeUrl !== url) {
    if (pool) {
      await pool.end().catch(() => {})
    }
    pool = new Pool(buildPoolConfig(url))
    // Evita que desconexiones inactivas del pooler tumben el proceso en Render
    pool.on('error', (idleErr) => {
      console.error('[PG Pool Idle Error]', idleErr.message)
    })
    activeUrl = url
    schemaInitialized = false
  }

  try {
    if (!schemaInitialized) {
      const schemaSql = await fs.readFile(SCHEMA_PATH, 'utf8')
      await pool.query(schemaSql)
      schemaInitialized = true
    }
  } catch (err) {
    err.message = formatDbError(err)
    throw err
  }

  return pool
}

export async function checkDbStatus() {
  try {
    const currentPool = await getPool()
    const res = await currentPool.query('SELECT NOW() AS server_time')
    return {
      connected: true,
      serverTime: res.rows[0].server_time,
    }
  } catch (err) {
    return {
      connected: false,
      code: err.code || 'DB_ERROR',
      error: formatDbError(err),
    }
  }
}

export async function closePool() {
  if (pool) {
    await pool.end().catch(() => {})
    pool = null
    schemaInitialized = false
  }
}
