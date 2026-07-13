import React from 'react';

export default function NotificationBanner({ type = 'info', message, onClose }) {
  if (!message) return null;

  const colors = {
    success: { background: '#ecfdf3', color: '#166534', border: '#a7f3d0' },
    error: { background: '#fef2f2', color: '#991b1b', border: '#fecaca' },
    info: { background: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe' }
  };

  const style = colors[type] || colors.info;

  return (
    <div style={{ padding: '12px 14px', borderRadius: '10px', border: `1px solid ${style.border}`, background: style.background, color: style.color, marginBottom: '14px', display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
      <span>{message}</span>
      {onClose && <button type="button" onClick={onClose} style={{ padding: '0 4px', background: 'transparent', color: style.color }}>×</button>}
    </div>
  );
}
