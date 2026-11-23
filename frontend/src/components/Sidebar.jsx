import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../utils/auth';

export default function Sidebar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const links = [
    { to: '/', label: 'Dashboard', icon: '◫' },
    { to: '/courses', label: 'Courses', icon: '◔' },
    { to: '/notes', label: 'Notes', icon: '✎' },
    { to: '/past-questions', label: 'Past Questions', icon: '✓' },
    { to: '/examination-history', label: 'Exam History', icon: '▤' },
    { to: '/ai', label: 'AI Study', icon: '◎' },
    { to: '/analytics', label: 'Analytics', icon: '◭' },
  ];

  const isApprovedLecturer = false;

  if (false) {
    links.splice(8, 0, { to: '/lecturer', label: 'Lecturer', icon: '▣' });
  } else if (false) {
    links.splice(8, 0, { to: '/lecturer/register', label: 'Become Lecturer', icon: '▣' });
  }

  if (false && user?.role === 'admin') {
    links.push({ to: '/admin/lecturers', label: 'Lecturer Review', icon: '✓' });
    links.push({ to: '/admin', label: 'Admin', icon: '⚑' });
  }

  if (user?.role === 'admin') {
    links.push({ to: '/admin/content', label: 'Content Management', icon: '*' });
    links.push({ to: '/admin', label: 'Admin', icon: '*' });
  }

  return (
    <aside className={`sidebar-panel ${mobileOpen ? 'is-open' : ''}`}>
      <div className="brand-block">
        <div className="brand-mark">
          <span className="brand-dot" />
          <span className="brand-edu">AcademicHub</span>
        </div>
        <button
          type="button"
          className="sidebar-toggle-button"
          aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={mobileOpen}
          aria-controls="primary-navigation"
          onClick={() => setMobileOpen((open) => !open)}
        >
          {mobileOpen ? 'Close' : 'Menu'}
        </button>
      </div>

      <nav id="primary-navigation" className="sidebar-menu" aria-label="Primary navigation">
        {links.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) => `side-link ${isActive ? 'active' : ''}`}
          >
            <span aria-hidden="true" className="side-icon">{item.icon}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <button
        type="button"
        className="sidebar-logout"
        onClick={async () => {
          try {
            await logout();
          } catch (error) {
            console.error('Logout failed:', error);
          }
          navigate('/login');
        }}
      >
        <span aria-hidden="true">⇠</span>
        <span>Log out</span>
      </button>
    </aside>
  );
}
