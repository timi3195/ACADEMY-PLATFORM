import React, { useEffect, useState } from 'react';
import lecturerService from '../services/lecturerService';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorState from '../components/ErrorState';
import EmptyState from '../components/EmptyState';
import MaterialCard from '../components/MaterialCard';
import MaterialFormModal from '../components/MaterialFormModal';
import NotificationBanner from '../components/NotificationBanner';

export default function LecturerDashboard() {
  const [materials, setMaterials] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState('create');
  const [selectedMaterial, setSelectedMaterial] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState('');

  const loadData = async () => {
    try {
      setLoading(true);
      const [materialsResponse, dashboardResponse] = await Promise.all([
        lecturerService.getMaterials(),
        lecturerService.getDashboard()
      ]);
      setMaterials(materialsResponse.materials || materialsResponse || []);
      setDashboard(dashboardResponse.dashboard || dashboardResponse);
      setError('');
    } catch (err) {
      setError(err.message || 'Unable to load lecturer materials.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const openCreateModal = () => {
    setModalMode('create');
    setSelectedMaterial(null);
    setModalOpen(true);
    setFeedback('');
  };

  const openEditModal = (material) => {
    setModalMode('edit');
    setSelectedMaterial(material);
    setModalOpen(true);
    setFeedback('');
  };

  const handleSubmit = async (payload, file, coverImage) => {
    try {
      setSubmitting(true);
      setError('');
      if (modalMode === 'edit' && selectedMaterial?._id) {
        await lecturerService.updateMaterial(selectedMaterial._id, payload, file, coverImage);
        setFeedback('Material updated successfully.');
      } else {
        await lecturerService.createMaterial(payload, file, coverImage);
        setFeedback('Material uploaded successfully.');
      }
      setModalOpen(false);
      await loadData();
    } catch (err) {
      setError(err.message || 'Unable to save material.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (material) => {
    if (!window.confirm(`Delete ${material.title}?`)) return;

    try {
      await lecturerService.deleteMaterial(material._id);
      setFeedback('Material removed from your dashboard.');
      await loadData();
    } catch (err) {
      setError(err.message || 'Unable to delete material.');
    }
  };

  return (
    <div className="page">
      <div className="wp-section" style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ marginBottom: '8px' }}>Lecturer Dashboard</h2>
          <p style={{ margin: 0, color: '#64748b' }}>Manage your shared learning materials and track sales.</p>
        </div>
        <button type="button" onClick={openCreateModal}>Upload material</button>
      </div>

      {feedback && <NotificationBanner type="success" message={feedback} onClose={() => setFeedback('')} />}

      {dashboard && (
        <div className="wp-section" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '20px' }}>
          <div style={{ background: '#fff', borderRadius: '12px', padding: '14px', border: '1px solid #e2e8f0' }}>
            <div style={{ color: '#64748b', fontSize: '13px' }}>Materials</div>
            <div style={{ fontSize: '24px', fontWeight: 700 }}>{dashboard.totalMaterials || 0}</div>
          </div>
          <div style={{ background: '#fff', borderRadius: '12px', padding: '14px', border: '1px solid #e2e8f0' }}>
            <div style={{ color: '#64748b', fontSize: '13px' }}>Sales</div>
            <div style={{ fontSize: '24px', fontWeight: 700 }}>{dashboard.totalSales || 0}</div>
          </div>
          <div style={{ background: '#fff', borderRadius: '12px', padding: '14px', border: '1px solid #e2e8f0' }}>
            <div style={{ color: '#64748b', fontSize: '13px' }}>Earnings</div>
            <div style={{ fontSize: '24px', fontWeight: 700 }}>₦{Number(dashboard.totalEarnings || 0).toLocaleString()}</div>
          </div>
          <div style={{ background: '#fff', borderRadius: '12px', padding: '14px', border: '1px solid #e2e8f0' }}>
            <div style={{ color: '#64748b', fontSize: '13px' }}>Downloads</div>
            <div style={{ fontSize: '24px', fontWeight: 700 }}>{dashboard.totalDownloads || 0}</div>
          </div>
        </div>
      )}

      {loading && <LoadingSpinner label="Loading lecturer materials" />}
      {error && <ErrorState message={error} />}
      {!loading && !error && (!materials || materials.length === 0) && (
        <EmptyState title="No materials yet" description="Upload your first study material to start selling and sharing it." />
      )}

      {!loading && !error && materials?.length > 0 && (
        <div style={{ display: 'grid', gap: '16px' }}>
          {materials.map((material) => (
            <div key={material._id} style={{ background: '#fff', borderRadius: '12px', padding: '16px', border: '1px solid #e2e8f0' }}>
              <MaterialCard material={material} />
              <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                <button type="button" onClick={() => openEditModal(material)}>Edit</button>
                <button type="button" onClick={() => handleDelete(material)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <MaterialFormModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        mode={modalMode}
        initialValues={selectedMaterial || {}}
        onSubmit={handleSubmit}
        loading={submitting}
        error={error}
      />
    </div>
  );
}
