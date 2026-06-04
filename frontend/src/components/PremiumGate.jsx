import React from 'react'
import { useAuth } from '../utils/auth'

export default function PremiumGate({ children, fallback }) {
  const { user } = useAuth()
  if (!user) return null
  // Admins always have access to premium features
  const isPremiumUser = user.role === 'admin' || user.subscriptionType === 'premium' || user.plan === 'premium'
  if (isPremiumUser) {
    return <>{children}</>
  }

  return (
    <div className="page card premium-message">
      <h3>Premium feature</h3>
      <p>This feature is available only for premium users.</p>
      <p>Upgrade to access AI-powered assistance and the full CBT engine.</p>
      {fallback}
    </div>
  )
}
