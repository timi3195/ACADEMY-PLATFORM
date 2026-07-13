import React from 'react';

export default function EmptyState({ title, description }) {
  return (
    <div style={{ padding: '24px', border: '1px dashed #cbd5e1', borderRadius: '12px', textAlign: 'center', color: '#64748b' }}>
      <h3 style={{ marginTop: 0, color: '#0f172a' }}>{title}</h3>
      <p>{description}</p>
    </div>
  );
}
