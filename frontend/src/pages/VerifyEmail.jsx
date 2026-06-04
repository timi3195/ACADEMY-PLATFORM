import React, { useState, useEffect } from 'react'
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import { useAuth } from '../utils/auth'

export default function VerifyEmail() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const [token, setToken] = useState(searchParams.get('token') || '')
  const [email, setEmail] = useState(location.state?.email || '')
  const [verificationCode, setVerificationCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [resending, setResending] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [message, setMessage] = useState('')
  const [resendCooldown, setResendCooldown] = useState(0)
  const { verifyEmail, resendVerificationEmail } = useAuth()

  // Handle automatic verification if token is in URL
  useEffect(() => {
    if (token) {
      verifyWithToken()
    }
  }, [token])

  // Cooldown timer for resend button
  useEffect(() => {
    let interval
    if (resendCooldown > 0) {
      interval = setInterval(() => {
        setResendCooldown(prev => prev - 1)
      }, 1000)
    }
    return () => clearInterval(interval)
  }, [resendCooldown])

  const verifyWithToken = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await verifyEmail(token)
      if (res.success) {
        setSuccess(true)
        setMessage(res.message || 'Email verified successfully!')
        // Redirect to login after 2 seconds
        setTimeout(() => {
          navigate('/login')
        }, 2000)
      }
    } catch (err) {
      setError(err.message || 'Verification failed')
    } finally {
      setLoading(false)
    }
  }

  const handleManualVerification = async (e) => {
    e.preventDefault()
    if (!verificationCode.trim()) {
      setError('Please enter the verification code')
      return
    }
    await verifyWithToken()
  }

  const handleResendEmail = async () => {
    if (!email) {
      setError('Email is required')
      return
    }
    setResending(true)
    setError('')
    try {
      const res = await resendVerificationEmail(email)
      setMessage(res.message || 'Verification email sent!')
      setResendCooldown(60) // 60 second cooldown
    } catch (err) {
      setError(err.message || 'Failed to resend email')
    } finally {
      setResending(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center py-12 px-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-lg shadow-lg p-8">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="text-4xl mb-2">✉️</div>
            <h1 className="text-3xl font-bold text-gray-900">Verify Your Email</h1>
            <p className="text-gray-600 mt-2">We've sent a verification link to your email</p>
          </div>

          {/* Success Message */}
          {success && (
            <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-green-700 text-sm font-medium">✓ {message}</p>
              <p className="text-green-600 text-xs mt-1">Redirecting to login...</p>
            </div>
          )}

          {/* Error Message */}
          {error && !success && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-700 text-sm font-medium">{error}</p>
            </div>
          )}

          {/* Info Message */}
          {message && !error && (
            <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-blue-700 text-sm font-medium">{message}</p>
            </div>
          )}

          {!success && (
            <>
              {/* Email Input (if not provided) */}
              {!email && (
                <div className="mb-6">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              )}

              {/* Manual Verification Code */}
              <form onSubmit={handleManualVerification} className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Or enter verification code (if applicable)
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={verificationCode}
                    onChange={(e) => setVerificationCode(e.target.value)}
                    placeholder="Enter code"
                    disabled={loading}
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                  />
                  <button
                    type="submit"
                    disabled={loading || !verificationCode}
                    className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-semibold rounded-lg transition"
                  >
                    {loading ? 'Verifying...' : 'Verify'}
                  </button>
                </div>
              </form>

              {/* Resend Email Button */}
              <div className="text-center">
                <p className="text-gray-600 text-sm mb-4">Didn't receive the email?</p>
                <button
                  onClick={handleResendEmail}
                  disabled={resending || resendCooldown > 0}
                  className="px-6 py-2 border border-blue-600 text-blue-600 hover:bg-blue-50 disabled:border-gray-300 disabled:text-gray-400 font-semibold rounded-lg transition"
                >
                  {resending ? 'Sending...' : resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend Email'}
                </button>
              </div>

              {/* Tips */}
              <div className="mt-8 pt-6 border-t border-gray-200">
                <p className="text-xs text-gray-600 mb-3 font-semibold">💡 Tips:</p>
                <ul className="text-xs text-gray-600 space-y-1">
                  <li>• Check your spam/junk folder</li>
                  <li>• Click the verification link in the email</li>
                  <li>• The link expires in 24 hours</li>
                </ul>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
