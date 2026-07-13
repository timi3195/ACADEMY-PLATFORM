import React, { createContext, useContext, useMemo, useState } from 'react';
import libraryService from '../services/libraryService';

const LibraryContext = createContext(null);

export function LibraryProvider({ children }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadLibrary = async (params = {}) => {
    setLoading(true);
    setError('');
    try {
      const response = await libraryService.getLibrary(params);
      const library = response.library || response || [];
      setItems(Array.isArray(library) ? library : []);
      return response;
    } catch (err) {
      setError(err.message || 'Failed to load library');
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const value = useMemo(() => ({
    items,
    loading,
    error,
    loadLibrary
  }), [items, loading, error]);

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary() {
  const context = useContext(LibraryContext);
  if (!context) {
    throw new Error('useLibrary must be used within a LibraryProvider');
  }
  return context;
}
