import apiClient from './apiClient';

const appendFormValue = (formData, key, value) => {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) formData.append(key, value.join(','));
  else formData.append(key, value);
};

const buildMaterialFormData = (payload, file, coverImage) => {
  const formData = new FormData();
  Object.entries(payload).forEach(([key, value]) => appendFormValue(formData, key, value));
  if (file) formData.append('file', file);
  if (coverImage) formData.append('coverImage', coverImage);
  return formData;
};

const unwrap = (response) => response.data;

export const lecturerService = {
  async getDashboard() {
    return unwrap(await apiClient.get('/api/lecturer/dashboard'));
  },

  async getCourses() {
    return unwrap(await apiClient.get('/api/lecturer/courses'));
  },

  async getMaterials(params = {}) {
    return unwrap(await apiClient.get('/api/lecturer/materials', { params }));
  },

  async createMaterial(payload, file, coverImage) {
    return unwrap(await apiClient.post('/api/lecturer/materials', buildMaterialFormData(payload, file, coverImage), {
      headers: { 'Content-Type': 'multipart/form-data' }
    }));
  },

  async updateMaterial(id, payload, file, coverImage) {
    return unwrap(await apiClient.put(`/api/lecturer/materials/${id}`, buildMaterialFormData(payload, file, coverImage), {
      headers: { 'Content-Type': 'multipart/form-data' }
    }));
  },

  async deleteMaterial(id) {
    return unwrap(await apiClient.delete(`/api/lecturer/materials/${id}`));
  },

  async getMaterialAnalytics(id) {
    return unwrap(await apiClient.get(`/api/lecturer/materials/${id}/analytics`));
  }
};

export default lecturerService;
