import React from 'react';
import { Link } from 'react-router-dom';

export default function PurchaseReceipt({ receipt, onPrint, onDownload }) {
  if (!receipt) return null;

  const amount = Number(receipt.amount || 0);

  return (
    <div style={{ background: '#fff', borderRadius: '24px', padding: '24px', border: '1px solid #e2e8f0', boxShadow: '0 12px 30px rgba(15, 23, 42, 0.06)' }}>
      <div style={{ display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '18px' }}>
        <div style={{ width: '92px', height: '120px', borderRadius: '16px', background: 'linear-gradient(135deg, #2563eb, #7c3aed)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '1.2rem', flexShrink: 0 }}>
          {receipt.coverImageUrl ? <img src={receipt.coverImageUrl} alt={receipt.materialTitle || 'Material cover'} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '16px' }} /> : (receipt.materialTitle || 'BK').slice(0, 2).toUpperCase()}
        </div>
        <div>
          <p style={{ margin: 0, color: '#64748b', fontSize: '.9rem' }}>Receipt generated</p>
          <h3 style={{ margin: '4px 0', fontSize: '1.2rem' }}>{receipt.materialTitle || 'Material title unavailable'}</h3>
          <p style={{ margin: 0, color: '#64748b' }}>{receipt.lecturerName || 'Author unavailable'}</p>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
        <div>
          <p style={{ margin: 0, color: '#2563eb', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em' }}>Purchase receipt</p>
          <h3 style={{ margin: '4px 0' }}>Academy Platform</h3>
          <p style={{ margin: 0, color: '#64748b' }}>Official digital purchase confirmation</p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '.85rem', color: '#64748b' }}>Receipt #</div>
          <strong>{receipt.receiptNumber || receipt.reference || 'N/A'}</strong>
        </div>
      </div>

      <div style={{ marginTop: '18px', display: 'grid', gap: '12px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
          <div style={{ padding: '12px', borderRadius: '12px', background: '#f8fafc', border: '1px solid #e2e8f0' }}><div style={{ color: '#64748b', fontSize: '.8rem' }}>Student</div><strong>{receipt.studentName || 'Student name unavailable'}</strong></div>
          <div style={{ padding: '12px', borderRadius: '12px', background: '#f8fafc', border: '1px solid #e2e8f0' }}><div style={{ color: '#64748b', fontSize: '.8rem' }}>Material</div><strong>{receipt.materialTitle || receipt.title || 'Material title unavailable'}</strong></div>
          <div style={{ padding: '12px', borderRadius: '12px', background: '#f8fafc', border: '1px solid #e2e8f0' }}><div style={{ color: '#64748b', fontSize: '.8rem' }}>Lecturer</div><strong>{receipt.lecturerName || 'Author unavailable'}</strong></div>
          <div style={{ padding: '12px', borderRadius: '12px', background: '#f8fafc', border: '1px solid #e2e8f0' }}><div style={{ color: '#64748b', fontSize: '.8rem' }}>Reference</div><strong>{receipt.reference || receipt.receiptNumber || 'Reference unavailable'}</strong></div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
          <div style={{ padding: '12px', borderRadius: '12px', background: '#f8fafc', border: '1px solid #e2e8f0' }}><div style={{ color: '#64748b', fontSize: '.8rem' }}>Amount</div><strong>{Number.isFinite(amount) ? `₦${amount.toLocaleString()}` : 'Amount unavailable'}</strong></div>
          <div style={{ padding: '12px', borderRadius: '12px', background: '#f8fafc', border: '1px solid #e2e8f0' }}><div style={{ color: '#64748b', fontSize: '.8rem' }}>Date</div><strong>{receipt.paymentDate ? new Date(receipt.paymentDate).toLocaleDateString() : 'Date unavailable'}</strong></div>
          <div style={{ padding: '12px', borderRadius: '12px', background: '#f8fafc', border: '1px solid #e2e8f0' }}><div style={{ color: '#64748b', fontSize: '.8rem' }}>Status</div><strong>{receipt.status || 'Status unavailable'}</strong></div>
          <div style={{ padding: '12px', borderRadius: '12px', background: '#f8fafc', border: '1px solid #e2e8f0' }}><div style={{ color: '#64748b', fontSize: '.8rem' }}>Method</div><strong>{receipt.paymentMethod || 'Card'}</strong></div>
        </div>
      </div>

      <div style={{ marginTop: '18px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <button type="button" className="button-ghost" onClick={onPrint}>Print</button>
        <button type="button" onClick={onDownload}>Download PDF</button>
        <Link to="/library" className="button-ghost" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>Open library</Link>
      </div>
    </div>
  );
}
