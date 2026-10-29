import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Badge, PageHeader, StatCard, StatusBadge, Switch } from '../components/ui';
import { useStore, uid } from '../lib/store';
import { num, pct } from '../lib/format';
import { api } from '../lib/api';
import type { PageTheme, Site, SitePage } from '../lib/types';

const THEMES: Array<{ value: PageTheme; label: string }> = [
  { value: 'gradient', label: 'Gradient' },
  { value: 'plain', label: 'Plain' },
  { value: 'dark', label: 'Dark' },
];

const THEME_BG: Record<PageTheme, string> = {
  gradient: 'linear-gradient(160deg, #eef0ff, #f7f5ff 60%, #ffffff)',
  plain: 'var(--surface-2)',
  dark: '#0f172a',
};

function siteSlug(site: Site): string {
  return site.name.toLowerCase().replace(/\s+/g, '-');
}

function slugPath(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug ? `/${slug}` : '/';
}

function toPath(value: string): string {
  const clean = value.trim();
  if (!clean) return '/';
  return clean.startsWith('/') ? clean : `/${clean}`;
}

function PagePreview({ site, page }: { site: Site; page: SitePage }) {
  const theme = page.theme ?? 'plain';
  const dark = theme === 'dark';
  return (
    <div
      style={{
        border: '1px solid var(--line)',
        borderRadius: 12,
        overflow: 'hidden',
        background: '#fff',
      }}
    >
      <div
        className="row"
        style={{
          gap: 14,
          padding: '12px 18px',
          borderBottom: '1px solid var(--line)',
          flexWrap: 'wrap',
        }}
      >
        <span className="row" style={{ gap: 7 }}>
          <span className="brand__mark">AG</span>
          <strong style={{ fontSize: 13 }}>{site.name}</strong>
        </span>
        <span className="spacer" />
        {site.pages.map((p) => (
          <span
            key={p.id}
            className="hint"
            style={{ fontSize: 12, fontWeight: p.id === page.id ? 650 : 450, color: p.id === page.id ? 'var(--text)' : undefined }}
          >
            {p.name}
          </span>
        ))}
      </div>
      <div
        style={{
          background: THEME_BG[theme],
          padding: '44px 28px',
          textAlign: 'center',
          color: dark ? '#f8fafc' : 'var(--text)',
        }}
      >
        <div style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.6, marginBottom: 8 }}>
          {page.name}
        </div>
        <h2 style={{ fontSize: 26, letterSpacing: '-0.03em', fontWeight: 700, lineHeight: 1.2, margin: 0 }}>
          {page.headline || `Welcome to ${page.name.toLowerCase()}`}
        </h2>
        <p
          style={{
            maxWidth: 470,
            margin: '10px auto 20px',
            fontSize: 13.5,
            lineHeight: 1.6,
            color: dark ? 'rgba(248, 250, 252, 0.72)' : 'var(--text-2)',
          }}
        >
          {page.subhead || 'Add a short description for this page in the editor.'}
        </p>
        <button className="btn btn--primary" type="button">
          {page.cta || 'Get started'}
        </button>
      </div>
      <div
        className="row row--between"
        style={{
          padding: '10px 18px',
          borderTop: '1px solid var(--line)',
          fontSize: 11.5,
          color: 'var(--text-3)',
        }}
      >
        <span>
          © 2026 {site.name}
        </span>
        <span style={{ fontFamily: 'var(--font-mono)' }}>{page.path}</span>
      </div>
    </div>
  );
}

