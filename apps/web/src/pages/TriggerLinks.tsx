import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { PageHeader, StatCard } from '../components/ui';
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
    <div className="content">
      <PageHeader
        title="Trigger Links"
        subtitle="Short links that fire a workflow whenever someone clicks."
        actions={
          <button className="btn btn--primary" onClick={() => setAdding(true)}>
            <Icon name="plus" size={15} /> New link
          </button>
        }
      />

      <div className="grid grid--4" style={{ marginBottom: 16 }}>
        <StatCard label="Total clicks" value={num(clicks)} icon={<Icon name="link" size={15} />} meta="all links" />
        <StatCard label="Links" value={num(triggerLinks.length)} icon={<Icon name="tag" size={15} />} meta="active triggers" />
        <StatCard label="Top link" value={best?.name ?? '—'} icon={<Icon name="star" size={15} />} meta={`${num(best?.clicks ?? 0)} clicks`} />
        <StatCard
          label="Last click"
          value={triggerLinks[0] ? relative(triggerLinks[0].lastClickAt) : '—'}
          icon={<Icon name="clock" size={15} />}
          meta="most recent"
        />
      </div>

      <div className="card">
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
    </div>
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
