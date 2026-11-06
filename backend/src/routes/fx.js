import { Router } from 'express'
import { fxClient } from '../services/fxClient.js'

const router = Router()

// GET /api/fx/currencies — Catálogo de monedas desde el microservicio REST
router.get('/currencies', async (_req, res, next) => {
  try {
    const data = await fxClient.getCurrencies()
    res.json(data)
  } catch (err) {
    next(err)
  }
})

// GET /api/fx/rates — Tipos de cambio actuales desde el microservicio REST
router.get('/rates', async (req, res, next) => {
  try {
    const { base = 'MXN', symbols = 'USD,EUR' } = req.query
    const data = await fxClient.getRates({ base, symbols })
    res.json(data)
  } catch (err) {
    next(err)
  }
})

// GET /api/fx/conversions — Historial de conversiones del usuario autenticado
router.get('/conversions', async (req, res, next) => {
  try {
    const data = await fxClient.listConversions(req.user.id, req.query.limit || 8)
    res.json(data)
  } catch (err) {
    next(err)
  }
})

// POST /api/fx/conversions — Convertir gasto en moneda extranjera (endpoint protegido en microservicio)
router.post('/conversions', async (req, res, next) => {
  try {
    const created = await fxClient.createConversion(req.user.id, req.body)
    res.status(201).json(created)
  } catch (err) {
    next(err)
  }
})

// DELETE /api/fx/conversions/:id — Eliminar conversión guardada
router.delete('/conversions/:id', async (req, res, next) => {
  try {
    const deleted = await fxClient.deleteConversion(req.user.id, req.params.id)
    res.json(deleted)
  } catch (err) {
    next(err)
  }
})

export default router

