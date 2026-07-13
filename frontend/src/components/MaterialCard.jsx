import React from 'react';
import { Link } from 'react-router-dom';
import PremiumBadge from './PremiumBadge';
import PriceTag from './PriceTag';

export default function MaterialCard({ material, onPurchase, onPreview }) {
  const title = material?.title || 'Untitled material';
  const description = material?.description || 'Academic resource';

  return (
    <article style={{ background: '#fff', borderRadius: '12px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', border: '1px solid #e2e8f0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <h3 style={{ margin: '0 0 6px', wordBreak: 'break-word' }}>{title}</h3>
          <p style={{ margin: 0, color: '#64748b' }}>{description}</p>
        </div>
        <PremiumBadge active={material?.isPremium || material?.isPaid} />
      </div>

      <div style={{ marginTop: '12px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        {material?.course?.title && <span style={{ color: '#2563eb', fontSize: '13px' }}>{material.course.title}</span>}
        {material?.department?.name && <span style={{ color: '#64748b', fontSize: '13px' }}>{material.department.name}</span>}
        {material?.lecturer?.name && <span style={{ color: '#64748b', fontSize: '13px' }}>by {material.lecturer.name}</span>}
      </div>

      <div style={{ marginTop: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <PriceTag price={material?.price} isFree={material?.isFree} discountedPrice={material?.discountedPrice} />
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {onPreview && (
            <button type="button" onClick={() => onPreview(material)}>
              Preview
            </button>
          )}
          {onPurchase && (
            <button type="button" onClick={() => onPurchase(material)}>
              Buy
            </button>
          )}
          {material?._id && (
            <Link to={`/marketplace/${material._id}`} style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 600 }}>
              View
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}
