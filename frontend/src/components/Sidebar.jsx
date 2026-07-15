import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';

const links = [
  { to: '/', label: 'Dashboard' },
  { to: '/courses', label: 'Courses' },
  { to: '/marketplace', label: 'Marketplace' },
  { to: '/library', label: 'Library' },
  { to: '/notes', label: 'Notes' },
  { to: '/past-questions', label: 'Past Questions' },
  { to: '/ai', label: 'AI Study' },
  { to: '/analytics', label: 'Analytics' },
  { to: '/lecturer', label: 'Lecturer' }
];

export default function Sidebar() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <aside className={`sidebar ${mobileOpen ? 'is-open' : ''}`}>
      <div className="sidebar-header">
        <h3>Explore</h3>
        <button
          type="button"
          className="sidebar-toggle"
          aria-label="Toggle sidebar"
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((open) => !open)}
        >
          ☰
        </button>
      </div>
      <nav className="sidebar-nav">
        {links.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={() => setMobileOpen(false)}
            style={({ isActive }) => ({ padding: '8px 10px', borderRadius: '8px', color: isActive ? '#2563eb' : '#334155', textDecoration: 'none', fontWeight: isActive ? 700 : 500 })}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
