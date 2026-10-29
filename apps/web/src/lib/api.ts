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
    list: <T = any>(collection: string) => request<{ data: T[]; total?: number }>(`/api/crm/${collection}`),
    create: <T = any>(collection: string, data: any) =>
      request<T>(`/api/crm/${collection}`, { method: 'POST', body: JSON.stringify(data) }),
    update: <T = any>(collection: string, id: string, data: any) =>
      request<T>(`/api/crm/${collection}/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (collection: string, id: string) =>
      request(`/api/crm/${collection}/${id}`, { method: 'DELETE' }),
  },
  contacts: {
    bulkTag: (contactIds: string[], tag: string) =>
      request('/api/crm/contacts/bulk-tag', { method: 'POST', body: JSON.stringify({ contactIds, tag }) }),
    importCsv: (csv: string) =>
      request('/api/crm/contacts/import', { method: 'POST', body: JSON.stringify({ csv }) }),
    merge: (primaryId: string, mergeIds: string[]) =>
      request('/api/crm/contacts/merge', { method: 'POST', body: JSON.stringify({ primaryId, mergeIds }) }),
    getTimeline: (id: string) =>
      request(`/api/crm/contacts/${id}/timeline`),
  },
  forms: {
    getPublic: (slug: string) => request<any>(`/api/forms/public/${slug}`),
    submitPublic: (slug: string, answers: Record<string, any>, source?: string) =>
      request<{ success: boolean; contactId: string; submissionId?: string }>(`/api/forms/submit/${slug}`, {
        method: 'POST',
        body: JSON.stringify({ answers, source }),
      }),
    publish: (id: string, published?: boolean) =>
      request<{ success: boolean; form: any }>(`/api/forms/${id}/publish`, {
        method: 'POST',
        body: JSON.stringify({ published }),
      }),
    getSubmissions: (formId?: string) =>
      request<{ submissions: any[] }>(formId ? `/api/forms/${formId}/submissions` : '/api/forms/submissions'),
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
    reply: (id: string, reply: string) =>
      request<{ success: boolean; review: any }>(`/api/reviews/${id}/reply`, { method: 'POST', body: JSON.stringify({ reply }) }),
    request: (data: { contactId: string; channel?: string; message?: string; scheduledAt?: string; sendNow?: boolean }) =>
      request<{ success: boolean; request: any }>('/api/reviews/request', { method: 'POST', body: JSON.stringify(data) }),
    sendRequest: (id: string) =>
      request<{ success: boolean; request: any }>(`/api/reviews/requests/${id}/send`, { method: 'POST' }),
  },
  courses: {
    addLesson: (id: string, lesson: { title: string; durationMin?: number; dripDays?: number }) =>
      request<{ success: boolean; lesson: any; course: any }>(`/api/courses/${id}/lessons`, { method: 'POST', body: JSON.stringify(lesson) }),
    updateCurriculum: (id: string, curriculum: any[]) =>
      request<{ success: boolean; course: any }>(`/api/courses/${id}/curriculum`, { method: 'PUT', body: JSON.stringify({ curriculum }) }),
    publish: (id: string, published: boolean) =>
      request<{ success: boolean; course: any }>(`/api/courses/${id}/publish`, { method: 'PUT', body: JSON.stringify({ published }) }),
  },
  agency: {
    getProfile: () => request<{ name: string; email: string; phone: string; website: string; timezone: string; currency: string }>('/api/agency/profile'),
    updateProfile: (data: { name?: string; email?: string; phone?: string; website?: string; timezone?: string; currency?: string }) =>
      request<{ success: boolean; profile: any }>('/api/agency/profile', { method: 'PUT', body: JSON.stringify(data) }),
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
  conversations: {
    sendMessage: (id: string, data: { content: string; channel?: string; subject?: string }) =>
      request(`/api/conversations/${id}/messages`, { method: 'POST', body: JSON.stringify(data) }),
  },
  social: {
    publish: (id: string) => request(`/api/social/publish/${id}`, { method: 'POST' }),
  },
  opportunities: {
    updateStage: (id: string, stage: string, stageId?: string) =>
      request(`/api/crm/opportunities/${id}`, { method: 'PUT', body: JSON.stringify({ stage, stageId }) }),
  },
  links: {
    click: (slug: string, contactId?: string) =>
      request(`/api/links/click/${slug}${contactId ? `?contactId=${encodeURIComponent(contactId)}` : ''}`),
  },
  documents: {
    sign: (id: string, signerName?: string) =>
      request(`/api/documents/${id}/sign`, { method: 'POST', body: JSON.stringify({ signerName }) }),
  },
  subscriptions: {
    list: () => request<{ data: any[] }>('/api/subscriptions'),
    create: (data: { contactId: string; plan: string; amount: number; interval?: 'month' | 'year'; status?: string; renewsAt?: string }) =>
      request<{ success: boolean; subscription: any }>('/api/subscriptions', { method: 'POST', body: JSON.stringify(data) }),
    cancel: (id: string) => request<{ success: boolean; subscription: any }>(`/api/subscriptions/${id}/cancel`, { method: 'POST' }),
    resume: (id: string) => request<{ success: boolean; subscription: any }>(`/api/subscriptions/${id}/resume`, { method: 'POST' }),
  },
  memberships: {
    enroll: (courseId: string, contactId: string) =>
      request('/api/memberships/enroll', { method: 'POST', body: JSON.stringify({ courseId, contactId }) }),
  },
  affiliates: {
    track: (code: string, amount: number) =>
      request(`/api/affiliates/track/${code}`, { method: 'POST', body: JSON.stringify({ amount }) }),
    settlePayout: (id: string, amount?: number) =>
      request<{ success: boolean; affiliate: any; paidAmount: number; invoiceId: string }>(
        `/api/affiliates/${id}/payout`,
        { method: 'POST', body: JSON.stringify({ amount }) }
      ),
    getPayoutReport: () =>
      request<{ totalPartners: number; activePartners: number; totalUnpaid: number; totalConversions: number; partners: any[] }>(
        '/api/affiliates/payout-report'
      ),
  },
  funnels: {
    getPublic: (slugOrId: string, pageSlug?: string) =>
      request<{ id: string; name: string; kind: string; published: boolean; visits: number; optins: number; pages: any[]; checkout: any }>(
        `/api/funnels/public/${slugOrId}${pageSlug ? `?pageSlug=${encodeURIComponent(pageSlug)}` : ''}`
      ),
    optin: (slugOrId: string, data: { firstName?: string; lastName?: string; email?: string; phone?: string; company?: string; pageSlug?: string; bumpAccepted?: boolean }) =>
      request(`/api/funnels/optin/${slugOrId}`, { method: 'POST', body: JSON.stringify(data) }),
  },
  customValues: {
    resolve: (text: string, contactId?: string) =>
      request<{ resolvedText: string; tokensResolved: number }>('/api/custom-values/resolve', {
        method: 'POST',
        body: JSON.stringify({ text, contactId })
      }),
  },
  calls: {
    setHandled: (id: string, handled = true) =>
      request(`/api/calls/handled/${id}`, { method: 'PUT', body: JSON.stringify({ handled }) }),
  },
  coupons: {
    validate: (code: string, subtotal?: number, agencyId?: string) =>
      request<{ valid: boolean; coupon?: any; discount?: number; newTotal?: number; error?: string }>(
        '/api/coupons/validate',
        { method: 'POST', body: JSON.stringify({ code, subtotal, agencyId }) }
      ),
  },
  smartLists: {
    evaluate: (id: string) =>
      request<{ list: any; count: number; contacts: any[] }>(`/api/crm/smart-lists/${id}/evaluate`),
  },
  reporting: {
    getOverview: () =>
      request<{ metrics: { revenue: number; pipeline: number; dealsWon: number; contacts: number; appointmentShowRate: number }; sources: Record<string, number>; timeline: any[]; campaignsCount: number }>('/api/reporting/overview'),
  },
  media: {
    upload: (data: { name?: string; folder?: string; kind?: string; mimeType?: string; sizeKb?: number; data?: string }) =>
      request<{ success: boolean; asset: any }>('/api/media/upload', { method: 'POST', body: JSON.stringify(data) }),
    delete: (id: string) => request<{ success: boolean; asset: any }>(`/api/media/${id}`, { method: 'DELETE' }),
    getFileUrl: (id: string) => `/api/media/file/${id}`,
  },
  blogs: {
    getPublic: (slug: string) => request<any>(`/api/blogs/public/${slug}`),
    publish: (id: string) => request<{ success: boolean; blog: any }>(`/api/blogs/publish/${id}`, { method: 'PUT' }),
  },
  qr: {
    getSvgUrl: (id: string) => `/api/qr/${id}.svg`,
    scan: (id: string, redirect = false) =>
      request<{ success: boolean; id: string; name: string; target: string; scans: number }>(
        `/api/qr/${id}/scan${redirect ? '?redirect=true' : ''}`
      ),
  },
  snippets: {
    use: (id: string, contactId?: string) =>
      request<{ success: boolean; snippetId: string; uses: number; resolvedBody: string; resolvedSubject?: string; tokensResolved: number }>(
        `/api/snippets/${id}/use`,
        { method: 'POST', body: JSON.stringify({ contactId }) }
      ),
  },
  templates: {
    use: (id: string, contactId?: string) =>
      request<{ success: boolean; templateId: string; uses: number; resolvedBody: string; resolvedSubject: string; tokensResolved: number }>(
        `/api/templates/${id}/use`,
        { method: 'POST', body: JSON.stringify({ contactId }) }
      ),
  },
  portal: {
    getSummary: (contactId: string) =>
      request<{ contact: any; invoices: any[]; courses: any[]; documents: any[]; appointments: any[] }>(
        `/api/portal/summary/${contactId}`
      ),
    toggleAccess: (contactId: string, portalAccess = true) =>
      request<{ success: boolean; contactId: string; portalAccess: boolean }>(
        `/api/crm/contacts/${contactId}/portal-access`,
        { method: 'PUT', body: JSON.stringify({ portalAccess }) }
      ),
  },
  team: {
    list: () => request<{ team: any[] }>('/api/agency/team'),
    invite: (data: { name: string; email: string; role?: 'admin' | 'user'; phone?: string }) =>
      request<{ success: boolean; member: any }>('/api/agency/team/invite', { method: 'POST', body: JSON.stringify(data) }),
    updateRole: (id: string, role: 'admin' | 'user') =>
      request<{ success: boolean; member: any }>(`/api/agency/team/${id}/role`, { method: 'PUT', body: JSON.stringify({ role }) }),
    delete: (id: string) =>
      request<{ success: boolean; member?: any; id?: string }>(`/api/agency/team/${id}`, { method: 'DELETE' }),
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
