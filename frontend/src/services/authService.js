import apiClient from './apiClient';

export const authService = {
  async login(payload) {
    const { data } = await apiClient.post('/api/auth/login', payload);
    return data;
  },

  async register(payload) {
    const { data } = await apiClient.post('/api/auth/register', payload);
    return data;
  },

  async logout() {
    const { data } = await apiClient.post('/api/auth/logout');
    return data;
  },

  async me() {
    const { data } = await apiClient.get('/api/auth/me');
    return data;
  },

  async refresh() {
    const { data } = await apiClient.post('/api/auth/refresh');
    return data;
  }
};

export default authService;
