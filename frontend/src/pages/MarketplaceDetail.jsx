import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import marketplaceService from '../services/marketplaceService';
import purchaseService from '../services/purchaseService';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorState from '../components/ErrorState';
import EmptyState from '../components/EmptyState';
import { formatCurrency } from '../utils/formatters';
import { useAuth } from '../utils/auth';

export default function MarketplaceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [material, setMaterial] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [purchaseLoading, setPurchaseLoading] = useState(false);
  const [purchaseMessage, setPurchaseMessage] = useState('');

  useEffect(() => {
    const loadMaterial = async () => {
      try {
        setLoading(true);
        const response = await marketplaceService.getMaterialById(id);
        setMaterial(response.material || response);
      } catch (err) {
        setError(err.message || 'Unable to load material.');
      } finally {
        setLoading(false);
      }
    };

    loadMaterial();
  }, [id]);

  const handlePurchase = async () => {
    setPurchaseLoading(true);
    setPurchaseMessage('');
    try {
      const response = await purchaseService.initializePurchase(material._id);
      const authorizationUrl = response?.data?.authorizationUrl || response?.authorizationUrl;
      if (authorizationUrl) {
        window.location.href = authorizationUrl;
      } else {
        setPurchaseMessage('Purchase request created.');
      }
    } catch (err) {
      setPurchaseMessage(err.message || 'Unable to start purchase.');
    } finally {
      setPurchaseLoading(false);
    }
  };

  if (loading) return <LoadingSpinner label="Loading material" />;
  if (error) return <ErrorState message={error} />;
  if (!material) return <EmptyState title="Material not found" description="This material is no longer available." />;

  return (
    <div className="page">
      <div className="wp-section" style={{ display: 'grid', gap: '14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ marginBottom: '8px' }}>{material.title}</h2>
            <p style={{ color: '#64748b', margin: 0 }}>{material.description || 'No description available.'}</p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontWeight: 700, fontSize: '20px' }}>{formatCurrency(material.price || 0)}</div>
            {material.isPremium && <span className="premium-badge">Premium</span>}
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', color: '#64748b' }}>
          {material.lecturer?.name && <span>Lecturer: {material.lecturer.name}</span>}
          {material.course?.title && <span>Course: {material.course.title}</span>}
          {material.department?.name && <span>Department: {material.department.name}</span>}
          {material.level && <span>Level: {material.level}</span>}
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button type="button" onClick={handlePurchase} disabled={purchaseLoading}>{purchaseLoading ? 'Preparing payment...' : 'Purchase'}</button>
          <button type="button" onClick={() => navigate('/marketplace')}>Back to marketplace</button>
        </div>

        {purchaseMessage && <p style={{ margin: 0, color: '#2563eb' }}>{purchaseMessage}</p>}
        {!user && <p style={{ margin: 0, color: '#b45309' }}>Sign in to purchase this material.</p>}
      </div>
    </div>
  );
}
