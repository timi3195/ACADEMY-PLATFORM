import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import Login from './pages/Login'
import Register from './pages/Register'
import Notes from './pages/Notes'
import PastQuestions from './pages/PastQuestions'
import Courses from './pages/Courses'
import CourseDetail from './pages/CourseDetail'
import CourseMaterials from './pages/CourseMaterials'
import AdminPanel from './pages/AdminPanel'
import AI from './pages/AI'
import Upgrade from './pages/Upgrade'
import { AuthProvider, useAuth } from './utils/auth'
import OAuthCallback from './pages/OAuthCallback'
import VerifyEmail from './pages/VerifyEmail'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import AIChatPage from './pages/AIChatPage'
import AnalyticsDashboard from './pages/AnalyticsDashboard'
import Marketplace from './pages/Marketplace'
import MarketplaceDetail from './pages/MarketplaceDetail'
import Library from './pages/Library'
import Reader from './pages/Reader'
import LecturerDashboard from './pages/LecturerDashboard'
import MainLayout from './layouts/MainLayout'
import AuthLayout from './layouts/AuthLayout'

function Protected({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="flex items-center justify-center h-screen">Loading...</div>
  if (!user) return <Navigate to="/login" replace />
  return <MainLayout>{children}</MainLayout>
}

function PublicOnly({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="flex items-center justify-center h-screen">Loading...</div>
  if (user) return <Navigate to="/" replace />
  return <AuthLayout>{children}</AuthLayout>
}

function AdminOnly({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="flex items-center justify-center h-screen">Loading...</div>
  if (!user) return <Navigate to="/login" replace />
  if (user.role?.toLowerCase() !== 'admin') {
    return (
      <MainLayout>
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center px-6 py-12">
          <div className="max-w-xl w-full bg-white rounded-3xl shadow-xl border border-gray-200 p-10 text-center">
            <h1 className="text-3xl font-bold text-gray-900 mb-4">Access Denied</h1>
            <p className="text-gray-600 mb-6">You need an administrator account to access this page.</p>
            <p className="text-sm text-gray-500">If you should have admin access, check your account role or ask a platform administrator to promote your user.</p>
          </div>
        </div>
      </MainLayout>
    )
  }
  return <MainLayout>{children}</MainLayout>
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        {/* Public Routes */}
        <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
        <Route path="/register" element={<PublicOnly><Register /></PublicOnly>} />
        <Route path="/auth/callback" element={<OAuthCallback />} />
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="/forgot-password" element={<PublicOnly><ForgotPassword /></PublicOnly>} />
        <Route path="/reset-password" element={<PublicOnly><ResetPassword /></PublicOnly>} />

        {/* Protected Routes */}
        <Route path="/" element={<Protected><Dashboard /></Protected>} />
        <Route path="/courses" element={<Protected><Courses /></Protected>} />
        <Route path="/courses/:courseId" element={<Protected><CourseDetail /></Protected>} />
        <Route path="/courses/:courseId/materials" element={<Protected><CourseMaterials /></Protected>} />
        <Route path="/notes" element={<Protected><Notes /></Protected>} />
        <Route path="/past-questions" element={<Protected><PastQuestions /></Protected>} />
        <Route path="/ai" element={<Protected><AI /></Protected>} />
        <Route path="/ai-chat" element={<Protected><AIChatPage /></Protected>} />
        <Route path="/analytics" element={<Protected><AnalyticsDashboard /></Protected>} />
        <Route path="/marketplace" element={<Protected><Marketplace /></Protected>} />
        <Route path="/marketplace/:id" element={<Protected><MarketplaceDetail /></Protected>} />
        <Route path="/reader/:materialId" element={<Protected><Reader /></Protected>} />
        <Route path="/library" element={<Protected><Library /></Protected>} />
        <Route path="/lecturer" element={<Protected><LecturerDashboard /></Protected>} />
        <Route path="/upgrade" element={<Protected><Upgrade /></Protected>} />
        <Route path="/admin" element={<AdminOnly><AdminPanel /></AdminOnly>} />

        {/* Catch all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}
