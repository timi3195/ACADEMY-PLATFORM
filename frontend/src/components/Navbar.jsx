import React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../utils/auth'

export default function Navbar() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const handleLogout = () => { logout(); navigate('/login') }

  return (
    <nav className="navbar">
      <div className="navbar-left">
        <Link to="/" className="brand">Academy</Link>
      </div>

      <div className="navbar-right">
        {user ? (
          <>
            <span className="user-pill">Hi, {user.name || user.email}</span>
            <Link to="/courses">Courses</Link>
            <Link to="/notes">Notes</Link>
            <Link to="/past-questions">Past Questions</Link>
            <Link to="/cbt">CBT</Link>
            <Link to="/ai">AI</Link>
            {user.role === 'admin' && <Link to="/admin">Admin</Link>}
            {user.subscriptionType !== 'premium' && user.plan !== 'premium' && <Link to="/upgrade">Upgrade</Link>}
            <button onClick={handleLogout}>Logout</button>
          </>
        ) : (
          <Link to="/login">Login</Link>
        )}
      </div>
    </nav>
  )
}
