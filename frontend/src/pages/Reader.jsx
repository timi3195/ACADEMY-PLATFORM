import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import marketplaceService from '../services/marketplaceService';
import purchaseService from '../services/purchaseService';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorState from '../components/ErrorState';
import PDFViewer from '../components/PDFViewer';
import { useAuth } from '../utils/auth';
import { useLibrary } from '../context/LibraryContext';
import { normalizeMaterialAccess } from '../utils/marketplaceAccess';

export default function Reader() {
  const { materialId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { items: libraryItems = [] } = useLibrary();
  const [material, setMaterial] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [access, setAccess] = useState(null);
  const [accessLoading, setAccessLoading] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const loadReaderData = async () => {
      try {
        setLoading(true);
        setError('');

        // Load material metadata
        const response = await marketplaceService.getMaterialById(materialId);
        const nextMaterial = response.material || response;

        if (!isMounted) return;
        setMaterial(nextMaterial);

        // Check access
        if (user) {
          setAccessLoading(true);
          try {
            const accessResponse = await purchaseService.getMaterialAccess(materialId);
            setAccess(normalizeMaterialAccess(accessResponse));
          } catch (accessErr) {
            // Fall back to library check
            const libraryOwned = Array.isArray(libraryItems) && libraryItems.some((item) => {
              const ownedId = item?.material?._id || item?.materialId || item?._id;
              return Boolean(ownedId && ownedId === materialId);
            });

            if (isMounted) {
              setAccess(
                libraryOwned
                  ? {
                      access: true,
                      hasAccess: true,
                      canView: true,
                      canRead: true,
                      canDownload: true,
                      isPurchased: true,
                      reason: 'Library purchase confirmed'
                    }
                  : {
                      access: false,
                      hasAccess: false,
                      canView: false,
                      canRead: false,
                      canDownload: false,
                      isPurchased: false,
                      reason: accessErr.message || 'Unable to verify access'
                    }
              );
            }
          } finally {
            if (isMounted) setAccessLoading(false);
          }
        } else {
          setAccess({
            access: false,
            hasAccess: false,
            canView: false,
            canRead: false,
            canDownload: false,
            isPurchased: false,
            reason: 'Please log in to read this material'
          });
        }
      } catch (err) {
        if (isMounted) {
          setError(err.message || 'Unable to load material.');
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadReaderData();

    return () => {
      isMounted = false;
    };
  }, [materialId, user, libraryItems]);

  const handleBack = () => {
    navigate('/library');
  };

  if (loading || accessLoading) {
    return <LoadingSpinner />;
  }

  if (error) {
    return <ErrorState message={error} />;
  }

  if (!material) {
    return <ErrorState message="Material not found." />;
  }

  // Access denied state
  if (!access?.hasAccess) {
    return (
      <div className="reader-container" style={{ minHeight: '100vh', background: 'linear-gradient(to br, #f8fafc, #f1f5f9)' }}>
        <div style={{ padding: '20px' }}>
          <button
            onClick={handleBack}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 12px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              background: '#fff',
              cursor: 'pointer',
              marginBottom: '20px'
            }}
          >
            ← Back to Library
          </button>
        </div>

        <div
          style={{
            maxWidth: '600px',
            margin: '40px auto',
            textAlign: 'center',
            background: '#fff',
            borderRadius: '16px',
            padding: '40px 20px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
          }}
        >
          <h2 style={{ color: '#1f2937', marginBottom: '12px' }}>Access Denied</h2>
          <p style={{ color: '#6b7280', marginBottom: '24px', fontSize: '15px' }}>
            You don't have permission to read <strong>{material.title}</strong>
          </p>
          <p style={{ color: '#9ca3af', marginBottom: '24px', fontSize: '14px' }}>
            {access?.reason || 'This material requires purchase or authorization.'}
          </p>
          <button
            onClick={() => navigate(`/marketplace/${materialId}`)}
            style={{
              display: 'inline-block',
              padding: '10px 20px',
              background: '#2563eb',
              color: '#fff',
              borderRadius: '8px',
              border: 'none',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '15px'
            }}
          >
            View Material Details
          </button>
        </div>
      </div>
    );
  }

  // Reader view with full access
  return (
    <div className="reader-container" style={{ minHeight: '100vh', background: '#f8fafc' }}>
      {/* Reader header */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <button
            onClick={handleBack}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 10px',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              background: 'transparent',
              cursor: 'pointer',
              marginBottom: '8px',
              fontSize: '14px',
              color: '#64748b'
            }}
          >
            ← Back to Library
          </button>
          <h1 style={{ margin: '0 0 4px 0', fontSize: '20px', color: '#1f2937', overflowWrap: 'anywhere' }}>{material.title}</h1>
          <div style={{ fontSize: '13px', color: '#64748b', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            {material.lecturer?.name && <span>By {material.lecturer.name}</span>}
            {material.course && <span>{material.course.title || material.course.code || material.course}</span>}
            {material.pageCount && <span>{material.pageCount} pages</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {access?.canDownload && <span style={{ fontSize: '12px', color: '#10b981', background: '#ecfdf5', padding: '4px 10px', borderRadius: '4px' }}>✓ Download available</span>}
        </div>
      </div>

      {/* Reader content */}
      <div style={{ padding: '20px', maxWidth: '100%' }}>
        <PDFViewer
          materialId={materialId}
          fileName={material.title}
          canDownload={access?.canDownload}
          disablePreviewLimit={true}
        />
      </div>
    </div>
  );
}
