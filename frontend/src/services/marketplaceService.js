import apiClient from './apiClient';

export const marketplaceService = {
  async listMaterials(params = {}) {
    const { data } = await apiClient.get('/api/marketplace/materials', { params });
    return data;
  },

  async getFeaturedMaterials(params = {}) {
    const { data } = await apiClient.get('/api/marketplace/materials/featured', { params });
    return data;
  },

  async getNewMaterials(params = {}) {
    const { data } = await apiClient.get('/api/marketplace/materials/new', { params });
    return data;
  },

  async getMaterialById(id) {
    const { data } = await apiClient.get(`/api/marketplace/materials/${id}`);
    return data;
  },

  async getCourseMaterials(courseId, params = {}) {
    const { data } = await apiClient.get(`/api/marketplace/course/${courseId}/materials`, { params });
    return data;
  },

  async getDepartmentMaterials(departmentId, params = {}) {
    const { data } = await apiClient.get(`/api/marketplace/department/${departmentId}/materials`, { params });
    return data;
  },

  async getLecturerMaterials() {
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

    const { data } = await apiClient.post('/api/marketplace/materials', formData, {
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

    const { data } = await apiClient.put(`/api/marketplace/materials/${id}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
    return data;
  },

  async deleteMaterial(id) {
    const { data } = await apiClient.delete(`/api/marketplace/materials/${id}`);
    return data;
  },

};

export default marketplaceService;
