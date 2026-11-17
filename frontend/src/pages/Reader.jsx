import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import marketplaceService from '../services/marketplaceService';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorState from '../components/ErrorState';
import PDFViewer from '../components/PDFViewer';
import { useAuth } from '../utils/auth';

export default function Reader() {
  const { materialId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [material, setMaterial] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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
  }, [materialId]);

  const handleBack = () => {
    navigate('/library');
  };

  if (loading) {
    return <LoadingSpinner />;
  }

  if (error) {
    return <ErrorState message={error} />;
  }

  if (!material) {
    return <ErrorState message="Material not found." />;
  }

  const canView = Boolean(user && material.access?.canView);
  const canDownload = Boolean(user && material.access?.canDownload);
  if (!canView) {
    return (
      <div className="reader-container" style={{ minHeight: '100vh', background: '#f8fafc', padding: '24px' }}>
        <ErrorState message="This resource is available only to students assigned to its course." />
        <button type="button" onClick={handleBack}>Back to Library</button>
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
          {canDownload && <span style={{ fontSize: '12px', color: '#10b981', background: '#ecfdf5', padding: '4px 10px', borderRadius: '4px' }}>✓ Download available</span>}
        </div>
      </div>

      {/* Reader content */}
      <div style={{ padding: '20px', maxWidth: '100%' }}>
        <PDFViewer
          materialId={materialId}
          fileName={material.title}
          canDownload={canDownload}
          disablePreviewLimit={true}
        />
      </div>
    </div>
  );
}
