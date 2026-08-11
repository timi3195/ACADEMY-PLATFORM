import React, { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../utils/auth'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const { login, isAuthenticated, API_BASE } = useAuth()
  const navigate = useNavigate()

  // Redirect if already logged in
  useEffect(() => {
    if (isAuthenticated) {
      navigate('/')
    }
  }, [isAuthenticated, navigate])

  const handleEmailLogin = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      if (!email) {
        throw new Error('Please enter your email')
      }
      if (!password) {
        throw new Error('Please enter your password')
      }

      await login(email, password, rememberMe)
      navigate('/')
    } catch (err) {
      setError(err.message || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  const handleGoogleLogin = () => {
    // Redirect to backend Google OAuth endpoint
    window.location.href = `${API_BASE}/api/auth/google`
  }

  return (
    <>
      <div className="auth-visual">
        <div className="auth-brand" aria-label="AcademicHUB home">
          <span className="auth-brand__mark">A</span>
          <span className="auth-brand__text">AcademicHUB</span>
        </div>

        <div className="auth-visual__copy">
          <p className="auth-visual__eyebrow">Your study hub</p>
          <h2 className="auth-visual__title">Welcome back to smarter learning.</h2>
          <p className="auth-visual__text">
            Sign in to access your courses, notes, practice quizzes, and premium learning tools in one place.
          </p>
          <ul className="auth-visual__list">
            <li>Continue your course progress</li>
            <li>Review saved lesson materials</li>
            <li>Unlock premium academic support</li>
          </ul>
        </div>
      </div>

      <div className="auth-card auth-card--narrow">
        <div className="auth-card__header auth-card__header--stacked">
          <div>
            <p className="auth-card__eyebrow">Sign in</p>
            <h1 className="auth-card__title">Welcome back</h1>
          </div>
        </div>

        {error && (
          <div className="auth-notice auth-notice--error" role="alert">
            {error}
          </div>
        )}

        <form onSubmit={handleEmailLogin} className="auth-form" noValidate>
          <div className="auth-field">
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="student@school.edu.ng"
              disabled={loading}
              autoComplete="email"
            />
          </div>

          <div className="auth-field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              disabled={loading}
              autoComplete="current-password"
            />
          </div>

          <div className="auth-field" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
            <label htmlFor="rememberMe" style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.9rem' }}>
              <input
                id="rememberMe"
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
              />
              Remember me
            </label>
            <Link to="/forgot-password" className="auth-footer-text" style={{ paddingTop: 0 }}>
              Forgot password?
            </Link>
          </div>

          <div className="auth-actions auth-actions--stacked">
            <button type="submit" className="auth-button auth-button--primary auth-button--inline" disabled={loading}>
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </div>
        </form>

        <div className="auth-divider"><span>or</span></div>

        <button
          onClick={handleGoogleLogin}
          type="button"
          className="auth-button auth-button--secondary"
        >
          Continue with Google
        </button>

        <p className="auth-footer-text">
          Don’t have an account? <Link to="/register">Create one</Link>
        </p>
      </div>
    </>
  )
}

