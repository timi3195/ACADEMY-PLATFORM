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
  const { loadLibrary } = useLibrary();
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
          materialType: filters.materialType || undefined
        });
        await loadLibrary();
      } catch (err) {
        console.error(err);
      }
    };

    load();
  }, [debouncedSearch, filters.department, filters.course, filters.level, filters.semester, filters.materialType, loadLibrary, loadMaterials, page]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, filters.department, filters.course, filters.level, filters.semester, filters.materialType, filters.price, filters.sortBy]);

  const totalPages = useMemo(() => Math.max(1, pagination?.totalPages || Math.ceil((materials?.length || 0) / 12)), [materials, pagination]);

  const courseOptions = useMemo(() => {
    const values = Array.isArray(materials) ? materials : [];
    return Array.from(new Set(values.map((item) => item?.course?.code || item?.course?.title).filter(Boolean))).sort();
  }, [materials]);

  const departmentOptions = useMemo(() => {
    const values = Array.isArray(materials) ? materials : [];
    return Array.from(new Set(values.map((item) => item?.department?.name).filter(Boolean))).sort();
  }, [materials]);

  const visibleMaterials = useMemo(() => {
    const source = Array.isArray(materials) ? materials : [];
    const filtered = source.filter((material) => {
      const matchesDepartment = !filters.department || material?.department?.name === filters.department;
      const matchesCourse = !filters.course || material?.course?.code === filters.course || material?.course?.title === filters.course;
      const matchesLevel = !filters.level || material?.level === filters.level;
      const matchesSemester = !filters.semester || material?.semester === filters.semester;
      const matchesMaterialType = !filters.materialType || material?.materialType === filters.materialType;
      const matchesPrice = (() => {
        if (filters.price === 'free') return Number(material?.price || 0) === 0 || material?.isFree;
        if (filters.price === 'paid') return Number(material?.price || 0) > 0;
        return true;
      })();
      const matchesRating = (() => {
        if (filters.price === 'top-rated') return Number(material?.ratingAverage || 0) >= 4;
        return true;
      })();
      const searchQuery = debouncedSearch.trim().toLowerCase();
      const haystack = [material?.title, material?.description, material?.course?.title, material?.course?.code, material?.department?.name, material?.lecturer?.name, material?.materialType, ...(material?.tags || [])].filter(Boolean).join(' ').toLowerCase();
      const matchesSearch = !searchQuery || haystack.includes(searchQuery);
      return matchesDepartment && matchesCourse && matchesLevel && matchesSemester && matchesMaterialType && matchesPrice && matchesRating && matchesSearch;
    });

    const sorted = [...filtered];
    switch (filters.sortBy) {
      case 'oldest':
        sorted.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
        break;
      case 'rating':
        sorted.sort((a, b) => Number(b.ratingAverage || 0) - Number(a.ratingAverage || 0));
        break;
      case 'low-price':
        sorted.sort((a, b) => Number(a.price || 0) - Number(b.price || 0));
        break;
      case 'high-price':
        sorted.sort((a, b) => Number(b.price || 0) - Number(a.price || 0));
        break;
      case 'views':
        sorted.sort((a, b) => Number(b.views || 0) - Number(a.views || 0));
        break;
      case 'sales':
        sorted.sort((a, b) => Number(b.sales || b.purchases || 0) - Number(a.sales || a.purchases || 0));
        break;
      case 'alpha':
        sorted.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
        break;
      case 'newest':
      default:
        sorted.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    }

    return sorted;
  }, [debouncedSearch, filters.course, filters.department, filters.level, filters.materialType, filters.price, filters.semester, filters.sortBy, materials]);

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
        <div style={{ color: '#64748b', whiteSpace: 'nowrap' }}>{visibleMaterials.length} available</div>
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
          <option value="ND1">ND1</option>
          <option value="ND2">ND2</option>
          <option value="HND1">HND1</option>
          <option value="HND2">HND2</option>
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
