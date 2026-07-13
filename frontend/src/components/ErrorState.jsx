import React from 'react';

export default function ErrorState({ message }) {
  return (
    <div style={{ padding: '24px', border: '1px solid #fecaca', borderRadius: '12px', background: '#fef2f2', color: '#b91c1c' }}>
      <strong>Something went wrong.</strong>
      <p style={{ marginBottom: 0 }}>{message}</p>
    </div>
  );
}
