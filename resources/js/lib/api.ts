import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import type { Segment } from './tracker';

const API_BASE_URL = import.meta.env['VITE_API_URL'] || '/api';

export const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  },
});

// Request interceptor to add CSRF token
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
  if (token) {
    config.headers['X-CSRF-TOKEN'] = token;
  }
  return config;
});

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    // Don't redirect on 401 for login/register pages to avoid infinite loops
    if (error.response?.status === 401 && !['/login', '/register'].includes(window.location.pathname)) {
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export interface ApiWorkSession {
  id: number;
  start: string;
  end: string | null;
  note: string;
  source?: 'manual' | 'calendar';
  calendarEventId?: string | null;
  pausedMs: number;
  pausedAt: string | null;
  segments: Segment[];
  segmentsInferred: boolean;
  durationMs: number;
  durationHours: number;
  isActive: boolean;
  dayKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApiStats {
  streak: number;
  weekHours: number;
  bestDayHours: number;
  avgPerActiveDay: number;
  totalHours: number;
  backlogHours: number;
}

export interface ApiMonthStats {
  key: string;
  label: string;
  doneHours: number;
  targetHours: number;
  remainingHours: number;
  daysLeft: number;
  perDayNeeded: number;
  paceDeltaHours: number;
  progress: number;
  isCurrent: boolean;
}

export interface ApiDayOff {
  date: string;
  type: 'excluded' | 'included';
  created_at: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  links: {
    first: string | null;
    last: string | null;
    prev: string | null;
    next: string | null;
  };
  meta: {
    current_page: number;
    from: number | null;
    last_page: number;
    path: string;
    per_page: number;
    to: number | null;
    total: number;
  };
}

// Session API
export const sessionsApi = {
  list: (params?: { from?: string; to?: string; month?: string; per_page?: number }) =>
    api.get<PaginatedResponse<ApiWorkSession>>('/sessions', { params }),

  create: (data: { start: string; end?: string; note?: string; paused_ms?: number; paused_at?: string; segments?: Segment[] }) =>
    api.post<ApiWorkSession>('/sessions', data),

  get: (id: number) =>
    api.get<ApiWorkSession>(`/sessions/${id}`),

  update: (id: number, data: Partial<{ start: string; end: string; note: string; paused_ms: number; paused_at: string | null; segments: Segment[] }>) =>
    api.put<ApiWorkSession>(`/sessions/${id}`, data),

  delete: (id: number) =>
    api.delete(`/sessions/${id}`),

  today: () =>
    api.get<ApiWorkSession[]>('/sessions/today'),

  stats: () =>
    api.get<ApiStats>('/sessions/stats'),

  monthly: (count = 4) =>
    api.get<ApiMonthStats[]>(`/sessions/monthly?count=${count}`),

  clearAll: () =>
    api.delete('/sessions/clear-all'),
};

// Day-offs API
export const dayOffsApi = {
  list: () =>
    api.get<ApiDayOff[]>('/day-offs'),

  create: (date: string, type: 'excluded' | 'included' = 'excluded') =>
    api.post<ApiDayOff>('/day-offs', { date, type }),

  delete: (date: string) =>
    api.delete(`/day-offs/${date}`),
};

// Auth API
export const authApi = {
  login: (email: string, password: string, remember = false) =>
    api.post('/login', { email, password, remember }),

  register: (name: string, email: string, password: string, password_confirmation: string) =>
    api.post('/register', { name, email, password, password_confirmation }),

  logout: () =>
    api.post('/logout'),

  user: () =>
    api.get('/user'),
};