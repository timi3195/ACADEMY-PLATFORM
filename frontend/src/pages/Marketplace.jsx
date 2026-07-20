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
import NotificationBanner from '../components/NotificationBanner';
import { formatCurrency } from '../utils/formatters';
import useDebounce from '../hooks/useDebounce';

const sortOptions = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'rating', label: 'Highest rated' },
  { value: 'low-price', label: 'Lowest price' },
  { value: 'high-price', label: 'Highest price' },
  { value: 'views', label: 'Most viewed' },
  { value: 'sales', label: 'Most purchased' },
  { value: 'alpha', label: 'Alphabetical' }
];

export default function Marketplace() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { materials, loading, error, loadMaterials, pagination } = useMarketplace();
  const { items: libraryItems = [], loadLibrary } = useLibrary();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('q') || '');
  const [page, setPage] = useState(Number(searchParams.get('page') || 1));
  const [selectedMaterial, setSelectedMaterial] = useState(null);
  const [purchaseLoading, setPurchaseLoading] = useState(false);
  const [purchaseMessage, setPurchaseMessage] = useState('');
  const [filters, setFilters] = useState({
    department: '',
    course: '',
    level: '',
    semester: '',
    materialType: '',
    price: '',
    sortBy: 'newest'
  });
  const debouncedSearch = useDebounce(search, 250);

  useEffect(() => {
    const load = async () => {
      try {
        await loadMaterials({
          q: debouncedSearch,
          page,
          limit: 12,
          department: filters.department || undefined,
          course: filters.course || undefined,
          level: filters.level || undefined,
          semester: filters.semester || undefined,
          materialType: filters.materialType || undefined,
          price: filters.price || undefined,
          sortBy: filters.sortBy || 'newest'
        });
        await loadLibrary({ limit: 8 });
      } catch (err) {
        console.error(err);
      }
    };

    load();
  }, [debouncedSearch, filters.department, filters.course, filters.level, filters.semester, filters.materialType, loadLibrary, loadMaterials, page]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, filters.department, filters.course, filters.level, filters.semester, filters.materialType, filters.price, filters.sortBy]);

  const totalPages = useMemo(() => Math.max(1, pagination?.totalPages || 1), [pagination]);

  const courseOptions = useMemo(() => {
    const values = Array.isArray(materials) ? materials : [];
    return Array.from(new Set(values.map((item) => item?.course || item?.course?.code || item?.course?.title).filter(Boolean))).sort();
  }, [materials]);

  const departmentOptions = useMemo(() => {
    const values = Array.isArray(materials) ? materials : [];
    return Array.from(new Set(values.map((item) => item?.department || item?.department?.name).filter(Boolean))).sort();
  }, [materials]);

  const visibleMaterials = useMemo(() => (Array.isArray(materials) ? materials : []), [materials]);

  const handleSearch = (value) => {
    setSearch(value);
    setPage(1);
    setSearchParams({ q: value, page: '1' });
  };

  const handleFilterChange = (event) => {
    const { name, value } = event.target;
    setFilters((prev) => ({ ...prev, [name]: value }));
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

      {purchaseMessage && <NotificationBanner type="info" message={purchaseMessage} onClose={() => setPurchaseMessage('')} autoDismissMs={2400} />}

      <div className="wp-section marketplace-toolbar">
        <div style={{ flex: 1 }}>
          <SearchBar value={search} onChange={handleSearch} placeholder="Search by title, course, department, lecturer, tags or material type" />
        </div>
        <div style={{ color: '#64748b', whiteSpace: 'nowrap' }}>{pagination.total || 0} available</div>
      </div>

      <div className="wp-section marketplace-filters">
        <select name="department" value={filters.department} onChange={handleFilterChange} aria-label="Filter by department">
          <option value="">Department</option>
          {departmentOptions.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
        <select name="course" value={filters.course} onChange={handleFilterChange} aria-label="Filter by course">
          <option value="">Course</option>
          {courseOptions.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
        <select name="level" value={filters.level} onChange={handleFilterChange} aria-label="Filter by level">
          <option value="">Level</option>
          <option value="100 Level">100 Level</option>
          <option value="200 Level">200 Level</option>
          <option value="300 Level">300 Level</option>
          <option value="400 Level">400 Level</option>
          <option value="500 Level">500 Level</option>
          <option value="Other">Other</option>
        </select>
        <select name="semester" value={filters.semester} onChange={handleFilterChange} aria-label="Filter by semester">
          <option value="">Semester</option>
          <option value="First">First</option>
          <option value="Second">Second</option>
        </select>
        <select name="materialType" value={filters.materialType} onChange={handleFilterChange} aria-label="Filter by material type">
          <option value="">Material type</option>
          <option value="PDF">PDF</option>
          <option value="DOCX">DOCX</option>
          <option value="PPT">PPT</option>
          <option value="ZIP">ZIP</option>
          <option value="Video">Video</option>
          <option value="Book">Book</option>
          <option value="Lab Manual">Lab Manual</option>
          <option value="Assignment">Assignment</option>
          <option value="Past Question">Past Question</option>
          <option value="Other">Other</option>
        </select>
        <select name="price" value={filters.price} onChange={handleFilterChange} aria-label="Filter by price">
          <option value="">Price</option>
          <option value="free">Free</option>
          <option value="paid">Paid</option>
          <option value="top-rated">Top rated</option>
        </select>
        <select name="sortBy" value={filters.sortBy} onChange={handleFilterChange} aria-label="Sort materials">
          {sortOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>

      {loading && <LoadingSpinner label="Loading marketplace" />}
      {error && <ErrorState message={error} />}
      {!loading && !error && visibleMaterials.length === 0 && (
        <EmptyState title="No materials found" description="Try a different search or filter to discover more resources." />
      )}

      {!loading && !error && visibleMaterials.length > 0 && (
        <div className="marketplace-grid">
          {visibleMaterials.map((material) => (
            <MaterialCard
              key={material._id}
              material={material}
              searchTerm={search}
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
              {Boolean(selectedMaterial && (selectedMaterial.isPurchased || selectedMaterial.hasAccess || selectedMaterial.accessGranted || selectedMaterial.canAccess || Array.isArray(libraryItems) && libraryItems.some((item) => { const id = item?.material?._id || item?.materialId || item?._id; return Boolean(id && (id === selectedMaterial._id || id === selectedMaterial.id)); }))) ? (
                <button type="button" onClick={() => navigate(`/marketplace/${selectedMaterial._id}`)}>Open library</button>
              ) : (
                <button type="button" onClick={() => handlePurchase(selectedMaterial)} disabled={purchaseLoading}>
                  {purchaseLoading ? 'Preparing...' : 'Purchase'}
                </button>
              )}
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
