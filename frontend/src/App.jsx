import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Ruta pública de autenticación */}
          <Route path="/login" element={<LoginPage />} />

          {/* Rutas protegidas con Supabase Auth */}
          <Route element={<ProtectedRoute />}>
            <Route path="/app" element={<DashboardPage />} />
            <Route path="/app/groups/:groupId" element={<DashboardPage />} />
          </Route>

          {/* Redirección por defecto */}
          <Route path="*" element={<Navigate to="/app" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
