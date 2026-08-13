import apiClient from './apiClient';

const appendFormValue = (formData, key, value) => {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    formData.append(key, value.join(','));
    return;
  }
  formData.append(key, value);
};

const toSafeNumber = (value, fallback) => {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return numericValue;
};

export const normalizeSalesResponse = (payload = {}) => {
  const normalizedPayload = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const nestedPayload = normalizedPayload.sales && typeof normalizedPayload.sales === 'object' && !Array.isArray(normalizedPayload.sales)
    ? normalizedPayload.sales
    : {};

  const sales = Array.isArray(normalizedPayload.sales)
    ? normalizedPayload.sales
    : Array.isArray(nestedPayload.sales)
      ? nestedPayload.sales
      : [];

  const total = toSafeNumber(normalizedPayload.total, toSafeNumber(nestedPayload.total, sales.length));
  const count = toSafeNumber(normalizedPayload.count, toSafeNumber(nestedPayload.count, sales.length));
  const page = toSafeNumber(normalizedPayload.page, toSafeNumber(nestedPayload.page, 1));
  const limit = toSafeNumber(normalizedPayload.limit, toSafeNumber(nestedPayload.limit, 20));

  return {
    sales,
    total: Number(total) || 0,
    count: Number(count) || 0,
    page: Number(page) > 0 ? Number(page) : 1,
    limit: Number(limit) > 0 ? Number(limit) : 20
  };
};

export const normalizePaymentSettingsResponse = (payload = {}) => {
  const settings = payload && typeof payload === 'object' && payload.settings && typeof payload.settings === 'object'
    ? payload.settings
    : {};

  return {
    bankCode: typeof settings.bankCode === 'string' ? settings.bankCode : '',
    bankName: typeof settings.bankName === 'string' ? settings.bankName : '',
    accountName: typeof settings.accountName === 'string' ? settings.accountName : '',
    accountNumberMasked: typeof settings.accountNumberMasked === 'string' ? settings.accountNumberMasked : '',
    verified: settings.verified === true
  };
};

export const lecturerService = {
  normalizeSalesResponse,
  normalizePaymentSettingsResponse,

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
  },

  async getSales(filters = {}) {
    const params = new URLSearchParams();
    if (filters.materialId) params.append('materialId', filters.materialId);
    if (filters.studentName) params.append('studentName', filters.studentName);
    if (filters.studentMatric) params.append('studentMatric', filters.studentMatric);
    if (filters.status) params.append('status', filters.status);
    if (filters.page) params.append('page', filters.page);
    if (filters.limit) params.append('limit', filters.limit);

    const { data } = await apiClient.get(`/api/lecturer/sales?${params.toString()}`);
    return normalizeSalesResponse(data);
  },

  async exportSalesCSV(filters = {}) {
    const params = new URLSearchParams();
    if (filters.materialId) params.append('materialId', filters.materialId);
    if (filters.studentName) params.append('studentName', filters.studentName);
    if (filters.studentMatric) params.append('studentMatric', filters.studentMatric);
    if (filters.status) params.append('status', filters.status);

    const { data } = await apiClient.get(`/api/lecturer/sales/export/csv?${params.toString()}`);
    return data;
  },

  async getPaymentSettings() {
    const { data } = await apiClient.get('/api/lecturer/payment/settings');
    return data;
  },

  async updatePaymentSettings(payload) {
    const { data } = await apiClient.post('/api/lecturer/payment/settings', payload);
    return data;
  },

  async getAvailableBanks() {
    const { data } = await apiClient.get('/api/lecturer/payment/banks');
    return data;
  }
};

export default lecturerService;
