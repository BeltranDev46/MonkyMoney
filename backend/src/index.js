import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import './env.js'
import { checkDbStatus, closePool } from './db.js'
import { getAllowedOrigins } from './supabase.js'
import { requireAuth } from './middleware/requireAuth.js'
import authRouter from './routes/auth.js'
import groupsRouter from './routes/groups.js'
import fxRouter from './routes/fx.js'

const app = express()
const PORT = Number(process.env.PORT) || 3001

// Necesario detrás de proxies inversos como Render y Vercel Rewrites
app.disable('x-powered-by')
app.set('trust proxy', 1)

// Cabeceras básicas de seguridad HTTP
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  next()
})

app.use(
  cors({
    origin(origin, callback) {
      // Permite peticiones sin cabecera Origin (health checks de Render, proxy mismo origen de Vercel, curl)
      if (!origin) return callback(null, true)
      const normalized = origin.trim().replace(/\/+$/, '')
      const allowed = getAllowedOrigins()
      if (allowed.includes(normalized)) {
        return callback(null, true)
      }
      return callback(new Error(`Origen no permitido por CORS: ${origin}`))
    },
    credentials: true,
  })
)

app.use(cookieParser())
app.use(express.json({ limit: '256kb' }))

// Health check para Render (sin exponer detalles internos)
app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

// Rutas de autenticación (manejan cookies HttpOnly desde el servidor)
app.use('/api/auth', authRouter)

// Rutas protegidas de la aplicación
app.use('/api/groups', requireAuth, groupsRouter)
app.use('/api/fx', requireAuth, fxRouter)

// Manejador global de errores
app.use((err, _req, res, _next) => {
  const isConfigError =
    err.code === 'MISSING_DATABASE_URL' ||
    err.code === 'INVALID_DATABASE_URL' ||
    err.code === 'MISSING_SUPABASE_URL' ||
    err.code === 'AUTH_NOT_CONFIGURED'

  const status = err.status || (isConfigError ? 503 : 500)
  console.error('[Backend Error]', err.message)

  res.status(status).json({
    code: err.code || 'INTERNAL_ERROR',
    error: isConfigError
      ? 'El servidor tiene variables pendientes de configurar.'
      : err.expose
      ? err.message
      : 'No se pudo completar la operación en el servidor.',
    ...(Array.isArray(err.details) && err.details.length > 0
      ? { details: err.details }
      : {}),
  })
})

const server = app.listen(PORT, '0.0.0.0', async () => {
  console.log(`🚀 Backend escuchando en puerto ${PORT}`)
  const db = await checkDbStatus()
  if (db.connected) {
    console.log('✅ Conectado a PostgreSQL y tablas listas.')
  } else {
    console.warn(`⚠️  PostgreSQL pendiente: ${db.error}`)
  }
})

// Cierre limpio cuando Render despliega una nueva versión (SIGTERM)
async function shutdown(signal) {
  console.log(`Recibido ${signal}, cerrando servidor...`)
  server.close(async () => {
    await closePool()
    process.exit(0)
  })
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
