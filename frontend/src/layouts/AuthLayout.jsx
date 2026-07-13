import React from 'react';

export default function AuthLayout({ children }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #eff6ff 0%, #f8fafc 100%)', padding: '24px' }}>
      <div style={{ width: '100%', maxWidth: '480px', background: '#fff', borderRadius: '16px', padding: '32px', boxShadow: '0 12px 30px rgba(15, 23, 42, 0.08)' }}>
        {children}
      </div>
    </div>
  );
}
