import React, { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import marketplaceService from '../services/marketplaceService';

const MarketplaceContext = createContext(null);

export function MarketplaceProvider({ children }) {
  const [materials, setMaterials] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pagination, setPagination] = useState({ page: 1, limit: 12, total: 0, totalPages: 1 });
  const lastRequestKeyRef = useRef('');
  const lastParamsRef = useRef({ page: 1, limit: 12 });

  const loadMaterials = useCallback(async (params = {}) => {
    const normalizedParams = {
      q: params.q || '',
      page: Number(params.page || 1),
      limit: Number(params.limit || 12),
      department: params.department || '',
      course: params.course || '',
      level: params.level || '',
      semester: params.semester || '',
      materialType: params.materialType || '',
      price: params.price || '',
      sortBy: params.sortBy || 'newest'
    };
    const requestKey = JSON.stringify(normalizedParams);
    lastParamsRef.current = normalizedParams;

    if (lastRequestKeyRef.current === requestKey && materials.length) {
      return { materials, pagination };
    }

    setLoading(true);
    setError('');
    try {
      const response = await marketplaceService.listMaterials(normalizedParams);
      const list = response.materials || response || [];
      setMaterials(Array.isArray(list) ? list : []);
      setPagination(response.pagination || {
        page: normalizedParams.page,
        limit: normalizedParams.limit,
        total: list.length || 0,
        totalPages: Math.max(1, Math.ceil((list.length || 0) / normalizedParams.limit))
      });
      lastRequestKeyRef.current = requestKey;
      return response;
    } catch (err) {
      setError(err.message || 'Failed to load marketplace');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [materials, pagination]);

  useEffect(() => {
    const refreshMarketplace = () => {
      lastRequestKeyRef.current = '';
      loadMaterials(lastParamsRef.current).catch(() => undefined);
    };

    window.addEventListener('auth:updated', refreshMarketplace);
    window.addEventListener('marketplace:updated', refreshMarketplace);
    window.addEventListener('storage', refreshMarketplace);
    return () => {
      window.removeEventListener('auth:updated', refreshMarketplace);
      window.removeEventListener('marketplace:updated', refreshMarketplace);
      window.removeEventListener('storage', refreshMarketplace);
    };
  }, [loadMaterials]);

  const value = useMemo(() => ({
    materials,
    loading,
    error,
    pagination,
    loadMaterials
  }), [materials, loading, error, pagination]);

  return <MarketplaceContext.Provider value={value}>{children}</MarketplaceContext.Provider>;
}

export function useMarketplace() {
  const context = useContext(MarketplaceContext);
  if (!context) {
    throw new Error('useMarketplace must be used within a MarketplaceProvider');
  }
  return context;
}
