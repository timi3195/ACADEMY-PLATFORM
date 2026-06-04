import React, { createContext, useContext, useEffect, useState } from 'react'
import { apiGet, apiPost, apiPut, apiDelete, setAccessToken, getAccessToken, API_BASE } from './api'

const AuthContext = createContext()

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  // Load user on mount
  useEffect(() => {
    restoreSession()
  }, [])

  /**
   * Restore user session from /api/auth/me
   */
  const restoreSession = async () => {
    try {
      const token = getAccessToken()
      if (token) {
        const res = await apiGet('/api/auth/me')
        if (res && res.user) {
          setUser(res.user)
          return
        }
      }
    } catch (err) {
      console.log('Session restore failed:', err)
      // Session invalid, clear it
      setAccessToken(null)
    } finally {
      setLoading(false)
    }
  }

  /**
   * Register new user with email and password
   */
  const register = async (name, email, password, confirmPassword, department, yearOfStudy) => {
    const res = await apiPost('/api/auth/register', { 
      name, email, password, confirmPassword, department, yearOfStudy
    })
    return res
  }

  /**
   * Login with email and password
   */
  const login = async (email, password, rememberMe = false) => {
    const res = await apiPost('/api/auth/login', { 
      email, password, rememberMe 
    })
    if (res && res.accessToken) {
      setAccessToken(res.accessToken)
      setUser(res.user)
      return res.user
    }
    throw new Error(res.message || 'Login failed')
  }

  /**
   * Handle OAuth callback (called after Google redirects)
   */
  const handleOAuthCallback = async (accessToken, userId) => {
    if (accessToken && userId) {
      setAccessToken(accessToken)
      // Fetch user details
      try {
        const res = await apiGet('/api/auth/me')
        if (res && res.user) {
          setUser(res.user)
          return res.user
        }
      } catch (err) {
        console.error('Failed to fetch user after OAuth:', err)
      }
    }
    throw new Error('OAuth callback failed')
  }

  /**
   * Verify email with token
   */
  const verifyEmail = async (token) => {
    const res = await apiPost('/api/auth/verify-email', { token })
    return res
  }

  /**
   * Resend verification email
   */
  const resendVerificationEmail = async (email) => {
    const res = await apiPost('/api/auth/send-verification-email', { email })
    return res
  }

  /**
   * Request password reset
   */
  const forgotPassword = async (email) => {
    const res = await apiPost('/api/auth/forgot-password', { email })
    return res
  }

  /**
   * Reset password with token
   */
  const resetPassword = async (token, password, confirmPassword) => {
    const res = await apiPost('/api/auth/reset-password', { 
      token, password, confirmPassword 
    })
    return res
  }

  /**
   * Change password (for logged-in users)
   */
  const changePassword = async (currentPassword, newPassword, confirmPassword) => {
    const res = await apiPost('/api/auth/change-password', {
      currentPassword, newPassword, confirmPassword
    })
    return res
  }

  /**
   * Refresh user data
   */
  const refreshUser = async () => {
    const res = await apiGet('/api/auth/me')
    if (res && res.user) {
      setUser(res.user)
      return res.user
    }
    return null
  }

  /**
   * Upgrade to premium
   */
  const upgradeToPremium = async () => {
    if (!user || !user._id) throw new Error('No user logged in')
    const res = await apiPut(`/api/users/${user._id}`, { 
      subscriptionType: 'premium' 
    })
    if (res && res.user) {
      setUser(res.user)
      return res.user
    }
    throw new Error('Upgrade failed')
  }

  /**
   * Logout (single device)
   */
  const logout = async () => {
    try {
      await apiPost('/api/auth/logout', {})
    } catch (err) {
      console.error('Logout request failed:', err)
    }
    setAccessToken(null)
    setUser(null)
  }

  /**
   * Logout from all devices
   */
  const logoutAll = async () => {
    try {
      await apiPost('/api/auth/logout-all', {})
    } catch (err) {
      console.error('Logout all request failed:', err)
    }
    setAccessToken(null)
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ 
      user, 
      loading,
      register,
      login, 
      logout,
      logoutAll,
      handleOAuthCallback,
      verifyEmail,
      resendVerificationEmail,
      forgotPassword,
      resetPassword,
      changePassword,
      upgradeToPremium, 
      refreshUser,
      isAuthenticated: !!user,
      API_BASE
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() { return useContext(AuthContext) }
