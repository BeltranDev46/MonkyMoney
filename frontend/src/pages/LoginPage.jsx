import React, { useState, useEffect } from 'react'
import { Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { Wallet, LogIn, UserPlus, CheckCircle2 } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { api } from '../services/api'

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  )
}

export default function LoginPage() {
  const { user, loading, signIn, signUp } = useAuth()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const redirectTo = location.state?.from?.pathname || '/app'

  const [mode, setMode] = useState('signin') // 'signin' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  useEffect(() => {
    const oauthError = searchParams.get('error')
    if (oauthError) {
      setError(oauthError)
      searchParams.delete('error')
      setSearchParams(searchParams, { replace: true })
    }
  }, [searchParams, setSearchParams])

  if (!loading && user) {
    return <Navigate to={redirectTo} replace />
  }

  const handleGoogleLogin = () => {
    setError('')
    window.location.href = api.getGoogleAuthUrl()
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setSuccessMsg('')

    if (!email.trim() || !password) {
      setError('Ingresa tu correo electrónico y contraseña.')
      return
    }
    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres.')
      return
    }

    setSubmitting(true)
    try {
      if (mode === 'signin') {
        await signIn(email, password)
      } else {
        const data = await signUp(email, password)
        if (data?.needsEmailConfirmation) {
          setSuccessMsg(
            '¡Cuenta creada! Revisa tu bandeja de correo para confirmar tu cuenta antes de iniciar sesión.'
          )
          setMode('signin')
          setPassword('')
        }
      }
    } catch (err) {
      setError(err.message || 'No se pudo completar la autenticación.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="card auth-card">
        <div className="auth-brand">
          <div className="brand-icon">
            <Wallet size={24} />
          </div>
          <div>
            <h1>CuentasClaras</h1>
            <p className="muted">Gestiona gastos y deudas entre amigos</p>
          </div>
        </div>

        <button
          type="button"
          className="btn-google full-width"
          onClick={handleGoogleLogin}
        >
          <GoogleIcon />
          <span>Continuar con Google</span>
        </button>

        <div className="auth-divider">
          <span>o con tu correo</span>
        </div>

        <div className="split-mode-tabs">
          <button
            type="button"
            className={mode === 'signin' ? 'tab active' : 'tab'}
            onClick={() => {
              setMode('signin')
              setError('')
            }}
          >
            <LogIn size={15} /> Iniciar sesión
          </button>
          <button
            type="button"
            className={mode === 'signup' ? 'tab active' : 'tab'}
            onClick={() => {
              setMode('signup')
              setError('')
            }}
          >
            <UserPlus size={15} /> Crear cuenta
          </button>
        </div>

        {successMsg && (
          <div className="auth-success">
            <CheckCircle2 size={16} />
            <span>{successMsg}</span>
          </div>
        )}

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="field">
            <label>Correo electrónico</label>
            <input
              type="email"
              placeholder="tu@correo.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </div>

          <div className="field">
            <label>Contraseña</label>
            <input
              type="password"
              placeholder="Mínimo 6 caracteres"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={
                mode === 'signin' ? 'current-password' : 'new-password'
              }
              required
            />
          </div>

          {error && <p className="error-msg">{error}</p>}

          <button
            type="submit"
            className="btn-primary full-width"
            disabled={submitting}
          >
            {submitting
              ? 'Procesando...'
              : mode === 'signin'
              ? 'Entrar a mis cuentas'
              : 'Registrarme'}
          </button>
        </form>
      </div>
    </div>
  )
}
