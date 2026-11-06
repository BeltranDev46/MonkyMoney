export const BASE_URL = (import.meta.env.VITE_API_URL || '/api')
  .trim()
  .replace(/\/+$/, '')

async function request(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    credentials: 'include', // Envía y recibe cookies HttpOnly de forma segura
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })

  const data = await res.json().catch(() => ({}))

  if (!res.ok) {
    const err = new Error(data.error || `Error HTTP ${res.status}`)
    err.code = data.code
    err.status = res.status
    throw err
  }

  return data
}

/**
 * Cliente HTTP del frontend: solo se comunica con nuestro backend (/api).
 * No maneja tokens en JavaScript ni se conecta a servicios externos.
 */
export const api = {
  getGoogleAuthUrl() {
    return `${BASE_URL}/auth/google`
  },

  // Autenticación (gestionada en el backend vía cookies HttpOnly)
  async getCurrentUser() {
    return request('/auth/me')
  },

  async login(email, password) {
    return request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
  },

  async signup(email, password) {
    return request('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
  },

  async logout() {
    return request('/auth/logout', {
      method: 'POST',
    })
  },

  // Grupos, amigos y gastos
  async getGroups() {
    return request('/groups')
  },

  async createGroup(name, memberNames = []) {
    return request('/groups', {
      method: 'POST',
      body: JSON.stringify({ name, memberNames }),
    })
  },

  async deleteGroup(groupId) {
    return request(`/groups/${groupId}`, {
      method: 'DELETE',
    })
  },

  async addMember(groupId, name) {
    return request(`/groups/${groupId}/members`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    })
  },

  async addExpense(groupId, expensePayload) {
    return request(`/groups/${groupId}/expenses`, {
      method: 'POST',
      body: JSON.stringify(expensePayload),
    })
  },

  async settleDebt(groupId, settlementPayload) {
    return request(`/groups/${groupId}/settlements`, {
      method: 'POST',
      body: JSON.stringify(settlementPayload),
    })
  },

  async deleteTransaction(groupId, txId) {
    return request(`/groups/${groupId}/transactions/${txId}`, {
      method: 'DELETE',
    })
  },

  async seedDemoData() {
    return request('/groups/seed', {
      method: 'POST',
    })
  },

  // Microservicio de divisas (consumido desde el módulo de gastos)
  async getFxCurrencies() {
    return request('/fx/currencies')
  },

  async getFxRates(base = 'MXN', symbols = 'USD,EUR') {
    const params = new URLSearchParams({ base, symbols })
    return request(`/fx/rates?${params.toString()}`)
  },

  async convertCurrency(payload) {
    return request('/fx/conversions', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  async getConversions(limit = 6) {
    return request(`/fx/conversions?limit=${limit}`)
  },

  async deleteConversion(id) {
    return request(`/fx/conversions/${id}`, {
      method: 'DELETE',
    })
  },
}
