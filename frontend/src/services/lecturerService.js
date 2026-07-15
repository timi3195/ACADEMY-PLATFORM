import apiClient from './apiClient';

const appendFormValue = (formData, key, value) => {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    formData.append(key, value.join(','));
    return;
  }
  formData.append(key, value);
};

export const lecturerService = {
  async getDashboard() {
    const { data } = await apiClient.get('/api/lecturer/dashboard');
    return data;
  },

  async getMaterials() {
    const { data } = await apiClient.get('/api/lecturer/materials');
    return data;
  },

  async createMaterial(payload, file, coverImage) {
    const formData = new FormData();
    Object.entries(payload).forEach(([key, value]) => {
      appendFormValue(formData, key, value);
    });
    if (file) {
      formData.append('file', file);
    }
    if (coverImage) {
      formData.append('coverImage', coverImage);
    }

    try {
      const { data } = await apiClient.post('/api/lecturer/materials', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      return data;
    } catch (error) {
      const errors = Array.isArray(error?.errors) ? error.errors : [];
      if (errors.length) {
        const enhancedError = new Error(errors.map((item) => item.message).join(' • '));
        enhancedError.errors = errors;
        throw enhancedError;
      }
      throw error;
    }
  },

  async updateMaterial(id, payload, file, coverImage) {
    const formData = new FormData();
    Object.entries(payload).forEach(([key, value]) => {
      appendFormValue(formData, key, value);
    });
    if (file) {
      formData.append('file', file);
    }
    if (coverImage) {
      formData.append('coverImage', coverImage);
    }

    try {
      const { data } = await apiClient.put(`/api/lecturer/materials/${id}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      return data;
    } catch (error) {
      const errors = Array.isArray(error?.errors) ? error.errors : [];
      if (errors.length) {
        const enhancedError = new Error(errors.map((item) => item.message).join(' • '));
        enhancedError.errors = errors;
        throw enhancedError;
      }
      throw error;
    }
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
