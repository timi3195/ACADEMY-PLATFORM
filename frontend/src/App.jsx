import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import Login from './pages/Login'
import Register from './pages/Register'
import Notes from './pages/Notes'
import PastQuestions from './pages/PastQuestions'
import CBTQuiz from './pages/CBTQuiz'
import Courses from './pages/Courses'
import CourseDetail from './pages/CourseDetail'
import CourseMaterials from './pages/CourseMaterials'
import AdminPanel from './pages/AdminPanel'
import AI from './pages/AI'
import Upgrade from './pages/Upgrade'
import Navbar from './components/Navbar'
import { AuthProvider, useAuth } from './utils/auth'
import OAuthCallback from './pages/OAuthCallback'
import VerifyEmail from './pages/VerifyEmail'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'

function Protected({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="flex items-center justify-center h-screen">Loading...</div>
  if (!user) return <Navigate to="/login" replace />
  return children
}

function PublicOnly({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="flex items-center justify-center h-screen">Loading...</div>
  if (user) return <Navigate to="/" replace />
  return children
}

function AdminOnly({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="flex items-center justify-center h-screen">Loading...</div>
  if (!user) return <Navigate to="/login" replace />
  if (user.role?.toLowerCase() !== 'admin') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center px-6 py-12">
        <div className="max-w-xl w-full bg-white rounded-3xl shadow-xl border border-gray-200 p-10 text-center">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">Access Denied</h1>
          <p className="text-gray-600 mb-6">You need an administrator account to access this page.</p>
          <p className="text-sm text-gray-500">If you should have admin access, check your account role or ask a platform administrator to promote your user.</p>
        </div>
      </div>
    )
  }
  return children
}

export default function App() {
  return (
    <AuthProvider>
      <Navbar />
      <div className="container wp-admin-wrap">
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
          <Route path="/cbt" element={<Protected><CBTQuiz /></Protected>} />
          <Route path="/ai" element={<Protected><AI /></Protected>} />
          <Route path="/upgrade" element={<Protected><Upgrade /></Protected>} />
          <Route path="/admin" element={<AdminOnly><AdminPanel /></AdminOnly>} />

          {/* Catch all */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </AuthProvider>
  )
}
