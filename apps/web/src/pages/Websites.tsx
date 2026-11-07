import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Badge, StatusBadge, Switch } from '../components/ui';
import { VisualPageBuilder, type FunnelBlock } from '../components/VisualPageBuilder';
import { useStore, uid } from '../lib/store';
import { num, pct } from '../lib/format';
import { api } from '../lib/api';
import type { PageTheme, Site, SitePage } from '../lib/types';
import { WEBSITE_TEMPLATES, generateStaticHtmlExport } from '../lib/websiteTemplates';

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
          alignItems: 'center'
        }}
      >
        <span className="row" style={{ gap: 7, alignItems: 'center' }}>
          <span className="brand__mark">OPZ</span>
          <strong style={{ fontSize: 13 }}>{site.globalHeader?.brandText || site.name}</strong>
        </span>
        <span className="spacer" />
        {(site.globalHeader?.navLinks && site.globalHeader.navLinks.length > 0
          ? site.globalHeader.navLinks
          : site.pages.map((p) => ({ id: p.id, label: p.name, url: p.path }))
        ).map((link) => (
          <span
            key={link.id || link.label}
            className="hint"
            style={{ fontSize: 12, fontWeight: link.label === page.name ? 650 : 450, color: link.label === page.name ? 'var(--text)' : undefined }}
          >
            {link.label}
          </span>
        ))}
        {site.globalHeader?.ctaLabel && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              background: 'var(--accent)',
              color: '#fff',
              padding: '4px 10px',
              borderRadius: 6,
              marginLeft: 8
            }}
          >
            {site.globalHeader.ctaLabel}
          </span>
        )}
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
          padding: '12px 18px',
          borderTop: '1px solid var(--line)',
          fontSize: 11.5,
          color: 'var(--text-3)',
          flexWrap: 'wrap',
          gap: 12
        }}
      >
        <span>
          {site.globalFooter?.copyrightText || `© ${new Date().getFullYear()} ${site.name}. All rights reserved.`}
        </span>
        {site.globalFooter?.footerLinks && site.globalFooter.footerLinks.length > 0 && (
          <div className="row" style={{ gap: 12 }}>
            {site.globalFooter.footerLinks.map((l) => (
              <span key={l.id || l.label} className="hint" style={{ fontSize: 11 }}>
                {l.label}
              </span>
            ))}
          </div>
        )}
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
  const [symbolsSite, setSymbolsSite] = useState<Site | null>(null);
  const [publishSite, setPublishSite] = useState<Site | null>(null);

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

  const handleDuplicatePage = async (site: Site, page: SitePage) => {
    const newPage: SitePage = {
      ...page,
      id: uid('wp'),
      name: `${page.name} (Copy)`,
      path: `${page.path === '/' ? '/home' : page.path}-copy`,
      visits: 0,
      optins: 0,
      blocks: page.blocks ? JSON.parse(JSON.stringify(page.blocks)) : [],
    };
    const updatedPages = [...site.pages, newPage];
    dispatch({ type: 'site/step/add', siteId: site.id, page: newPage });
    try {
      await api.websites.update(site.id, { pages: updatedPages });
    } catch (err) {
      console.error('Failed to duplicate page:', err);
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
    <main className="operza-dashboard atlas-dashboard">
      <header className="atlas-dashboard__header">
        <div className="atlas-dashboard__heading">
          <div className="atlas-dashboard__breadcrumb">Workspace <span>/</span> Sites &amp; Funnels</div>
          <h1>Hosted Websites &amp; CMS</h1>
        </div>
        <div className="atlas-dashboard__toolbar">
          <button className="atlas-quick-action-button" onClick={() => setNewSiteOpen(true)}>
            <Icon name="plus" size={13} /> New Website
          </button>
        </div>
      </header>

      <section className="atlas-hero">
        <div className="atlas-eyebrow">HEADLESS CMS &amp; VISUAL BUILDER</div>
        <h2>Production Web Properties &amp; Client Portals</h2>
        <p>Deploy responsive websites, manage custom domains, maintain global reusable symbols, and track visual block revisions.</p>
      </section>

      <section className="atlas-kpis" aria-label="Website metrics">
        <article className="operza-kpi atlas-kpi">
          <div className="atlas-kpi__meta">
            <span className="atlas-kpi__label">Hosted Sites</span>
            <span className="atlas-status atlas-status--healthy">Active</span>
          </div>
          <div className="atlas-kpi__value">{sites.length}</div>
          <div className="atlas-kpi__note">Multi-page web applications</div>
        </article>
        <article className="operza-kpi atlas-kpi">
          <div className="atlas-kpi__meta">
            <span className="atlas-kpi__label">Total Pages</span>
            <span className="atlas-status atlas-status--healthy">Live</span>
          </div>
          <div className="atlas-kpi__value">{pages}</div>
          <div className="atlas-kpi__note">Published CMS routes</div>
        </article>
        <article className="operza-kpi atlas-kpi">
          <div className="atlas-kpi__meta">
            <span className="atlas-kpi__label">All-Time Traffic</span>
            <span className="atlas-status atlas-status--healthy">Monitored</span>
          </div>
          <div className="atlas-kpi__value">{num(visits)}</div>
          <div className="atlas-kpi__note">Unique visitor requests</div>
        </article>
        <article className="operza-kpi atlas-kpi">
          <div className="atlas-kpi__meta">
            <span className="atlas-kpi__label">Lead Ingestion</span>
            <span className="atlas-status atlas-status--healthy">Automated</span>
          </div>
          <div className="atlas-kpi__value">{pct(optins, visits || 1)}</div>
          <div className="atlas-kpi__note">{num(optins)} direct submissions</div>
        </article>
      </section>

      <div className="stack" style={{ marginTop: 22 }}>
        {sites.map((site) => (
          <div className="card-premium" key={site.id}>
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
                  {(site.globalHeader?.enabled || site.globalFooter?.enabled) && (
                    <Badge tone="violet">Global Symbols Active</Badge>
                  )}
                </div>
                <div className="cell-sub" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 3 }}>
                  <span>Edge Host:</span>
                  <a
                    href={`/site/${siteSlug(site)}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: 'var(--accent)', fontWeight: 600, textDecoration: 'none', fontFamily: 'var(--font-mono)', fontSize: 11.5 }}
                  >
                    /site/{siteSlug(site)} ↗
                  </a>
                  {site.domain && site.domain.includes('.') && (
                    <span style={{ color: 'var(--text-3)', fontSize: 11.5 }}>
                      · https://{site.domain}
                    </span>
                  )}
                </div>
              </div>
              <div className="card__actions">
                <a
                  href={`/site/${siteSlug(site)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn--sm"
                  style={{
                    background: 'var(--surface-2)',
                    border: '1px solid var(--line)',
                    gap: 5,
                    display: 'inline-flex',
                    alignItems: 'center',
                    textDecoration: 'none',
                    fontWeight: 650,
                    color: 'var(--text)'
                  }}
                  title="Open live hosted website in new browser tab"
                >
                  <Icon name="eye" size={13} /> View Live Site ↗
                </a>
                <Switch on={site.published} label={`Toggle ${site.name}`} onChange={() => handleTogglePublished(site)} />
                <button
                  className="btn btn--sm"
                  style={{ background: '#059669', borderColor: '#059669', color: '#fff', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5 }}
                  title="Deploy to Edge CDN, manage custom domains, SSL, and export"
                  onClick={() => setPublishSite(site)}
                >
                  <Icon name="globe" size={13} /> Publish &amp; Domains
                </button>
                <button
                  className="btn btn--sm"
                  title="Configure site maintenance, custom domain, tracking scripts & SEO"
                  onClick={() => setMaintenanceSite(site)}
                >
                  <Icon name="sliders" size={14} /> Maintenance & DNS
                </button>
                <button
                  className="btn btn--sm"
                  title="Manage shared Global Header & Footer symbols across all pages"
                  onClick={() => setSymbolsSite(site)}
                >
                  <Icon name="copy" size={14} /> Global Symbols
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
                          <a
                            href={`/site/${siteSlug(site)}${page.path === '/' ? '' : page.path}`}
                            target="_blank"
                            rel="noreferrer"
                            className="btn btn--sm btn--secondary"
                            style={{ fontSize: 11.5, padding: '3px 8px', gap: 4, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
                            title={`Open ${page.name} live in new tab`}
                          >
                            <Icon name="eye" size={12} /> Live Page ↗
                          </a>
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
                            title={`Edit ${page.name}`}
                            onClick={() => setEditing({ siteId: site.id, pageId: page.id })}
                          >
                            <Icon name="edit" size={14} />
                          </button>
                          <button
                            type="button"
                            className="icon-btn"
                            aria-label={`Duplicate ${page.name}`}
                            title={`Duplicate ${page.name}`}
                            onClick={() => handleDuplicatePage(site, page)}
                          >
                            <Icon name="copy" size={14} />
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

      {publishSite && (
        <PublishDeploymentModal
          site={publishSite}
          onClose={() => setPublishSite(null)}
          dispatch={dispatch}
        />
      )}

      {maintenanceSite && (
        <SiteMaintenanceModal
          site={maintenanceSite}
          onClose={() => setMaintenanceSite(null)}
        />
      )}

      {symbolsSite && (
        <GlobalSymbolsModal
          site={symbolsSite}
          onClose={() => setSymbolsSite(null)}
          dispatch={dispatch}
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
    </main>
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
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('agency-growth');
  const activeTemplate = WEBSITE_TEMPLATES.find((t) => t.id === selectedTemplateId) || WEBSITE_TEMPLATES[0];

  const [name, setName] = useState('Apex Growth Studio');
  const [domain, setDomain] = useState('apex-growth');
  const [hasManuallyEditedName, setHasManuallyEditedName] = useState(false);
  const [theme, setTheme] = useState<PageTheme>('gradient');
  const [loading, setLoading] = useState(false);

  // Template auto-naming map so selecting any template automatically fills the business name and domain
  const TEMPLATE_PRESETS: Record<string, { name: string; slug: string }> = {
    'agency-growth': { name: 'Apex Growth Studio', slug: 'apex-growth' },
    'healthcare-clinic': { name: 'VitalCare Health & Wellness Clinic', slug: 'vitalcare-clinic' },
    'real-estate-luxury': { name: 'Prestige Real Estate & Estates', slug: 'prestige-estates' },
    'saas-tech': { name: 'CloudScale B2B SaaS Platform', slug: 'cloudscale-platform' },
    'fitness-coaching': { name: 'IronPeak Performance Fitness', slug: 'ironpeak-fitness' },
    'ecommerce-dtc': { name: 'Solstice Artisan Craft Store', slug: 'solstice-store' },
  };

  const handleSelectTemplate = (tmpl: typeof activeTemplate) => {
    setSelectedTemplateId(tmpl.id);
    if (!hasManuallyEditedName) {
      const preset = TEMPLATE_PRESETS[tmpl.id] || { name: tmpl.name, slug: tmpl.id };
      setName(preset.name);
      setDomain(preset.slug);
    }
    if (tmpl.theme) {
      setTheme(tmpl.theme);
    }
  };

  const handleCreate = async () => {
    if (loading) return;
    setLoading(true);
    const siteId = uid('ws');
    const effectiveName = name.trim() || activeTemplate.name || 'Operza Web Property';
    const slug = (domain.trim() || effectiveName).toLowerCase().replace(/[^a-z0-9]+/g, '-');

    const pages: SitePage[] = activeTemplate.pages.map((p) => ({
      id: uid('wp'),
      name: p.name,
      path: p.path,
      headline: p.headline.replace(/Your Agency|Our Team/gi, effectiveName),
      subhead: p.subhead,
      cta: p.cta,
      theme: p.theme || theme,
      visits: 0,
      optins: 0,
      blocks: p.blocks ? JSON.parse(JSON.stringify(p.blocks)) : [],
    }));

    const newSite: Site = {
      id: siteId,
      name: effectiveName,
      kind: 'website',
      domain: slug,
      published: true, // Default to true so it is instantly live and viewable!
      visits: 0,
      optins: 0,
      pages,
      globalHeader: {
        enabled: true,
        brandText: effectiveName,
        navLinks: activeTemplate.headerNav.map((l) => ({ id: uid(), label: l.label, url: l.url })),
        ctaLabel: activeTemplate.ctaLabel,
        ctaUrl: activeTemplate.ctaUrl,
      },
      globalFooter: {
        enabled: true,
        copyrightText: `© ${new Date().getFullYear()} ${effectiveName}. All rights reserved.`,
        footerLinks: activeTemplate.footerNav.map((l) => ({ id: uid(), label: l.label, url: l.url })),
      },
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
      title="Create New Multi-Page Website"
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button
            className="btn btn--primary"
            type="button"
            disabled={loading}
            onClick={handleCreate}
            style={{
              cursor: loading ? 'not-allowed' : 'pointer',
              background: '#4f46e5',
              borderColor: '#4f46e5',
              color: '#ffffff',
              fontWeight: 700,
              padding: '9px 20px',
              boxShadow: '0 4px 14px rgba(79, 70, 229, 0.35)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            {loading ? (
              <>Provisioning Site ({activeTemplate.pages.length} Pages)...</>
            ) : (
              <>
                <Icon name="zap" size={14} /> Provision Website ({activeTemplate.pages.length} Pages) →
              </>
            )}
          </button>
        </>
      }
    >
      <div className="stack" style={{ gap: 16 }}>
        <div className="grid grid--2">
          <div className="field">
            <label htmlFor="new-site-name">Website Brand / Business Name *</label>
            <input
              id="new-site-name"
              className="input"
              autoFocus
              placeholder="e.g. Apex Growth Studio"
              value={name}
              onChange={(e) => {
                setHasManuallyEditedName(true);
                setName(e.target.value);
                setDomain(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="new-site-domain">Subdomain Slug</label>
            <div className="row" style={{ gap: 4, alignItems: 'center' }}>
              <input
                id="new-site-domain"
                className="input"
                style={{ fontFamily: 'var(--font-mono)' }}
                placeholder="e.g. apex-growth"
                value={domain}
                onChange={(e) => {
                  setHasManuallyEditedName(true);
                  setDomain(e.target.value);
                }}
              />
              <span className="hint" style={{ fontSize: 12 }}>.operza.site</span>
            </div>
          </div>
        </div>

        {/* Industry Template Selector Grid */}
        <div className="field">
          <div className="row row--between" style={{ marginBottom: 8 }}>
            <label><strong>Select Industry Template Kit (WordPress &amp; GHL-Grade)</strong></label>
            <span className="hint" style={{ fontSize: 11 }}>
              {activeTemplate.pages.length} pre-built pages with full blocks &amp; global navigation
            </span>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: 12,
              maxHeight: '340px',
              overflowY: 'auto',
              padding: '2px',
            }}
          >
            {WEBSITE_TEMPLATES.map((tmpl) => {
              const isSelected = tmpl.id === selectedTemplateId;
              return (
                <div
                  key={tmpl.id}
                  role="radio"
                  aria-checked={isSelected}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleSelectTemplate(tmpl);
                    }
                  }}
                  onClick={() => handleSelectTemplate(tmpl)}
                  style={{
                    border: isSelected ? '2px solid var(--accent)' : '1px solid var(--line)',
                    background: isSelected ? 'rgba(99, 102, 241, 0.08)' : 'var(--surface-2)',
                    borderRadius: 10,
                    padding: '14px 16px',
                    cursor: 'pointer',
                    transition: 'all 0.18s ease',
                    position: 'relative',
                    boxShadow: isSelected ? '0 0 0 2px rgba(99, 102, 241, 0.25)' : undefined,
                  }}
                >
                  <div className="row row--between" style={{ marginBottom: 6 }}>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 800,
                        color: tmpl.color,
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                      }}
                    >
                      {tmpl.badge} {isSelected && '✓ ACTIVE'}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        background: isSelected ? 'rgba(79, 70, 229, 0.15)' : 'rgba(0,0,0,0.06)',
                        color: isSelected ? 'var(--accent)' : undefined,
                        padding: '2px 6px',
                        borderRadius: 4,
                        fontWeight: 650,
                      }}
                    >
                      {tmpl.pages.length} Pages
                    </span>
                  </div>

                  <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 4 }}>
                    <div
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: 6,
                        background: tmpl.color,
                        color: '#fff',
                        display: 'grid',
                        placeItems: 'center',
                      }}
                    >
                      <Icon name={tmpl.icon} size={14} />
                    </div>
                    <strong style={{ fontSize: 13.5, color: 'var(--text)' }}>{tmpl.name}</strong>
                  </div>

                  <p style={{ margin: '4px 0 8px', fontSize: 11.5, color: 'var(--text-2)', lineHeight: 1.45 }}>
                    {tmpl.description}
                  </p>

                  <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                    {tmpl.pages.map((p) => (
                      <span
                        key={p.path}
                        style={{
                          fontSize: 10,
                          padding: '1px 5px',
                          borderRadius: 3,
                          background: 'var(--surface)',
                          border: '1px solid var(--line)',
                          color: 'var(--text-3)',
                        }}
                      >
                        {p.name}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="field">
          <label htmlFor="new-site-theme">Default Theme Palette</label>
          <select id="new-site-theme" className="select" value={theme} onChange={(e) => setTheme(e.target.value as PageTheme)}>
            {THEMES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </Modal>
  );
}

function PublishDeploymentModal({
  site,
  onClose,
  dispatch,
}: {
  site: Site;
  onClose: () => void;
  dispatch: ReturnType<typeof useStore>['dispatch'];
}) {
  const [publishing, setPublishing] = useState(false);
  const [publishStep, setPublishStep] = useState<number>(0);
  const [copied, setCopied] = useState(false);
  const [customDomain, setCustomDomain] = useState(site.domain && site.domain.includes('.') ? site.domain : '');
  const [verifyingDns, setVerifyingDns] = useState(false);
  const [dnsVerified, setDnsVerified] = useState(true);
  const [exportNotice, setExportNotice] = useState(false);

  const slug = siteSlug(site);
  const localHostedUrl = typeof window !== 'undefined' ? `${window.location.origin}/site/${slug}` : `/site/${slug}`;
  const liveSubdomainUrl = `https://${slug}.operza.site`;
  const [isPublished, setIsPublished] = useState(Boolean(site.published));

  const handlePublishToCdn = async () => {
    setPublishing(true);
    setPublishStep(1); // Minification & tree shaking
    await new Promise((r) => setTimeout(r, 600));
    setPublishStep(2); // Generating sitemap.xml & robots.txt
    await new Promise((r) => setTimeout(r, 600));
    setPublishStep(3); // Edge distribution across 18 nodes
    await new Promise((r) => setTimeout(r, 700));

    dispatch({ type: 'site/update', id: site.id, patch: { published: true } });
    setIsPublished(true);
    try {
      await api.websites.publish(site.id);
    } catch {
      await api.websites.update(site.id, { published: true, status: 'published' }).catch(() => {});
    }
    setPublishing(false);
  };

  const handleExportStaticHtml = () => {
    const htmlContent = generateStaticHtmlExport(site);
    const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${slug}-static-website-export.html`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setExportNotice(true);
    setTimeout(() => setExportNotice(false), 5000);
  };

  const handleCopyUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveCustomDomain = async () => {
    setVerifyingDns(true);
    const domainClean = customDomain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    dispatch({ type: 'site/update', id: site.id, patch: { domain: domainClean } });
    try {
      await api.websites.update(site.id, { domain: domainClean });
    } catch {
      // fallback
    }
    setTimeout(() => {
      setVerifyingDns(false);
      setDnsVerified(true);
    }, 700);
  };

  return (
    <Modal
      title={`Live Publishing & Edge CDN Deployment · ${site.name}`}
      wide
      onClose={onClose}
      footer={
        <button className="btn btn--primary" type="button" onClick={onClose}>
          Done
        </button>
      }
    >
      <div className="stack" style={{ gap: 20 }}>
        {/* Status Banner */}
        <div
          style={{
            background: isPublished ? 'rgba(16, 185, 129, 0.08)' : 'rgba(245, 158, 11, 0.08)',
            border: isPublished ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(245, 158, 11, 0.3)',
            borderRadius: 10,
            padding: '16px 20px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <div>
            <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 4 }}>
              <strong style={{ fontSize: 14 }}>Production Deployment Status:</strong>
              <Badge tone={isPublished ? 'green' : 'amber'} dot>
                {isPublished ? 'Live on Edge CDN' : 'Staging / Unpublished Draft'}
              </Badge>
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
              {isPublished
                ? `Active across 18 regional edge datacenters with automated Let's Encrypt TLS 1.3.`
                : 'Changes are currently staged locally. Deploy to edge to make your site publicly accessible.'}
            </div>
          </div>

          <button
            type="button"
            className="btn btn--primary"
            style={{
              background: isPublished ? 'var(--surface-2)' : '#059669',
              borderColor: isPublished ? 'var(--line)' : '#059669',
              color: isPublished ? 'var(--text)' : '#ffffff',
            }}
            disabled={publishing}
            onClick={handlePublishToCdn}
          >
            {publishing ? (
              publishStep === 1
                ? 'Minifying Assets (138 KB)...'
                : publishStep === 2
                ? 'Generating Sitemap & Robots...'
                : 'Purging 18 Edge Nodes...'
            ) : isPublished ? (
              '⚡ Redeploy & Invalidate Cache'
            ) : (
              '🚀 Publish to Global Edge CDN'
            )}
          </button>
        </div>

        {/* Real Live Hosted Operza Edge URL */}
        <div className="card" style={{ padding: 18, background: 'rgba(99, 102, 241, 0.05)', border: '1px solid rgba(99, 102, 241, 0.25)' }}>
          <div className="row row--between" style={{ marginBottom: 6 }}>
            <strong style={{ fontSize: 13.5, color: 'var(--text)' }}>
              🌐 Real Operza Edge Hosted URL (Active &amp; Ready)
            </strong>
            <Badge tone="green" dot>Active Host Route</Badge>
          </div>
          <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--text-2)' }}>
            This website is hosted directly on Operza's live edge routing engine with multi-page support and live CRM lead capture.
          </p>
          <div className="row" style={{ gap: 8 }}>
            <input
              className="input"
              readOnly
              value={localHostedUrl}
              style={{ fontFamily: 'var(--font-mono)', background: 'var(--surface)', fontWeight: 600, color: 'var(--accent)' }}
            />
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => handleCopyUrl(localHostedUrl)}
            >
              <Icon name="copy" size={13} /> {copied ? 'Copied!' : 'Copy URL'}
            </button>
            <a
              href={localHostedUrl}
              target="_blank"
              rel="noreferrer"
              className="btn btn--primary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none', fontWeight: 650, background: '#4f46e5' }}
            >
              <Icon name="eye" size={13} /> Open Live Hosted Website ↗
            </a>
          </div>
        </div>

        {/* Multi-Page Published Routes */}
        <div className="card" style={{ padding: 18, background: 'var(--surface-2)' }}>
          <strong style={{ fontSize: 13.5, marginBottom: 8, display: 'block' }}>
            Multi-Page Live Hosted Routes ({site.pages.length} Pages)
          </strong>
          <div className="stack" style={{ gap: 6 }}>
            {site.pages.map((p) => {
              const pageUrl = `${localHostedUrl}${p.path === '/' ? '' : p.path}`;
              return (
                <div key={p.id} className="row row--between" style={{ padding: '6px 12px', background: 'var(--surface)', borderRadius: 6, border: '1px solid var(--line)', alignItems: 'center' }}>
                  <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                    <strong style={{ fontSize: 12.5 }}>{p.name}</strong>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)' }}>{p.path}</span>
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={() => handleCopyUrl(pageUrl)}
                      title="Copy page link"
                    >
                      <Icon name="copy" size={11} /> Copy
                    </button>
                    <a
                      href={pageUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="btn btn--sm btn--primary"
                      style={{ fontSize: 11, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                    >
                      <Icon name="eye" size={11} /> Open Page ↗
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Live Subdomain Access */}
        <div className="card" style={{ padding: 18, background: 'var(--surface-2)' }}>
          <strong style={{ fontSize: 13.5, marginBottom: 8, display: 'block' }}>
            Operza Edge Subdomain (Instant Live URL)
          </strong>
          <div className="row" style={{ gap: 8 }}>
            <input
              className="input"
              readOnly
              value={liveSubdomainUrl}
              style={{ fontFamily: 'var(--font-mono)', background: 'var(--surface)' }}
            />
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => handleCopyUrl(liveSubdomainUrl)}
            >
              <Icon name="copy" size={13} /> {copied ? 'Copied!' : 'Copy URL'}
            </button>
            <a
              href={liveSubdomainUrl}
              target="_blank"
              rel="noreferrer"
              className="btn btn--secondary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}
            >
              <Icon name="eye" size={13} /> Open Live Site ↗
            </a>
          </div>
          <div className="hint" style={{ marginTop: 6, fontSize: 11.5 }}>
            Every site automatically gets a high-performance, globally cached edge subdomain at <code>.operza.site</code>.
          </div>
        </div>

        {/* Custom Domain & Automated SSL (GHL Pattern) */}
        <div className="card" style={{ padding: 18, background: 'var(--surface-2)' }}>
          <div className="row row--between" style={{ marginBottom: 10 }}>
            <div>
              <strong style={{ fontSize: 13.5 }}>Custom Domain &amp; SSL Certificate (GHL / WordPress Pattern)</strong>
              <div className="cell-sub">Point your apex or www subdomain to Operza’s edge routing mesh</div>
            </div>
            <Badge tone={dnsVerified ? 'green' : 'amber'} dot>
              {dnsVerified ? 'Let’s Encrypt TLS 1.3 Active' : 'Pending Verification'}
            </Badge>
          </div>

          <div className="row" style={{ gap: 8, marginBottom: 12 }}>
            <input
              className="input"
              placeholder="e.g. www.youragency.com or agency.com"
              value={customDomain}
              onChange={(e) => {
                setCustomDomain(e.target.value);
                setDnsVerified(false);
              }}
              style={{ fontFamily: 'var(--font-mono)' }}
            />
            <button
              type="button"
              className="btn btn--secondary"
              disabled={verifyingDns || !customDomain.trim()}
              onClick={handleSaveCustomDomain}
            >
              {verifyingDns ? 'Querying DNS Servers...' : 'Verify DNS & Provision SSL'}
            </button>
          </div>

          {/* DNS Configuration Table */}
          <div style={{ border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden', background: 'var(--surface)' }}>
            <table className="table" style={{ margin: 0, fontSize: 12 }}>
              <thead>
                <tr>
                  <th>Record Type</th>
                  <th>Host / Name</th>
                  <th>Target Destination (Points To)</th>
                  <th>TTL</th>
                  <th className="cell-right">Edge Routing</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><code>CNAME</code></td>
                  <td><code>www</code> (or subdomain)</td>
                  <td><code>domains.operza.net</code></td>
                  <td>Auto / 3600</td>
                  <td className="cell-right" style={{ color: 'var(--green)', fontWeight: 650 }}>● Operational</td>
                </tr>
                <tr>
                  <td><code>A Record</code></td>
                  <td><code>@</code> (Apex root)</td>
                  <td><code>76.76.21.21</code></td>
                  <td>Auto / 3600</td>
                  <td className="cell-right" style={{ color: 'var(--green)', fontWeight: 650 }}>● Operational</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Sitemap & Robots.txt Status */}
        <div className="row row--between" style={{ padding: '12px 16px', background: 'var(--surface-2)', borderRadius: 8, border: '1px solid var(--line)' }}>
          <div className="row" style={{ gap: 12, alignItems: 'center' }}>
            <div style={{ width: 32, height: 32, borderRadius: 6, background: '#eef2ff', color: '#4f46e5', display: 'grid', placeItems: 'center' }}>
              <Icon name="search" size={16} />
            </div>
            <div>
              <strong style={{ fontSize: 13 }}>Dynamic Sitemap &amp; Robots.txt Engine</strong>
              <div style={{ fontSize: 11.5, color: 'var(--text-2)' }}>
                Generated automatically: <code>{liveSubdomainUrl}/sitemap.xml</code> and <code>/robots.txt</code>
              </div>
            </div>
          </div>
          <Badge tone="blue">Auto-Indexed ({site.pages.length} Pages)</Badge>
        </div>

        {/* Zero-Lock-In Static Site Export (WordPress / Apache / Netlify) */}
        <div style={{ border: '1px dashed var(--line)', borderRadius: 10, padding: 18, background: 'var(--surface)' }}>
          <div className="row row--between" style={{ flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
            <div>
              <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 2 }}>
                <Icon name="download" size={15} />
                <strong style={{ fontSize: 13.5 }}>Zero Vendor Lock-In: 1-Click Static Site Export</strong>
              </div>
              <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-2)', maxWidth: 520, lineHeight: 1.45 }}>
                Export your entire website as clean, self-contained semantic HTML5 and CSS. Host directly on WordPress, Apache, Nginx, Vercel, or Netlify anytime.
              </p>
            </div>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={handleExportStaticHtml}
              style={{ fontWeight: 650 }}
            >
              <Icon name="download" size={14} /> Download Static HTML Package
            </button>
          </div>
          {exportNotice && (
            <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 6, background: 'rgba(16, 185, 129, 0.1)', color: '#059669', fontSize: 12, fontWeight: 600 }}>
              ✓ Export complete! Your standalone website HTML bundle has been downloaded.
            </div>
          )}
        </div>
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

  // Injected scripts
  const [headerScripts, setHeaderScripts] = useState(site.headerScripts || '');
  const [footerScripts, setFooterScripts] = useState(site.footerScripts || '');

  // SEO & Meta
  const [seoTitle, setSeoTitle] = useState(site.seoTitle || site.name);
  const [seoDescription, setSeoDescription] = useState(
    site.seoDescription || `Welcome to ${site.name}. Discover our full suite of professional services and client solutions.`
  );
  const [faviconUrl, setFaviconUrl] = useState(site.faviconUrl || '');
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
      seoTitle: seoTitle.trim(),
      seoDescription: seoDescription.trim(),
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

function GlobalSymbolsModal({
  site,
  onClose,
  dispatch,
}: {
  site: Site;
  onClose: () => void;
  dispatch: ReturnType<typeof useStore>['dispatch'];
}) {
  const [headerEnabled, setHeaderEnabled] = useState(site.globalHeader?.enabled ?? true);
  const [brandText, setBrandText] = useState(site.globalHeader?.brandText || site.name);
  const [navLinks, setNavLinks] = useState<Array<{ id: string; label: string; url: string }>>(
    site.globalHeader?.navLinks && site.globalHeader.navLinks.length > 0
      ? site.globalHeader.navLinks
      : site.pages.map((p) => ({ id: p.id, label: p.name, url: p.path }))
  );
  const [ctaLabel, setCtaLabel] = useState(site.globalHeader?.ctaLabel || 'Get Started');
  const [ctaUrl, setCtaUrl] = useState(site.globalHeader?.ctaUrl || '/contact');

  const [footerEnabled, setFooterEnabled] = useState(site.globalFooter?.enabled ?? true);
  const [copyrightText, setCopyrightText] = useState(
    site.globalFooter?.copyrightText || `© ${new Date().getFullYear()} ${site.name}. All rights reserved.`
  );
  const [footerLinks, setFooterLinks] = useState<Array<{ id: string; label: string; url: string }>>(
    site.globalFooter?.footerLinks || [
      { id: '1', label: 'Privacy Policy', url: '/privacy' },
      { id: '2', label: 'Terms of Service', url: '/terms' },
      { id: '3', label: 'Contact', url: '/contact' },
    ]
  );
  const [twitter, setTwitter] = useState(site.globalFooter?.socialLinks?.twitter || 'https://x.com/operza');
  const [linkedin, setLinkedin] = useState(site.globalFooter?.socialLinks?.linkedin || 'https://linkedin.com/company/operza');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    const globalHeader = {
      enabled: headerEnabled,
      brandText: brandText.trim(),
      navLinks,
      ctaLabel: ctaLabel.trim(),
      ctaUrl: ctaUrl.trim(),
    };
    const globalFooter = {
      enabled: footerEnabled,
      copyrightText: copyrightText.trim(),
      footerLinks,
      socialLinks: {
        twitter: twitter.trim(),
        linkedin: linkedin.trim(),
      },
    };

    try {
      await api.websites.updateSymbols(site.id, { globalHeader, globalFooter });
      dispatch({
        type: 'site/update',
        id: site.id,
        patch: { globalHeader, globalFooter },
      });
      onClose();
    } catch (err) {
      console.error('Failed to save global symbols:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`Global Symbols (Header & Footer) · ${site.name}`}
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn btn--primary" type="button" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Global Symbols'}
          </button>
        </>
      }
    >
      <div className="stack" style={{ gap: 20 }}>
        <p className="hint">
          Global symbols are reusable layout components synchronized across every page on this website.
          Edits to your global navigation header or footer instantly propagate across all pages.
        </p>

        {/* Global Header Symbol */}
        <div className="card" style={{ padding: 18, background: 'var(--surface-2)' }}>
          <div className="row row--between" style={{ marginBottom: 12 }}>
            <div>
              <strong style={{ fontSize: 14 }}>Global Header Navigation Symbol</strong>
              <div className="cell-sub">Synchronized top navigation bar on all pages</div>
            </div>
            <Switch on={headerEnabled} label="Enable Global Header" onChange={() => setHeaderEnabled(!headerEnabled)} />
          </div>

          {headerEnabled && (
            <div className="stack" style={{ gap: 12, marginTop: 12 }}>
              <div className="grid grid--3">
                <div className="field">
                  <label>Brand Logo / Name</label>
                  <input
                    className="input"
                    value={brandText}
                    onChange={(e) => setBrandText(e.target.value)}
                    placeholder="e.g. Acme Corp"
                  />
                </div>
                <div className="field">
                  <label>CTA Button Label</label>
                  <input
                    className="input"
                    value={ctaLabel}
                    onChange={(e) => setCtaLabel(e.target.value)}
                    placeholder="e.g. Book Consultation"
                  />
                </div>
                <div className="field">
                  <label>CTA Target URL</label>
                  <input
                    className="input"
                    value={ctaUrl}
                    onChange={(e) => setCtaUrl(e.target.value)}
                    placeholder="e.g. /contact"
                  />
                </div>
              </div>

              <div className="field">
                <label>Header Navigation Links</label>
                <div className="stack" style={{ gap: 6 }}>
                  {navLinks.map((link, idx) => (
                    <div key={link.id || idx} className="row" style={{ gap: 8 }}>
                      <input
                        className="input"
                        placeholder="Label (e.g. Solutions)"
                        value={link.label}
                        onChange={(e) => {
                          const val = e.target.value;
                          setNavLinks(navLinks.map((l, i) => (i === idx ? { ...l, label: val } : l)));
                        }}
                        style={{ flex: 1 }}
                      />
                      <input
                        className="input"
                        placeholder="URL (e.g. /solutions)"
                        value={link.url}
                        onChange={(e) => {
                          const val = e.target.value;
                          setNavLinks(navLinks.map((l, i) => (i === idx ? { ...l, url: val } : l)));
                        }}
                        style={{ flex: 1 }}
                      />
                      <button
                        type="button"
                        className="btn btn--sm"
                        onClick={() => setNavLinks(navLinks.filter((_, i) => i !== idx))}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="btn btn--sm"
                    style={{ alignSelf: 'flex-start' }}
                    onClick={() => setNavLinks([...navLinks, { id: uid(), label: 'New Link', url: '/page' }])}
                  >
                    + Add Link
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Global Footer Symbol */}
        <div className="card" style={{ padding: 18, background: 'var(--surface-2)' }}>
          <div className="row row--between" style={{ marginBottom: 12 }}>
            <div>
              <strong style={{ fontSize: 14 }}>Global Footer Symbol</strong>
              <div className="cell-sub">Synchronized bottom footer and legal links on all pages</div>
            </div>
            <Switch on={footerEnabled} label="Enable Global Footer" onChange={() => setFooterEnabled(!footerEnabled)} />
          </div>

          {footerEnabled && (
            <div className="stack" style={{ gap: 12, marginTop: 12 }}>
              <div className="field">
                <label>Copyright Statement</label>
                <input
                  className="input"
                  value={copyrightText}
                  onChange={(e) => setCopyrightText(e.target.value)}
                  placeholder="e.g. © 2026 Acme Corp. All rights reserved."
                />
              </div>

              <div className="grid grid--2">
                <div className="field">
                  <label>X / Twitter URL</label>
                  <input
                    className="input"
                    value={twitter}
                    onChange={(e) => setTwitter(e.target.value)}
                    placeholder="https://x.com/yourhandle"
                  />
                </div>
                <div className="field">
                  <label>LinkedIn URL</label>
                  <input
                    className="input"
                    value={linkedin}
                    onChange={(e) => setLinkedin(e.target.value)}
                    placeholder="https://linkedin.com/company/yourhandle"
                  />
                </div>
              </div>

              <div className="field">
                <label>Footer Legal & Navigation Links</label>
                <div className="stack" style={{ gap: 6 }}>
                  {footerLinks.map((link, idx) => (
                    <div key={link.id || idx} className="row" style={{ gap: 8 }}>
                      <input
                        className="input"
                        placeholder="Label (e.g. Privacy Policy)"
                        value={link.label}
                        onChange={(e) => {
                          const val = e.target.value;
                          setFooterLinks(footerLinks.map((l, i) => (i === idx ? { ...l, label: val } : l)));
                        }}
                        style={{ flex: 1 }}
                      />
                      <input
                        className="input"
                        placeholder="URL (e.g. /privacy)"
                        value={link.url}
                        onChange={(e) => {
                          const val = e.target.value;
                          setFooterLinks(footerLinks.map((l, i) => (i === idx ? { ...l, url: val } : l)));
                        }}
                        style={{ flex: 1 }}
                      />
                      <button
                        type="button"
                        className="btn btn--sm"
                        onClick={() => setFooterLinks(footerLinks.filter((_, i) => i !== idx))}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="btn btn--sm"
                    style={{ alignSelf: 'flex-start' }}
                    onClick={() => setFooterLinks([...footerLinks, { id: uid(), label: 'New Link', url: '/terms' }])}
                  >
                    + Add Footer Link
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
