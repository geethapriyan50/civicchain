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
  if (typeof window === 'undefined') return '/api';
  // A production build's backend URL must override stale device-local settings.
  if (import.meta.env?.VITE_API_URL) {
    return import.meta.env.VITE_API_URL.trim().replace(/\\/+$/, '');
  }

  const stored = localStorage.getItem('civicchain_api_url');
  if (stored && stored.trim()) return stored.trim();
  
  if (isNativePlatform()) {
    // Default fallback for Android Emulator
    return 'http://10.0.2.2:5000/api';
  }
  
  return '/api';
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
    const res = await axios.get(healthEndpoint, { timeout: 5000 });
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
    if (error.response?.status === 401) {
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
