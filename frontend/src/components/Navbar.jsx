import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../utils/auth';

export default function Navbar() {
  const { user } = useAuth();
  const initials = (user?.name || user?.email || 'Student')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || 'S';

  return (
    <header className="topbar">
      <div className="topbar-search">
        <span className="search-icon" aria-hidden="true">⌕</span>
        <input aria-label="Search" type="text" placeholder="Search courses, materials or notes" />
      </div>

      <div className="topbar-actions">
        <button type="button" className="icon-button" aria-label="Notifications">
          ⎈
        </button>
        <Link to="/" className="user-chip" aria-label="Profile">
          <span className="user-avatar">{initials}</span>
          <span>{user?.name || user?.email || 'Student'}</span>
        </Link>
      </div>
    </header>
  );
}
