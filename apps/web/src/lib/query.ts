import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api.ts';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        if (error instanceof ApiError && [400, 401, 403, 404, 409, 422].includes(error.status)) {
          return false;
        }
        return failureCount < 1;
      },
    },
    mutations: {
      retry: false,
    },
  },
});

export function clearTenantCache() {
  queryClient.clear();
}

export const queryKeys = {
  tenant: (agencyId?: string | null, locationId?: string | null) =>
    ['tenant', agencyId ?? 'none', locationId ?? 'none'] as const,
  dashboard: (agencyId?: string | null, locationId?: string | null) =>
    [...queryKeys.tenant(agencyId, locationId), 'dashboard'] as const,
  contacts: (agencyId?: string | null, locationId?: string | null, params?: Record<string, unknown>) =>
    [...queryKeys.tenant(agencyId, locationId), 'contacts', params ?? {}] as const,
  contact: (agencyId?: string | null, locationId?: string | null, id?: string) =>
    [...queryKeys.tenant(agencyId, locationId), 'contact', id ?? ''] as const,
  contactTimeline: (agencyId?: string | null, locationId?: string | null, id?: string) =>
    [...queryKeys.tenant(agencyId, locationId), 'contactTimeline', id ?? ''] as const,
  opportunities: (agencyId?: string | null, locationId?: string | null) =>
    [...queryKeys.tenant(agencyId, locationId), 'opportunities'] as const,
  pipelines: (agencyId?: string | null, locationId?: string | null) =>
    [...queryKeys.tenant(agencyId, locationId), 'pipelines'] as const,
  tasks: (agencyId?: string | null, locationId?: string | null, params?: Record<string, unknown>) =>
    [...queryKeys.tenant(agencyId, locationId), 'tasks', params ?? {}] as const,
  calendars: (agencyId?: string | null, locationId?: string | null) =>
    [...queryKeys.tenant(agencyId, locationId), 'calendars'] as const,
  appointments: (agencyId?: string | null, locationId?: string | null) =>
    [...queryKeys.tenant(agencyId, locationId), 'appointments'] as const,
  workflows: (agencyId?: string | null, locationId?: string | null) =>
    [...queryKeys.tenant(agencyId, locationId), 'workflows'] as const,
  workflowRuns: (agencyId?: string | null, locationId?: string | null) =>
    [...queryKeys.tenant(agencyId, locationId), 'workflowRuns'] as const,
  funnels: (agencyId?: string | null, locationId?: string | null) =>
    [...queryKeys.tenant(agencyId, locationId), 'funnels'] as const,
  websites: (agencyId?: string | null, locationId?: string | null) =>
    [...queryKeys.tenant(agencyId, locationId), 'websites'] as const,
  forms: (agencyId?: string | null, locationId?: string | null) =>
    [...queryKeys.tenant(agencyId, locationId), 'forms'] as const,
  formSubmissions: (agencyId?: string | null, locationId?: string | null, formId?: string) =>
    [...queryKeys.tenant(agencyId, locationId), 'formSubmissions', formId ?? 'all'] as const,
  conversations: (agencyId?: string | null, locationId?: string | null) =>
    [...queryKeys.tenant(agencyId, locationId), 'conversations'] as const,
  consents: (agencyId?: string | null, locationId?: string | null, contactId?: string) =>
    [...queryKeys.tenant(agencyId, locationId), 'consents', contactId ?? 'all'] as const,
  orders: (agencyId?: string | null, locationId?: string | null) =>
    [...queryKeys.tenant(agencyId, locationId), 'orders'] as const,
  invoices: (agencyId?: string | null, locationId?: string | null) =>
    [...queryKeys.tenant(agencyId, locationId), 'invoices'] as const,
  payments: (agencyId?: string | null, locationId?: string | null) =>
    [...queryKeys.tenant(agencyId, locationId), 'payments'] as const,
  reviews: (agencyId?: string | null, locationId?: string | null) =>
    [...queryKeys.tenant(agencyId, locationId), 'reviews'] as const,
  agencyProfile: (agencyId?: string | null) =>
    ['tenant', agencyId ?? 'none', 'agencyProfile'] as const,
  agencyTeam: (agencyId?: string | null) =>
    ['tenant', agencyId ?? 'none', 'agencyTeam'] as const,
  agencyLocations: (agencyId?: string | null) =>
    ['tenant', agencyId ?? 'none', 'agencyLocations'] as const,
  agencyBranding: (agencyId?: string | null) =>
    ['tenant', agencyId ?? 'none', 'agencyBranding'] as const,
};
