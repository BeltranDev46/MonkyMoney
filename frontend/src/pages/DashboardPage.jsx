import React, { useEffect, useState, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Wallet,
  Plus,
  UserPlus,
  ArrowRight,
  CheckCircle2,
  Trash2,
  Sparkles,
  Receipt,
  HandCoins,
  Scale,
  LogOut,
  RefreshCw,
} from 'lucide-react'
import { api } from '../services/api'
import { calculateGroupSummary, formatCurrency } from '../utils/balances'
import { useAuth } from '../context/AuthContext'
import ExpenseForm from '../components/ExpenseForm'

export default function DashboardPage() {
  const { user, signOut } = useAuth()
  const { groupId } = useParams()
  const navigate = useNavigate()

  const [groups, setGroups] = useState([])
  const [loadingGroups, setLoadingGroups] = useState(true)
  const [actionError, setActionError] = useState('')

  // Nuevo grupo
  const [showNewGroup, setShowNewGroup] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupMembers, setNewGroupMembers] = useState('')

  // Nuevo amigo en grupo actual
  const [newMemberName, setNewMemberName] = useState('')

  const loadGroups = useCallback(
    async (preferredGroupId = null) => {
      setLoadingGroups(true)
      setActionError('')
      try {
        const loaded = await api.getGroups()
        setGroups(loaded)

        const target = preferredGroupId || groupId
        if (target && loaded.some((g) => g.id === target)) {
          if (groupId !== target) {
            navigate(`/app/groups/${target}`, { replace: true })
          }
        } else if (loaded[0]?.id) {
          navigate(`/app/groups/${loaded[0].id}`, { replace: true })
        }
      } catch (err) {
        if (err.status === 401) {
          await signOut()
          return
        }
        setActionError(
          err.message || 'No se pudieron cargar tus cuentas en este momento.'
        )
      } finally {
        setLoadingGroups(false)
      }
    },
    [groupId, navigate, signOut]
  )

  useEffect(() => {
    loadGroups()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const activeGroup =
    groups.find((g) => g.id === groupId) || groups[0] || null

  const updateSingleGroupInState = (updatedGroup) => {
    setGroups((prev) =>
      prev.map((g) => (g.id === updatedGroup.id ? updatedGroup : g))
    )
  }

  const handleCreateGroup = async (e) => {
    e.preventDefault()
    if (!newGroupName.trim()) return
    setActionError('')
    try {
      const memberList = newGroupMembers
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      const created = await api.createGroup(newGroupName, memberList)
      setGroups((prev) => [created, ...prev])
      setNewGroupName('')
      setNewGroupMembers('')
      setShowNewGroup(false)
      navigate(`/app/groups/${created.id}`)
    } catch (err) {
      setActionError(err.message)
    }
  }

  const handleDeleteGroup = async (id) => {
    setActionError('')
    try {
      const remaining = await api.deleteGroup(id)
      setGroups(remaining)
      if (activeGroup?.id === id) {
        if (remaining[0]?.id) {
          navigate(`/app/groups/${remaining[0].id}`, { replace: true })
        } else {
          navigate('/app', { replace: true })
        }
      }
    } catch (err) {
      setActionError(err.message)
    }
  }

  const handleAddMember = async (e) => {
    e.preventDefault()
    if (!activeGroup || !newMemberName.trim()) return
    setActionError('')
    try {
      const updated = await api.addMember(activeGroup.id, newMemberName)
      updateSingleGroupInState(updated)
      setNewMemberName('')
    } catch (err) {
      setActionError(err.message)
    }
  }

  const handleAddExpense = async (expenseData) => {
    if (!activeGroup) return
    setActionError('')
    try {
      const updated = await api.addExpense(activeGroup.id, expenseData)
      updateSingleGroupInState(updated)
    } catch (err) {
      setActionError(err.message)
    }
  }

  const handleSettle = async (settlement) => {
    if (!activeGroup) return
    setActionError('')
    try {
      const updated = await api.settleDebt(activeGroup.id, settlement)
      updateSingleGroupInState(updated)
    } catch (err) {
      setActionError(err.message)
    }
  }

  const handleDeleteTx = async (txId) => {
    if (!activeGroup) return
    setActionError('')
    try {
      const updated = await api.deleteTransaction(activeGroup.id, txId)
      updateSingleGroupInState(updated)
    } catch (err) {
      setActionError(err.message)
    }
  }

  const handleSeedDemo = async () => {
    setActionError('')
    try {
      const updatedGroups = await api.seedDemoData()
      setGroups(updatedGroups)
      if (updatedGroups[0]?.id) {
        navigate(`/app/groups/${updatedGroups[0].id}`)
      }
    } catch (err) {
      setActionError(err.message)
    }
  }

  const handleLogout = async () => {
    await signOut()
    navigate('/login', { replace: true })
  }

  const summary = activeGroup
    ? calculateGroupSummary(activeGroup)
    : { totalSpent: 0, balances: {}, settlements: [] }

  const getMemberName = (id) =>
    activeGroup?.members.find((m) => m.id === id)?.name || 'Desconocido'

  return (
    <div className="app-layout">
      {/* Sidebar de grupos */}
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">
            <Wallet size={22} />
          </div>
          <div>
            <h1>CuentasClaras</h1>
            <span className="subtitle">Gastos compartidos</span>
          </div>
        </div>

        <div className="sidebar-section">
          <div className="sidebar-header">
            <span>MIS CUENTAS / GRUPOS</span>
            <button
              className="btn-icon"
              title="Crear grupo"
              onClick={() => setShowNewGroup((v) => !v)}
            >
              <Plus size={16} />
            </button>
          </div>

          {showNewGroup && (
            <form className="new-group-box" onSubmit={handleCreateGroup}>
              <input
                type="text"
                placeholder="Nombre (ej. Asado sábado)"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                autoFocus
              />
              <input
                type="text"
                placeholder="Amigos separados por coma (Ana, Luis)"
                value={newGroupMembers}
                onChange={(e) => setNewGroupMembers(e.target.value)}
              />
              <div className="new-group-actions">
                <button type="submit" className="btn-primary btn-sm">
                  Crear
                </button>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => setShowNewGroup(false)}
                >
                  Cancelar
                </button>
              </div>
            </form>
          )}

          <ul className="group-list">
            {groups.map((g) => (
              <li
                key={g.id}
                className={
                  g.id === activeGroup?.id ? 'group-item active' : 'group-item'
                }
                onClick={() => navigate(`/app/groups/${g.id}`)}
              >
                <div className="group-item-info">
                  <strong>{g.name}</strong>
                  <span>{g.members.length} amigos</span>
                </div>
                <button
                  className="btn-delete-group"
                  title="Eliminar grupo"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDeleteGroup(g.id)
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="sidebar-footer">
          <button className="btn-ghost full-width" onClick={handleSeedDemo}>
            <Sparkles size={15} /> Cargar grupo de ejemplo
          </button>

          <div className="user-session-box">
            <span className="user-email" title={user?.email}>
              {user?.email}
            </span>
            <button
              className="btn-ghost btn-sm full-width"
              onClick={handleLogout}
            >
              <LogOut size={14} /> Cerrar sesión
            </button>
          </div>
        </div>
      </aside>

      {/* Contenido principal */}
      <main className="main-content">
        {actionError && (
          <div className="error-msg">
            <span>{actionError}</span>
            <button
              type="button"
              className="btn-link"
              style={{ marginLeft: '10px' }}
              onClick={() => loadGroups()}
            >
              <RefreshCw size={13} /> Reintentar
            </button>
          </div>
        )}

        {loadingGroups ? (
          <div className="empty-state">
            <div className="spinner" />
            <p className="muted">Cargando tus cuentas...</p>
          </div>
        ) : !activeGroup ? (
          <div className="empty-state">
            <h2>¡Hola, {user?.email}!</h2>
            <p>
              Crea tu primer grupo de amigos o carga un grupo de demostración.
            </p>
            <div className="empty-actions">
              <button
                className="btn-primary"
                onClick={() => setShowNewGroup(true)}
              >
                <Plus size={16} /> Nuevo grupo
              </button>
              <button className="btn-secondary" onClick={handleSeedDemo}>
                <Sparkles size={16} /> Cargar grupo de ejemplo
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Encabezado del grupo */}
            <header className="group-header card">
              <div className="group-title-area">
                <div>
                  <h2>{activeGroup.name}</h2>
                  <p className="muted">
                    Gasto total acumulado:{' '}
                    <strong className="total-highlight">
                      {formatCurrency(summary.totalSpent)}
                    </strong>
                  </p>
                </div>
              </div>

              <div className="members-bar">
                <div className="member-chips">
                  {activeGroup.members.map((m) => (
                    <span key={m.id} className="member-chip">
                      {m.name}
                    </span>
                  ))}
                </div>

                <form className="add-member-inline" onSubmit={handleAddMember}>
                  <input
                    type="text"
                    placeholder="Agregar amigo..."
                    value={newMemberName}
                    onChange={(e) => setNewMemberName(e.target.value)}
                  />
                  <button type="submit" className="btn-secondary btn-sm">
                    <UserPlus size={15} /> Agregar
                  </button>
                </form>
              </div>
            </header>

            <div className="workspace-grid">
              {/* Columna izquierda: Formulario + Historial */}
              <section className="col-main">
                <ExpenseForm
                  members={activeGroup.members}
                  onAddExpense={handleAddExpense}
                />

                <div className="card">
                  <div className="card-header">
                    <h3>
                      <Receipt size={18} /> Movimientos (
                      {activeGroup.transactions.length})
                    </h3>
                  </div>

                  {activeGroup.transactions.length === 0 ? (
                    <p className="muted empty-list">
                      Aún no hay gastos registrados en este grupo.
                    </p>
                  ) : (
                    <ul className="tx-list">
                      {activeGroup.transactions.map((tx) => (
                        <li key={tx.id} className="tx-item">
                          {tx.type === 'expense' ? (
                            <div className="tx-body">
                              <div className="tx-main">
                                <strong>{tx.description}</strong>
                                <span className="tx-meta">
                                  Pagó <b>{getMemberName(tx.paidBy)}</b> •{' '}
                                  {tx.splitMode === 'equal'
                                    ? 'Partes iguales'
                                    : 'Consumo separado'}
                                </span>
                                <div className="tx-splits">
                                  {tx.splits.map((s) => (
                                    <span key={s.memberId} className="split-tag">
                                      {getMemberName(s.memberId)}:{' '}
                                      {formatCurrency(s.amount)}
                                    </span>
                                  ))}
                                </div>
                              </div>
                              <div className="tx-right">
                                <span className="tx-amount">
                                  {formatCurrency(tx.amount)}
                                </span>
                                <button
                                  className="btn-icon-danger"
                                  title="Eliminar movimiento"
                                  onClick={() => handleDeleteTx(tx.id)}
                                >
                                  <Trash2 size={15} />
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="tx-body settlement-row">
                              <div className="tx-main">
                                <span className="settlement-badge">
                                  <HandCoins size={14} /> Pago de deuda
                                </span>
                                <span>
                                  <b>{getMemberName(tx.from)}</b> le pagó a{' '}
                                  <b>{getMemberName(tx.to)}</b>
                                </span>
                              </div>
                              <div className="tx-right">
                                <span className="tx-amount positive">
                                  {formatCurrency(tx.amount)}
                                </span>
                                <button
                                  className="btn-icon-danger"
                                  title="Eliminar pago"
                                  onClick={() => handleDeleteTx(tx.id)}
                                >
                                  <Trash2 size={15} />
                                </button>
                              </div>
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>

              {/* Columna derecha: Deudas simplificadas + Balances */}
              <aside className="col-side">
                <div className="card">
                  <div className="card-header">
                    <h3>
                      <HandCoins size={18} /> ¿Quién le debe a quién?
                    </h3>
                  </div>

                  {summary.settlements.length === 0 ? (
                    <div className="all-settled">
                      <CheckCircle2 size={28} />
                      <p>¡Todas las cuentas están saldadas!</p>
                    </div>
                  ) : (
                    <ul className="settlement-list">
                      {summary.settlements.map((s, idx) => (
                        <li key={idx} className="settlement-card">
                          <div className="settlement-names">
                            <strong>{getMemberName(s.from)}</strong>
                            <ArrowRight size={15} className="arrow-icon" />
                            <strong>{getMemberName(s.to)}</strong>
                          </div>
                          <div className="settlement-action">
                            <span className="debt-amount">
                              {formatCurrency(s.amount)}
                            </span>
                            <button
                              className="btn-settle"
                              onClick={() => handleSettle(s)}
                            >
                              Liquidar
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="card">
                  <div className="card-header">
                    <h3>
                      <Scale size={18} /> Balance por amigo
                    </h3>
                  </div>

                  <ul className="balance-list">
                    {activeGroup.members.map((m) => (
                      <li key={m.id} className="balance-row">
                        <span>{m.name}</span>
                        <span
                          className={`bal-value ${
                            (summary.balances[m.id] || 0) > 0.01
                              ? 'bal-pos'
                              : (summary.balances[m.id] || 0) < -0.01
                              ? 'bal-neg'
                              : 'bal-zero'
                          }`}
                        >
                          {(summary.balances[m.id] || 0) > 0.01 ? '+' : ''}
                          {formatCurrency(summary.balances[m.id] || 0)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="balance-footnote">
                    Verde = le deben dinero • Rojo = debe dinero
                  </p>
                </div>
              </aside>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
