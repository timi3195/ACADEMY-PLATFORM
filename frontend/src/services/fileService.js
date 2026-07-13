import apiClient from './apiClient';

export const fileService = {
  async getFiles() {
    const { data } = await apiClient.get('/api/files');
    return data;
  },

  async getCourseFiles(courseId) {
    const { data } = await apiClient.get(`/api/files/course/${courseId}`);
    return data;
  },

  async downloadFile(id) {
    const response = await apiClient.get(`/api/files/download/${id}`, {
      responseType: 'blob'
    });
    return response;
  },

  async viewFile(id) {
    const response = await apiClient.get(`/api/files/view/${id}`, {
      responseType: 'blob'
    });
    return response;
  }
};

export default fileService;
