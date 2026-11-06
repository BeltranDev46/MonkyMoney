/**
 * Calcula el balance neto de cada miembro y sugiere las transferencias mínimas
 * para saldar todas las deudas del grupo.
 */
export function calculateGroupSummary(group) {
  const balances = {}
  group.members.forEach((m) => {
    balances[m.id] = 0
  })

  let totalSpent = 0

  for (const item of group.transactions) {
    if (item.type === 'expense') {
      totalSpent += Number(item.amount) || 0
      // El que pagó recibe crédito por el monto total
      if (balances[item.paidBy] !== undefined) {
        balances[item.paidBy] += Number(item.amount)
      }
      // A cada participante se le resta su parte
      for (const split of item.splits) {
        if (balances[split.memberId] !== undefined) {
          balances[split.memberId] -= Number(split.amount)
        }
      }
    } else if (item.type === 'settlement') {
      // Liquidación / pago directo: `from` le paga a `to`
      if (balances[item.from] !== undefined) {
        balances[item.from] += Number(item.amount)
      }
      if (balances[item.to] !== undefined) {
        balances[item.to] -= Number(item.amount)
      }
    }
  }

  // Redondear a 2 decimales
  Object.keys(balances).forEach((id) => {
    balances[id] = Math.round(balances[id] * 100) / 100
  })

  // Algoritmo para simplificar deudas (quién le debe a quién)
  const debtors = []
  const creditors = []

  Object.entries(balances).forEach(([memberId, amount]) => {
    if (amount < -0.01) {
      debtors.push({ memberId, amount: Math.abs(amount) })
    } else if (amount > 0.01) {
      creditors.push({ memberId, amount })
    }
  })

  debtors.sort((a, b) => b.amount - a.amount)
  creditors.sort((a, b) => b.amount - a.amount)

  const settlements = []
  let i = 0
  let j = 0

  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i]
    const creditor = creditors[j]
    const settledAmount = Math.round(Math.min(debtor.amount, creditor.amount) * 100) / 100

    if (settledAmount > 0) {
      settlements.push({
        from: debtor.memberId,
        to: creditor.memberId,
        amount: settledAmount,
      })
    }

    debtor.amount = Math.round((debtor.amount - settledAmount) * 100) / 100
    creditor.amount = Math.round((creditor.amount - settledAmount) * 100) / 100

    if (debtor.amount <= 0.01) i++
    if (creditor.amount <= 0.01) j++
  }

  return {
    totalSpent: Math.round(totalSpent * 100) / 100,
    balances,
    settlements,
  }
}

export function formatCurrency(value) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
  }).format(value || 0)
}

