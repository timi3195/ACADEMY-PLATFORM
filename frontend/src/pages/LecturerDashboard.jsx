import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import lecturerService from '../services/lecturerService';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorState from '../components/ErrorState';
import EmptyState from '../components/EmptyState';
import MaterialCard from '../components/MaterialCard';
import MaterialFormModal from '../components/MaterialFormModal';
import NotificationBanner from '../components/NotificationBanner';

export default function LecturerDashboard() {
  const [materials, setMaterials] = useState([]);
  const [courses, setCourses] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState('create');
  const [selectedMaterial, setSelectedMaterial] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState('');
  
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [materialsResponse, dashboardResponse, coursesResponse] = await Promise.all([
        lecturerService.getMaterials(),
        lecturerService.getDashboard(),
        lecturerService.getCourses()
      ]);
      setMaterials(materialsResponse.materials || materialsResponse || []);
      setDashboard(dashboardResponse.dashboard || dashboardResponse);
      setCourses(coursesResponse.courses || []);
      setError('');
    } catch (err) {
      setError(err.message || 'Unable to load lecturer materials.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, []);

  const modalInitialValues = useMemo(() => {
    if (modalMode === 'edit' && selectedMaterial) {
      return selectedMaterial;
    }
    return {};
  }, [modalMode, selectedMaterial]);

  const openCreateModal = useCallback(() => {
    setModalMode('create');
    setSelectedMaterial(null);
    setModalOpen(true);
    setFeedback('');
  }, []);

  const openEditModal = useCallback((material) => {
    setModalMode('edit');
    setSelectedMaterial(material);
    setModalOpen(true);
    setFeedback('');
  }, []);

  const handleSubmit = useCallback(async (payload, file, coverImage) => {
    try {
      setSubmitting(true);
      setError('');
      setFeedback('');
      if (modalMode === 'edit' && selectedMaterial?._id) {
        await lecturerService.updateMaterial(selectedMaterial._id, payload, file, coverImage);
        setFeedback('Material updated successfully.');
      } else {
        await lecturerService.createMaterial(payload, file, coverImage);
        setFeedback('Material published successfully and is now available to authorized students for free.');
      }
      setModalOpen(false);
      await loadData();
    } catch (err) {
      const details = err?.errors?.length ? err.errors.map((entry) => entry.message).join(' • ') : err.message || 'Unable to save material.';
      setError(details);
      throw err;
    } finally {
      setSubmitting(false);
    }
  }, [loadData, modalMode, selectedMaterial]);

  const handleDelete = useCallback(async (material) => {
    if (!window.confirm(`Delete ${material.title}?`)) return;

    try {
      await lecturerService.deleteMaterial(material._id);
      setFeedback('Material removed from your dashboard.');
      await loadData();
    } catch (err) {
      setError(err.message || 'Unable to delete material.');
    }
  }, [loadData]);

  return (
    <div className="page">
      <div className="wp-section" style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', background: 'linear-gradient(135deg, #f8fbff, #ffffff)', border: '1px solid #dbeafe' }}>
        <div>
          <div style={{ color: '#0f3d91', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em' }}>Administration</div>
          <h2 style={{ marginBottom: '8px' }}>Course Material Studio</h2>
          <p style={{ margin: 0, color: '#64748b' }}>Upload and manage course materials for platform courses.</p>
          <p style={{ margin: '8px 0 0', color: '#166534', fontWeight: 600 }}>All lecturer materials are free for students authorized to access their course in this release.</p>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <Link to="/admin/question-extractions" style={{ padding: '8px 12px', border: '1px solid #2563eb', borderRadius: '6px', color: '#2563eb', textDecoration: 'none', fontWeight: 600 }}>Extract Past Questions</Link>
          <button type="button" onClick={openCreateModal} disabled={!courses.length}>Add Course Material</button>
        </div>
      </div>

      {feedback && <NotificationBanner type="success" message={feedback} onClose={() => setFeedback('')} />}

      {dashboard && (
            <div className="wp-section" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '20px' }}>
              <div style={{ background: '#fff', borderRadius: '12px', padding: '14px', border: '1px solid #e2e8f0' }}>
                <div style={{ color: '#64748b', fontSize: '13px' }}>Published Materials</div>
                <div style={{ fontSize: '24px', fontWeight: 700 }}>{dashboard.publishedMaterials || 0}</div>
              </div>
              <div style={{ background: '#fff', borderRadius: '12px', padding: '14px', border: '1px solid #e2e8f0' }}>
                <div style={{ color: '#64748b', fontSize: '13px' }}>Drafts</div>
                <div style={{ fontSize: '24px', fontWeight: 700 }}>{dashboard.draftMaterials || 0}</div>
              </div>
              <div style={{ background: '#fff', borderRadius: '12px', padding: '14px', border: '1px solid #e2e8f0' }}>
                <div style={{ color: '#64748b', fontSize: '13px' }}>Downloads</div>
                <div style={{ fontSize: '24px', fontWeight: 700 }}>{dashboard.totalDownloads || 0}</div>
              </div>
              <div style={{ background: '#fff', borderRadius: '12px', padding: '14px', border: '1px solid #e2e8f0' }}>
                <div style={{ color: '#64748b', fontSize: '13px' }}>Views</div>
                <div style={{ fontSize: '24px', fontWeight: 700 }}>{dashboard.totalViews || 0}</div>
              </div>
            </div>
      )}

      {loading && <LoadingSpinner label="Loading lecturer materials" />}
      {error && <ErrorState message={error} />}
      {!loading && !error && (!materials || materials.length === 0) && (
        <EmptyState title="No course materials yet" description={courses.length ? "Upload a learning resource for one of your assigned courses." : "No courses are currently assigned to your lecturer account."} />
      )}

      {!loading && !error && materials?.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px' }}>
          {materials.map((material) => (
            <div key={material._id} style={{ background: '#fff', borderRadius: '12px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
              <MaterialCard material={material} variant="compact" />
              <div style={{ display: 'flex', gap: '6px', padding: '10px', borderTop: '1px solid #e2e8f0' }}>
                <button type="button" onClick={() => openEditModal(material)} style={{ flex: 1, padding: '6px 10px', fontSize: '.85rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>Edit</button>
                <button type="button" onClick={() => handleDelete(material)} style={{ flex: 1, padding: '6px 10px', fontSize: '.85rem', background: '#ef4444', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <MaterialFormModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        mode={modalMode}
        initialValues={modalInitialValues}
        courses={courses}
        onSubmit={handleSubmit}
        loading={submitting}
        error={error}
      />
    </div>
  );
}
