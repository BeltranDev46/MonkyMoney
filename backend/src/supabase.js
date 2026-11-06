import { createClient } from '@supabase/supabase-js'
import { refreshLocalEnv } from './env.js'

export const ACCESS_COOKIE = 'sb_access_token'
export const REFRESH_COOKIE = 'sb_refresh_token'
export const PKCE_COOKIE = 'sb_pkce_state'

export function getSupabaseConfig() {
  refreshLocalEnv()
  const url = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '')
  const key = (
    process.env.SUPABASE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    ''
  ).trim()

  if (!url || !key) {
    const err = new Error(
      'Servicio de autenticación pendiente de configuración en el servidor.'
    )
    err.status = 503
    err.code = 'AUTH_NOT_CONFIGURED'
    throw err
  }

  return { url, key }
}

export function getAllowedOrigins() {
  refreshLocalEnv()
  const raw = process.env.CORS_ORIGIN || process.env.FRONTEND_URL || 'http://localhost:5173'
  return raw
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean)
}

export function getFrontendOrigin() {
  refreshLocalEnv()
  const explicit = (process.env.FRONTEND_URL || '').trim().replace(/\/+$/, '')
  if (explicit) return explicit
  const origins = getAllowedOrigins()
  return origins[0] || 'http://localhost:5173'
}

function getCookieSecurityOptions() {
  const frontendOrigin = getFrontendOrigin()
  const configuredSameSite = (process.env.COOKIE_SAME_SITE || 'lax').trim().toLowerCase()
  const sameSite = ['lax', 'strict', 'none'].includes(configuredSameSite)
    ? configuredSameSite
    : 'lax'

  const secure =
    sameSite === 'none' ||
    process.env.NODE_ENV === 'production' ||
    frontendOrigin.startsWith('https://')

  return { secure, sameSite }
}

/**
 * Crea un cliente Supabase sin estado en memoria (seguro para peticiones concurrentes en Express).
 */
export function createStatelessSupabaseClient() {
  const { url, key } = getSupabaseConfig()
  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  })
}

/**
 * Crea un cliente Supabase temporal para flujo OAuth PKCE respaldado por un diccionario en cookie HttpOnly.
 */
export function createPkceSupabaseClient(initialStore = {}) {
  const { url, key } = getSupabaseConfig()
  const store = { ...initialStore }

  const client = createClient(url, key, {
    auth: {
      flowType: 'pkce',
      autoRefreshToken: false,
      persistSession: true,
      detectSessionInUrl: false,
      storageKey: 'sb-pkce',
      storage: {
        getItem: (k) => store[k] ?? null,
        setItem: (k, v) => {
          store[k] = v
        },
        removeItem: (k) => {
          delete store[k]
        },
      },
    },
  })

  return { client, store }
}

export function setPkceCookie(res, store) {
  const { secure, sameSite } = getCookieSecurityOptions()
  res.cookie(PKCE_COOKIE, JSON.stringify(store), {
    httpOnly: true,
    secure,
    sameSite,
    path: '/api/auth',
    maxAge: 5 * 60 * 1000,
  })
}

export function clearPkceCookie(res) {
  const { secure, sameSite } = getCookieSecurityOptions()
  res.clearCookie(PKCE_COOKIE, {
    httpOnly: true,
    secure,
    sameSite,
    path: '/api/auth',
  })
}

export function setSessionCookies(res, session) {
  const { secure, sameSite } = getCookieSecurityOptions()

  res.cookie(ACCESS_COOKIE, session.access_token, {
    httpOnly: true,
    secure,
    sameSite,
    path: '/api',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  })

  if (session.refresh_token) {
    res.cookie(REFRESH_COOKIE, session.refresh_token, {
      httpOnly: true,
      secure,
      sameSite,
      path: '/api',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    })
  }
}

export function clearSessionCookies(res) {
  const { secure, sameSite } = getCookieSecurityOptions()
  const opts = {
    httpOnly: true,
    secure,
    sameSite,
    path: '/api',
  }
  res.clearCookie(ACCESS_COOKIE, opts)
  res.clearCookie(REFRESH_COOKIE, opts)
}
