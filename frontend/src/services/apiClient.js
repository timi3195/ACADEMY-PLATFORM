import axios from 'axios';

export const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5000';

const apiClient = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json'
  }
});

const sanitizeToken = (token) => {
  if (typeof token !== 'string') return null;
  const normalized = token.trim();
  if (!normalized || normalized === 'null' || normalized === 'undefined') return null;
  return normalized;
};

export const getAccessToken = () => {
  const token = localStorage.getItem('accessToken');
  return sanitizeToken(token);
};

export const setAccessToken = (token) => {
  const sanitized = sanitizeToken(token);
  if (sanitized) {
    localStorage.setItem('accessToken', sanitized);
  } else {
    localStorage.removeItem('accessToken');
  }
};

apiClient.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let refreshPromise = null;

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest?._retry && !originalRequest?.url?.includes('/api/auth/refresh')) {
      originalRequest._retry = true;

      if (!refreshPromise) {
        refreshPromise = apiClient
          .post('/api/auth/refresh')
          .then(({ data }) => {
            if (data.accessToken) {
              setAccessToken(data.accessToken);
            }
            return data;
          })
          .finally(() => {
            refreshPromise = null;
          });
      }

      try {
        await refreshPromise;
        return apiClient(originalRequest);
      } catch (refreshError) {
        setAccessToken(null);
        window.location.href = '/login';
        return Promise.reject(refreshError);
      }
    }

    const responseData = error.response?.data;
    const message = responseData?.message || error.message || 'Request failed';
    const enhancedError = new Error(message);
    enhancedError.status = error.response?.status;
    enhancedError.responseData = responseData;
    enhancedError.errors = Array.isArray(responseData?.errors) ? responseData.errors : [];
    return Promise.reject(enhancedError);
  }
);

export default apiClient;
