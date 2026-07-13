import React from 'react';

export default function PremiumBadge({ active = false }) {
  return (
    <span style={{ display: 'inline-block', padding: '4px 8px', borderRadius: '999px', background: active ? '#fef3c7' : '#e2e8f0', color: active ? '#92400e' : '#475569', fontSize: '12px', fontWeight: 700 }}>
      {active ? 'Premium' : 'Standard'}
    </span>
  );
}
