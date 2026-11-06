import { createRemoteJWKSet, jwtVerify } from 'jose'
import { refreshLocalEnv } from '../env.js'
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  createStatelessSupabaseClient,
  setSessionCookies,
  clearSessionCookies,
} from '../supabase.js'

let cachedUrl = null
let cachedJwks = null

function getJwksAndIssuer() {
  refreshLocalEnv()
  const rawUrl = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '')

  if (!rawUrl) {
    const err = new Error('Falta configurar SUPABASE_URL en las variables de entorno.')
    err.status = 503
    err.code = 'MISSING_SUPABASE_URL'
    throw err
  }

  if (cachedUrl !== rawUrl || !cachedJwks) {
    cachedJwks = createRemoteJWKSet(
      new URL(`${rawUrl}/auth/v1/.well-known/jwks.json`)
    )
    cachedUrl = rawUrl
  }

  return {
    jwks: cachedJwks,
    issuer: `${rawUrl}/auth/v1`,
  }
}

function buildUserFromPayload(payload) {
  if (!payload?.sub || payload.role !== 'authenticated' || payload.is_anonymous === true) {
    return null
  }
  // Nunca usamos `user_metadata` para autorización
  return {
    id: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : null,
  }
}

/**
 * Verifica el JWT almacenado en la cookie HttpOnly (con renovación automática si expiró).
 */
export async function requireAuth(req, res, next) {
  try {
    const accessToken = req.cookies?.[ACCESS_COOKIE]
    const refreshToken = req.cookies?.[REFRESH_COOKIE]

    if (!accessToken && !refreshToken) {
      return res.status(401).json({
        code: 'UNAUTHORIZED',
        error: 'Sesión requerida.',
      })
    }

    const { jwks, issuer } = getJwksAndIssuer()

    if (accessToken) {
      try {
        const { payload } = await jwtVerify(accessToken, jwks, { issuer })
        const user = buildUserFromPayload(payload)
        if (!user) {
          clearSessionCookies(res)
          return res.status(403).json({
            code: 'FORBIDDEN',
            error: 'Cuenta no autorizada.',
          })
        }
        req.user = user
        return next()
      } catch (verifyErr) {
        if (verifyErr?.code !== 'ERR_JWT_EXPIRED' || !refreshToken) {
          clearSessionCookies(res)
          return res.status(401).json({
            code: 'INVALID_TOKEN',
            error: 'Tu sesión expiró. Vuelve a iniciar sesión.',
          })
        }
      }
    }

    // Renovación silenciosa en servidor con refresh_token
    const supabase = createStatelessSupabaseClient()
    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: refreshToken,
    })

    if (error || !data?.session?.access_token) {
      clearSessionCookies(res)
      return res.status(401).json({
        code: 'SESSION_EXPIRED',
        error: 'Tu sesión expiró. Vuelve a iniciar sesión.',
      })
    }

    const { payload } = await jwtVerify(data.session.access_token, jwks, { issuer })
    const user = buildUserFromPayload(payload)
    if (!user) {
      clearSessionCookies(res)
      return res.status(403).json({
        code: 'FORBIDDEN',
        error: 'Cuenta no autorizada.',
      })
    }

    setSessionCookies(res, data.session)
    req.user = user
    return next()
  } catch (err) {
    if (err.status === 503) {
      return next(err)
    }
    clearSessionCookies(res)
    return res.status(401).json({
      code: 'UNAUTHORIZED',
      error: 'No se pudo verificar tu sesión.',
    })
  }
}
