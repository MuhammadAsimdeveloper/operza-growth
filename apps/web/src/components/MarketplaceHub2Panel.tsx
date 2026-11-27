import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Badge, EmptyState } from './ui';

interface MarketplaceAppRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  app_type: string;
  status: string;
  version: string;
  pricing_model: string;
  price_cents: number;
  currency: string;
  requested_scopes: string[];
}

interface InstallationRow {
  id: string;
  app_id: string;
  app_name: string;
  app_slug: string;
  status: string;
  installed_version?: string;
  granted_scopes: string[];
}

export function MarketplaceHub2Panel() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'catalog' | 'installed' | 'developer' | 'admin'>('catalog');
  const [search, setSearch] = useState('');
  const [appTypeFilter, setAppTypeFilter] = useState('all');
  const [manifestJson, setManifestJson] = useState(
    JSON.stringify(
      {
        slug: 'sample-crm-sync',
        name: 'Sample CRM Sync',
        appType: 'external_connector',
        version: '1.0.0',
        pricingModel: 'free',
        requestedScopes: ['contacts:read'],
      },
      null,
      2
    )
  );
  const [manifestValidation, setManifestValidation] = useState<{ valid: boolean; errors: Array<{ code: string; message: string }> } | null>(null);

  const { data: catalogData } = useQuery<{ apps?: MarketplaceAppRow[] }>({
    queryKey: ['marketplace', 'v2', 'catalog'],
    queryFn: () => api('/api/marketplace/v2/catalog'),
  });

  const { data: installedData } = useQuery<{ installations?: InstallationRow[] }>({
    queryKey: ['marketplace', 'installations'],
    queryFn: () => api('/api/marketplace/installations'),
  });

  const apps = (catalogData?.apps || []).filter((a) => {
    if (appTypeFilter !== 'all' && a.app_type !== appTypeFilter) return false;
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return a.name.toLowerCase().includes(q) || (a.description || '').toLowerCase().includes(q);
  });

  const installations = installedData?.installations || [];

  const handleValidateManifest = async () => {
    try {
      const parsed = JSON.parse(manifestJson);
      const res = await api<{ valid: boolean; errors: Array<{ code: string; message: string }> }>(
        '/api/developer/manifests/validate',
        { method: 'POST', body: JSON.stringify({ manifest: parsed }) }
      );
      setManifestValidation(res);
    } catch {
      setManifestValidation({ valid: false, errors: [{ code: 'JSON_PARSE_ERROR', message: 'Invalid JSON syntax' }] });
    }
  };

  const handleUninstall = async (installationId: string) => {
    await api('/api/marketplace/uninstall', { method: 'POST', body: JSON.stringify({ installationId }) });
    await queryClient.invalidateQueries({ queryKey: ['marketplace'] });
  };

  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 16, marginBottom: 22, background: 'var(--surface)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Operza Marketplace &amp; Developer Ecosystem 2.0</div>
          <div style={{ fontSize: 12, opacity: 0.75 }}>
            Published Apps: {catalogData?.apps?.length ?? 0} · Workspace Installations: {installations.length}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(['catalog', 'installed', 'developer', 'admin'] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={tab === t ? 'btn btn--primary' : 'btn btn--ghost'}
              onClick={() => setTab(t)}
            >
              {t === 'catalog' ? 'Marketplace' : t === 'installed' ? 'My Applications' : t === 'developer' ? 'Developer Portal' : 'Admin Governance'}
            </button>
          ))}
        </div>
      </div>

      {tab === 'catalog' && (
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <input className="input" placeholder="Search marketplace apps..." value={search} onChange={(e) => setSearch(e.target.value)} />
            <select className="input" value={appTypeFilter} onChange={(e) => setAppTypeFilter(e.target.value)}>
              <option value="all">All types</option>
              <option value="native_integration">Native Integration</option>
              <option value="external_connector">External Connector</option>
              <option value="workflow_template">Workflow Template</option>
              <option value="ai_tool">AI Tool</option>
            </select>
          </div>
          {apps.length === 0 ? (
            <EmptyState icon="grid" title="No published marketplace apps yet" body="Approved and published applications appear here with explicit scope declarations." />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
              {apps.map((app) => (
                <div key={app.id} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 12, fontSize: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <strong>{app.name}</strong>
                    <Badge tone="green">v{app.version}</Badge>
                  </div>
                  <div style={{ opacity: 0.78, marginBottom: 6 }}>{app.description || app.app_type}</div>
                  <div style={{ fontSize: 11, opacity: 0.7 }}>
                    Scopes: {(app.requested_scopes || []).join(', ') || 'None'} · {app.pricing_model}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'installed' && (
        installations.length === 0 ? (
          <EmptyState icon="plug" title="No applications installed" body="Install an approved Marketplace application to manage its scopes and version here." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
            {installations.map((inst) => (
              <div key={inst.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid var(--line)', borderRadius: 8, padding: 10 }}>
                <div>
                  <strong>{inst.app_name || inst.app_slug}</strong> (v{inst.installed_version || '1.0.0'})
                  <div style={{ opacity: 0.75 }}>Status: {inst.status} · Granted Scopes: {(inst.granted_scopes || []).join(', ') || 'None'}</div>
                </div>
                {inst.status !== 'uninstalled' && (
                  <button type="button" className="btn btn--ghost" onClick={() => handleUninstall(inst.id)}>Uninstall</button>
                )}
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'developer' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
          <div style={{ fontWeight: 600 }}>Manifest Validator &amp; Publisher Sandbox</div>
          <textarea
            className="input"
            rows={8}
            value={manifestJson}
            onChange={(e) => setManifestJson(e.target.value)}
            style={{ fontFamily: 'monospace', fontSize: 12 }}
          />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button type="button" className="btn btn--primary" onClick={handleValidateManifest}>Validate Manifest</button>
            {manifestValidation && (
              <Badge tone={manifestValidation.valid ? 'green' : 'red'}>
                {manifestValidation.valid ? 'Manifest Valid' : `${manifestValidation.errors.length} Error(s)`}
              </Badge>
            )}
          </div>
          {manifestValidation && !manifestValidation.valid && (
            <div style={{ color: '#ef4444' }}>
              {manifestValidation.errors.map((e, i) => <div key={i}>{e.code}: {e.message}</div>)}
            </div>
          )}
        </div>
      )}

      {tab === 'admin' && (
        <div style={{ fontSize: 12, opacity: 0.8 }}>
          Platform-admin review queue, suspension, and review moderation are enforced server-side on <code>/api/platform-admin/marketplace/v2/*</code> with immutable <code>platform_admin_audit_log</code> entries.
        </div>
      )}
    </div>
  );
}
