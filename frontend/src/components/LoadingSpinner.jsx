import React from 'react';

export default function LoadingSpinner({ label = 'Loading...' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', color: '#64748b', gap: '10px' }} aria-live="polite">
      <span style={{ width: '14px', height: '14px', borderRadius: '50%', border: '2px solid #cbd5e1', borderTopColor: '#2563eb', display: 'inline-block', animation: 'spin 0.8s linear infinite' }} />
      <span>{label}</span>
    </div>
  );
}