export default function Websites() {
  const { state, dispatch } = useStore();
  const [preview, setPreview] = useState<{ siteId: string; pageId: string } | null>(null);
  const [editing, setEditing] = useState<{ siteId: string; pageId: string } | null>(null);
  const [addingSiteId, setAddingSiteId] = useState<string | null>(null);

  useEffect(() => {
    api.crm.list<Site>('websites').then((res) => {
      if (res.data && res.data.length > 0) {
        for (const s of res.data) {
          if (!state.sites.some((x) => x.id === s.id)) {
            dispatch({ type: 'site/duplicate', copy: s });
          }
        }
      }
    }).catch(() => { /* dev fallback */ });
  }, []);

  const sites = state.sites.filter((s) => s.kind === 'website');
  const visits = sites.reduce((s, x) => s + x.visits, 0);
  const optins = sites.reduce((s, x) => s + x.optins, 0);
  const pages = sites.reduce((s, x) => s + x.pages.length, 0);

  const previewSite = preview ? sites.find((s) => s.id === preview.siteId) : undefined;
  const previewPage = previewSite?.pages.find((p) => p.id === preview?.pageId);
  const editingSite = editing ? sites.find((s) => s.id === editing.siteId) : undefined;
  const editingPage = editingSite?.pages.find((p) => p.id === editing?.pageId);
  const addingSite = addingSiteId ? sites.find((s) => s.id === addingSiteId) : undefined;

  return (
    <div className="content">
      <PageHeader title="Websites" subtitle="Hosted site pages, navigation and lead capture." />

      <div className="grid grid--4" style={{ marginBottom: 16 }}>
        <StatCard label="Websites" value={String(sites.length)} icon={<Icon name="globe" size={15} />} meta="hosted in workspace" />
        <StatCard label="Pages" value={String(pages)} icon={<Icon name="copy" size={15} />} meta="total published pages" />
        <StatCard label="Visits" value={num(visits)} icon={<Icon name="eye" size={15} />} meta="all time" />
        <StatCard label="Opt-ins" value={num(optins)} icon={<Icon name="users" size={15} />} meta={`${pct(optins, visits || 1)} conversion`} />
      </div>

      <div className="stack">
        {sites.map((site) => (
          <div className="card" key={site.id}>
            <div className="card__head">
              <div
                className="avatar avatar--md avatar--square"
                style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
              >
                <Icon name="globe" size={17} />
              </div>
              <div>
                <div className="row" style={{ gap: 8 }}>
                  <strong style={{ fontSize: 14 }}>{site.name}</strong>
                  <StatusBadge status={site.published ? 'published' : 'draft'} />
                </div>
                <div className="cell-sub">agency.test/{siteSlug(site)}</div>
              </div>
              <div className="card__actions">
                <Switch on={site.published} label={`Toggle ${site.name}`} onChange={() => dispatch({ type: 'site/toggle', id: site.id })} />
                <button className="btn btn--sm" onClick={() => setAddingSiteId(site.id)}>
                  <Icon name="plus" size={14} /> Add page
                </button>
                <button
                  className="btn btn--sm"
                  disabled={site.pages.length === 0}
                  onClick={() => setPreview({ siteId: site.id, pageId: site.pages[0].id })}
                >
                  <Icon name="eye" size={14} /> Preview
                </button>
              </div>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Page</th>
                    <th>Path</th>
                    <th className="cell-right">Visits</th>
                    <th style={{ width: 160 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {site.pages.map((page, index) => (
                    <tr key={page.id}>
                      <td className="cell-main">{page.name}</td>
                      <td className="cell-sub" style={{ fontFamily: 'var(--font-mono)' }}>
                        {page.path}
                      </td>
                      <td className="cell-right cell-num">{num(page.visits)}</td>
                      <td>
                        <div className="row" style={{ gap: 2, justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            className="icon-btn"
                            aria-label={`Move ${page.name} up`}
                            disabled={index === 0}
                            onClick={() => dispatch({ type: 'site/step/move', siteId: site.id, id: page.id, direction: 'up' })}
                          >
                            <Icon name="chevron-up" size={14} />
                          </button>
                          <button
                            type="button"
                            className="icon-btn"
                            aria-label={`Move ${page.name} down`}
                            disabled={index === site.pages.length - 1}
                            onClick={() => dispatch({ type: 'site/step/move', siteId: site.id, id: page.id, direction: 'down' })}
                          >
                            <Icon name="chevron-down" size={14} />
                          </button>
                          <button
                            type="button"
                            className="icon-btn"
                            aria-label={`Edit ${page.name}`}
                            onClick={() => setEditing({ siteId: site.id, pageId: page.id })}
                          >
                            <Icon name="edit" size={14} />
                          </button>
                          <button
                            type="button"
                            className="icon-btn"
                            aria-label={`Delete ${page.name}`}
                            onClick={() => dispatch({ type: 'site/step/delete', siteId: site.id, id: page.id })}
                          >
                            <Icon name="trash" size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {site.pages.length === 0 && (
                    <tr>
                      <td colSpan={4}>
                        <div className="hint">No pages yet — add the first one to render a preview.</div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      {previewSite && previewPage && (
        <Modal
          title={`Preview · ${previewSite.name}`}
          wide
          onClose={() => setPreview(null)}
          footer={
            <button className="btn btn--primary" onClick={() => setPreview(null)}>
              Done
            </button>
          }
        >
          <div className="row row--between" style={{ marginBottom: 12, gap: 10, flexWrap: 'wrap' }}>
            <div className="segmented">
              {previewSite.pages.map((p) => (
                <button
                  key={p.id}
                  className={p.id === previewPage.id ? 'is-active' : ''}
                  onClick={() => setPreview({ siteId: previewSite.id, pageId: p.id })}
                >
                  {p.name}
                </button>
              ))}
            </div>
            <span className="hint" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
              {previewSite.published ? '' : 'Draft · '}agency.test/{siteSlug(previewSite)}
              {previewPage.path === '/' ? '' : previewPage.path}
            </span>
          </div>
          <PagePreview site={previewSite} page={previewPage} />
          <div className="row" style={{ gap: 8, marginTop: 12 }}>
            <Badge tone="blue">{previewSite.pages.length} pages</Badge>
            <Badge>{num(previewPage.visits)} visits</Badge>
            <Badge>Theme: {previewPage.theme ?? 'plain'}</Badge>
          </div>
        </Modal>
      )}

      {editingSite && editingPage && (
        <PageEditor
          site={editingSite}
          page={editingPage}
          onClose={() => setEditing(null)}
        />
      )}

      {addingSite && <AddPageModal site={addingSite} onClose={() => setAddingSiteId(null)} />}
    </div>
  );
}

function PageEditor({ site, page, onClose }: { site: Site; page: SitePage; onClose: () => void }) {
  const { dispatch } = useStore();
  const [name, setName] = useState(page.name);
  const [path, setPath] = useState(page.path);
  const [headline, setHeadline] = useState(page.headline ?? '');
  const [subhead, setSubhead] = useState(page.subhead ?? '');
  const [cta, setCta] = useState(page.cta ?? '');
  const [theme, setTheme] = useState<PageTheme>(page.theme ?? 'plain');

  const canSave = name.trim().length > 0 && path.trim().length > 0;

  const draft: SitePage = {
    ...page,
    name: name.trim() || page.name,
    path: toPath(path),
    headline: headline.trim(),
    subhead: subhead.trim(),
    cta: cta.trim(),
    theme,
  };

  const save = () => {
    if (!canSave) return;
    dispatch({
      type: 'site/step/update',
      siteId: site.id,
      id: page.id,
      patch: {
        name: name.trim(),
        path: toPath(path),
        headline: headline.trim(),
        subhead: subhead.trim(),
        cta: cta.trim(),
        theme,
      },
    });
    onClose();
  };

  return (
    <Modal
      title={`Edit page · ${page.name}`}
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn--primary" type="button" disabled={!canSave} onClick={save}>
            Save page
          </button>
        </>
      }
    >
      <div className="grid grid--2" style={{ alignItems: 'start' }}>
        <div className="stack" style={{ gap: 12 }}>
          <div className="grid grid--2">
            <div className="field">
              <label htmlFor="page-name">Page name</label>
              <input id="page-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="page-path">Path</label>
              <input
                id="page-path"
                className="input"
                style={{ fontFamily: 'var(--font-mono)' }}
                value={path}
                onChange={(e) => setPath(e.target.value)}
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor="page-headline">Headline</label>
            <input
              id="page-headline"
              className="input"
              placeholder="Grow faster with a system that runs itself"
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="page-subhead">Subheadline</label>
            <textarea
              id="page-subhead"
              className="input"
              rows={3}
              placeholder="One or two sentences that explain the offer."
              value={subhead}
              onChange={(e) => setSubhead(e.target.value)}
            />
          </div>
          <div className="grid grid--2">
            <div className="field">
              <label htmlFor="page-cta">Button label</label>
              <input id="page-cta" className="input" placeholder="Book a call" value={cta} onChange={(e) => setCta(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="page-theme">Theme</label>
              <select id="page-theme" className="select" value={theme} onChange={(e) => setTheme(e.target.value as PageTheme)}>
                {THEMES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="hint">
            Visitors reach this page at agency.test/{siteSlug(site)}
            {draft.path === '/' ? '' : draft.path}.
          </div>
        </div>
        <div className="builder-box">
          <div className="row row--between" style={{ marginBottom: 10 }}>
            <strong style={{ fontSize: 13 }}>Live preview</strong>
            <Badge tone={site.published ? 'green' : 'default'} dot>
              {site.published ? 'Published' : 'Draft'}
            </Badge>
          </div>
          <PagePreview site={site} page={draft} />
        </div>
      </div>
    </Modal>
  );
}

function AddPageModal({ site, onClose }: { site: Site; onClose: () => void }) {
  const { dispatch } = useStore();
  const [name, setName] = useState('');
  const [path, setPath] = useState('');

  const canCreate = name.trim().length > 0;

  const create = () => {
    if (!canCreate) return;
    const trimmed = name.trim();
    const page: SitePage = {
      id: uid('wp'),
      name: trimmed,
      path: toPath(path.trim() || slugPath(trimmed)),
      visits: 0,
      optins: 0,
      headline: trimmed,
      subhead: '',
      cta: 'Get started',
      theme: 'plain',
    };
    dispatch({ type: 'site/step/add', siteId: site.id, page });
    onClose();
  };

  return (
    <Modal
      title={`Add page · ${site.name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn--primary" type="button" disabled={!canCreate} onClick={create}>
            Create page
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="new-page-name">Page name</label>
        <input
          id="new-page-name"
          className="input"
          autoFocus
          placeholder="Pricing"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="field" style={{ marginTop: 12 }}>
        <label htmlFor="new-page-path">Path</label>
        <input
          id="new-page-path"
          className="input"
          style={{ fontFamily: 'var(--font-mono)' }}
          placeholder="/pricing"
          value={path}
          onChange={(e) => setPath(e.target.value)}
        />
        <div className="hint" style={{ marginTop: 6 }}>
          Leave the path blank to derive it from the page name.
        </div>
      </div>
    </Modal>
  );
}
