import { Router } from 'express'
import {
  ACCESS_COOKIE,
  PKCE_COOKIE,
  createStatelessSupabaseClient,
  createPkceSupabaseClient,
  getSupabaseConfig,
  getFrontendOrigin,
  setPkceCookie,
  clearPkceCookie,
  setSessionCookies,
  clearSessionCookies,
} from '../supabase.js'
import { requireAuth } from '../middleware/requireAuth.js'

const router = Router()

function redirectWithAuthError(res, message) {
  const frontendOrigin = getFrontendOrigin()
  const encoded = encodeURIComponent(message)
  return res.redirect(`${frontendOrigin}/login?error=${encoded}`)
}

// GET /api/auth/google — Inicia el flujo OAuth con Google (PKCE en servidor)
router.get('/google', async (_req, res) => {
  try {
    const { url, key } = getSupabaseConfig()
    const frontendOrigin = getFrontendOrigin()

    // Verificar si el proveedor Google ya está habilitado en el proyecto de Supabase
    const settingsRes = await fetch(`${url}/auth/v1/settings`, {
      headers: { apikey: key },
    })
    if (settingsRes.ok) {
      const settings = await settingsRes.json()
      if (!settings?.external?.google) {
        return redirectWithAuthError(
          res,
          'Activa primero el proveedor de Google en tu panel de Supabase (Authentication → Sign In / Providers → Google).'
        )
      }
    }

    const { client, store } = createPkceSupabaseClient()
    const { data, error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${frontendOrigin}/api/auth/callback`,
        skipBrowserRedirect: true,
      },
    })

    if (error || !data?.url) {
      return redirectWithAuthError(
        res,
        error?.message || 'No se pudo iniciar la autenticación con Google.'
      )
    }

    setPkceCookie(res, store)
    return res.redirect(data.url)
  } catch (err) {
    console.error('[Google OAuth Init Error]', err.message)
    return redirectWithAuthError(
      res,
      'No se pudo iniciar sesión con Google. Verifica la configuración del servidor.'
    )
  }
})

// GET /api/auth/callback — Intercambia el código OAuth por sesión en cookies HttpOnly
router.get('/callback', async (req, res) => {
  const frontendOrigin = getFrontendOrigin()
  try {
    const oauthError = req.query.error_description || req.query.error
    if (oauthError) {
      clearPkceCookie(res)
      return redirectWithAuthError(res, String(oauthError))
    }

    const code = typeof req.query.code === 'string' ? req.query.code : ''
    if (!code) {
      clearPkceCookie(res)
      return redirectWithAuthError(
        res,
        'No se recibió el código de autorización de Google.'
      )
    }

    let savedStore = {}
    const rawPkce = req.cookies?.[PKCE_COOKIE]
    if (rawPkce) {
      try {
        savedStore = JSON.parse(rawPkce)
      } catch {
        savedStore = {}
      }
    }

    const { client } = createPkceSupabaseClient(savedStore)
    const { data, error } = await client.auth.exchangeCodeForSession(code)
    clearPkceCookie(res)

    if (error || !data?.session) {
      console.error('[Google OAuth Callback Error]', error?.message)
      return redirectWithAuthError(
        res,
        error?.message || 'No se pudo completar el inicio de sesión con Google.'
      )
    }

    setSessionCookies(res, data.session)
    return res.redirect(`${frontendOrigin}/app`)
  } catch (err) {
    clearPkceCookie(res)
    console.error('[Google OAuth Unexpected Error]', err.message)
    return redirectWithAuthError(
      res,
      'Ocurrió un error al validar la sesión de Google.'
    )
  }
})

// POST /api/auth/signup — Registro desde el servidor
router.post('/signup', async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim()
    const password = String(req.body?.password || '')

    if (!email || password.length < 6) {
      return res.status(400).json({
        error: 'Ingresa un correo válido y una contraseña de al menos 6 caracteres.',
      })
    }

    const supabase = createStatelessSupabaseClient()
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    })

    if (error) {
      return res.status(400).json({ error: error.message })
    }

    if (data?.session) {
      setSessionCookies(res, data.session)
      return res.status(201).json({
        user: {
          id: data.user.id,
          email: data.user.email,
        },
        needsEmailConfirmation: false,
      })
    }

    return res.status(201).json({
      user: data?.user
        ? { id: data.user.id, email: data.user.email }
        : null,
      needsEmailConfirmation: true,
    })
  } catch (err) {
    next(err)
  }
})

// POST /api/auth/login — Inicio de sesión con cookies HttpOnly
router.post('/login', async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim()
    const password = String(req.body?.password || '')

    if (!email || !password) {
      return res.status(400).json({
        error: 'Ingresa tu correo y contraseña.',
      })
    }

    const supabase = createStatelessSupabaseClient()
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error || !data?.session) {
      return res.status(401).json({
        error: error?.message || 'Credenciales inválidas.',
      })
    }

    setSessionCookies(res, data.session)
    return res.json({
      user: {
        id: data.user.id,
        email: data.user.email,
      },
    })
  } catch (err) {
    next(err)
  }
})

// POST /api/auth/logout — Revoca la sesión en Supabase y limpia las cookies HttpOnly
router.post('/logout', async (req, res) => {
  const accessToken = req.cookies?.[ACCESS_COOKIE]
  if (accessToken) {
    try {
      const { url, key } = getSupabaseConfig()
      await fetch(`${url}/auth/v1/logout`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          apikey: key,
        },
      })
    } catch {
      // Aunque falle la revocación remota, siempre borramos las cookies locales
    }
  }

  clearSessionCookies(res)
  res.json({ ok: true })
})

// GET /api/auth/me — Obtiene el usuario actual a partir de la cookie HttpOnly
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user })
})

export default router
