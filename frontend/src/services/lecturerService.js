import apiClient from './apiClient';

export const lecturerService = {
  async getDashboard() {
    const { data } = await apiClient.get('/api/lecturer/dashboard');
    return data;
  },

  async getMaterials() {
    const { data } = await apiClient.get('/api/lecturer/materials');
    return data;
  },

  async createMaterial(payload, file) {
    const formData = new FormData();
    Object.entries(payload).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        formData.append(key, value);
      }
    });
    if (file) {
      formData.append('file', file);
    }

    const { data } = await apiClient.post('/api/lecturer/materials', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
    return data;
  },

  async updateMaterial(id, payload, file) {
    const formData = new FormData();
    Object.entries(payload).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        formData.append(key, value);
      }
    });
    if (file) {
      formData.append('file', file);
    }

    const { data } = await apiClient.put(`/api/lecturer/materials/${id}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
    return data;
  },

  async deleteMaterial(id) {
    const { data } = await apiClient.delete(`/api/lecturer/materials/${id}`);
    return data;
  },

  async getMaterialAnalytics(id) {
    const { data } = await apiClient.get(`/api/lecturer/materials/${id}/analytics`);
    return data;
  },

  async getEarnings() {
    const { data } = await apiClient.get('/api/lecturer/earnings');
    return data;
  },

  async getWithdrawalHistory() {
    const { data } = await apiClient.get('/api/lecturer/withdrawals');
    return data;
  },

  async requestWithdrawal(payload) {
    const { data } = await apiClient.post('/api/lecturer/withdraw', payload);
    return data;
  }
};

export default lecturerService;
