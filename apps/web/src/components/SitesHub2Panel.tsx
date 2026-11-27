import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '../lib/api';
import { Badge, Button, Card, EmptyState, Alert } from './ui';

type Tab = 'editor' | 'templates' | 'sites' | 'seo';
type Device = 'desktop' | 'tablet' | 'mobile';

interface SectionItem {
  id: string;
  type: string;
  props: Record<string, any>;
}

const DEVICE_WIDTH: Record<Device, string> = {
  desktop: '100%',
  tablet: '768px',
  mobile: '390px',
};

export function SitesHub2Panel() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('editor');
  const [device, setDevice] = useState<Device>('desktop');
  const [siteName, setSiteName] = useState('');
  const [selectedTpl, setSelectedTpl] = useState('tpl-agency-growth');
  const [sections, setSections] = useState<SectionItem[]>([
    { id: 'sec-hero', type: 'hero', props: { heading: '[Editable Headline] Grow With Clarity', subheading: 'Customize this section in the visual editor.' } },
    { id: 'sec-form', type: 'lead_form', props: { heading: 'Request a Consultation', formSlug: 'contact' } },
  ]);
  const [selectedSecId, setSelectedSecId] = useState<string>('sec-hero');
  const [history, setHistory] = useState<SectionItem[][]>([]);
  const [validationMsg, setValidationMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const catalogQ = useQuery({
    queryKey: ['sites2', 'catalog'],
    queryFn: () => request<{ templates: any[]; components: Record<string, string[]> }>('/api/sites/v2/catalog'),
    retry: false,
  });

  const sitesQ = useQuery({
    queryKey: ['sites2', 'list'],
    queryFn: () => request<{ data: any[] }>('/api/sites/v2'),
    retry: false,
  });

  const createSiteMut = useMutation({
    mutationFn: () =>
      request('/api/sites/v2', {
        method: 'POST',
        body: JSON.stringify({ name: siteName || 'Agency Site 2.0', templateId: selectedTpl }),
      }),
    onSuccess: () => {
      setErrorMsg(null);
      setSiteName('');
      qc.invalidateQueries({ queryKey: ['sites2', 'list'] });
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  const validatePageMut = useMutation({
    mutationFn: () =>
      request<{ valid: boolean; sectionCount?: number; error?: string }>('/api/sites/v2/pages/validate', {
        method: 'POST',
        body: JSON.stringify({ slug: '/', title: 'Home', sections }),
      }),
    onSuccess: (res) => {
      setErrorMsg(null);
      setValidationMsg(res.valid ? `Schema v2 Validated (${res.sectionCount} sections)` : res.error || 'Invalid');
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  const pushHistory = (next: SectionItem[]) => {
    setHistory((h) => [...h.slice(-19), sections]);
    setSections(next);
  };

  const addSection = (type: string) => {
    const id = `sec-${Date.now()}`;
    pushHistory([...sections, { id, type, props: { heading: `New ${type.replace(/_/g, ' ')}`, text: 'Editable block content' } }]);
    setSelectedSecId(id);
  };

  const moveSection = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= sections.length) return;
    const copy = [...sections];
    [copy[index], copy[target]] = [copy[target], copy[index]];
    pushHistory(copy);
  };

  const undo = () => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setSections(prev);
  };

  const selectedSec = sections.find((s) => s.id === selectedSecId) || sections[0];

  return (
    <Card className="p-5" style={{ marginTop: 24 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Website, Landing Page &amp; Funnel Builder 2.0</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-2)' }}>
            Schema-validated 3-pane visual editor, starter templates, immutable versioning, and conversion tracking.
          </p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {(['editor', 'templates', 'sites', 'seo'] as Tab[]).map((t) => (
            <Button key={t} variant={tab === t ? 'primary' : 'secondary'} onClick={() => setTab(t)}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </Button>
          ))}
        </div>
      </div>

      {errorMsg && <Alert tone="danger" title="Sites 2.0 Error">{errorMsg}</Alert>}
      {validationMsg && <Alert tone="info" title="Schema Validation">{validationMsg}</Alert>}

      {tab === 'editor' && (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, padding: 10, borderRadius: 8, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['desktop', 'tablet', 'mobile'] as Device[]).map((d) => (
                <Button key={d} variant={device === d ? 'primary' : 'secondary'} onClick={() => setDevice(d)}>
                  {d.charAt(0).toUpperCase() + d.slice(1)}
                </Button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <Button variant="secondary" onClick={undo} disabled={history.length === 0}>Undo</Button>
              <Button variant="secondary" onClick={() => validatePageMut.mutate()}>Validate Schema</Button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            {/* Left: Component Library */}
            <div style={{ padding: 12, border: '1px solid var(--line)', borderRadius: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Component Library</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {['hero', 'feature_grid', 'pricing', 'faq', 'cta', 'lead_form', 'booking_form', 'payment_link'].map((comp) => (
                  <Button key={comp} variant="secondary" onClick={() => addSection(comp)}>
                    + {comp.replace(/_/g, ' ')}
                  </Button>
                ))}
              </div>
            </div>

            {/* Center: Visual Canvas */}
            <div style={{ padding: 12, border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface-2)', overflowX: 'auto' }}>
              <div style={{ width: DEVICE_WIDTH[device], maxWidth: '100%', margin: '0 auto', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, padding: 12, display: 'grid', gap: 8 }}>
                {sections.map((s, idx) => (
                  <div
                    key={s.id}
                    onClick={() => setSelectedSecId(s.id)}
                    style={{
                      padding: 10,
                      borderRadius: 6,
                      border: s.id === selectedSec?.id ? '2px solid var(--accent)' : '1px solid var(--line)',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <Badge tone="accent">{s.type}</Badge>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button type="button" className="btn btn--secondary" onClick={(e) => { e.stopPropagation(); moveSection(idx, -1); }}>↑</button>
                        <button type="button" className="btn btn--secondary" onClick={(e) => { e.stopPropagation(); moveSection(idx, 1); }}>↓</button>
                      </div>
                    </div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{s.props.heading || s.type}</div>
                    {s.props.subheading && <div style={{ fontSize: 12, color: 'var(--text-2)' }}>{s.props.subheading}</div>}
                  </div>
                ))}
              </div>
            </div>

            {/* Right: Property Inspector */}
            <div style={{ padding: 12, border: '1px solid var(--line)', borderRadius: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Property Inspector</div>
              {selectedSec ? (
                <div style={{ display: 'grid', gap: 8 }}>
                  <label style={{ fontSize: 12 }}>Heading</label>
                  <input
                    className="input"
                    value={selectedSec.props.heading || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSections((prev) => prev.map((s) => (s.id === selectedSec.id ? { ...s, props: { ...s.props, heading: val } } : s)));
                    }}
                  />
                  <label style={{ fontSize: 12 }}>Subheading / Copy</label>
                  <textarea
                    className="textarea"
                    rows={2}
                    value={selectedSec.props.subheading || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSections((prev) => prev.map((s) => (s.id === selectedSec.id ? { ...s, props: { ...s.props, subheading: val } } : s)));
                    }}
                  />
                </div>
              ) : (
                <EmptyState title="No section selected" text="Select a section on the canvas." />
              )}
            </div>
          </div>
        </div>
      )}

      {tab === 'templates' && (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input className="input" placeholder="New site name" value={siteName} onChange={(e) => setSiteName(e.target.value)} />
            <select className="select" value={selectedTpl} onChange={(e) => setSelectedTpl(e.target.value)}>
              {(catalogQ.data?.templates || []).map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <Button onClick={() => createSiteMut.mutate()} disabled={createSiteMut.isPending}>Install Starter Site</Button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
            {(catalogQ.data?.templates || []).map((t) => (
              <div key={t.id} style={{ padding: 12, border: '1px solid var(--line)', borderRadius: 8 }}>
                <div style={{ fontWeight: 600 }}>{t.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4 }}>{t.description}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'sites' && (
        <div>
          {(sitesQ.data?.data?.length ?? 0) === 0 ? (
            <EmptyState title="No Sites 2.0 records yet" text="Install a starter template above (PostgreSQL required for persistence)." />
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {sitesQ.data?.data.map((s) => (
                <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', padding: 10, border: '1px solid var(--line)', borderRadius: 8 }}>
                  <span><strong>{s.name}</strong> (/{s.slug}) · v{s.published_version_number || 0}</span>
                  <Badge tone={s.status === 'published' ? 'green' : 'default'}>{s.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'seo' && (
        <Alert tone="info" title="Multi-Tenant SEO & Safe Publishing">
          Draft pages are excluded from public sitemaps and indexing. Published versions are immutable snapshots in `site_versions` with HTML-escaped SSR output, JSON-LD, and host+version cache invalidation.
        </Alert>
      )}
    </Card>
  );
}
