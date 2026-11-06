import React, { createContext, useContext, useEffect, useState } from 'react'
import { api } from '../services/api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    api
      .getCurrentUser()
      .then((data) => {
        if (mounted) setUser(data.user || null)
      })
      .catch(() => {
        if (mounted) setUser(null)
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })

    return () => {
      mounted = false
    }
  }, [])

  const signIn = async (email, password) => {
    const data = await api.login(email, password)
    setUser(data.user)
    return data
  }

  const signUp = async (email, password) => {
    const data = await api.signup(email, password)
    if (data.user && !data.needsEmailConfirmation) {
      setUser(data.user)
    }
    return data
  }

  const signOut = async () => {
    try {
      await api.logout()
    } finally {
      setUser(null)
    }
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        signIn,
        signUp,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth debe usarse dentro de <AuthProvider>')
  }
  return ctx
}
