import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'
import cookieParser from 'cookie-parser'
import { generateKeyPair, exportJWK, SignJWT } from 'jose'

describe('Authentication System & Protected Routes (JWKS ES256 + HttpOnly Cookies)', () => {
  let mockAuthServer
  let appServer
  let appBaseUrl
  let privateKey
  let publicJwk

  before(async () => {
    // 1. Generate ephemeral ES256 keypair simulating Supabase Auth JWKS
    const kp = await generateKeyPair('ES256')
    privateKey = kp.privateKey
    publicJwk = await exportJWK(kp.publicKey)
    publicJwk.kid = 'test-es256-key-1'
    publicJwk.alg = 'ES256'
    publicJwk.use = 'sig'

    // 2. Start local mock Supabase Auth server (/.well-known/jwks.json + token refresh + logout)
    const mockExpress = express()
    mockExpress.use(express.json())

    mockExpress.get('/auth/v1/.well-known/jwks.json', (_req, res) => {
      res.json({ keys: [publicJwk] })
    })

    mockExpress.post('/auth/v1/token', async (req, res) => {
      if (req.body?.refresh_token === 'valid-refresh-token') {
        const freshJwt = await new SignJWT({
          email: 'student@utags.edu.mx',
          role: 'authenticated',
        })
          .setProtectedHeader({ alg: 'ES256', kid: 'test-es256-key-1', typ: 'JWT' })
          .setSubject('11111111-2222-4333-8444-555555555555')
          .setIssuer(`${process.env.SUPABASE_URL}/auth/v1`)
          .setIssuedAt()
          .setExpirationTime('1h')
          .sign(privateKey)

        return res.json({
          access_token: freshJwt,
          refresh_token: 'rotated-refresh-token',
          token_type: 'bearer',
          expires_in: 3600,
          user: {
            id: '11111111-2222-4333-8444-555555555555',
            email: 'student@utags.edu.mx',
          },
        })
      }
      return res.status(400).json({ error: 'Invalid refresh token' })
    })

    mockExpress.post('/auth/v1/logout', (_req, res) => {
      res.status(204).end()
    })

    mockAuthServer = http.createServer(mockExpress)
    await new Promise((resolve) => mockAuthServer.listen(0, '127.0.0.1', resolve))
    const mockPort = mockAuthServer.address().port

    // Force production mode so env.js uses injected process.env values without reading local .env
    process.env.NODE_ENV = 'production'
    process.env.SUPABASE_URL = `http://127.0.0.1:${mockPort}`
    process.env.SUPABASE_KEY = 'sb_publishable_test_key'
    process.env.FRONTEND_URL = 'https://monkeymoney-eta.vercel.app'
    process.env.CORS_ORIGIN = 'https://monkeymoney-eta.vercel.app'

    const { requireAuth } = await import('../src/middleware/requireAuth.js')
    const authRouter = (await import('../src/routes/auth.js')).default

    const app = express()
    app.use(cookieParser())
    app.use(express.json())
    app.use('/api/auth', authRouter)
    app.get('/api/protected-resource', requireAuth, (req, res) => {
      res.json({ ok: true, ownerId: req.user.id, email: req.user.email })
    })

    appServer = http.createServer(app)
    await new Promise((resolve) => appServer.listen(0, '127.0.0.1', resolve))
    appBaseUrl = `http://127.0.0.1:${appServer.address().port}`
  })

  after(async () => {
    if (appServer) await new Promise((resolve) => appServer.close(resolve))
    if (mockAuthServer) await new Promise((resolve) => mockAuthServer.close(resolve))
  })

  it('1. Rejects unauthenticated requests without HttpOnly cookie (401 UNAUTHORIZED)', async () => {
    const res = await fetch(`${appBaseUrl}/api/protected-resource`)
    const body = await res.json()
    assert.equal(res.status, 401)
    assert.equal(body.code, 'UNAUTHORIZED')
  })

  it('2. Rejects tampered or forged JWT signatures (401 INVALID_TOKEN)', async () => {
    const validJwt = await new SignJWT({
      email: 'student@utags.edu.mx',
      role: 'authenticated',
    })
      .setProtectedHeader({ alg: 'ES256', kid: 'test-es256-key-1', typ: 'JWT' })
      .setSubject('11111111-2222-4333-8444-555555555555')
      .setIssuer(`${process.env.SUPABASE_URL}/auth/v1`)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey)

    const tamperedJwt = `${validJwt.slice(0, -4)}XXXX`
    const res = await fetch(`${appBaseUrl}/api/protected-resource`, {
      headers: { Cookie: `sb_access_token=${tamperedJwt}` },
    })
    const body = await res.json()
    assert.equal(res.status, 401)
    assert.equal(body.code, 'INVALID_TOKEN')
  })

  it('3. Rejects anonymous tokens with 403 FORBIDDEN (authorization vs authentication)', async () => {
    const anonJwt = await new SignJWT({
      role: 'authenticated',
      is_anonymous: true,
    })
      .setProtectedHeader({ alg: 'ES256', kid: 'test-es256-key-1', typ: 'JWT' })
      .setSubject('99999999-9999-4999-8999-999999999999')
      .setIssuer(`${process.env.SUPABASE_URL}/auth/v1`)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey)

    const res = await fetch(`${appBaseUrl}/api/protected-resource`, {
      headers: { Cookie: `sb_access_token=${anonJwt}` },
    })
    const body = await res.json()
    assert.equal(res.status, 403)
    assert.equal(body.code, 'FORBIDDEN')
  })

  it('4. Grants access on valid ES256 JWT in HttpOnly cookie (200 OK)', async () => {
    const validJwt = await new SignJWT({
      email: 'student@utags.edu.mx',
      role: 'authenticated',
    })
      .setProtectedHeader({ alg: 'ES256', kid: 'test-es256-key-1', typ: 'JWT' })
      .setSubject('11111111-2222-4333-8444-555555555555')
      .setIssuer(`${process.env.SUPABASE_URL}/auth/v1`)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey)

    const res = await fetch(`${appBaseUrl}/api/auth/me`, {
      headers: { Cookie: `sb_access_token=${validJwt}` },
    })
    const body = await res.json()
    assert.equal(res.status, 200)
    assert.equal(body.user.id, '11111111-2222-4333-8444-555555555555')
    assert.equal(body.user.email, 'student@utags.edu.mx')
  })

  it('5. Silently refreshes an expired access token using sb_refresh_token and rotates HttpOnly cookies', async () => {
    const expiredJwt = await new SignJWT({
      email: 'student@utags.edu.mx',
      role: 'authenticated',
    })
      .setProtectedHeader({ alg: 'ES256', kid: 'test-es256-key-1', typ: 'JWT' })
      .setSubject('11111111-2222-4333-8444-555555555555')
      .setIssuer(`${process.env.SUPABASE_URL}/auth/v1`)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(privateKey)

    const res = await fetch(`${appBaseUrl}/api/protected-resource`, {
      headers: {
        Cookie: `sb_access_token=${expiredJwt}; sb_refresh_token=valid-refresh-token`,
      },
    })
    const body = await res.json()
    const setCookieHeader = res.headers.get('set-cookie') || ''

    assert.equal(res.status, 200)
    assert.equal(body.ownerId, '11111111-2222-4333-8444-555555555555')
    assert.match(setCookieHeader, /sb_access_token=/)
    assert.match(setCookieHeader, /HttpOnly/)
    assert.match(setCookieHeader, /Secure/)
    assert.match(setCookieHeader, /SameSite=Lax/)
  })

  it('6. Revokes remote session and clears HttpOnly cookies on POST /api/auth/logout', async () => {
    const res = await fetch(`${appBaseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Cookie: 'sb_access_token=some-token; sb_refresh_token=some-refresh' },
    })
    const body = await res.json()
    const setCookieHeader = res.headers.get('set-cookie') || ''

    assert.equal(res.status, 200)
    assert.equal(body.ok, true)
    assert.match(setCookieHeader, /sb_access_token=;/)
    assert.match(setCookieHeader, /sb_refresh_token=;/)
  })
})
