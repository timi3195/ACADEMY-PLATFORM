import React, { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../utils/auth';

export default function Sidebar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const navigationRef = useRef(null);
  const menuTriggerRef = useRef(null);

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

  const primaryMobilePaths = ['/', '/courses', '/notes', '/examination-history'];
  const mobilePrimaryLinks = links.filter((item) => primaryMobilePaths.includes(item.to));
  const moreIsActive = !primaryMobilePaths.some((path) =>
    path === '/' ? pathname === path : pathname === path || pathname.startsWith(`${path}/`)
  );

  useEffect(() => {
    if (!mobileOpen) return undefined;
    const focusableElements = navigationRef.current?.querySelectorAll('a[href], button:not([disabled])') || [];
    focusableElements[0]?.focus();

    const handleMenuKeyDown = (event) => {
      if (event.key === 'Escape') {
        setMobileOpen(false);
        menuTriggerRef.current?.focus();
        return;
      }
      if (event.key !== 'Tab' || focusableElements.length === 0) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };
    document.addEventListener('keydown', handleMenuKeyDown);
    return () => document.removeEventListener('keydown', handleMenuKeyDown);
  }, [mobileOpen]);

  const closeMobileMenu = () => {
    setMobileOpen(false);
    menuTriggerRef.current?.focus();
  };

  const toggleMobileMenu = (event) => {
    menuTriggerRef.current = event.currentTarget;
    setMobileOpen((open) => !open);
  };

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
          onClick={toggleMobileMenu}
        >
          {mobileOpen ? 'Close' : 'Menu'}
        </button>
      </div>

      {mobileOpen && (
        <button
          type="button"
          className="mobile-navigation-backdrop"
          aria-label="Close navigation menu"
          onClick={closeMobileMenu}
        />
      )}

      <div
        ref={navigationRef}
        className={`sidebar-navigation ${mobileOpen ? 'is-open' : ''}`}
        role={mobileOpen ? 'dialog' : undefined}
        aria-modal={mobileOpen ? 'true' : undefined}
        aria-label={mobileOpen ? 'More navigation' : undefined}
      >
        <nav id="primary-navigation" className="sidebar-menu" aria-label="Primary navigation">
          {links.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={closeMobileMenu}
              className={({ isActive }) => `side-link ${isActive ? 'active' : ''}`}
            >
              <span aria-hidden="true" className="side-icon">{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
          <NavLink
            to="/cbt"
            onClick={closeMobileMenu}
            className={({ isActive }) => `side-link mobile-only-link ${isActive ? 'active' : ''}`}
          >
            <span aria-hidden="true" className="side-icon">◉</span>
            <span>CBT Practice</span>
          </NavLink>
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
      </div>

      <nav className="mobile-bottom-nav" aria-label="Mobile primary navigation">
        {mobilePrimaryLinks.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            onClick={closeMobileMenu}
            className={({ isActive }) => `mobile-bottom-link ${isActive ? 'active' : ''}`}
          >
            <span aria-hidden="true">{item.icon}</span>
            <span>{item.label === 'Dashboard' ? 'Home' : item.label === 'Exam History' ? 'Exams' : item.label}</span>
          </NavLink>
        ))}
        <button
          type="button"
          className={`mobile-bottom-link mobile-bottom-more ${moreIsActive ? 'active' : ''}`}
          aria-label={mobileOpen ? 'Close more navigation' : 'Open more navigation'}
          aria-expanded={mobileOpen}
          aria-controls="primary-navigation"
          onClick={toggleMobileMenu}
        >
          <span aria-hidden="true">{mobileOpen ? '×' : '···'}</span>
          <span>{mobileOpen ? 'Close' : 'More'}</span>
        </button>
      </nav>
    </aside>
  );
}
