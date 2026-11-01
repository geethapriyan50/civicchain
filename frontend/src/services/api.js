import axios from 'axios';
import { Capacitor } from '@capacitor/core';

export const isNativePlatform = () => {
  if (typeof window === 'undefined') return false;
  try {
    if (Capacitor && typeof Capacitor.isNativePlatform === 'function' && Capacitor.isNativePlatform()) {
      return true;
    }
  } catch (_) {}
  if (Boolean(window?.Capacitor?.isNativePlatform?.())) return true;
  if (window.location?.protocol === 'capacitor:' || window.location?.protocol === 'ionic:') return true;
  if (window.location?.hostname === 'localhost' && !window.location?.port) return true;
  return false;
};

export const getApiBaseUrl = () => {
  if (typeof window === 'undefined') return 'https://civicchain-8b15.onrender.com/api';
  const stored = localStorage.getItem('civicchain_api_url');
  
  // If stored value is an obsolete localhost or 10.0.2.2 on a physical phone, reset to Render cloud
  if (stored && stored.trim()) {
    const s = stored.trim();
    if (isNativePlatform() && (s.includes('10.0.2.2') || s.includes('localhost') || s.includes('127.0.0.1'))) {
      localStorage.setItem('civicchain_api_url', 'https://civicchain-8b15.onrender.com/api');
      return 'https://civicchain-8b15.onrender.com/api';
    }
    return s;
  }
  
  if (import.meta.env?.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }
  
  return 'https://civicchain-8b15.onrender.com/api';
};

export const setApiBaseUrl = (url) => {
  if (typeof window !== 'undefined') {
    if (!url || !url.trim()) {
      localStorage.removeItem('civicchain_api_url');
    } else {
      let clean = url.trim();
      if (!clean.endsWith('/api') && !clean.endsWith('/api/')) {
        clean = clean.replace(/\/+$/, '') + '/api';
      }
      localStorage.setItem('civicchain_api_url', clean);
    }
  }
};

export const testConnection = async (testUrl) => {
  const target = (testUrl || getApiBaseUrl()).replace(/\/+$/, '');
  const healthEndpoint = target.endsWith('/api') ? `${target}/health` : `${target}/api/health`;
  const startTime = Date.now();
  try {
    const res = await axios.get(healthEndpoint, { timeout: 35000 });
    const latency = Date.now() - startTime;
    return {
      ok: true,
      latency,
      data: res.data,
      endpoint: healthEndpoint
    };
  } catch (err) {
    return {
      ok: false,
      error: err.response?.data?.error || err.message || 'Connection failed',
      endpoint: healthEndpoint
    };
  }
};

const api = axios.create({
  timeout: 35000,
  headers: { 'Content-Type': 'application/json' }
});

api.interceptors.request.use((config) => {
  const dynamicBase = getApiBaseUrl();
  config.baseURL = dynamicBase;
  
  const token = localStorage.getItem('civicchain_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const url = error.config?.url || '';
    const isResourceError = url.includes('/evidence/') || error.config?.skipAuthRedirect;

    if (error.response?.status === 401 && !isResourceError) {
      localStorage.removeItem('civicchain_token');
      localStorage.removeItem('civicchain_user');
      if (typeof window !== 'undefined' && !window.location.pathname.includes('/login')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;
