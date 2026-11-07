import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';

import { uid, useStore } from '../lib/store';
import { num, relative } from '../lib/format';
import { api } from '../lib/api';
import type { TriggerLink } from '../lib/types';

export default function TriggerLinks() {
  const { state, dispatch } = useStore();
  const { triggerLinks } = state;
  const [adding, setAdding] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    api.crm.list<TriggerLink>('triggerLinks').then((res) => {
      if (res.data && res.data.length > 0) {
        for (const tl of res.data) {
          if (!triggerLinks.some((x) => x.id === tl.id)) {
            dispatch({ type: 'triggerLink/add', link: tl });
          }
        }
      }
    }).catch(() => { /* dev fallback */ });
  }, []);

  const clicks = triggerLinks.reduce((s, l) => s + l.clicks, 0);
  const best = [...triggerLinks].sort((a, b) => b.clicks - a.clicks)[0];

  const url = (l: TriggerLink) => `${window.location.origin}/api/links/click/${l.slug}`;

  async function copy(l: TriggerLink) {
    try {
      await navigator.clipboard.writeText(url(l));
    } catch {
      /* clipboard unavailable */
    }
    setCopied(l.id);
    window.setTimeout(() => setCopied((cur) => (cur === l.id ? null : cur)), 1600);
  }

  async function handleTestClick(l: TriggerLink) {
    dispatch({ type: 'triggerLink/click', id: l.id });
    try {
      await api.links.click(l.slug, state.contacts[0]?.id);
    } catch { /* dev fallback */ }
  }

  return (
    <main className="operza-dashboard atlas-dashboard">
      <header className="atlas-dashboard__header">
        <div className="atlas-dashboard__heading">
          <div className="atlas-dashboard__breadcrumb">Workspace <span>/</span> Automations &amp; Links</div>
          <h1>Trigger Links &amp; URL Handlers</h1>
        </div>
        <div className="atlas-dashboard__toolbar">
          <button className="atlas-quick-action-button" onClick={() => setAdding(true)}>
            <Icon name="plus" size={13} /> New Link
          </button>
        </div>
      </header>

      <section className="atlas-hero">
        <div className="atlas-eyebrow">AUTOMATION ROUTING LINKS</div>
        <h2>Click-Triggered Workflow Enrollment</h2>
        <p>Shortened tracking links that automatically tag contacts and trigger multi-step automations upon visitor click.</p>
      </section>

      <section className="atlas-kpis" aria-label="Trigger link metrics">
        <article className="operza-kpi atlas-kpi">
          <div className="atlas-kpi__meta">
            <span className="atlas-kpi__label">Total Link Clicks</span>
            <span className="atlas-status atlas-status--healthy">Tracked</span>
          </div>
          <div className="atlas-kpi__value">{num(clicks)}</div>
          <div className="atlas-kpi__note">Verified redirect events</div>
        </article>
        <article className="operza-kpi atlas-kpi">
          <div className="atlas-kpi__meta">
            <span className="atlas-kpi__label">Active Links</span>
            <span className="atlas-status atlas-status--healthy">Live</span>
          </div>
          <div className="atlas-kpi__value">{num(triggerLinks.length)}</div>
          <div className="atlas-kpi__note">Configured handlers</div>
        </article>
        <article className="operza-kpi atlas-kpi">
          <div className="atlas-kpi__meta">
            <span className="atlas-kpi__label">Top Performer</span>
            <span className="atlas-status atlas-status--healthy">Leader</span>
          </div>
          <div className="atlas-kpi__value">{best?.name ?? '—'}</div>
          <div className="atlas-kpi__note">{num(best?.clicks ?? 0)} click events</div>
        </article>
        <article className="operza-kpi atlas-kpi">
          <div className="atlas-kpi__meta">
            <span className="atlas-kpi__label">Most Recent Click</span>
            <span className="atlas-status atlas-status--healthy">Real-Time</span>
          </div>
          <div className="atlas-kpi__value">{triggerLinks[0] ? relative(triggerLinks[0].lastClickAt) : '—'}</div>
          <div className="atlas-kpi__note">Active traffic</div>
        </article>
      </section>

      <div className="card-premium" style={{ marginTop: 22 }}>
        <div className="card__head">
          <div>
            <div className="card__title">All trigger links</div>
            <div className="card__sub">Clicking a link enrolls the contact in the attached workflow</div>
          </div>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>URL</th>
                <th className="cell-right">Clicks</th>
                <th>Last click</th>
                <th style={{ width: 170 }} />
              </tr>
            </thead>
            <tbody>
              {triggerLinks.map((l) => (
                <tr key={l.id}>
                  <td style={{ fontWeight: 600 }}>{l.name}</td>
                  <td>
                    <span className="mono-cell">{url(l)}</span>
                  </td>
                  <td className="cell-right cell-num">{num(l.clicks)}</td>
                  <td className="cell-sub" title={l.lastClickAt}>
                    {relative(l.lastClickAt)}
                  </td>
                  <td className="cell-right">
                    <span className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                      <button type="button" className="btn btn--sm" onClick={() => copy(l)}>
                        <Icon name={copied === l.id ? 'check' : 'copy'} size={13} />
                        {copied === l.id ? 'Copied' : 'Copy'}
                      </button>
                      <button
                        type="button"
                        className="btn btn--sm"
                        onClick={() => handleTestClick(l)}
                      >
                        <Icon name="play" size={13} /> Test
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {adding && <NewLinkModal onClose={() => setAdding(false)} />}
    </main>
  );
}

function NewLinkModal({ onClose }: { onClose: () => void }) {
  const { dispatch } = useStore();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');

  const derived = slug || name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const canSave = name.trim().length > 1 && derived.length > 1;

  async function save() {
    if (!canSave) return;
    const newLink: TriggerLink = {
      id: uid('tl'),
      name: name.trim(),
      slug: derived,
      clicks: 0,
      lastClickAt: new Date().toISOString(),
    };
    try {
      await api.crm.create('triggerLinks', {
        name: newLink.name,
        slug: newLink.slug,
        targetUrl: 'https://operza.io',
        clicks: 0
      });
    } catch { /* dev fallback */ }
    dispatch({
      type: 'triggerLink/add',
      link: newLink,
    });
    onClose();
  }

  return (
    <Modal
      title="New trigger link"
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn--primary" type="button" disabled={!canSave} onClick={save}>
            Create link
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="link-name">Name</label>
        <input
          id="link-name"
          className="input"
          autoFocus
          placeholder="Book a strategy call"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="field" style={{ marginTop: 12 }}>
        <label htmlFor="link-slug">Slug</label>
        <input
          id="link-slug"
          className="input"
          placeholder={name ? name.toLowerCase().replace(/[^a-z0-9]+/g, '-') : 'strategy-call'}
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
        />
        <div className="cell-sub" style={{ marginTop: 4 }}>
          Final URL: {window.location.origin}/api/links/click/{derived || '…'}
        </div>
      </div>
    </Modal>
  );
}
