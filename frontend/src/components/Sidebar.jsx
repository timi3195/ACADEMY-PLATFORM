import React from 'react';
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
  return (
    <aside style={{ background: '#fff', borderRadius: '12px', padding: '16px', minWidth: '220px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
      <h3 style={{ marginTop: 0 }}>Explore</h3>
      <nav style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {links.map((item) => (
          <NavLink key={item.to} to={item.to} style={({ isActive }) => ({ padding: '8px 10px', borderRadius: '8px', color: isActive ? '#2563eb' : '#334155', textDecoration: 'none', fontWeight: isActive ? 700 : 500 })}>
            {item.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
