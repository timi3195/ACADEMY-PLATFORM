import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMarketplace } from '../context/MarketplaceContext';
import { useLibrary } from '../context/LibraryContext';
import { useAuth } from '../utils/auth';
import marketplaceService from '../services/marketplaceService';
import purchaseService from '../services/purchaseService';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorState from '../components/ErrorState';
import EmptyState from '../components/EmptyState';
import SearchBar from '../components/SearchBar';
import MaterialCard from '../components/MaterialCard';
import Pagination from '../components/Pagination';
import Modal from '../components/Modal';
import { formatCurrency } from '../utils/formatters';
import useDebounce from '../hooks/useDebounce';

export default function Marketplace() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { materials, loading, error, loadMaterials } = useMarketplace();
  const { loadLibrary } = useLibrary();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('q') || '');
  const [page, setPage] = useState(Number(searchParams.get('page') || 1));
  const [selectedMaterial, setSelectedMaterial] = useState(null);
  const [purchaseLoading, setPurchaseLoading] = useState(false);
  const [purchaseMessage, setPurchaseMessage] = useState('');
  const debouncedSearch = useDebounce(search, 250);

  useEffect(() => {
    const load = async () => {
      try {
        await loadMaterials({ q: debouncedSearch, page, limit: 12 });
        await loadLibrary();
      } catch (err) {
        console.error(err);
      }
    };

    load();
  }, [debouncedSearch, loadLibrary, loadMaterials, page]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil((materials?.length || 0) / 12)), [materials]);

  const handleSearch = (value) => {
    setSearch(value);
    setPage(1);
    setSearchParams({ q: value, page: '1' });
  };

  const handlePurchase = async (material) => {
    if (!user) {
      navigate('/login');
      return;
    }

    setSelectedMaterial(material);
    setPurchaseLoading(true);
    setPurchaseMessage('');

    try {
      const response = await purchaseService.initializePurchase(material._id);
      const authorizationUrl = response?.data?.authorizationUrl || response?.authorizationUrl;
      setPurchaseMessage(authorizationUrl ? 'Redirecting to payment...' : 'Purchase request created.');
      if (authorizationUrl) {
        window.location.href = authorizationUrl;
      }
    } catch (err) {
      setPurchaseMessage(err.message || 'Unable to start purchase.');
    } finally {
      setPurchaseLoading(false);
    }
  };

  const handlePreview = async (material) => {
    try {
      const data = await marketplaceService.getMaterialById(material._id);
      setSelectedMaterial(data.material || data);
    } catch (err) {
      setPurchaseMessage(err.message || 'Unable to preview this material.');
    }
  };

  return (
    <div className="page">
      <div className="wp-section" style={{ marginBottom: '20px' }}>
        <h2 style={{ marginBottom: '8px' }}>Marketplace</h2>
        <p style={{ margin: 0, color: '#64748b' }}>Browse, preview, and purchase study materials from verified lecturers.</p>
      </div>

      <div className="wp-section marketplace-toolbar">
        <div style={{ flex: 1 }}>
          <SearchBar value={search} onChange={handleSearch} placeholder="Search by title, topic or lecturer" />
        </div>
        <div style={{ color: '#64748b', whiteSpace: 'nowrap' }}>{materials?.length || 0} available</div>
      </div>

      {loading && <LoadingSpinner label="Loading marketplace" />}
      {error && <ErrorState message={error} />}
      {!loading && !error && (!materials || materials.length === 0) && (
        <EmptyState title="No materials yet" description="The marketplace is empty right now. Check back soon." />
      )}

      {!loading && !error && materials?.length > 0 && (
        <div className="marketplace-grid">
          {materials.map((material) => (
            <MaterialCard
              key={material._id}
              material={material}
              onPreview={() => handlePreview(material)}
              onPurchase={() => handlePurchase(material)}
            />
          ))}
        </div>
      )}

      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />

      <Modal isOpen={Boolean(selectedMaterial)} onClose={() => setSelectedMaterial(null)} title={selectedMaterial?.title || 'Material details'}>
        {selectedMaterial && (
          <div>
            <p style={{ color: '#64748b' }}>{selectedMaterial.description || 'No description available.'}</p>
            <div style={{ marginTop: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700 }}>{formatCurrency(selectedMaterial.price || 0)}</span>
              {selectedMaterial.isPremium && <span className="premium-badge">Premium</span>}
            </div>
            {purchaseMessage && <p style={{ marginTop: '12px', color: '#2563eb' }}>{purchaseMessage}</p>}
            <div style={{ marginTop: '16px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button type="button" onClick={() => handlePurchase(selectedMaterial)} disabled={purchaseLoading}>
                {purchaseLoading ? 'Preparing...' : 'Purchase'}
              </button>
              <button type="button" onClick={() => setSelectedMaterial(null)}>
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
