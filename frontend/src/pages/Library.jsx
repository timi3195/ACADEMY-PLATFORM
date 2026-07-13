import React, { useEffect, useMemo, useState } from 'react';
import { useLibrary } from '../context/LibraryContext';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorState from '../components/ErrorState';
import EmptyState from '../components/EmptyState';
import MaterialCard from '../components/MaterialCard';
import SearchBar from '../components/SearchBar';
import Pagination from '../components/Pagination';
import useDebounce from '../hooks/useDebounce';

export default function Library() {
  const { items, loading, error, loadLibrary } = useLibrary();
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('newest');
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounce(search, 250);
  const pageSize = 8;

  useEffect(() => {
    loadLibrary({ q: debouncedSearch, sortBy });
  }, [debouncedSearch, loadLibrary, sortBy]);

  const filteredItems = useMemo(() => {
    const query = debouncedSearch.trim().toLowerCase();
    const source = Array.isArray(items) ? items : [];
    const filtered = query
      ? source.filter((item) => {
          const title = item.material?.title || '';
          const lecturer = item.material?.lecturer?.name || '';
          const course = item.material?.course?.title || '';
          return `${title} ${lecturer} ${course}`.toLowerCase().includes(query);
        })
      : source;

    return filtered.slice((page - 1) * pageSize, page * pageSize);
  }, [debouncedSearch, items, page]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(((Array.isArray(items) ? items : []).length || 0) / pageSize)), [items]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, sortBy]);

  return (
    <div className="page">
      <div className="wp-section" style={{ marginBottom: '20px' }}>
        <h2 style={{ marginBottom: '8px' }}>My Library</h2>
        <p style={{ margin: 0, color: '#64748b' }}>Your purchased materials and study resources.</p>
      </div>

      <div className="wp-section library-toolbar">
        <SearchBar value={search} onChange={setSearch} placeholder="Search your library" />
        <select value={sortBy} onChange={(event) => setSortBy(event.target.value)} aria-label="Sort library items">
          <option value="newest">Newest</option>
          <option value="course">Course</option>
          <option value="lecturer">Lecturer</option>
          <option value="department">Department</option>
        </select>
      </div>

      {loading && <LoadingSpinner label="Loading library" />}
      {error && <ErrorState message={error} />}
      {!loading && !error && (!items || items.length === 0) && (
        <EmptyState title="No purchases yet" description="Purchased materials will appear here automatically." />
      )}

      {!loading && !error && filteredItems?.length > 0 && (
        <div className="marketplace-grid">
          {filteredItems.map((item) => (
            <article key={item.transactionId || item.material?._id} className="library-card">
              <MaterialCard material={item.material} />
              <div style={{ marginTop: '12px', color: '#64748b', fontSize: '13px' }}>
                <div>Purchased: {item.purchasedAt ? new Date(item.purchasedAt).toLocaleDateString() : '—'}</div>
                <div>Lecturer: {item.material?.lecturer?.name || '—'}</div>
                <div>Course: {item.material?.course?.title || '—'}</div>
              </div>
            </article>
          ))}
        </div>
      )}

      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}
