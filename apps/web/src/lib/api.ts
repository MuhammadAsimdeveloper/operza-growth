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
  workflows: {
    getRuns: () => request('/api/workflows/runs'),
    approveRun: (runId: string) =>
      request(`/api/workflows/runs/${runId}/approve`, { method: 'POST' }),
  },
  copilot: {
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
