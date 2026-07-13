import React from 'react';

export default function PriceTag({ price, isFree = false, discountedPrice }) {
  if (isFree || Number(price) === 0) {
    return <span style={{ fontWeight: 700, color: '#16a34a' }}>Free</span>;
  }

  if (discountedPrice !== undefined && discountedPrice !== null && discountedPrice < price) {
    return (
      <span style={{ fontWeight: 700, color: '#dc2626' }}>
        ₦{Number(discountedPrice).toLocaleString()} <span style={{ textDecoration: 'line-through', color: '#64748b', fontSize: '12px' }}>₦{Number(price).toLocaleString()}</span>
      </span>
    );
  }

  return <span style={{ fontWeight: 700, color: '#0f172a' }}>₦{Number(price).toLocaleString()}</span>;
}
