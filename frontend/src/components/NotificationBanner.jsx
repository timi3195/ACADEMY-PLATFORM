import React, { useEffect, useState } from 'react';

export default function NotificationBanner({ type = 'info', message, onClose, autoDismissMs = 0 }) {
  const [visible, setVisible] = useState(Boolean(message));

  useEffect(() => {
    setVisible(Boolean(message));
    if (!message || !autoDismissMs) return undefined;
    const timer = window.setTimeout(() => {
      setVisible(false);
      if (onClose) onClose();
    }, autoDismissMs);
    return () => window.clearTimeout(timer);
  }, [message, autoDismissMs, onClose]);

  if (!message || !visible) return null;

  const colors = {
    success: { background: '#ecfdf3', color: '#166534', border: '#a7f3d0' },
    warning: { background: '#fff7ed', color: '#9a2c00', border: '#fed7aa' },
    error: { background: '#fef2f2', color: '#991b1b', border: '#fecaca' },
    info: { background: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe' }
  };

  const style = colors[type] || colors.info;

  return (
    <div role="status" aria-live="polite" style={{ padding: '12px 14px', borderRadius: '10px', border: `1px solid ${style.border}`, background: style.background, color: style.color, marginBottom: '14px', display: 'flex', justifyContent: 'space-between', gap: '10px', animation: 'fadeIn 180ms ease' }}>
      <span>{message}</span>
      {onClose && <button type="button" onClick={onClose} style={{ padding: '0 4px', background: 'transparent', color: style.color }} aria-label="Dismiss notification">×</button>}
    </div>
  );
}
