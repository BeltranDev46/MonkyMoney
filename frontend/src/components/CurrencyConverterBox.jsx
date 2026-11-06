import React, { useEffect, useState } from 'react'
import { Globe, ArrowRightLeft, Check, Trash2, RefreshCw } from 'lucide-react'
import { api } from '../services/api'
import { formatCurrency } from '../utils/balances'

const FALLBACK_CURRENCIES = [
  { code: 'USD', name: 'United States Dollar' },
  { code: 'EUR', name: 'Euro' },
  { code: 'CAD', name: 'Canadian Dollar' },
  { code: 'GBP', name: 'British Pound' },
  { code: 'JPY', name: 'Japanese Yen' },
  { code: 'BRL', name: 'Brazilian Real' },
]

export default function CurrencyConverterBox({
  concept,
  participantsCount = 1,
  onApplyConversion,
}) {
  const [currencies, setCurrencies] = useState(FALLBACK_CURRENCIES)
  const [fromCurrency, setFromCurrency] = useState('USD')
  const [foreignAmount, setForeignAmount] = useState('')
  const [loading, setLoading] = useState(false)
  const [fxError, setFxError] = useState('')
  const [lastQuote, setLastQuote] = useState(null)
  const [history, setHistory] = useState([])

  const loadInitialData = async () => {
    setFxError('')
    try {
      const [currRes, histRes] = await Promise.all([
        api.getFxCurrencies(),
        api.getConversions(5),
      ])
      if (Array.isArray(currRes?.currencies) && currRes.currencies.length > 0) {
        setCurrencies(currRes.currencies.filter((c) => c.code !== 'MXN'))
      }
      if (Array.isArray(histRes?.items)) {
        setHistory(histRes.items)
      }
    } catch (err) {
      setFxError(err.message || 'No se pudo conectar con el microservicio de divisas.')
    }
  }

  useEffect(() => {
    loadInitialData()
  }, [])

  const handleConvert = async () => {
    setFxError('')
    const numeric = parseFloat(foreignAmount)
    if (!numeric || numeric <= 0) {
      setFxError('Ingresa un monto extranjero mayor a 0 para convertir.')
      return
    }

    setLoading(true)
    try {
      const created = await api.convertCurrency({
        concept: concept?.trim() || undefined,
        amount: numeric,
        from: fromCurrency,
        to: 'MXN',
        participants: Math.max(1, participantsCount),
      })
      setLastQuote(created)
      setHistory((prev) => [created, ...prev.filter((item) => item.id !== created.id)].slice(0, 5))
    } catch (err) {
      setFxError(err.message || 'Error al convertir la moneda.')
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteHistoryItem = async (id) => {
    try {
      await api.deleteConversion(id)
      setHistory((prev) => prev.filter((item) => item.id !== id))
      if (lastQuote?.id === id) {
        setLastQuote(null)
      }
    } catch (err) {
      setFxError(err.message)
    }
  }

  return (
    <div className="fx-panel">
      <div className="fx-panel-header">
        <span className="fx-title">
          <Globe size={15} /> Conversor multimoneda en tiempo real (Microservicio FX → MXN)
        </span>
        <button
          type="button"
          className="btn-link"
          onClick={loadInitialData}
          title="Recargar catálogo e historial"
        >
          <RefreshCw size={12} /> Actualizar
        </button>
      </div>

      <div className="fx-controls">
        <div className="field">
          <label>Moneda origen</label>
          <select
            value={fromCurrency}
            onChange={(e) => {
              setFromCurrency(e.target.value)
              setFxError('')
            }}
          >
            {currencies.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>Monto en {fromCurrency}</label>
          <input
            type="number"
            step="0.01"
            min="0"
            placeholder="Ej. 50.00"
            value={foreignAmount}
            onChange={(e) => {
              setForeignAmount(e.target.value)
              setFxError('')
            }}
          />
        </div>

        <button
          type="button"
          className="btn-secondary fx-convert-btn"
          disabled={loading}
          onClick={handleConvert}
        >
          <ArrowRightLeft size={15} />
          {loading ? 'Convirtiendo...' : 'Convertir a MXN'}
        </button>
      </div>

      {fxError && <p className="error-msg fx-error">{fxError}</p>}

      {lastQuote && (
        <div className="fx-quote-card">
          <div className="fx-quote-info">
            <strong>
              {lastQuote.originalAmount} {lastQuote.from} ={' '}
              {formatCurrency(lastQuote.convertedAmount)}
            </strong>
            <span className="fx-rate-meta">
              Tasa oficial ({lastQuote.rateDate}): 1 {lastQuote.from} = {lastQuote.rate} MXN
              {lastQuote.participants > 1 &&
                ` • ${formatCurrency(lastQuote.perPersonAmount)} c/u (${lastQuote.participants} personas)`}
            </span>
          </div>
          <button
            type="button"
            className="btn-primary btn-sm"
            onClick={() => onApplyConversion(lastQuote)}
          >
            <Check size={14} /> Usar en este gasto
          </button>
        </div>
      )}

      {history.length > 0 && (
        <div className="fx-history">
          <span className="fx-history-label">Conversiones recientes guardadas:</span>
          <ul className="fx-history-list">
            {history.map((item) => (
              <li key={item.id} className="fx-history-item">
                <span>
                  <b>
                    {item.originalAmount} {item.from}
                  </b>{' '}
                  → {formatCurrency(item.convertedAmount)}
                  {item.concept ? ` (${item.concept})` : ''}
                </span>
                <div className="fx-history-actions">
                  <button
                    type="button"
                    className="btn-link"
                    onClick={() => onApplyConversion(item)}
                  >
                    Aplicar
                  </button>
                  <button
                    type="button"
                    className="btn-icon-danger"
                    title="Eliminar conversión"
                    onClick={() => handleDeleteHistoryItem(item.id)}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

