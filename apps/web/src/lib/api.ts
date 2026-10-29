// Operza Production API Client

const BASE = '';

export async function request<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  // Pass active location header if saved
  const activeLoc = localStorage.getItem('operza_active_location');
  if (activeLoc && !headers.has('x-operza-location')) {
    headers.set('x-operza-location', activeLoc);
  }

  const response = await fetch(`${BASE}${endpoint}`, {
    ...options,
    headers,
    credentials: 'include'
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody.error || `Request failed with status ${response.status}`);
  }

  return response.json();
}

export const api = {
  auth: {
    signup: (data: { name: string; email: string; password: string; agencyName?: string }) =>
      request('/api/auth/signup', { method: 'POST', body: JSON.stringify(data) }),
    login: (data: { email: string; password: string }) =>
      request('/api/auth/login', { method: 'POST', body: JSON.stringify(data) }),
    session: () => request('/api/auth/session'),
    logout: () => request('/api/auth/logout', { method: 'POST' }),
  },
  crm: {
    list: (collection: string) => request(`/api/crm/${collection}`),
    create: (collection: string, data: any) =>
      request(`/api/crm/${collection}`, { method: 'POST', body: JSON.stringify(data) }),
    update: (collection: string, id: string, data: any) =>
      request(`/api/crm/${collection}/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (collection: string, id: string) =>
      request(`/api/crm/${collection}/${id}`, { method: 'DELETE' }),
  },
  forms: {
    getPublic: (slug: string) => request(`/api/forms/public/${slug}`),
    submitPublic: (slug: string, answers: Record<string, any>) =>
      request(`/api/forms/submit/${slug}`, { method: 'POST', body: JSON.stringify({ answers }) }),
  },
  calendars: {
    getPublic: (idOrSlug: string, date?: string) =>
      request(`/api/calendars/public/${idOrSlug}${date ? `?date=${encodeURIComponent(date)}` : ''}`),
    bookPublic: (idOrSlug: string, data: { name: string; email: string; phone?: string; date: string; timeSlot: string; notes?: string }) =>
      request(`/api/calendars/book/${idOrSlug}`, { method: 'POST', body: JSON.stringify(data) }),
  },
  payments: {
    getPublic: (slugOrId: string) => request(`/api/payments/public/${slugOrId}`),
    checkoutPublic: (slugOrId: string, data: { customerName: string; customerEmail: string; customerPhone?: string; billingAddress?: any }) =>
      request(`/api/payments/checkout/${slugOrId}`, { method: 'POST', body: JSON.stringify(data) }),
  },
  workflows: {
    getRuns: () => request('/api/workflows/runs'),
    approveRun: (runId: string) =>
      request(`/api/workflows/runs/${runId}/approve`, { method: 'POST' }),
    run: (workflowId: string, data: { contactId?: string; payload?: any } = {}) =>
      request(`/api/workflows/${workflowId}/run`, { method: 'POST', body: JSON.stringify(data) }),
  },
  reviews: {
    getPublic: (locationId: string) => request(`/api/reviews/public/${locationId}`),
    submitPublic: (locationId: string, data: { contactName: string; email?: string; rating: number; text: string; source?: string }) =>
      request(`/api/reviews/submit/${locationId}`, { method: 'POST', body: JSON.stringify(data) }),
  },
  agency: {
    getLocations: () => request<{ locations: any[] }>('/api/agency/locations'),
    createLocation: (data: { name: string; address?: string; phone?: string; timezone?: string; industry?: string; ownerEmail?: string; planId?: string; seats?: number; status?: string }) =>
      request('/api/agency/locations', { method: 'POST', body: JSON.stringify(data) }),
    updateLocation: (id: string, data: any) =>
      request(`/api/agency/locations/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteLocation: (id: string) =>
      request(`/api/agency/locations/${id}`, { method: 'DELETE' }),
    getSnapshots: () => request<{ snapshots: any[] }>('/api/agency/snapshots'),
    createSnapshot: (data: { name: string; description?: string; industry?: string; sourceLocationId?: string; includeContacts?: boolean }) =>
      request('/api/agency/snapshots', { method: 'POST', body: JSON.stringify(data) }),
    deploySnapshot: (id: string, targetLocationId: string, options?: { includeContacts?: boolean }) =>
      request(`/api/agency/snapshots/${id}/deploy`, { method: 'POST', body: JSON.stringify({ targetLocationId, ...options }) }),
    restoreSnapshot: (id: string) =>
      request(`/api/agency/snapshots/${id}/restore`, { method: 'POST' }),
    deleteSnapshot: (id: string) =>
      request(`/api/agency/snapshots/${id}`, { method: 'DELETE' }),
  },
  dashboard: {
    getStats: () => request('/api/dashboard/stats'),
    getActivity: (limit = 20) => request(`/api/dashboard/activity?limit=${limit}`),
  },
  audit: {
    list: (params?: { q?: string; action?: string; limit?: number }) => {
      const q = new URLSearchParams();
      if (params?.q) q.set('q', params.q);
      if (params?.action) q.set('action', params.action);
      if (params?.limit) q.set('limit', String(params.limit));
      const qs = q.toString();
      return request<{ data: any[]; total: number }>(`/api/audit${qs ? `?${qs}` : ''}`);
    },
    clear: () => request('/api/audit', { method: 'DELETE' }),
  },
  campaigns: {
    send: (id: string) => request(`/api/campaigns/${id}/send`, { method: 'POST' }),
  },
  copilot: {
    chat: (data: { message: string; sessionId?: string; tools?: any[] }) =>
      request('/api/copilot/chat', { method: 'POST', body: JSON.stringify(data) }),
    stream: (message: string, onDelta: (delta: string) => void, onComplete: () => void) => {
      const eventSource = new EventSource(`/api/copilot/stream?message=${encodeURIComponent(message)}`, {
        withCredentials: true
      });
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.delta) onDelta(data.delta);
          if (data.done) {
            eventSource.close();
            onComplete();
          }
        } catch (err) {
          console.error('Error parsing SSE delta:', err);
        }
      };
      eventSource.onerror = (err) => {
        console.error('SSE Error:', err);
        eventSource.close();
        onComplete();
      };
      return () => eventSource.close();
    }
  }
};
