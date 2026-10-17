import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { sessionsApi, authApi, dayOffsApi, type ApiWorkSession, type ApiStats, type ApiMonthStats, type ApiDayOff } from './api';
import type { Segment } from './tracker';

export function useSessions(params?: { from?: string; to?: string; month?: string; per_page?: number }) {
  return useQuery({
    queryKey: ['sessions', params],
    queryFn: () => sessionsApi.list(params).then(res => res.data.data),
  });
}

export function useTodaySessions() {
  return useQuery({
    queryKey: ['sessions', 'today'],
    queryFn: () => sessionsApi.today().then(res => res.data),
  });
}

export function useStats() {
  return useQuery({
    queryKey: ['sessions', 'stats'],
    queryFn: () => sessionsApi.stats().then(res => res.data),
  });
}

export function useMonthlyBreakdown(count = 4) {
  return useQuery({
    queryKey: ['sessions', 'monthly', count],
    queryFn: () => sessionsApi.monthly(count).then(res => res.data),
  });
}

export function useCreateSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { start: string; end?: string; note?: string; type?: 'work' | 'study'; paused_ms?: number; paused_at?: string; segments?: Segment[] }) =>
      sessionsApi.create(data).then(res => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({ queryKey: ['sessions', 'today'] });
      queryClient.invalidateQueries({ queryKey: ['sessions', 'stats'] });
      queryClient.invalidateQueries({ queryKey: ['sessions', 'monthly'] });
    },
  });
}

export function useUpdateSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<{ start: string; end: string; note: string; type: 'work' | 'study'; paused_ms: number; paused_at: string | null; segments: Segment[] }> }) =>
      sessionsApi.update(id, data).then(res => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({ queryKey: ['sessions', 'today'] });
      queryClient.invalidateQueries({ queryKey: ['sessions', 'stats'] });
      queryClient.invalidateQueries({ queryKey: ['sessions', 'monthly'] });
    },
  });
}

export function useDeleteSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => sessionsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({ queryKey: ['sessions', 'today'] });
      queryClient.invalidateQueries({ queryKey: ['sessions', 'stats'] });
      queryClient.invalidateQueries({ queryKey: ['sessions', 'monthly'] });
    },
  });
}

export function useClearAllSessions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => sessionsApi.clearAll(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({ queryKey: ['sessions', 'today'] });
      queryClient.invalidateQueries({ queryKey: ['sessions', 'stats'] });
      queryClient.invalidateQueries({ queryKey: ['sessions', 'monthly'] });
    },
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ email, password, remember }: { email: string; password: string; remember?: boolean }) =>
      authApi.login(email, password, remember),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user'] });
    },
  });
}

export function useRegister() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, email, password, password_confirmation }: { name: string; email: string; password: string; password_confirmation: string }) =>
      authApi.register(name, email, password, password_confirmation),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user'] });
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => authApi.logout(),
    onSuccess: () => {
      queryClient.clear();
    },
  });
}

export function useUser() {
  return useQuery({
    queryKey: ['user'],
    queryFn: async () => {
      try {
        const res = await authApi.user();
        return res.data.user;
      } catch (error) {
        const axiosError = error as { response?: { status?: number } };
        if (axiosError.response?.status === 401) {
          return null;
        }
        throw error;
      }
    },
    retry: false,
  });
}

export function useDayOffs() {
  return useQuery({
    queryKey: ['dayOffs'],
    queryFn: () => dayOffsApi.list().then(res => res.data),
  });
}

export function useAddDayOff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ date, type }: { date: string; type?: 'excluded' | 'included' }) =>
      dayOffsApi.create(date, type).then(res => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dayOffs'] });
      queryClient.invalidateQueries({ queryKey: ['sessions', 'stats'] });
      queryClient.invalidateQueries({ queryKey: ['sessions', 'monthly'] });
    },
  });
}

export function useRemoveDayOff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (date: string) => dayOffsApi.delete(date),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dayOffs'] });
      queryClient.invalidateQueries({ queryKey: ['sessions', 'stats'] });
      queryClient.invalidateQueries({ queryKey: ['sessions', 'monthly'] });
    },
  });
}

export function useDaySessions(dateKey: string) {
  return useQuery({
    queryKey: ['sessions', 'day', dateKey],
    queryFn: () => sessionsApi.list({ from: dateKey, to: dateKey }).then(res => res.data.data),
    enabled: !!dateKey,
  });
}