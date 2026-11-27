import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '../lib/api';
import { Badge, Button, Card, EmptyState, Alert } from './ui';

type Tab = 'config' | 'requests' | 'security' | 'preview';

export function PortalHub2Panel() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('config');
  const [portalName, setPortalName] = useState('Client Self-Service Portal');
  const [welcomeMsg, setWelcomeMsg] = useState('Welcome to your dedicated agency portal.');
  const [supportEmail, setSupportEmail] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const configQ = useQuery({
    queryKey: ['portal2', 'config'],
    queryFn: () => request<{ config: any }>('/api/portal/v2/config'),
    retry: false,
  });

  const requestsQ = useQuery({
    queryKey: ['portal2', 'requests'],
    queryFn: () => request<{ data: any[] }>('/api/portal/v2/requests'),
    retry: false,
  });

  const saveConfigMut = useMutation({
    mutationFn: () =>
      request('/api/portal/v2/config', {
        method: 'PUT',
        body: JSON.stringify({ enabled, portalName, welcomeMessage: welcomeMsg, supportEmail }),
      }),
    onSuccess: () => {
      setErrorMsg(null);
      setSavedMsg('Portal configuration saved.');
      qc.invalidateQueries({ queryKey: ['portal2', 'config'] });
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  const transitionReqMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      request(`/api/portal/v2/requests/${id}/transition`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => {
      setErrorMsg(null);
      qc.invalidateQueries({ queryKey: ['portal2', 'requests'] });
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  return (
    <Card className="p-5" style={{ marginTop: 24 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Customer Portal &amp; Self-Service 2.0</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-2)' }}>
            Agency-scoped magic-link authentication, internal-note isolation, field-level profile governance, and self-service request approvals.
          </p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {(['config', 'requests', 'security', 'preview'] as Tab[]).map((t) => (
            <Button key={t} variant={tab === t ? 'primary' : 'secondary'} onClick={() => setTab(t)}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </Button>
          ))}
        </div>
      </div>

      {errorMsg && <Alert tone="danger" title="Portal 2.0 Error">{errorMsg}</Alert>}
      {savedMsg && <Alert tone="info" title="Saved">{savedMsg}</Alert>}

      {tab === 'config' && (
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input className="input" placeholder="Portal Name" value={portalName} onChange={(e) => setPortalName(e.target.value)} />
            <input className="input" placeholder="Support Email" value={supportEmail} onChange={(e) => setSupportEmail(e.target.value)} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              Portal Enabled
            </label>
            <Button onClick={() => saveConfigMut.mutate()} disabled={saveConfigMut.isPending}>Save Configuration</Button>
          </div>
          <textarea className="textarea" rows={2} value={welcomeMsg} onChange={(e) => setWelcomeMsg(e.target.value)} />
          {configQ.data?.config && (
            <Badge tone="green">Active Config: {configQ.data.config.portal_name}</Badge>
          )}
        </div>
      )}

      {tab === 'requests' && (
        <div>
          {(requestsQ.data?.data?.length ?? 0) === 0 ? (
            <EmptyState title="No self-service requests" text="Customer requests for refunds, cancellations, booking changes, and data exports appear here for agency review." />
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {requestsQ.data?.data.map((r) => (
                <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 10, border: '1px solid var(--line)', borderRadius: 8 }}>
                  <span><strong>{r.request_type}</strong> · Contact {String(r.contact_id).slice(0, 8)}</span>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <Badge tone={r.status === 'completed' || r.status === 'approved' ? 'green' : 'default'}>{r.status}</Badge>
                    {r.status === 'requested' && (
                      <>
                        <Button variant="secondary" onClick={() => transitionReqMut.mutate({ id: r.id, status: 'approved' })}>Approve</Button>
                        <Button variant="secondary" onClick={() => transitionReqMut.mutate({ id: r.id, status: 'rejected' })}>Reject</Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'security' && (
        <Alert tone="info" title="Customer Identity & Isolation Guarantees">
          External customers authenticate via single-use SHA-256 hashed magic links into agency-scoped sessions (`role: external_customer`). Internal CRM notes are stripped, restricted profile fields are blocked server-side, and sensitive refund/cancellation requests require agency approval.
        </Alert>
      )}

      {tab === 'preview' && (
        <div style={{ padding: 14, border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface-2)' }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>{portalName}</div>
          <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--text-2)' }}>{welcomeMsg}</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {['Home', 'Appointments', 'Messages', 'Orders', 'Invoices', 'Documents', 'Profile', 'Preferences'].map((nav) => (
              <Badge key={nav} tone="default">{nav}</Badge>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
