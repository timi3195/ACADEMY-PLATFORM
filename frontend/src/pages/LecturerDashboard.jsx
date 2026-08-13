import React, { useCallback, useEffect, useMemo, useState } from 'react';
import lecturerService, { normalizeSalesResponse } from '../services/lecturerService';
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
  
  // Sales view state
  const [activeTab, setActiveTab] = useState('materials'); // 'materials' or 'sales'
  const [sales, setSales] = useState([]);
  const [salesLoading, setSalesLoading] = useState(false);
  const [salesFilters, setSalesFilters] = useState({
    materialId: '',
    studentName: '',
    studentMatric: '',
    status: 'success',
    page: 1,
    limit: 20
  });
  const [salesTotal, setSalesTotal] = useState(0);

  const loadData = useCallback(async () => {
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
  }, []);

  const loadSales = useCallback(async () => {
    try {
      setSalesLoading(true);
      const response = await lecturerService.getSales(salesFilters);
      const normalizedSales = normalizeSalesResponse(response);

      setSales(normalizedSales.sales);
      setSalesTotal(normalizedSales.total);
    } catch (err) {
      setError(err.message || 'Unable to load sales data.');
    } finally {
      setSalesLoading(false);
    }
  }, [salesFilters]);

  const handleExportCSV = useCallback(async () => {
    try {
      const response = await lecturerService.exportSalesCSV(salesFilters);
      // Create blob and download
      const blob = new Blob([response], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `sales-${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message || 'Unable to export sales data.');
    }
  }, [salesFilters]);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (activeTab === 'sales') {
      loadSales();
    }
  }, [activeTab, loadSales]);

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
        setFeedback('Material published successfully and is now visible in the marketplace.');
      }
      window.dispatchEvent(new Event('marketplace:updated'));
      window.localStorage.setItem('marketplace:updated', String(Date.now()));
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
          <div style={{ color: '#0f3d91', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em' }}>Academic Publishing Portal</div>
          <h2 style={{ marginBottom: '8px' }}>Course Material Studio</h2>
          <p style={{ margin: 0, color: '#64748b' }}>Publish lecture notes, guides, past questions, and other academic resources for your students.</p>
        </div>
        <button type="button" onClick={openCreateModal}>Create New Material</button>
      </div>

      {/* Tab Navigation */}
      <div className="wp-section" style={{ marginBottom: '20px', display: 'flex', gap: '12px', borderBottom: '1px solid #e2e8f0' }}>
        <button
          onClick={() => setActiveTab('materials')}
          style={{
            padding: '12px 16px',
            background: activeTab === 'materials' ? '#2563eb' : 'transparent',
            color: activeTab === 'materials' ? '#fff' : '#64748b',
            border: 'none',
            borderBottom: activeTab === 'materials' ? '3px solid #2563eb' : 'none',
            cursor: 'pointer',
            fontWeight: activeTab === 'materials' ? '600' : '400',
            fontSize: '14px'
          }}
        >
          Materials
        </button>
        <button
          onClick={() => setActiveTab('sales')}
          style={{
            padding: '12px 16px',
            background: activeTab === 'sales' ? '#2563eb' : 'transparent',
            color: activeTab === 'sales' ? '#fff' : '#64748b',
            border: 'none',
            borderBottom: activeTab === 'sales' ? '3px solid #2563eb' : 'none',
            cursor: 'pointer',
            fontWeight: activeTab === 'sales' ? '600' : '400',
            fontSize: '14px'
          }}
        >
          Sales ({dashboard?.totalSales || 0})
        </button>
      </div>

      {feedback && <NotificationBanner type="success" message={feedback} onClose={() => setFeedback('')} />}

      {activeTab === 'materials' && (
        <>
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
              <div style={{ background: '#fff', borderRadius: '12px', padding: '14px', border: '1px solid #e2e8f0' }}>
                <div style={{ color: '#64748b', fontSize: '13px' }}>Sales</div>
                <div style={{ fontSize: '24px', fontWeight: 700 }}>{dashboard.totalSales || 0}</div>
              </div>
              <div style={{ background: '#fff', borderRadius: '12px', padding: '14px', border: '1px solid #e2e8f0' }}>
                <div style={{ color: '#64748b', fontSize: '13px' }}>Earnings</div>
                <div style={{ fontSize: '24px', fontWeight: 700 }}>₦{Number(dashboard.totalEarnings || 0).toLocaleString()}</div>
              </div>
              <div style={{ background: '#fff', borderRadius: '12px', padding: '14px', border: '1px solid #e2e8f0' }}>
                <div style={{ color: '#64748b', fontSize: '13px' }}>Avg. Rating</div>
                <div style={{ fontSize: '24px', fontWeight: 700 }}>{Number(dashboard.averageRating || 0).toFixed(1)}</div>
              </div>
            </div>
          )}

          {loading && <LoadingSpinner label="Loading lecturer materials" />}
          {error && <ErrorState message={error} />}
          {!loading && !error && (!materials || materials.length === 0) && (
            <EmptyState title="No course materials yet" description="Create your first academic resource to support your students and build a trusted library of course content." />
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
        </>
      )}

      {activeTab === 'sales' && (
        <>
          <div className="wp-section" style={{ marginBottom: '20px', background: '#fff', borderRadius: '12px', padding: '14px', border: '1px solid #e2e8f0' }}>
            <div style={{ marginBottom: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h3>Sales Records</h3>
                <button
                  onClick={handleExportCSV}
                  style={{
                    padding: '8px 12px',
                    background: '#10b981',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: '600'
                  }}
                >
                  Export CSV
                </button>
              </div>
              
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '8px' }}>
                <div>
                  <label style={{ fontSize: '12px', color: '#64748b', display: 'block', marginBottom: '4px' }}>Student Name</label>
                  <input
                    type="text"
                    placeholder="Filter by name"
                    value={salesFilters.studentName}
                    onChange={(e) => setSalesFilters({ ...salesFilters, studentName: e.target.value, page: 1 })}
                    style={{
                      width: '100%',
                      padding: '8px',
                      border: '1px solid #d1d5db',
                      borderRadius: '6px',
                      fontSize: '13px'
                    }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '12px', color: '#64748b', display: 'block', marginBottom: '4px' }}>Matric Number</label>
                  <input
                    type="text"
                    placeholder="Filter by matric"
                    value={salesFilters.studentMatric}
                    onChange={(e) => setSalesFilters({ ...salesFilters, studentMatric: e.target.value, page: 1 })}
                    style={{
                      width: '100%',
                      padding: '8px',
                      border: '1px solid #d1d5db',
                      borderRadius: '6px',
                      fontSize: '13px'
                    }}
                  />
                </div>
              </div>
            </div>

            {salesLoading ? (
              <LoadingSpinner label="Loading sales data" />
            ) : sales.length === 0 ? (
              <EmptyState title="No sales yet" description="Your first sale will appear here" />
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                      <th style={{ padding: '10px', textAlign: 'left', fontWeight: '600', color: '#1f2937' }}>Date</th>
                      <th style={{ padding: '10px', textAlign: 'left', fontWeight: '600', color: '#1f2937' }}>Student</th>
                      <th style={{ padding: '10px', textAlign: 'left', fontWeight: '600', color: '#1f2937' }}>Matric</th>
                      <th style={{ padding: '10px', textAlign: 'left', fontWeight: '600', color: '#1f2937' }}>Material</th>
                      <th style={{ padding: '10px', textAlign: 'left', fontWeight: '600', color: '#1f2937' }}>Amount</th>
                      <th style={{ padding: '10px', textAlign: 'left', fontWeight: '600', color: '#1f2937' }}>Your Earnings</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sales.map((sale) => (
                      <tr key={sale._id} style={{ borderBottom: '1px solid #e2e8f0', '&:hover': { background: '#f9fafb' } }}>
                        <td style={{ padding: '10px' }}>{new Date(sale.paidAt).toLocaleDateString()}</td>
                        <td style={{ padding: '10px' }}>{sale.studentName || 'N/A'}</td>
                        <td style={{ padding: '10px' }}>{sale.studentMatric || 'N/A'}</td>
                        <td style={{ padding: '10px' }}>{sale.material}</td>
                        <td style={{ padding: '10px' }}>₦{Number(sale.amount).toFixed(2)}</td>
                        <td style={{ padding: '10px', fontWeight: '600', color: '#10b981' }}>₦{Number(sale.lecturerAmount).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Pagination */}
                {salesTotal > salesFilters.limit && (
                  <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginTop: '16px' }}>
                    <button
                      onClick={() => setSalesFilters({ ...salesFilters, page: Math.max(1, salesFilters.page - 1) })}
                      disabled={salesFilters.page === 1}
                      style={{
                        padding: '6px 12px',
                        background: salesFilters.page === 1 ? '#e5e7eb' : '#2563eb',
                        color: salesFilters.page === 1 ? '#9ca3af' : '#fff',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: salesFilters.page === 1 ? 'default' : 'pointer'
                      }}
                    >
                      Previous
                    </button>
                    <span style={{ padding: '6px 12px', alignSelf: 'center' }}>
                      Page {salesFilters.page} of {Math.ceil(salesTotal / salesFilters.limit)}
                    </span>
                    <button
                      onClick={() => setSalesFilters({ ...salesFilters, page: Math.min(Math.ceil(salesTotal / salesFilters.limit), salesFilters.page + 1) })}
                      disabled={salesFilters.page >= Math.ceil(salesTotal / salesFilters.limit)}
                      style={{
                        padding: '6px 12px',
                        background: salesFilters.page >= Math.ceil(salesTotal / salesFilters.limit) ? '#e5e7eb' : '#2563eb',
                        color: salesFilters.page >= Math.ceil(salesTotal / salesFilters.limit) ? '#9ca3af' : '#fff',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: salesFilters.page >= Math.ceil(salesTotal / salesFilters.limit) ? 'default' : 'pointer'
                      }}
                    >
                      Next
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      <MaterialFormModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        mode={modalMode}
        initialValues={modalInitialValues}
        onSubmit={handleSubmit}
        loading={submitting}
        error={error}
      />
    </div>
  );
}
