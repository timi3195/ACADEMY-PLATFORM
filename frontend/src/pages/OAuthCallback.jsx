import React, { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../utils/auth'

export default function OAuthCallback() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [error, setError] = useState('')
  const { handleOAuthCallback } = useAuth()

  useEffect(() => {
    const processCallback = async () => {
      try {
        const accessToken = searchParams.get('accessToken')
        const userId = searchParams.get('userId')
        const errorParam = searchParams.get('error')

        if (errorParam) {
          throw new Error(decodeURIComponent(errorParam) || 'Authentication failed')
        }

        if (!accessToken || !userId) {
          throw new Error('Missing authentication tokens')
        }

        // Handle the OAuth callback
        await handleOAuthCallback(accessToken, userId)

        // Redirect to dashboard
        setTimeout(() => {
          navigate('/', { replace: true })
        }, 1000)
      } catch (err) {
        console.error('OAuth callback error:', err)
        setError(err.message || 'Authentication failed')

        // Redirect to login after 3 seconds
        setTimeout(() => {
          navigate('/login', { replace: true })
        }, 3000)
      }
    }

    processCallback()
  }, [searchParams, navigate, handleOAuthCallback])

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center py-12 px-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-lg shadow-lg p-8 text-center">
          {error ? (
            <>
              <div className="text-6xl mb-4">❌</div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Authentication Failed</h2>
              <p className="text-gray-600 mb-4">{error}</p>
              <p className="text-sm text-gray-500">Redirecting to login...</p>
            </>
          ) : (
            <>
              <div className="animate-spin text-4xl mb-4 inline-block">⏳</div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Completing Sign In</h2>
              <p className="text-gray-600">Please wait while we complete your authentication...</p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
