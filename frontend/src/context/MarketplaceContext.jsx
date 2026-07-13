import React, { createContext, useContext, useMemo, useState } from 'react';
import marketplaceService from '../services/marketplaceService';

const MarketplaceContext = createContext(null);

export function MarketplaceProvider({ children }) {
  const [materials, setMaterials] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadMaterials = async (params = {}) => {
    setLoading(true);
    setError('');
    try {
      const response = await marketplaceService.listMaterials(params);
      setMaterials(response.materials || response || []);
      return response;
    } catch (err) {
      setError(err.message || 'Failed to load marketplace');
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const value = useMemo(() => ({
    materials,
    loading,
    error,
    loadMaterials
  }), [materials, loading, error]);

  return <MarketplaceContext.Provider value={value}>{children}</MarketplaceContext.Provider>;
}

export function useMarketplace() {
  const context = useContext(MarketplaceContext);
  if (!context) {
    throw new Error('useMarketplace must be used within a MarketplaceProvider');
  }
  return context;
}
