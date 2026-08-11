import React from 'react';

export default function AuthLayout({ children }) {
  return (
    <div className="auth-page">
      <div className="auth-shell">
        <div className="auth-shell__inner">
          {children}
        </div>
      </div>
    </div>
  );
}
