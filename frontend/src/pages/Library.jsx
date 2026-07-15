import React, { useEffect, useMemo, useState } from 'react';
import { useLibrary } from '../context/LibraryContext';
import { useMarketplace } from '../context/MarketplaceContext';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorState from '../components/ErrorState';
import EmptyState from '../components/EmptyState';
import MaterialCard from '../components/MaterialCard';
import SearchBar from '../components/SearchBar';
import Pagination from '../components/Pagination';
import NotificationBanner from '../components/NotificationBanner';
import useDebounce from '../hooks/useDebounce';
import { getProgressEntry, getProgressPercent, loadWishlistEntries, toggleWishlistEntry, isWishlisted } from '../utils/libraryState';

export default function Library() {
  const { items, loading, error, loadLibrary } = useLibrary();
  const { materials, loadMaterials } = useMarketplace();
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('newest');
  const [page, setPage] = useState(1);
  const [viewMode, setViewMode] = useState('grid');
  const [filters, setFilters] = useState({ department: '', course: '', semester: '', level: '', materialType: '', price: '', recentlyOpened: false, recentlyPurchased: false });
  const [notice, setNotice] = useState('');
  const [wishlistIds, setWishlistIds] = useState(loadWishlistEntries());
  const debouncedSearch = useDebounce(search, 250);
  const pageSize = 8;

  useEffect(() => {
    loadLibrary({ q: debouncedSearch, sortBy });
    loadMaterials({ limit: 24 }).catch(() => undefined);
  }, [debouncedSearch, loadLibrary, loadMaterials, sortBy]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, filters.department, filters.course, filters.semester, filters.level, filters.materialType, filters.price, filters.recentlyOpened, filters.recentlyPurchased, sortBy]);

  const sourceItems = useMemo(() => Array.isArray(items) ? items : [], [items]);

  const continueReadingItems = useMemo(() => sourceItems
    .map((item) => ({ ...item, progress: getProgressEntry(item.material?._id) }))
    .filter((item) => item.progress)
    .sort((a, b) => new Date(b.progress.lastOpened || 0) - new Date(a.progress.lastOpened || 0))
    .slice(0, 5), [sourceItems]);

  const filteredItems = useMemo(() => {
    const query = debouncedSearch.trim().toLowerCase();
    const filtered = sourceItems.filter((item) => {
      const material = item.material || {};
      const title = material.title || '';
      const lecturer = material.lecturer?.name || '';
      const course = material.course?.title || material.course?.code || '';
      const department = material.department?.name || '';
      const semester = material.semester || '';
      const level = material.level || '';
      const type = material.materialType || '';
      const price = Number(material.price || 0);
      const searchMatches = !query || [title, lecturer, course, department, semester, level, type, material.description || ''].join(' ').toLowerCase().includes(query);
      const departmentMatches = !filters.department || department === filters.department;
      const courseMatches = !filters.course || course === filters.course;
      const semesterMatches = !filters.semester || semester === filters.semester;
      const levelMatches = !filters.level || level === filters.level;
      const typeMatches = !filters.materialType || type === filters.materialType;
      const priceMatches = filters.price === 'free' ? price === 0 : filters.price === 'paid' ? price > 0 : true;
      const recentlyPurchasedMatches = !filters.recentlyPurchased || Boolean(item.purchasedAt);
      const recentlyOpenedMatches = !filters.recentlyOpened || Boolean(getProgressEntry(material._id));
      return searchMatches && departmentMatches && courseMatches && semesterMatches && levelMatches && typeMatches && priceMatches && recentlyPurchasedMatches && recentlyOpenedMatches;
    });

    const sorted = [...filtered];
    switch (sortBy) {
      case 'course':
        sorted.sort((a, b) => (a.material?.course?.title || '').localeCompare(b.material?.course?.title || '')); break;
      case 'lecturer':
        sorted.sort((a, b) => (a.material?.lecturer?.name || '').localeCompare(b.material?.lecturer?.name || '')); break;
      case 'department':
        sorted.sort((a, b) => (a.material?.department?.name || '').localeCompare(b.material?.department?.name || '')); break;
      case 'newest':
      default:
        sorted.sort((a, b) => new Date(b.purchasedAt || 0) - new Date(a.purchasedAt || 0));
    }

    return sorted.slice((page - 1) * pageSize, page * pageSize);
  }, [debouncedSearch, filters.course, filters.department, filters.level, filters.materialType, filters.price, filters.recentlyOpened, filters.recentlyPurchased, page, sortBy, sourceItems]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(sourceItems.length / pageSize)), [sourceItems.length]);

  const departmentOptions = useMemo(() => Array.from(new Set(sourceItems.map((item) => item.material?.department?.name).filter(Boolean))).sort(), [sourceItems]);
  const courseOptions = useMemo(() => Array.from(new Set(sourceItems.map((item) => item.material?.course?.title || item.material?.course?.code).filter(Boolean))).sort(), [sourceItems]);
  const semesterOptions = useMemo(() => Array.from(new Set(sourceItems.map((item) => item.material?.semester).filter(Boolean))).sort(), [sourceItems]);
  const levelOptions = useMemo(() => Array.from(new Set(sourceItems.map((item) => item.material?.level).filter(Boolean))).sort(), [sourceItems]);
  const materialTypeOptions = useMemo(() => Array.from(new Set(sourceItems.map((item) => item.material?.materialType).filter(Boolean))).sort(), [sourceItems]);

  const wishlistMaterials = useMemo(() => (Array.isArray(materials) ? materials : []).filter((material) => wishlistIds.includes(material._id)), [materials, wishlistIds]);
  const recommendations = useMemo(() => (Array.isArray(materials) ? materials : []).slice(0, 6), [materials]);

  const handleWishlistToggle = (material) => {
    const nextWishlist = toggleWishlistEntry(material);
    setWishlistIds(nextWishlist);
    setNotice(isWishlisted(material) ? 'Removed from wishlist' : 'Saved to wishlist');
  };

  const handleFilterChange = (event) => {
    const { name, value, type, checked } = event.target;
    setFilters((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  return (
    <div className="page library-shell">
      <NotificationBanner type="info" message={notice} onClose={() => setNotice('')} autoDismissMs={2400} />
      <section className="library-hero">
        <div className="library-actions">
          <span className="library-pill">📚 {sourceItems.length} purchased</span>
          <span className="library-pill">⭐ {wishlistIds.length} wishlist</span>
          <span className="library-pill">⏱ {continueReadingItems.length} continue reading</span>
        </div>
        <h2 style={{ margin: 0 }}>Your digital bookshelf</h2>
        <p style={{ margin: 0, maxWidth: '760px' }}>A polished library experience with progress tracking, curated recommendations, and quick access to your purchases.</p>
        <div className="library-actions" style={{ marginTop: '4px' }}>
          <button type="button" className="product-card__button product-card__button--ghost" onClick={() => setViewMode('grid')}>Grid view</button>
          <button type="button" className="product-card__button product-card__button--ghost" onClick={() => setViewMode('list')}>List view</button>
        </div>
      </section>

      {continueReadingItems.length > 0 && (
        <section className="library-section">
          <div className="library-section__header">
            <h3 style={{ margin: 0 }}>Continue Reading</h3>
            <span className="nav-pill">Latest activity</span>
          </div>
          <div className="library-list">
            {continueReadingItems.map((item) => {
              const progress = getProgressEntry(item.material?._id);
              const percent = getProgressPercent(progress?.lastPage || 0, progress?.totalPages || item.material?.pageCount || 1);
              return (
                <div key={item.transactionId || item.material?._id} className="library-list-item">
                  <div>
                    <strong>{item.material?.title}</strong>
                    <div style={{ color: '#64748b', fontSize: '.9rem' }}>{item.material?.course?.title || item.material?.course?.code || 'General course'}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span className="nav-pill">{percent}% done</span>
                    <button type="button" className="product-card__button" onClick={() => setNotice(`Resuming ${item.material?.title}`)}>Resume</button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="library-section">
        <div className="library-section__header">
          <h3 style={{ margin: 0 }}>Browse your library</h3>
          <span className="nav-pill">{sourceItems.length} materials</span>
        </div>
        <div className="library-toolbar">
          <SearchBar value={search} onChange={setSearch} placeholder="Search title, lecturer, course or department" />
          <select value={sortBy} onChange={(event) => setSortBy(event.target.value)} aria-label="Sort library items">
            <option value="newest">Newest</option>
            <option value="course">Course</option>
            <option value="lecturer">Lecturer</option>
            <option value="department">Department</option>
          </select>
        </div>
        <div className="marketplace-filters" style={{ marginTop: '12px' }}>
          <select name="department" value={filters.department} onChange={handleFilterChange} aria-label="Filter by department">
            <option value="">Department</option>
            {departmentOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
          <select name="course" value={filters.course} onChange={handleFilterChange} aria-label="Filter by course">
            <option value="">Course</option>
            {courseOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
          <select name="semester" value={filters.semester} onChange={handleFilterChange} aria-label="Filter by semester">
            <option value="">Semester</option>
            {semesterOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
          <select name="level" value={filters.level} onChange={handleFilterChange} aria-label="Filter by level">
            <option value="">Level</option>
            {levelOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
          <select name="materialType" value={filters.materialType} onChange={handleFilterChange} aria-label="Filter by material type">
            <option value="">Material type</option>
            {materialTypeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
          <select name="price" value={filters.price} onChange={handleFilterChange} aria-label="Filter by price">
            <option value="">Price</option>
            <option value="free">Free</option>
            <option value="paid">Paid</option>
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '.9rem' }}>
            <input type="checkbox" name="recentlyOpened" checked={filters.recentlyOpened} onChange={handleFilterChange} /> Recently opened
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '.9rem' }}>
            <input type="checkbox" name="recentlyPurchased" checked={filters.recentlyPurchased} onChange={handleFilterChange} /> Recently purchased
          </label>
        </div>
      </section>

      {loading && <LoadingSpinner label="Loading library" />}
      {error && <ErrorState message={error} />}
      {!loading && !error && sourceItems.length === 0 && (
        <EmptyState title="No library yet" description="Your purchased materials will show up here once you buy them." icon="📖" />
      )}

      {!loading && !error && filteredItems.length === 0 && sourceItems.length > 0 && (
        <EmptyState title="No search results" description="Try a different filter or search term to find your material." icon="🔎" />
      )}

      {!loading && !error && filteredItems.length > 0 && (
        <div className={viewMode === 'list' ? 'library-list' : 'marketplace-grid'}>
          {filteredItems.map((item) => {
            const progress = getProgressEntry(item.material?._id);
            const percent = getProgressPercent(progress?.lastPage || 0, progress?.totalPages || item.material?.pageCount || 1);
            return (
              <article key={item.transactionId || item.material?._id} className={viewMode === 'list' ? 'library-compact-card' : 'library-card'}>
                <MaterialCard
                  material={item.material}
                  searchTerm={search}
                  progressPercent={percent}
                  showWishlist
                  isWishlisted={wishlistIds.includes(item.material?._id)}
                  onWishlistToggle={handleWishlistToggle}
                />
                <div style={{ marginTop: '12px', color: '#64748b', fontSize: '13px' }}>
                  <div>Purchased: {item.purchasedAt ? new Date(item.purchasedAt).toLocaleDateString() : '—'}</div>
                  <div>Lecturer: {item.material?.lecturer?.name || '—'}</div>
                  <div>Course: {item.material?.course?.title || '—'}</div>
                  <div>Last opened: {progress?.lastOpened ? new Date(progress.lastOpened).toLocaleDateString() : 'Not yet opened'}</div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <section className="library-section" style={{ marginTop: '20px' }}>
        <div className="library-section__header">
          <h3 style={{ margin: 0 }}>Wishlist</h3>
          <span className="nav-pill">{wishlistMaterials.length} saved</span>
        </div>
        {wishlistMaterials.length > 0 ? (
          <div className="library-grid">
            {wishlistMaterials.map((material) => (
              <div key={material._id} className="library-compact-card">
                <strong>{material.title}</strong>
                <div style={{ color: '#64748b', fontSize: '.92rem' }}>{material.department?.name || 'General'} • {material.course?.title || material.course?.code || 'Broad'}</div>
                <button type="button" className="product-card__button" onClick={() => setNotice(`${material.title} remains in your wishlist`)}>Keep watching</button>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No wishlist yet" description="Save a material to revisit it later." icon="♡" />
        )}
      </section>

      <section className="library-section" style={{ marginTop: '20px' }}>
        <div className="library-section__header">
          <h3 style={{ margin: 0 }}>Purchase history</h3>
          <span className="nav-pill">Latest records</span>
        </div>
        <div className="library-list">
          {sourceItems.slice(0, 4).map((item) => (
            <div key={`${item.transactionId || item.material?._id}-history`} className="library-list-item">
              <div>
                <strong>{item.material?.title}</strong>
                <div style={{ color: '#64748b', fontSize: '.9rem' }}>{item.transactionId || 'No reference'}</div>
              </div>
              <div style={{ color: '#64748b', fontSize: '.9rem' }}>{item.purchasedAt ? new Date(item.purchasedAt).toLocaleDateString() : '—'}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="library-section" style={{ marginTop: '20px' }}>
        <div className="library-section__header">
          <h3 style={{ margin: 0 }}>Recommended for you</h3>
          <span className="nav-pill">From the marketplace</span>
        </div>
        <div className="marketplace-grid">
          {recommendations.map((material) => (
            <MaterialCard key={material._id} material={material} searchTerm={search} showWishlist isWishlisted={wishlistIds.includes(material._id)} onWishlistToggle={handleWishlistToggle} />
          ))}
        </div>
      </section>

      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}
