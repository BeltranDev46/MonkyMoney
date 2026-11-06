import React, { useState, useEffect } from 'react'
import { PlusCircle, Users, Calculator, Globe } from 'lucide-react'
import { formatCurrency } from '../utils/balances'
import CurrencyConverterBox from './CurrencyConverterBox'

export default function ExpenseForm({ members, onAddExpense }) {
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [paidBy, setPaidBy] = useState('')
  const [splitMode, setSplitMode] = useState('equal') // 'equal' | 'exact'
  const [selectedIds, setSelectedIds] = useState([])
  const [exactAmounts, setExactAmounts] = useState({})
  const [showFxConverter, setShowFxConverter] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (members.length > 0) {
      if (!paidBy || !members.some((m) => m.id === paidBy)) {
        setPaidBy(members[0].id)
      }
      setSelectedIds(members.map((m) => m.id))
      const initialExact = {}
      members.forEach((m) => {
        initialExact[m.id] = ''
      })
      setExactAmounts(initialExact)
    }
  }, [members])

  if (members.length < 2) {
    return (
      <div className="card empty-hint">
        <p>Agrega al menos <strong>2 amigos</strong> al grupo para empezar a registrar gastos y separar cuentas.</p>
      </div>
    )
  }

  const numericTotal = parseFloat(amount) || 0

  const toggleMember = (id) => {
    setError('')
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    )
  }

  const handleExactChange = (id, val) => {
    setError('')
    setExactAmounts((prev) => ({ ...prev, [id]: val }))
  }

  const sumExact = members.reduce(
    (acc, m) => acc + (parseFloat(exactAmounts[m.id]) || 0),
    0
  )
  const roundedSumExact = Math.round(sumExact * 100) / 100
  const remainingExact = Math.round((numericTotal - roundedSumExact) * 100) / 100

  const autofillTotalFromExact = () => {
    if (roundedSumExact > 0) {
      setAmount(String(roundedSumExact))
      setError('')
    }
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    setError('')

    if (!description.trim()) {
      setError('Escribe un concepto para el gasto (ej. Cena, Uber, Súper).')
      return
    }

    if (numericTotal <= 0) {
      setError('Ingresa un monto mayor a 0.')
      return
    }

    let splits = []

    if (splitMode === 'equal') {
      if (selectedIds.length === 0) {
        setError('Selecciona al menos una persona para dividir el gasto.')
        return
      }
      const count = selectedIds.length
      const baseShare = Math.floor((numericTotal / count) * 100) / 100
      let remainder = Math.round((numericTotal - baseShare * count) * 100) / 100

      splits = selectedIds.map((memberId) => {
        let share = baseShare
        if (remainder > 0.001) {
          share = Math.round((share + 0.01) * 100) / 100
          remainder = Math.round((remainder - 0.01) * 100) / 100
        }
        return { memberId, amount: share }
      })
    } else {
      if (Math.abs(remainingExact) > 0.01) {
        setError(
          `La suma individual (${formatCurrency(roundedSumExact)}) debe coincidir con el total (${formatCurrency(numericTotal)}).`
        )
        return
      }
      splits = members
        .map((m) => ({
          memberId: m.id,
          amount: Math.round((parseFloat(exactAmounts[m.id]) || 0) * 100) / 100,
        }))
        .filter((s) => s.amount > 0)
    }

    onAddExpense({
      description,
      amount: numericTotal,
      paidBy,
      splitMode,
      splits,
    })

    setDescription('')
    setAmount('')
    const resetExact = {}
    members.forEach((m) => {
      resetExact[m.id] = ''
    })
    setExactAmounts(resetExact)
  }

  const equalPreview =
    selectedIds.length > 0 && numericTotal > 0
      ? numericTotal / selectedIds.length
      : 0

  const handleApplyConversion = (quote) => {
    setError('')
    setAmount(String(quote.convertedAmount))
    const suffix = `(${quote.originalAmount} ${quote.from})`
    setDescription((prev) => {
      const trimmed = prev.trim()
      if (!trimmed) {
        return quote.concept ? `${quote.concept} ${suffix}` : `Gasto en ${quote.from} ${suffix}`
      }
      return trimmed.includes(quote.from) ? trimmed : `${trimmed} ${suffix}`
    })
  }

  return (
    <form className="card expense-form" onSubmit={handleSubmit}>
      <div className="card-header expense-card-header">
        <h3>
          <PlusCircle size={18} /> Nuevo gasto / Separar cuenta
        </h3>
        <button
          type="button"
          className={showFxConverter ? 'btn-secondary btn-sm' : 'btn-ghost btn-sm'}
          onClick={() => setShowFxConverter((v) => !v)}
        >
          <Globe size={14} />
          {showFxConverter ? 'Ocultar divisas' : 'Otra moneda (USD, EUR...)'}
        </button>
      </div>

      {showFxConverter && (
        <CurrencyConverterBox
          concept={description}
          participantsCount={splitMode === 'equal' ? selectedIds.length || members.length : members.length}
          onApplyConversion={handleApplyConversion}
        />
      )}

      <div className="form-grid">
        <div className="field">
          <label>Concepto</label>
          <input
            type="text"
            placeholder="Ej. Pizzas, Uber, Cuenta del bar..."
            value={description}
            onChange={(e) => {
              setError('')
              setDescription(e.target.value)
            }}
          />
        </div>

        <div className="field">
          <label>Monto total ($)</label>
          <input
            type="number"
            step="0.01"
            min="0"
            placeholder="0.00"
            value={amount}
            onChange={(e) => {
              setError('')
              setAmount(e.target.value)
            }}
          />
        </div>

        <div className="field">
          <label>¿Quién pagó?</label>
          <select value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="split-mode-tabs">
        <button
          type="button"
          className={splitMode === 'equal' ? 'tab active' : 'tab'}
          onClick={() => {
            setSplitMode('equal')
            setError('')
          }}
        >
          <Users size={15} /> Partes iguales
        </button>
        <button
          type="button"
          className={splitMode === 'exact' ? 'tab active' : 'tab'}
          onClick={() => {
            setSplitMode('exact')
            setError('')
          }}
        >
          <Calculator size={15} /> Separar por consumo exacto
        </button>
      </div>

      {splitMode === 'equal' ? (
        <div className="split-box">
          <div className="split-box-header">
            <span>¿Entre quiénes se divide?</span>
            {numericTotal > 0 && selectedIds.length > 0 && (
              <span className="badge-info">
                {formatCurrency(equalPreview)} c/u
              </span>
            )}
          </div>
          <div className="member-checks">
            {members.map((m) => {
              const checked = selectedIds.includes(m.id)
              return (
                <label
                  key={m.id}
                  className={`check-pill ${checked ? 'selected' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleMember(m.id)}
                  />
                  <span>{m.name}</span>
                </label>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="split-box">
          <div className="split-box-header">
            <span>Cuánto consumió cada quien:</span>
            <div className="exact-summary">
              <span
                className={
                  Math.abs(remainingExact) <= 0.01 && numericTotal > 0
                    ? 'status-ok'
                    : 'status-pending'
                }
              >
                Suma: {formatCurrency(roundedSumExact)}
                {numericTotal > 0 &&
                  (Math.abs(remainingExact) <= 0.01
                    ? ' ✓ Cuadra exacto'
                    : remainingExact > 0
                    ? ` (Faltan ${formatCurrency(remainingExact)})`
                    : ` (Sobran ${formatCurrency(Math.abs(remainingExact))})`)}
              </span>
              {roundedSumExact > 0 && Math.abs(remainingExact) > 0.01 && (
                <button
                  type="button"
                  className="btn-link"
                  onClick={autofillTotalFromExact}
                >
                  Usar {formatCurrency(roundedSumExact)} como total
                </button>
              )}
            </div>
          </div>

          <div className="exact-list">
            {members.map((m) => (
              <div key={m.id} className="exact-row">
                <span>{m.name}</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={exactAmounts[m.id] ?? ''}
                  onChange={(e) => handleExactChange(m.id, e.target.value)}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {error && <p className="error-msg">{error}</p>}

      <button type="submit" className="btn-primary full-width">
        Guardar gasto
      </button>
    </form>
  )
}

