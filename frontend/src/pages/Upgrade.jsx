import React, { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../utils/auth'
import { apiGet, apiPost } from '../utils/api'

export default function Upgrade() {
  const { user, refreshUser } = useAuth()
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const [semester, setSemester] = useState('2025-1')
  const [plan, setPlan] = useState('premium')
  const [amount, setAmount] = useState(15000)
  const location = useLocation()

  // Update amount when plan changes
  useEffect(() => {
    if (plan === 'basic') {
      setAmount(7500)
    } else {
      setAmount(15000)
    }
  }, [plan])

  useEffect(() => {
    const urlParams = new URLSearchParams(location.search)
    const reference = urlParams.get('reference')
    
    if (reference) {
      // Verify payment with backend
      verifyPayment(reference)
    } else if (location.search.includes('status=cancel')) {
      setMessage('Payment was canceled. You can try again below.')
      setMessageType('warning')
      setStatusMessage('')
    }
  }, [location.search, refreshUser])

  const verifyPayment = async (reference) => {
    try {
      const data = await apiGet(`/api/payments/verify/${reference}`)

      if (data.success) {
        setMessage('Payment verified successfully!')
        setMessageType('success')
        setStatusMessage('Refreshing your account...')
        refreshUser().then(() => {
          setStatusMessage('Your account has been upgraded to premium!')
        })
      } else {
        setMessage('Payment verification failed. ' + (data.message || ''))
        setMessageType('error')
      }
    } catch (err) {
      console.error('Payment verification error:', err)
      setMessage('Unable to verify payment. Please contact support.')
      setMessageType('error')
    }
  }

  const handleUpgrade = async () => {
    if (!user) return
    setLoading(true)
    setMessage('')
    setMessageType('')
    setStatusMessage('')

    try {
      const data = await apiPost('/api/payments/initialize', {
        amount,
        semester,
        plan
      })

      if (data.data?.authorization_url) {
        window.location.href = data.data.authorization_url
      } else {
        throw new Error('No payment URL received')
      }
    } catch (err) {
      console.error(err)
      setMessage(`Unable to start payment. ${err.message || 'Please try again.'}`)
      setMessageType('error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page">
      <h2>Upgrade to Premium</h2>
      <div className="card">
        <p>Unlock AI-powered assistance and the full CBT quiz engine.</p>
        <ul>
          <li>Premium course materials access</li>
          <li>AI tutor and generated practice questions</li>
          <li>Full CBT quiz engine</li>
        </ul>
        
        <div className="upgrade-form">
          <div className="form-group">
            <label>Select Semester:</label>
            <select value={semester} onChange={(e) => setSemester(e.target.value)} disabled={loading}>
              <option value="2024-1">2024 Semester 1</option>
              <option value="2024-2">2024 Semester 2</option>
              <option value="2025-1">2025 Semester 1</option>
              <option value="2025-2">2025 Semester 2</option>
              <option value="2026-1">2026 Semester 1</option>
              <option value="2026-2">2026 Semester 2</option>
            </select>
          </div>

          <div className="form-group">
            <label>Select Plan:</label>
            <select value={plan} onChange={(e) => setPlan(e.target.value)} disabled={loading}>
              <option value="basic">Basic - ₦7,500</option>
              <option value="premium">Premium - ₦15,000</option>
            </select>
          </div>

          <div className="form-group">
            <p><strong>Amount: ₦{amount.toLocaleString()}</strong></p>
          </div>
        </div>

        <button onClick={handleUpgrade} disabled={loading || user?.plan === 'premium'}>
          {user?.plan === 'premium' ? 'Already Premium' : loading ? 'Processing...' : 'Proceed to Payment'}
        </button>
        {statusMessage && <p className="upgrade-status">{statusMessage}</p>}
        {message && (
          <div className={`upgrade-message ${messageType}`}>
            <p>{message}</p>
            {messageType === 'error' && !loading && (
              <button className="retry-button" onClick={handleUpgrade}>
                Try again
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
