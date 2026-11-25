import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, request } from '../lib/api';
import { useAuth } from '../lib/AuthContext';
import { queryKeys } from '../lib/query';

function useTenantIds() {
  const { agency, activeLocation, isAuthenticated } = useAuth();
  return {
    agencyId: agency?.id ?? null,
    locationId: activeLocation?.id ?? null,
    enabled: Boolean(isAuthenticated && agency?.id && activeLocation?.id),
  };
}

export function useDashboardStats() {
  const { agencyId, locationId, enabled } = useTenantIds();
  return useQuery({
    queryKey: queryKeys.dashboard(agencyId, locationId),
    queryFn: ({ signal }) => request<any>('/api/dashboard/stats', { signal }),
    enabled,
  });
}

export function useContacts(params?: { search?: string; status?: string; page?: number; limit?: number }) {
  const { agencyId, locationId, enabled } = useTenantIds();
  const qs = new URLSearchParams();
  if (params?.search) qs.set('search', params.search);
  if (params?.status && params.status !== 'all') qs.set('status', params.status);
  if (params?.page) qs.set('page', String(params.page));
  if (params?.limit) qs.set('limit', String(params.limit));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return useQuery({
    queryKey: queryKeys.contacts(agencyId, locationId, params),
    queryFn: ({ signal }) => request<{ data: any[]; total?: number }>(`/api/crm/contacts${suffix}`, { signal }),
    enabled,
  });
}

export function useContactMutations() {
  const qc = useQueryClient();
  const { agencyId, locationId } = useTenantIds();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: queryKeys.tenant(agencyId, locationId) });
  };

  const create = useMutation({
    mutationFn: (data: any) => api.crm.create('contacts', data),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: any }) => api.crm.update('contacts', id, patch),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.crm.delete('contacts', id),
    onSuccess: invalidate,
  });
  const bulkTag = useMutation({
    mutationFn: ({ contactIds, tag }: { contactIds: string[]; tag: string }) => api.contacts.bulkTag(contactIds, tag),
    onSuccess: invalidate,
  });

  return { create, update, remove, bulkTag };
}

export function useOpportunities() {
  const { agencyId, locationId, enabled } = useTenantIds();
  return useQuery({
    queryKey: queryKeys.opportunities(agencyId, locationId),
    queryFn: ({ signal }) => request<{ data: any[]; total?: number }>('/api/crm/opportunities', { signal }),
    enabled,
  });
}

export function usePipelines() {
  const { agencyId, locationId, enabled } = useTenantIds();
  return useQuery({
    queryKey: queryKeys.pipelines(agencyId, locationId),
    queryFn: ({ signal }) => request<{ data: any[]; pipelines?: any[] }>('/api/crm/pipelines', { signal }),
    enabled,
  });
}

export function useOpportunityMutations() {
  const qc = useQueryClient();
  const { agencyId, locationId } = useTenantIds();
  const invalidate = () => qc.invalidateQueries({ queryKey: queryKeys.opportunities(agencyId, locationId) });

  return {
    create: useMutation({
      mutationFn: (data: any) => api.crm.create('opportunities', data),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, patch }: { id: string; patch: any }) => api.crm.update('opportunities', id, patch),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.crm.delete('opportunities', id),
      onSuccess: invalidate,
    }),
  };
}

export function useTasks(params?: { status?: string }) {
  const { agencyId, locationId, enabled } = useTenantIds();
  const qs = params?.status && params.status !== 'all' ? `?status=${encodeURIComponent(params.status)}` : '';
  return useQuery({
    queryKey: queryKeys.tasks(agencyId, locationId, params),
    queryFn: ({ signal }) => request<{ data: any[]; tasks?: any[] }>(`/api/crm/tasks${qs}`, { signal }),
    enabled,
  });
}

export function useTaskMutations() {
  const qc = useQueryClient();
  const { agencyId, locationId } = useTenantIds();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: queryKeys.tenant(agencyId, locationId) });
  };

  return {
    create: useMutation({
      mutationFn: (data: any) => api.crm.create('tasks', data),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, patch }: { id: string; patch: any }) =>
        request(`/api/crm/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.crm.delete('tasks', id),
      onSuccess: invalidate,
    }),
  };
}

export function useCalendars() {
  const { agencyId, locationId, enabled } = useTenantIds();
  return useQuery({
    queryKey: queryKeys.calendars(agencyId, locationId),
    queryFn: ({ signal }) => request<{ data: any[] }>('/api/crm/calendars', { signal }),
    enabled,
  });
}

export function useAppointments() {
  const { agencyId, locationId, enabled } = useTenantIds();
  return useQuery({
    queryKey: queryKeys.appointments(agencyId, locationId),
    queryFn: ({ signal }) => request<{ data: any[] }>('/api/crm/appointments', { signal }),
    enabled,
  });
}

export function useWorkflows() {
  const { agencyId, locationId, enabled } = useTenantIds();
  return useQuery({
    queryKey: queryKeys.workflows(agencyId, locationId),
    queryFn: ({ signal }) => request<{ data: any[] }>('/api/crm/workflows', { signal }),
    enabled,
  });
}

export function useWorkflowRuns() {
  const { agencyId, locationId, enabled } = useTenantIds();
  return useQuery({
    queryKey: queryKeys.workflowRuns(agencyId, locationId),
    queryFn: ({ signal }) => request<{ runs: any[] }>('/api/workflows/runs', { signal }),
    enabled,
  });
}

export function useForms() {
  const { agencyId, locationId, enabled } = useTenantIds();
  return useQuery({
    queryKey: queryKeys.forms(agencyId, locationId),
    queryFn: ({ signal }) => request<{ data: any[]; forms?: any[] }>('/api/crm/forms', { signal }),
    enabled,
  });
}

export function useConversations() {
  const { agencyId, locationId, enabled } = useTenantIds();
  return useQuery({
    queryKey: queryKeys.conversations(agencyId, locationId),
    queryFn: ({ signal }) => request<{ data: any[]; conversations?: any[] }>('/api/crm/conversations', { signal }),
    enabled,
  });
}

export function useConsents(contactId?: string) {
  const { agencyId, locationId, enabled } = useTenantIds();
  const qs = contactId ? `?contactId=${encodeURIComponent(contactId)}` : '';
  return useQuery({
    queryKey: queryKeys.consents(agencyId, locationId, contactId),
    queryFn: ({ signal }) => request<{ data: any[] }>(`/api/platform/consents${qs}`, { signal }),
    enabled,
  });
}

export function useOrders() {
  const { agencyId, locationId, enabled } = useTenantIds();
  return useQuery({
    queryKey: queryKeys.orders(agencyId, locationId),
    queryFn: ({ signal }) => request<{ data: any[] }>('/api/crm/orders', { signal }),
    enabled,
  });
}

export function useInvoices() {
  const { agencyId, locationId, enabled } = useTenantIds();
  return useQuery({
    queryKey: queryKeys.invoices(agencyId, locationId),
    queryFn: ({ signal }) => request<{ data: any[] }>('/api/crm/invoices', { signal }),
    enabled,
  });
}

export function useReviews() {
  const { agencyId, locationId, enabled } = useTenantIds();
  return useQuery({
    queryKey: queryKeys.reviews(agencyId, locationId),
    queryFn: ({ signal }) => request<{ data: any[]; reviews?: any[] }>('/api/crm/reviews', { signal }),
    enabled,
  });
}
