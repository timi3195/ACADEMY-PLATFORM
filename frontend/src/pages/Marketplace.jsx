import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMarketplace } from '../context/MarketplaceContext';
import marketplaceService from '../services/marketplaceService';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorState from '../components/ErrorState';
import EmptyState from '../components/EmptyState';
import SearchBar from '../components/SearchBar';
import MaterialCard from '../components/MaterialCard';
import Pagination from '../components/Pagination';
import Modal from '../components/Modal';
import NotificationBanner from '../components/NotificationBanner';
import useDebounce from '../hooks/useDebounce';

const sortOptions = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'rating', label: 'Highest rated' },
  { value: 'views', label: 'Most viewed' },
  { value: 'alpha', label: 'Alphabetical' }
];

export default function Marketplace() {
  const navigate = useNavigate();
  const { materials, loading, error, loadMaterials, pagination } = useMarketplace();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('q') || '');
  const [page, setPage] = useState(Number(searchParams.get('page') || 1));
  const [selectedMaterial, setSelectedMaterial] = useState(null);
  const [notice, setNotice] = useState('');
  const [filters, setFilters] = useState({
    department: '',
    course: '',
    level: '',
    semester: '',
    materialType: '',
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
          sortBy: filters.sortBy || 'newest'
        });
      } catch (err) {
        console.error(err);
      }
    };

    load();
  }, [debouncedSearch, filters.department, filters.course, filters.level, filters.semester, filters.materialType, loadMaterials, page]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, filters.department, filters.course, filters.level, filters.semester, filters.materialType, filters.sortBy]);

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

  const handlePreview = async (material) => {
    try {
      const data = await marketplaceService.getMaterialById(material._id);
      setSelectedMaterial(data.material || data);
    } catch (err) {
      setNotice(err.message || 'Unable to preview this material.');
    }
  };

  return (
    <div className="page">
      <div className="wp-section" style={{ marginBottom: '20px' }}>
        <h2 style={{ marginBottom: '8px' }}>Marketplace</h2>
        <p style={{ margin: 0, color: '#64748b' }}>Browse educational materials shared by verified lecturers. Resources are free for students authorized to access them.</p>
        <p role="status" style={{ margin: '10px 0 0', color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '10px 12px' }}>
          Marketplace buying and selling are deferred in this release. Course and library access are not affected.
        </p>
      </div>

      {notice && <NotificationBanner type="info" message={notice} onClose={() => setNotice('')} autoDismissMs={2400} />}

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
              variant="compact"
              onPreview={() => handlePreview(material)}
            />
          ))}
        </div>
      )}

      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />

      <Modal isOpen={Boolean(selectedMaterial)} onClose={() => setSelectedMaterial(null)} title={selectedMaterial?.title || 'Material details'}>
        {selectedMaterial && (
          <div>
            <p style={{ color: '#64748b' }}>{selectedMaterial.description || 'No description available.'}</p>
            <p style={{ marginTop: '12px', color: '#166534', fontWeight: 600 }}>
              Free for students authorized to access the associated course.
            </p>
            <div style={{ marginTop: '16px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button type="button" onClick={() => navigate(`/marketplace/${selectedMaterial._id}`)}>View material</button>
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
