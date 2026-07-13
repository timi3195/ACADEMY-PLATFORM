import apiClient from './apiClient';

export const libraryService = {
  async getLibrary(params = {}) {
    const { data } = await apiClient.get('/api/library', { params });
    return data;
  },

  async getLibraryItem(id) {
    const { data } = await apiClient.get(`/api/library/${id}`);
    return data;
  }
};

export default libraryService;
