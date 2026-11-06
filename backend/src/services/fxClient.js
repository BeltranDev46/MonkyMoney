import { refreshLocalEnv } from '../env.js'

// 45s por defecto para soportar el "cold start" del plan gratuito de Render (~30s tras inactividad)
const DEFAULT_TIMEOUT_MS = 45000

function normalizeBaseUrl(rawUrl) {
  const cleaned = (rawUrl || 'http://localhost:4001/api/v1').trim().replace(/\/+$/, '')
  // Si el usuario pega la URL raíz de Render (ej. https://mi-servicio.onrender.com), agregamos /api/v1 automáticamente
  if (cleaned.endsWith('/api/v1')) {
    return cleaned
  }
  return `${cleaned}/api/v1`
}

function getFxConfig() {
  refreshLocalEnv()
  const baseUrl = normalizeBaseUrl(process.env.FX_SERVICE_URL)
  const apiKey = (process.env.FX_SERVICE_API_KEY || '').trim()
  const timeoutMs = Number(process.env.FX_SERVICE_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS

  return { baseUrl, apiKey, timeoutMs }
}

async function callMicroservice(pathname, { method = 'GET', body, userId, requiresAuth = false } = {}) {
  const { baseUrl, apiKey, timeoutMs } = getFxConfig()

  if (requiresAuth && !apiKey) {
    const err = new Error('Falta configurar FX_SERVICE_API_KEY en backend/.env.')
    err.status = 503
    err.code = 'MISSING_FX_API_KEY'
    err.expose = true
    throw err
  }

  const headers = {
    Accept: 'application/json',
  }

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }

  if (requiresAuth) {
    headers.Authorization = `Bearer ${apiKey}`
  }

  if (userId) {
    headers['X-User-Id'] = String(userId)
  }

  let res
  try {
    res = await fetch(`${baseUrl}${pathname}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (networkErr) {
    const err = new Error(
      `No se pudo conectar con el microservicio de divisas (${baseUrl}). Verifica la URL o espera unos segundos si Render está despertando.`
    )
    err.status = 503
    err.code = 'FX_SERVICE_UNAVAILABLE'
    err.expose = true
    throw err
  }

  const data = await res.json().catch(() => ({}))

  if (!res.ok) {
    const err = new Error(data.error || 'El microservicio de divisas devolvió un error.')
    err.status = res.status
    err.code = data.code || 'FX_SERVICE_ERROR'
    err.details = data.details
    err.expose = true
    throw err
  }

  return data
}

export const fxClient = {
  getCurrencies() {
    return callMicroservice('/currencies')
  },

  getRates({ base = 'MXN', symbols = '' } = {}) {
    const params = new URLSearchParams()
    if (base) params.set('base', base)
    if (symbols) params.set('symbols', symbols)
    const qs = params.toString()
    return callMicroservice(`/rates${qs ? `?${qs}` : ''}`)
  },

  createConversion(userId, payload) {
    return callMicroservice('/conversions', {
      method: 'POST',
      body: payload,
      userId,
      requiresAuth: true,
    })
  },

  listConversions(userId, limit = 10) {
    return callMicroservice(`/conversions?limit=${encodeURIComponent(limit)}`, {
      method: 'GET',
      userId,
      requiresAuth: true,
    })
  },

  deleteConversion(userId, conversionId) {
    return callMicroservice(`/conversions/${encodeURIComponent(conversionId)}`, {
      method: 'DELETE',
      userId,
      requiresAuth: true,
    })
  },
}
