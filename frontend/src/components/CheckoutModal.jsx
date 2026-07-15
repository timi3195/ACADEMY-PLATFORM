import React, { useEffect, useMemo, useRef } from 'react';
import LoadingSpinner from './LoadingSpinner';
import NotificationBanner from './NotificationBanner';

export default function CheckoutModal({ open, material, onClose, onProceed, loading, message }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    if (!open) return;

    const firstFocusable = dialogRef.current?.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose?.();
      }
    };

    firstFocusable?.focus();
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  const price = Number(material?.price || 0);
  const isFree = material?.isFree || price === 0;
  const readingTime = useMemo(() => {
    const pages = Number(material?.pageCount || material?.previewPages || 0);
    return pages > 0 ? `${Math.max(5, Math.round(pages / 2))} min read` : 'Flexible reading time';
  }, [material?.pageCount, material?.previewPages]);

  if (!open || !material) return null;

  return (
    <div role="presentation" onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', zIndex: 50 }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="checkout-title" tabIndex={-1} onClick={(event) => event.stopPropagation()} style={{ width: '100%', maxWidth: '760px', background: '#fff', borderRadius: '24px', padding: '24px', boxShadow: '0 20px 60px rgba(15, 23, 42, 0.25)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: '12px' }}>
          <div>
            <p style={{ margin: 0, color: '#2563eb', fontSize: '.85rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em' }}>Secure checkout</p>
            <h3 id="checkout-title" style={{ margin: '4px 0 6px', fontSize: '1.3rem' }}>Complete your purchase</h3>
            <p style={{ margin: 0, color: '#64748b', maxWidth: '560px' }}>This purchase unlocks access to your digital library and a permanent receipt.</p>
          </div>
          <button type="button" onClick={onClose} style={{ border: 'none', background: 'transparent', fontSize: '1.2rem', cursor: 'pointer' }} aria-label="Close checkout">×</button>
        </div>

        {message ? <div style={{ marginTop: '14px' }}><NotificationBanner type="info" message={message} onClose={() => undefined} /></div> : null}

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 260px) 1fr', gap: '20px', marginTop: '18px' }}>
          <div style={{ borderRadius: '18px', overflow: 'hidden', border: '1px solid #e2e8f0', background: '#f8fafc' }}>
            {material.coverImageUrl ? (
              <img src={material.coverImageUrl} alt={material.title || 'Material cover'} style={{ width: '100%', display: 'block', aspectRatio: '3 / 4', objectFit: 'cover' }} loading="lazy" />
            ) : (
              <div style={{ aspectRatio: '3 / 4', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #2563eb, #7c3aed)', color: '#fff', fontWeight: 800, fontSize: '2rem' }}>
                {material.title?.slice(0, 2)?.toUpperCase() || 'BK'}
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: '.82rem', textTransform: 'uppercase', letterSpacing: '.08em', color: '#64748b' }}>Material</div>
                <strong>{material.title}</strong>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '.82rem', textTransform: 'uppercase', letterSpacing: '.08em', color: '#64748b' }}>Price</div>
                <strong>{isFree ? 'Free' : `₦${price.toLocaleString()}`}</strong>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px' }}>
              <div style={{ padding: '10px', border: '1px solid #e2e8f0', borderRadius: '12px' }}><div style={{ color: '#64748b', fontSize: '.8rem' }}>Author</div><strong>{material.lecturer?.name || 'Verified lecturer'}</strong></div>
              <div style={{ padding: '10px', border: '1px solid #e2e8f0', borderRadius: '12px' }}><div style={{ color: '#64748b', fontSize: '.8rem' }}>Course</div><strong>{material.course?.title || material.course?.code || 'General'}</strong></div>
              <div style={{ padding: '10px', border: '1px solid #e2e8f0', borderRadius: '12px' }}><div style={{ color: '#64748b', fontSize: '.8rem' }}>Semester</div><strong>{material.semester || '—'}</strong></div>
              <div style={{ padding: '10px', border: '1px solid #e2e8f0', borderRadius: '12px' }}><div style={{ color: '#64748b', fontSize: '.8rem' }}>Level</div><strong>{material.level || '—'}</strong></div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px' }}>
              <div style={{ padding: '10px', border: '1px solid #e2e8f0', borderRadius: '12px' }}><div style={{ color: '#64748b', fontSize: '.8rem' }}>Pages</div><strong>{material.pageCount || material.previewPages || '—'}</strong></div>
              <div style={{ padding: '10px', border: '1px solid #e2e8f0', borderRadius: '12px' }}><div style={{ color: '#64748b', fontSize: '.8rem' }}>Language</div><strong>{material.language || 'English'}</strong></div>
              <div style={{ padding: '10px', border: '1px solid #e2e8f0', borderRadius: '12px' }}><div style={{ color: '#64748b', fontSize: '.8rem' }}>Publisher</div><strong>{material.publisher || '—'}</strong></div>
              <div style={{ padding: '10px', border: '1px solid #e2e8f0', borderRadius: '12px' }}><div style={{ color: '#64748b', fontSize: '.8rem' }}>Reading</div><strong>{readingTime}</strong></div>
            </div>

            <div style={{ border: '1px solid #dbeafe', background: '#eff6ff', borderRadius: '12px', padding: '12px' }}>
              <strong>Payment method</strong>
              <div style={{ color: '#1d4ed8', marginTop: '4px' }}>Secure card payment via your trusted checkout provider.</div>
            </div>

            <div style={{ color: '#64748b', fontSize: '.92rem' }}>
              By proceeding you confirm that you understand this is a digital purchase and access will be available immediately after payment confirmation.
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginTop: '18px' }}>
          <div style={{ color: '#64748b', fontSize: '.9rem' }}>Protected checkout • Secure payment • Instant access</div>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button type="button" className="button-ghost" onClick={onClose}>Cancel</button>
            <button type="button" onClick={onProceed} disabled={loading} style={{ minWidth: '180px' }}>
              {loading ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}><LoadingSpinner label="" /> Preparing…</span> : 'Proceed to payment'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
