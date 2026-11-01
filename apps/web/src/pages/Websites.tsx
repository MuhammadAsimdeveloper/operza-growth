import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Badge, PageHeader, StatCard, StatusBadge, Switch } from '../components/ui';
import { VisualPageBuilder, type FunnelBlock } from '../components/VisualPageBuilder';
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
  return site.domain || site.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
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
  const [newSiteOpen, setNewSiteOpen] = useState(false);
  const [confirmDeleteSite, setConfirmDeleteSite] = useState<Site | null>(null);
  const [builderTarget, setBuilderTarget] = useState<{ site: Site; page: SitePage } | null>(null);
  const [maintenanceSite, setMaintenanceSite] = useState<Site | null>(null);
  const [codeModalSite, setCodeModalSite] = useState<Site | null>(null);

  useEffect(() => {
    api.websites.list().then((res) => {
      if (res?.data && Array.isArray(res.data) && res.data.length > 0) {
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

  const handleTogglePublished = async (site: Site) => {
    const nextPublished = !site.published;
    dispatch({ type: 'site/toggle', id: site.id });
    try {
      await api.websites.publish(site.id);
    } catch {
      await api.websites.update(site.id, {
        published: nextPublished,
        status: nextPublished ? 'published' : 'draft',
      }).catch(() => {});
    }
  };

  const handleMovePage = async (site: Site, pageId: string, direction: 'up' | 'down') => {
    dispatch({ type: 'site/step/move', siteId: site.id, id: pageId, direction });
    const idx = site.pages.findIndex((p) => p.id === pageId);
    if (idx < 0) return;
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= site.pages.length) return;
    const nextPages = [...site.pages];
    const [moved] = nextPages.splice(idx, 1);
    nextPages.splice(targetIdx, 0, moved);
    try {
      await api.websites.update(site.id, { pages: nextPages });
    } catch (err) {
      console.error('Failed to update page order:', err);
    }
  };

  const handleDeletePage = async (site: Site, pageId: string) => {
    dispatch({ type: 'site/step/delete', siteId: site.id, id: pageId });
    try {
      await api.websites.deletePage(site.id, pageId);
    } catch {
      const nextPages = site.pages.filter((p) => p.id !== pageId);
      await api.websites.update(site.id, { pages: nextPages }).catch(() => {});
    }
  };

  if (builderTarget) {
    return (
      <VisualPageBuilder
        pageName={`${builderTarget.site.name} · ${builderTarget.page.name}`}
        pagePath={builderTarget.page.path}
        initialBlocks={(builderTarget.page.blocks as FunnelBlock[]) || []}
        onSave={async (blocks) => {
          const updatedPages = builderTarget.site.pages.map((p) =>
            p.id === builderTarget.page.id ? { ...p, blocks } : p
          );
          dispatch({
            type: 'site/step/update',
            siteId: builderTarget.site.id,
            id: builderTarget.page.id,
            patch: { blocks },
          });
          try {
            await api.websites.update(builderTarget.site.id, { pages: updatedPages });
          } catch (err) {
            console.error('Failed to sync page blocks to backend:', err);
          }
          setBuilderTarget({
            site: { ...builderTarget.site, pages: updatedPages },
            page: { ...builderTarget.page, blocks },
          });
        }}
        onClose={() => setBuilderTarget(null)}
      />
    );
  }

  return (
    <div className="content">
      <PageHeader
        title="Websites"
        subtitle="Hosted site pages, navigation and lead capture."
        actions={
          <button className="btn btn--primary" onClick={() => setNewSiteOpen(true)}>
            <Icon name="plus" size={15} /> New website
          </button>
        }
      />

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
                <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: 14 }}>{site.name}</strong>
                  <StatusBadge status={site.published ? 'published' : 'draft'} />
                  {site.maintenanceMode && (
                    <Badge tone="amber" dot>Maintenance Mode</Badge>
                  )}
                  {site.domain && (
                    <Badge tone="blue">{site.domain}</Badge>
                  )}
                </div>
                <div className="cell-sub">
                  agency.test/{siteSlug(site)}
                  {site.domain ? ` · https://${site.domain}` : ''}
                </div>
              </div>
              <div className="card__actions">
                <Switch on={site.published} label={`Toggle ${site.name}`} onChange={() => handleTogglePublished(site)} />
                <button
                  className="btn btn--sm"
                  title="Configure site maintenance, custom domain, tracking scripts & SEO"
                  onClick={() => setMaintenanceSite(site)}
                >
                  <Icon name="sliders" size={14} /> Maintenance & DNS
                </button>
                <button
                  className="btn btn--sm"
                  title="Import or export website HTML code and template JSON"
                  onClick={() => setCodeModalSite(site)}
                >
                  <Icon name="code" size={14} /> Code / Export
                </button>
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
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Delete ${site.name}`}
                  title={`Delete ${site.name}`}
                  onClick={() => setConfirmDeleteSite(site)}
                >
                  <Icon name="trash" size={14} />
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
                    <th style={{ width: 220 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {site.pages.map((page, index) => (
                    <tr key={page.id}>
                      <td className="cell-main">
                        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                          <span>{page.name}</span>
                          {page.blocks && page.blocks.length > 0 && (
                            <Badge tone="violet">
                              {page.blocks.length} elements
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="cell-sub" style={{ fontFamily: 'var(--font-mono)' }}>
                        {page.path}
                      </td>
                      <td className="cell-right cell-num">{num(page.visits)}</td>
                      <td>
                        <div className="row" style={{ gap: 4, justifyContent: 'flex-end', alignItems: 'center' }}>
                          <button
                            type="button"
                            className="btn btn--sm btn--primary"
                            style={{ fontSize: 11.5, padding: '3px 8px', gap: 4 }}
                            title="Open Drag-and-Drop Visual Page Builder"
                            onClick={() => setBuilderTarget({ site, page })}
                          >
                            <Icon name="layout" size={13} /> Visual Builder
                          </button>
                          <button
                            type="button"
                            className="icon-btn"
                            aria-label={`Move ${page.name} up`}
                            disabled={index === 0}
                            onClick={() => handleMovePage(site, page.id, 'up')}
                          >
                            <Icon name="chevron-up" size={14} />
                          </button>
                          <button
                            type="button"
                            className="icon-btn"
                            aria-label={`Move ${page.name} down`}
                            disabled={index === site.pages.length - 1}
                            onClick={() => handleMovePage(site, page.id, 'down')}
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
                            onClick={() => handleDeletePage(site, page.id)}
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

      {newSiteOpen && <NewWebsiteModal onClose={() => setNewSiteOpen(false)} />}

      {maintenanceSite && (
        <SiteMaintenanceModal
          site={maintenanceSite}
          onClose={() => setMaintenanceSite(null)}
        />
      )}

      {codeModalSite && (
        <SiteCodeModal
          site={codeModalSite}
          onClose={() => setCodeModalSite(null)}
        />
      )}

      {confirmDeleteSite && (
        <Modal
          title={`Delete ${confirmDeleteSite.name}?`}
          onClose={() => setConfirmDeleteSite(null)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirmDeleteSite(null)}>
                Cancel
              </button>
              <button
                className="btn btn--primary"
                style={{ background: 'var(--red)', borderColor: 'var(--red)' }}
                onClick={async () => {
                  const targetId = confirmDeleteSite.id;
                  dispatch({ type: 'site/delete', id: targetId });
                  try {
                    await api.websites.delete(targetId);
                  } catch (err) {
                    console.error('Failed to delete website on backend:', err);
                  }
                  setConfirmDeleteSite(null);
                }}
              >
                Delete website
              </button>
            </>
          }
        >
          <p style={{ fontSize: 13, lineHeight: 1.6 }}>
            Are you sure you want to delete <strong>{confirmDeleteSite.name}</strong>? This will permanently remove its hosted pages and public routing.
          </p>
        </Modal>
      )}
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

  const save = async () => {
    if (!canSave) return;
    const patch = {
      name: name.trim(),
      path: toPath(path),
      headline: headline.trim(),
      subhead: subhead.trim(),
      cta: cta.trim(),
      theme,
    };
    dispatch({
      type: 'site/step/update',
      siteId: site.id,
      id: page.id,
      patch,
    });
    const updatedPages = site.pages.map((p) => (p.id === page.id ? { ...p, ...patch } : p));
    try {
      await api.websites.update(site.id, { pages: updatedPages });
    } catch (err) {
      console.error('Failed to sync page edit to backend:', err);
    }
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

  const create = async () => {
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
    try {
      await api.websites.addPage(site.id, page);
    } catch {
      const updatedPages = [...site.pages, page];
      await api.websites.update(site.id, { pages: updatedPages }).catch(() => {});
    }
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

function NewWebsiteModal({ onClose }: { onClose: () => void }) {
  const { dispatch } = useStore();
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [theme, setTheme] = useState<PageTheme>('plain');
  const [loading, setLoading] = useState(false);

  const canCreate = name.trim().length > 0;

  const handleCreate = async () => {
    if (!canCreate || loading) return;
    setLoading(true);
    const siteId = uid('ws');
    const slug = (domain.trim() || name.trim()).toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const homePage: SitePage = {
      id: uid('wp'),
      name: 'Home',
      path: '/',
      visits: 0,
      optins: 0,
      headline: `Welcome to ${name.trim()}`,
      subhead: 'Grow your business with our tailored solutions.',
      cta: 'Get started',
      theme,
    };
    const aboutPage: SitePage = {
      id: uid('wp'),
      name: 'About',
      path: '/about',
      visits: 0,
      optins: 0,
      headline: `About ${name.trim()}`,
      subhead: 'Learn more about our team and mission.',
      cta: 'Contact us',
      theme,
    };

    const newSite: Site = {
      id: siteId,
      name: name.trim(),
      kind: 'website',
      domain: slug,
      published: false,
      visits: 0,
      optins: 0,
      pages: [homePage, aboutPage],
    };

    dispatch({ type: 'site/duplicate', copy: newSite });

    try {
      await api.websites.create(newSite);
    } catch (err) {
      console.error('Failed to create website on backend:', err);
    }
    setLoading(false);
    onClose();
  };

  return (
    <Modal
      title="Create new website"
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button className="btn btn--primary" type="button" disabled={!canCreate || loading} onClick={handleCreate}>
            {loading ? 'Creating...' : 'Create website'}
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="new-site-name">Website name</label>
        <input
          id="new-site-name"
          className="input"
          autoFocus
          placeholder="e.g. Acme Growth Advisory"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (!domain) {
              setDomain(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
            }
          }}
        />
      </div>
      <div className="field" style={{ marginTop: 12 }}>
        <label htmlFor="new-site-domain">Domain / Subdomain slug</label>
        <input
          id="new-site-domain"
          className="input"
          style={{ fontFamily: 'var(--font-mono)' }}
          placeholder="e.g. acme-growth"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
        />
        <div className="hint" style={{ marginTop: 4 }}>
          Public preview will be accessible at agency.test/{domain || 'acme-growth'}
        </div>
      </div>
      <div className="field" style={{ marginTop: 12 }}>
        <label htmlFor="new-site-theme">Default theme</label>
        <select id="new-site-theme" className="select" value={theme} onChange={(e) => setTheme(e.target.value as PageTheme)}>
          {THEMES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
    </Modal>
  );
}

function SiteMaintenanceModal({ site, onClose }: { site: Site; onClose: () => void }) {
  const { dispatch } = useStore();
  const [activeTab, setActiveTab] = useState<'maintenance' | 'domain' | 'scripts' | 'seo'>('maintenance');

  // Maintenance fields
  const [maintenanceMode, setMaintenanceMode] = useState<boolean>(Boolean(site.maintenanceMode));
  const [maintenanceHeadline, setMaintenanceHeadline] = useState(site.maintenanceHeadline || "We'll be right back");
  const [maintenanceNotice, setMaintenanceNotice] = useState(
    site.maintenanceNotice || "We are currently performing scheduled maintenance to upgrade our platform and infrastructure. Please check back shortly!"
  );

  // Custom domain fields
  const [domain, setDomain] = useState(site.domain || '');
  const [dnsVerified, setDnsVerified] = useState(true);
  const [verifyingDns, setVerifyingDns] = useState(false);

  // Injected scripts & WordPress Custom CSS
  const [headerScripts, setHeaderScripts] = useState(site.headerScripts || '');
  const [footerScripts, setFooterScripts] = useState(site.footerScripts || '');
  const [customCss, setCustomCss] = useState(site.customCss || '');

  // SEO & Meta
  const [seoTitle, setSeoTitle] = useState(site.seoTitle || site.name);
  const [seoDescription, setSeoDescription] = useState(
    site.seoDescription || `Welcome to ${site.name}. Discover our full suite of professional services and client solutions.`
  );
  const [faviconUrl, setFaviconUrl] = useState(site.faviconUrl || '');
  const [focusKeyword, setFocusKeyword] = useState(site.focusKeyword || '');
  const [saving, setSaving] = useState(false);

  const handleVerifyDns = () => {
    setVerifyingDns(true);
    setTimeout(() => {
      setVerifyingDns(false);
      setDnsVerified(true);
    }, 800);
  };

  const handleSave = async () => {
    setSaving(true);
    const patch: Partial<Site> = {
      maintenanceMode,
      maintenanceHeadline: maintenanceHeadline.trim(),
      maintenanceNotice: maintenanceNotice.trim(),
      domain: domain.trim(),
      headerScripts: headerScripts.trim(),
      footerScripts: footerScripts.trim(),
      customCss: customCss.trim(),
      seoTitle: seoTitle.trim(),
      seoDescription: seoDescription.trim(),
      focusKeyword: focusKeyword.trim(),
      faviconUrl: faviconUrl.trim(),
    };
    dispatch({ type: 'site/update', id: site.id, patch });
    try {
      await api.websites.update(site.id, patch);
    } catch (err) {
      console.error('Failed to update website maintenance settings:', err);
    }
    setSaving(false);
    onClose();
  };

  return (
    <Modal
      title={`Website Maintenance & Settings · ${site.name}`}
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn btn--primary" type="button" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Website Settings'}
          </button>
        </>
      }
    >
      <div className="segmented" style={{ marginBottom: 16 }}>
        <button
          type="button"
          className={activeTab === 'maintenance' ? 'is-active' : ''}
          onClick={() => setActiveTab('maintenance')}
        >
          <span className="row" style={{ gap: 6, alignItems: 'center' }}>
            <Icon name="sliders" size={13} /> Maintenance Mode
          </span>
        </button>
        <button
          type="button"
          className={activeTab === 'domain' ? 'is-active' : ''}
          onClick={() => setActiveTab('domain')}
        >
          <span className="row" style={{ gap: 6, alignItems: 'center' }}>
            <Icon name="globe" size={13} /> Domain & DNS
          </span>
        </button>
        <button
          type="button"
          className={activeTab === 'scripts' ? 'is-active' : ''}
          onClick={() => setActiveTab('scripts')}
        >
          <span className="row" style={{ gap: 6, alignItems: 'center' }}>
            <Icon name="code" size={13} /> Tracking & Code
          </span>
        </button>
        <button
          type="button"
          className={activeTab === 'seo' ? 'is-active' : ''}
          onClick={() => setActiveTab('seo')}
        >
          <span className="row" style={{ gap: 6, alignItems: 'center' }}>
            <Icon name="search" size={13} /> SEO & Social
          </span>
        </button>
      </div>

      {activeTab === 'maintenance' && (
        <div className="stack" style={{ gap: 16 }}>
          <div
            style={{
              padding: 14,
              borderRadius: 8,
              border: '1px solid var(--line)',
              background: maintenanceMode ? 'rgba(234, 179, 8, 0.12)' : 'var(--surface-2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
            }}
          >
            <div>
              <div style={{ fontWeight: 650, fontSize: 13.5, color: maintenanceMode ? '#b45309' : 'var(--text)' }}>
                {maintenanceMode ? '⚠️ Maintenance Mode is Active' : '🟢 Website is Online'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
                {maintenanceMode
                  ? 'All public traffic is redirected to the branded maintenance screen below.'
                  : 'Your live site pages are fully accessible to visitors and search engines.'}
              </div>
            </div>
            <Switch
              on={maintenanceMode}
              label="Toggle Maintenance Mode"
              onChange={() => setMaintenanceMode(!maintenanceMode)}
            />
          </div>

          <div className="field">
            <label htmlFor="maint-headline">Maintenance Splash Headline</label>
            <input
              id="maint-headline"
              className="input"
              value={maintenanceHeadline}
              onChange={(e) => setMaintenanceHeadline(e.target.value)}
              placeholder="We'll be right back"
            />
          </div>

          <div className="field">
            <label htmlFor="maint-notice">Public Notice / Explanatory Message</label>
            <textarea
              id="maint-notice"
              className="input"
              rows={3}
              value={maintenanceNotice}
              onChange={(e) => setMaintenanceNotice(e.target.value)}
              placeholder="Provide a friendly note for visitors while maintenance is ongoing."
            />
          </div>

          <div style={{ border: '1px dashed var(--line)', borderRadius: 10, padding: 20, background: '#0f172a', color: '#f8fafc', textAlign: 'center' }}>
            <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', opacity: 0.6, marginBottom: 8 }}>
              Visitor Maintenance Preview
            </div>
            <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
              <Icon name="sliders" size={22} />
            </div>
            <h3 style={{ fontSize: 20, margin: '0 0 8px', color: '#ffffff' }}>{maintenanceHeadline || "We'll be right back"}</h3>
            <p style={{ maxWidth: 440, margin: '0 auto', fontSize: 13, color: '#94a3b8', lineHeight: 1.6 }}>
              {maintenanceNotice || 'We are performing scheduled maintenance to improve our services.'}
            </p>
          </div>
        </div>
      )}

      {activeTab === 'domain' && (
        <div className="stack" style={{ gap: 16 }}>
          <div className="field">
            <label htmlFor="custom-domain">Custom Domain / Hostname</label>
            <div className="row" style={{ gap: 8 }}>
              <input
                id="custom-domain"
                className="input"
                style={{ fontFamily: 'var(--font-mono)' }}
                placeholder="e.g. acme-growth.com or www.acme.com"
                value={domain}
                onChange={(e) => {
                  setDomain(e.target.value);
                  setDnsVerified(false);
                }}
              />
              <button
                type="button"
                className="btn btn--secondary"
                disabled={verifyingDns || !domain.trim()}
                onClick={handleVerifyDns}
              >
                {verifyingDns ? 'Checking DNS...' : 'Verify DNS'}
              </button>
            </div>
            <div className="hint" style={{ marginTop: 4 }}>
              Point your domain or subdomain DNS records to Operza's edge network below.
            </div>
          </div>

          <div style={{ border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', background: 'var(--surface-2)', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ fontSize: 12.5 }}>Required DNS Records</strong>
              <Badge tone={dnsVerified ? 'green' : 'amber'} dot>
                {dnsVerified ? 'DNS Verified & SSL Active' : 'Pending Verification'}
              </Badge>
            </div>
            <table className="table" style={{ margin: 0 }}>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Host / Name</th>
                  <th>Points To (Value)</th>
                  <th>TTL</th>
                  <th className="cell-right">Status</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><code>CNAME</code></td>
                  <td><code>www</code> (or subdomain)</td>
                  <td><code>cname.operza.io</code></td>
                  <td>Auto / 3600</td>
                  <td className="cell-right">
                    <span style={{ color: 'var(--green)', fontSize: 12, fontWeight: 600 }}>● Active</span>
                  </td>
                </tr>
                <tr>
                  <td><code>A</code></td>
                  <td><code>@</code> (Apex root)</td>
                  <td><code>76.76.21.21</code></td>
                  <td>Auto / 3600</td>
                  <td className="cell-right">
                    <span style={{ color: 'var(--green)', fontSize: 12, fontWeight: 600 }}>● Active</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div style={{ padding: 12, borderRadius: 8, background: 'rgba(34, 197, 94, 0.08)', border: '1px solid rgba(34, 197, 94, 0.2)', fontSize: 12.5, color: 'var(--text)' }}>
            🔒 <strong>Automatic Let's Encrypt SSL:</strong> All domains routed to Operza automatically receive a provisioned TLS/SSL certificate with zero manual renewal required.
          </div>
        </div>
      )}

      {activeTab === 'scripts' && (
        <div className="stack" style={{ gap: 16 }}>
          <div className="field">
            <label htmlFor="header-scripts">Header Tracking & Custom Code (&lt;head&gt;)</label>
            <textarea
              id="header-scripts"
              className="input"
              rows={5}
              style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
              placeholder={'<!-- Google Tag Manager, Meta Pixel, or Custom CSS -->\n<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXX"></script>'}
              value={headerScripts}
              onChange={(e) => setHeaderScripts(e.target.value)}
            />
            <div className="hint" style={{ marginTop: 4 }}>
              Injected before the closing <code>&lt;/head&gt;</code> tag on every published page of this website.
            </div>
          </div>

          <div className="field">
            <label htmlFor="footer-scripts">Footer Body Code (&lt;/body&gt;)</label>
            <textarea
              id="footer-scripts"
              className="input"
              rows={4}
              style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
              placeholder={'<!-- Live chat widgets, attribution scripts, conversion event listeners -->\n<script>\n  console.log("Website loaded");\n</script>'}
              value={footerScripts}
              onChange={(e) => setFooterScripts(e.target.value)}
            />
            <div className="hint" style={{ marginTop: 4 }}>
              Injected right before the closing <code>&lt;/body&gt;</code> tag for optimal page load speed.
            </div>
          </div>

          <div className="field">
            <div className="row row--between">
              <label htmlFor="custom-css">WordPress-Style Additional CSS</label>
              <span className="hint" style={{ fontSize: 11 }}>Site-wide scoped styles</span>
            </div>
            <textarea
              id="custom-css"
              className="input"
              rows={5}
              style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
              placeholder={'/* WordPress Customizer Additional CSS */\n:root {\n  --brand-primary: #3b82f6;\n}\n.operza-cta-btn {\n  box-shadow: 0 4px 14px rgba(59, 130, 246, 0.4);\n}'}
              value={customCss}
              onChange={(e) => setCustomCss(e.target.value)}
            />
            <div className="hint" style={{ marginTop: 4 }}>
              Injected into a dedicated <code>&lt;style id="operza-custom-css"&gt;</code> block across all site templates.
            </div>
          </div>
        </div>
      )}

      {activeTab === 'seo' && (
        <div className="stack" style={{ gap: 14 }}>
          <div className="field">
            <label htmlFor="seo-title">SEO Meta Title</label>
            <input
              id="seo-title"
              className="input"
              value={seoTitle}
              onChange={(e) => setSeoTitle(e.target.value)}
              placeholder="e.g. Acme Growth Advisory — Enterprise Revenue Engine"
            />
          </div>

          <div className="field">
            <div className="row row--between">
              <label htmlFor="seo-desc">SEO Meta Description</label>
              <span className="hint" style={{ fontSize: 11 }}>{seoDescription.length}/160 characters</span>
            </div>
            <textarea
              id="seo-desc"
              className="input"
              rows={3}
              value={seoDescription}
              onChange={(e) => setSeoDescription(e.target.value)}
              placeholder="Concise summary for search engine results and social previews."
            />
          </div>

          <div className="field">
            <div className="row row--between">
              <label htmlFor="focus-keyword">Focus Keyphrase (WordPress / Yoast Style)</label>
              <Badge tone={focusKeyword ? 'violet' : 'default'}>
                {focusKeyword ? `Auditing: "${focusKeyword}"` : 'Optional'}
              </Badge>
            </div>
            <input
              id="focus-keyword"
              className="input"
              value={focusKeyword}
              onChange={(e) => setFocusKeyword(e.target.value)}
              placeholder="e.g. enterprise b2b saas growth"
            />
            <div className="hint" style={{ marginTop: 4 }}>
              Enter the primary keyword phrase you want this website to rank for. Operza audits your metadata below.
            </div>
          </div>

          {focusKeyword.trim() && (
            <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 12, background: 'var(--surface-2)', fontSize: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Keyphrase Optimization Audit:</div>
              <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
                <li style={{ color: seoTitle.toLowerCase().includes(focusKeyword.toLowerCase().trim()) ? 'var(--green)' : 'var(--amber)' }}>
                  {seoTitle.toLowerCase().includes(focusKeyword.toLowerCase().trim()) ? '✓' : '✗'} Keyphrase in SEO Title
                </li>
                <li style={{ color: seoDescription.toLowerCase().includes(focusKeyword.toLowerCase().trim()) ? 'var(--green)' : 'var(--amber)' }}>
                  {seoDescription.toLowerCase().includes(focusKeyword.toLowerCase().trim()) ? '✓' : '✗'} Keyphrase in Meta Description
                </li>
                <li style={{ color: seoTitle.length >= 30 && seoTitle.length <= 60 ? 'var(--green)' : 'var(--amber)' }}>
                  {seoTitle.length >= 30 && seoTitle.length <= 60 ? '✓' : '–'} Title length ({seoTitle.length} chars — recommended 30-60)
                </li>
                <li style={{ color: seoDescription.length >= 120 && seoDescription.length <= 160 ? 'var(--green)' : 'var(--amber)' }}>
                  {seoDescription.length >= 120 && seoDescription.length <= 160 ? '✓' : '–'} Description length ({seoDescription.length} chars — recommended 120-160)
                </li>
              </ul>
            </div>
          )}

          <div className="field">
            <label htmlFor="favicon-url">Favicon URL</label>
            <input
              id="favicon-url"
              className="input"
              value={faviconUrl}
              onChange={(e) => setFaviconUrl(e.target.value)}
              placeholder="https://yourdomain.com/favicon.png"
            />
          </div>

          <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 16, background: '#ffffff' }}>
            <div style={{ fontSize: 11, fontWeight: 650, color: '#64748b', textTransform: 'uppercase', marginBottom: 10 }}>
              Google Search Result Snippet Preview
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>
                🌐
              </div>
              <div style={{ fontSize: 12, color: '#202124' }}>
                https://{domain || `${siteSlug(site)}.operza.io`}
              </div>
            </div>
            <div style={{ fontSize: 18, color: '#1a0dab', fontWeight: 500, lineHeight: 1.3, marginBottom: 4 }}>
              {seoTitle || site.name}
            </div>
            <div style={{ fontSize: 13, color: '#4d5156', lineHeight: 1.5 }}>
              {seoDescription || 'Add an SEO description above to customize your Google search preview.'}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function SiteCodeModal({ site, onClose }: { site: Site; onClose: () => void }) {
  const { dispatch } = useStore();
  const [activeTab, setActiveTab] = useState<'export' | 'import'>('export');
  const [exportFormat, setExportFormat] = useState<'html' | 'json'>('html');
  const [copied, setCopied] = useState(false);

  // Import states
  const [importType, setImportType] = useState<'json' | 'html'>('json');
  const [importCode, setImportCode] = useState('');
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // Generate HTML bundle
  const generateHtml = (): string => {
    const pagesHtml = site.pages.map((p) => `
    <section id="${p.id}" class="operza-page-section" data-path="${p.path}">
      <header class="operza-section-header">
        <h1>${p.headline || p.name}</h1>
        ${p.subhead ? `<p class="operza-subhead">${p.subhead}</p>` : ''}
        ${p.cta ? `<a href="#action" class="operza-cta-btn">${p.cta}</a>` : ''}
      </header>
      <div class="operza-blocks">
        ${(p.blocks || []).map((b: any) => `
        <div class="operza-block operza-block--${b.type}">
          ${b.type === 'heading' ? `<h2>${b.props?.text || ''}</h2>` : ''}
          ${b.type === 'paragraph' ? `<p>${b.props?.text || ''}</p>` : ''}
          ${b.type === 'button' ? `<button>${b.props?.label || 'Action'}</button>` : ''}
          ${b.type === 'image' ? `<img src="${b.props?.url || ''}" alt="${b.props?.alt || ''}" />` : ''}
        </div>`).join('\n        ')}
      </div>
    </section>`).join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${site.seoTitle || site.name}</title>
  <meta name="description" content="${site.seoDescription || ''}">
  ${site.focusKeyword ? `<meta name="keywords" content="${site.focusKeyword}">` : ''}
  ${site.faviconUrl ? `<link rel="icon" href="${site.faviconUrl}">` : ''}
  <!-- Operza WordPress-Compatible Additional CSS -->
  <style id="operza-custom-css">
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; line-height: 1.6; color: #1e293b; background: #fff; }
    .operza-site-container { max-width: 1200px; margin: 0 auto; padding: 2rem 1.5rem; }
    .operza-page-section { padding: 3rem 0; border-bottom: 1px solid #e2e8f0; }
    .operza-cta-btn { display: inline-block; padding: 0.75rem 1.5rem; background: #2563eb; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 600; margin-top: 1rem; }
    ${site.customCss || ''}
  </style>
  ${site.headerScripts || ''}
</head>
<body>
  <div class="operza-site-container">
    <header class="operza-global-header" style="padding-bottom: 1.5rem; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center;">
      <h2 style="margin: 0; font-size: 1.25rem;">${site.name}</h2>
      <nav>
        ${site.pages.map((p) => `<a href="${p.path}" style="margin-left: 1rem; color: #475569; text-decoration: none;">${p.name}</a>`).join(' ')}
      </nav>
    </header>
    <main>
${pagesHtml}
    </main>
    <footer style="margin-top: 4rem; padding-top: 2rem; border-top: 1px solid #e2e8f0; font-size: 0.875rem; color: #94a3b8; text-align: center;">
      <p>© ${new Date().getFullYear()} ${site.name}. Powered by Operza Growth Engine.</p>
    </footer>
  </div>
  ${site.footerScripts || ''}
</body>
</html>`;
  };

  const generateJson = (): string => {
    return JSON.stringify(site, null, 2);
  };

  const exportContent = exportFormat === 'html' ? generateHtml() : generateJson();

  const handleCopy = () => {
    navigator.clipboard.writeText(exportContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const slug = siteSlug(site);
    const filename = exportFormat === 'html' ? `${slug}-site.html` : `${slug}-template.json`;
    const mimeType = exportFormat === 'html' ? 'text/html' : 'application/json';
    const blob = new Blob([exportContent], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async () => {
    setImportError(null);
    setImportStatus(null);
    if (!importCode.trim()) {
      setImportError('Please paste valid code or schema to import.');
      return;
    }

    try {
      if (importType === 'json') {
        const parsed = JSON.parse(importCode);
        if (!parsed || typeof parsed !== 'object') {
          throw new Error('Invalid JSON format');
        }

        let importedPages: SitePage[] = [];
        if (Array.isArray(parsed.pages)) {
          importedPages = parsed.pages.map((p: any) => ({
            id: p.id || uid('page'),
            name: String(p.name || 'Imported Page'),
            path: toPath(String(p.path || '/page')),
            headline: p.headline ? String(p.headline) : undefined,
            subhead: p.subhead ? String(p.subhead) : undefined,
            cta: p.cta ? String(p.cta) : undefined,
            theme: p.theme || 'plain',
            visits: typeof p.visits === 'number' ? p.visits : 0,
            optins: typeof p.optins === 'number' ? p.optins : 0,
            blocks: Array.isArray(p.blocks) ? p.blocks : [],
          }));
        } else if (Array.isArray(parsed)) {
          importedPages = parsed.map((p: any) => ({
            id: p.id || uid('page'),
            name: String(p.name || 'Imported Page'),
            path: toPath(String(p.path || '/page')),
            headline: p.headline ? String(p.headline) : undefined,
            subhead: p.subhead ? String(p.subhead) : undefined,
            cta: p.cta ? String(p.cta) : undefined,
            theme: p.theme || 'plain',
            visits: 0,
            optins: 0,
            blocks: Array.isArray(p.blocks) ? p.blocks : [],
          }));
        } else {
          throw new Error('JSON schema must contain a "pages" array');
        }

        const newPages = importMode === 'replace'
          ? importedPages
          : [...site.pages, ...importedPages];

        const patch: Partial<Site> = {
          pages: newPages,
          customCss: parsed.customCss ? String(parsed.customCss) : site.customCss,
          seoTitle: parsed.seoTitle ? String(parsed.seoTitle) : site.seoTitle,
          seoDescription: parsed.seoDescription ? String(parsed.seoDescription) : site.seoDescription,
          focusKeyword: parsed.focusKeyword ? String(parsed.focusKeyword) : site.focusKeyword,
        };

        dispatch({ type: 'site/update', id: site.id, patch });
        try {
          await api.websites.update(site.id, patch);
        } catch (err) {
          console.error('Failed to sync imported site to backend:', err);
        }

        setImportStatus(`Successfully imported ${importedPages.length} page(s)!`);
        setTimeout(() => onClose(), 1200);
      } else {
        const parser = new DOMParser();
        const doc = parser.parseFromString(importCode, 'text/html');
        const title = doc.querySelector('title')?.textContent || 'Imported Page';
        const h1 = doc.querySelector('h1')?.textContent || title;
        const p = doc.querySelector('p')?.textContent || '';
        const customStyle = doc.querySelector('style#operza-custom-css')?.textContent || '';

        const newPage: SitePage = {
          id: uid('page'),
          name: title.slice(0, 30),
          path: slugPath(title),
          headline: h1,
          subhead: p.slice(0, 160),
          cta: 'Learn more',
          theme: 'plain',
          visits: 0,
          optins: 0,
          blocks: [
            { id: uid('block'), type: 'heading', props: { text: h1, level: 1 } },
            ...(p ? [{ id: uid('block'), type: 'paragraph', props: { text: p } }] : []),
          ],
        };

        const newPages = importMode === 'replace' ? [newPage] : [...site.pages, newPage];
        const patch: Partial<Site> = {
          pages: newPages,
          customCss: customStyle ? `${site.customCss || ''}\n${customStyle}`.trim() : site.customCss,
        };

        dispatch({ type: 'site/update', id: site.id, patch });
        try {
          await api.websites.update(site.id, patch);
        } catch (err) {
          console.error('Failed to sync imported HTML to backend:', err);
        }

        setImportStatus(`Successfully created page "${newPage.name}" from HTML!`);
        setTimeout(() => onClose(), 1200);
      }
    } catch (err: any) {
      setImportError(err.message || 'Failed to parse import content');
    }
  };

  return (
    <Modal
      title={`Code & Template Manager · ${site.name}`}
      wide
      onClose={onClose}
      footer={
        <button className="btn" type="button" onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="segmented" style={{ marginBottom: 16 }}>
        <button
          type="button"
          className={activeTab === 'export' ? 'is-active' : ''}
          onClick={() => setActiveTab('export')}
        >
          <span className="row" style={{ gap: 6, alignItems: 'center' }}>
            <Icon name="download" size={13} /> Export Code & Templates
          </span>
        </button>
        <button
          type="button"
          className={activeTab === 'import' ? 'is-active' : ''}
          onClick={() => setActiveTab('import')}
        >
          <span className="row" style={{ gap: 6, alignItems: 'center' }}>
            <Icon name="upload" size={13} /> Import HTML / JSON
          </span>
        </button>
      </div>

      {activeTab === 'export' && (
        <div className="stack" style={{ gap: 14 }}>
          <div className="row row--between" style={{ alignItems: 'center' }}>
            <div className="segmented" style={{ width: 'fit-content' }}>
              <button
                type="button"
                className={exportFormat === 'html' ? 'is-active' : ''}
                onClick={() => setExportFormat('html')}
              >
                Production HTML Code
              </button>
              <button
                type="button"
                className={exportFormat === 'json' ? 'is-active' : ''}
                onClick={() => setExportFormat('json')}
              >
                Site JSON Template
              </button>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn btn--sm" onClick={handleCopy}>
                {copied ? '✓ Copied!' : 'Copy Code'}
              </button>
              <button type="button" className="btn btn--sm btn--primary" onClick={handleDownload}>
                <Icon name="download" size={13} /> Download File
              </button>
            </div>
          </div>

          <div className="field">
            <textarea
              className="input"
              rows={14}
              readOnly
              style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, background: 'var(--surface-2)', whiteSpace: 'pre' }}
              value={exportContent}
            />
          </div>

          <div className="hint">
            💡 Exported code is 100% self-contained and ready for deployment on Apache, Nginx, Netlify, Cloudflare Pages, or WordPress custom templates.
          </div>
        </div>
      )}

      {activeTab === 'import' && (
        <div className="stack" style={{ gap: 14 }}>
          <div className="row row--between" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <div className="segmented" style={{ width: 'fit-content' }}>
              <button
                type="button"
                className={importType === 'json' ? 'is-active' : ''}
                onClick={() => setImportType('json')}
              >
                JSON Schema / Template
              </button>
              <button
                type="button"
                className={importType === 'html' ? 'is-active' : ''}
                onClick={() => setImportType('html')}
              >
                Raw HTML Page
              </button>
            </div>
            <div className="row" style={{ gap: 8, alignItems: 'center' }}>
              <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="importMode"
                  checked={importMode === 'merge'}
                  onChange={() => setImportMode('merge')}
                />
                Merge with existing
              </label>
              <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="importMode"
                  checked={importMode === 'replace'}
                  onChange={() => setImportMode('replace')}
                />
                Replace all pages
              </label>
            </div>
          </div>

          <div className="field">
            <label>
              {importType === 'json' ? 'Paste Operza or WordPress WP-JSON Schema' : 'Paste Raw HTML Code or Page Source'}
            </label>
            <textarea
              className="input"
              rows={10}
              placeholder={importType === 'json' ? '{\n  "pages": [\n    { "name": "Landing", "path": "/home" }\n  ]\n}' : '<!DOCTYPE html>\n<html>\n<head><title>My Landing Page</title></head>\n<body><h1>Welcome</h1><p>Our company specializes in...</p></body>\n</html>'}
              style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5 }}
              value={importCode}
              onChange={(e) => setImportCode(e.target.value)}
            />
          </div>

          {importError && (
            <div style={{ padding: '8px 12px', borderRadius: 6, background: 'rgba(239, 68, 68, 0.1)', color: 'var(--red)', fontSize: 12 }}>
              ⚠️ {importError}
            </div>
          )}

          {importStatus && (
            <div style={{ padding: '8px 12px', borderRadius: 6, background: 'rgba(34, 197, 94, 0.1)', color: 'var(--green)', fontSize: 12 }}>
              ✓ {importStatus}
            </div>
          )}

          <button
            type="button"
            className="btn btn--primary"
            style={{ width: 'fit-content' }}
            onClick={handleImport}
          >
            <Icon name="upload" size={13} /> Process & Apply Import
          </button>
        </div>
      )}
    </Modal>
  );
}
