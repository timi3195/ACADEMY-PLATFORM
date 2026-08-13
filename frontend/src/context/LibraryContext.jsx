import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import libraryService from '../services/libraryService';

const LibraryContext = createContext(null);

export function LibraryProvider({ children }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pagination, setPagination] = useState({ page: 1, limit: 8, total: 0, totalPages: 1 });

  const loadLibrary = useCallback(async (params = {}) => {
    const normalizedParams = {
      q: params.q || '',
      sortBy: params.sortBy || 'newest',
      department: params.department || '',
      course: params.course || '',
      semester: params.semester || '',
      level: params.level || '',
      materialType: params.materialType || '',
      price: params.price || '',
      page: Number(params.page || 1),
      limit: Number(params.limit || 8)
    };

    setLoading(true);
    setError('');
    try {
      const response = await libraryService.getLibrary(normalizedParams);
      const library = response.library || response || [];
      setItems(Array.isArray(library) ? library : []);
      setPagination(response.pagination || {
        page: normalizedParams.page,
        limit: normalizedParams.limit,
        total: Array.isArray(library) ? library.length : 0,
        totalPages: Math.max(1, Math.ceil((Array.isArray(library) ? library.length : 0) / normalizedParams.limit))
      });
      return response;
    } catch (err) {
      setError(err.message || 'Failed to load library');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const handleAuthUpdated = () => {
      loadLibrary({ page: 1, limit: 8 }).catch(() => undefined);
    };

    window.addEventListener('auth:updated', handleAuthUpdated);
    return () => window.removeEventListener('auth:updated', handleAuthUpdated);
  }, [loadLibrary]);

  const value = useMemo(() => ({
    items,
    loading,
    error,
    pagination,
    loadLibrary
  }), [items, loading, error, pagination, loadLibrary]);

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary() {
  const context = useContext(LibraryContext);
  if (!context) {
    throw new Error('useLibrary must be used within a LibraryProvider');
  }
  return context;
}
