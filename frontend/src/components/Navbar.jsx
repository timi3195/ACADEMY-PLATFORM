import React, { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../utils/auth'
import { useLibrary } from '../context/LibraryContext'
import { loadWishlistEntries } from '../utils/libraryState'

export default function Navbar() {
  const { user, logout } = useAuth()
  const { items: libraryItems } = useLibrary()
  const navigate = useNavigate()
  const [wishlistCount, setWishlistCount] = useState(0)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const handleLogout = () => {
    setMobileMenuOpen(false)
    logout()
    navigate('/login')
  }

  useEffect(() => {
    const syncWishlist = () => setWishlistCount(loadWishlistEntries().length)
    const syncAuthState = () => setMobileMenuOpen(false)

    syncWishlist()
    window.addEventListener('storage', syncWishlist)
    window.addEventListener('auth:updated', syncAuthState)
    return () => {
      window.removeEventListener('storage', syncWishlist)
      window.removeEventListener('auth:updated', syncAuthState)
    }
  }, [])

  const closeMenu = () => setMobileMenuOpen(false)

  return (
    <nav className="navbar">
      <div className="navbar-left">
        <Link to="/" className="brand" onClick={closeMenu}>Academy</Link>
      </div>

      {user && (
        <button
          type="button"
          className="navbar-toggle"
          aria-label="Toggle navigation menu"
          aria-expanded={mobileMenuOpen}
          onClick={() => setMobileMenuOpen(prev => !prev)}
        >
          ☰ Menu
        </button>
      )}

      <div className={`navbar-right ${mobileMenuOpen ? 'is-open' : ''}`}>
        {user ? (
          <>
            <span className="user-pill">Hi, {user.name || user.email}</span>
            <span className="nav-pill">{user.role === 'admin' ? 'Admin' : 'Student'}</span>
            <Link to="/courses" onClick={closeMenu}>Courses</Link>
            <Link to="/marketplace" onClick={closeMenu}>Marketplace</Link>
            <Link to="/library" onClick={closeMenu}>Library ({libraryItems?.length || 0})</Link>
            <Link to="/library" onClick={closeMenu}>♡ {wishlistCount}</Link>
            <Link to="/notes" onClick={closeMenu}>Notes</Link>
            <Link to="/past-questions" onClick={closeMenu}>Past Questions</Link>
            <Link to="/ai-chat" onClick={closeMenu}>🤖 AI Assistant</Link>
            <Link to="/analytics" onClick={closeMenu}>📊 Analytics</Link>
            {user.role === 'admin' && <Link to="/admin" onClick={closeMenu}>Admin</Link>}
            {user.subscriptionType !== 'premium' && user.plan !== 'premium' && <Link to="/upgrade" onClick={closeMenu}>Upgrade</Link>}
            <button type="button" onClick={handleLogout}>Logout</button>
          </>
        ) : (
          <Link to="/login" onClick={closeMenu}>Login</Link>
        )}
      </div>
    </nav>
  )
}
