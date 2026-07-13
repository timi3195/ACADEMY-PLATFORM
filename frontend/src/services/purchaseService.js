import apiClient from './apiClient';

export const purchaseService = {
  async getPurchaseHistory(params = {}) {
    const { data } = await apiClient.get('/api/purchase/history', { params });
    return data;
  },

  async initializePurchase(materialId) {
    const { data } = await apiClient.post(`/api/purchase/marketplace/materials/${materialId}/purchase`);
    return data;
  },

  async verifyPurchase(materialId, reference) {
    const { data } = await apiClient.post(`/api/purchase/marketplace/materials/${materialId}/verify`, { reference });
    return data;
  },

  async getMaterialAccess(materialId) {
    const { data } = await apiClient.get(`/api/purchase/marketplace/materials/${materialId}/access`);
    return data;
  }
};

export default purchaseService;
