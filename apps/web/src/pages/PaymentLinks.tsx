import { useState, useEffect } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Badge, EmptyState, Switch } from '../components/ui';
import { currency, num, pct } from '../lib/format';
import { uid, useStore } from '../lib/store';
import { api } from '../lib/api';
import type { PaymentLink } from '../lib/types';

const urlFor = (slug: string) => `${typeof window !== 'undefined' ? window.location.origin : ''}/pay/${slug}`;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export default function PaymentLinks() {
  const { state, dispatch } = useStore();
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    api.crm.list<PaymentLink>('paymentLinks').then((res) => {
      if (res.data && res.data.length > 0) {
        for (const link of res.data) {
          if (!state.paymentLinks.some((x) => x.id === link.id)) {
            dispatch({ type: 'paymentLink/add', link });
          }
        }
      }
    }).catch(() => {});
  }, []);

  const handleToggle = async (link: PaymentLink) => {
    const nextActive = !link.active;
    dispatch({ type: 'paymentLink/toggle', id: link.id });
    try {
      await api.crm.update('paymentLinks', link.id, { active: nextActive });
    } catch { /* dev fallback */ }
  };

  const handleTestVisit = async (link: PaymentLink) => {
    dispatch({ type: 'paymentLink/visit', id: link.id });
    try {
      await api.payments.getPublic(link.slug || link.id);
    } catch { /* dev fallback */ }
  };

  const handleDelete = async (link: PaymentLink) => {
    dispatch({ type: 'paymentLink/delete', id: link.id });
    try {
      await api.crm.delete('paymentLinks', link.id);
    } catch { /* dev fallback */ }
  };

  const visits = state.paymentLinks.reduce((sum, link) => sum + link.visits, 0);
  const conversions = state.paymentLinks.reduce((sum, link) => sum + link.conversions, 0);
  const active = state.paymentLinks.filter((link) => link.active).length;

  const copy = async (link: PaymentLink) => {
    try {
      await navigator.clipboard.writeText(urlFor(link.slug));
      setCopied(link.id);
      window.setTimeout(() => setCopied((current) => (current === link.id ? null : current)), 1600);
    } catch {
      /* clipboard blocked — the URL stays selectable */
    }
  };

  return (
    <main className="operza-dashboard atlas-dashboard">
      <header className="atlas-dashboard__header">
        <div className="atlas-dashboard__heading">
          <div className="atlas-dashboard__breadcrumb">Workspace <span>/</span> Commerce &amp; Checkouts</div>
          <h1>Payment Links</h1>
        </div>
        <div className="atlas-dashboard__toolbar">
          <button className="atlas-quick-action-button" onClick={() => setCreating(true)}>
            <Icon name="plus" size={13} /> New Payment Link
          </button>
        </div>
      </header>

      <section className="atlas-hero">
        <div className="atlas-eyebrow">ONE-CLICK CHECKOUTS</div>
        <h2>Direct Product Payment Links</h2>
        <p>Generate frictionless checkout pages for social selling, email invoices, and custom service proposals.</p>
      </section>

      <section className="atlas-kpis" aria-label="Payment link metrics">
        <article className="operza-kpi atlas-kpi">
          <div className="atlas-kpi__meta">
            <span className="atlas-kpi__label">Payment Links</span>
            <span className="atlas-status atlas-status--healthy">Active</span>
          </div>
          <div className="atlas-kpi__value">{num(state.paymentLinks.length)}</div>
          <div className="atlas-kpi__note">{active} accepting payments</div>
        </article>
        <article className="operza-kpi atlas-kpi">
          <div className="atlas-kpi__meta">
            <span className="atlas-kpi__label">Checkout Visits</span>
            <span className="atlas-status atlas-status--healthy">Tracked</span>
          </div>
          <div className="atlas-kpi__value">{num(visits)}</div>
          <div className="atlas-kpi__note">Unique visitor pageviews</div>
        </article>
        <article className="operza-kpi atlas-kpi">
          <div className="atlas-kpi__meta">
            <span className="atlas-kpi__label">Conversions</span>
            <span className="atlas-status atlas-status--healthy">Paid</span>
          </div>
          <div className="atlas-kpi__value">{num(conversions)}</div>
          <div className="atlas-kpi__note">Completed transactions</div>
        </article>
        <article className="operza-kpi atlas-kpi">
          <div className="atlas-kpi__meta">
            <span className="atlas-kpi__label">Conversion Rate</span>
            <span className="atlas-status atlas-status--healthy">Optimized</span>
          </div>
          <div className="atlas-kpi__value">{pct(conversions, visits)}</div>
          <div className="atlas-kpi__note">Visits into paid revenue</div>
        </article>
      </section>

      {state.paymentLinks.length === 0 ? (
        <div className="card-premium" style={{ marginTop: 22 }}>
          <EmptyState
            icon={<Icon name="link" size={22} />}
            title="No payment links"
            text="Bundle a few products into a checkout you can share anywhere."
            action={
              <button className="btn btn--sm" onClick={() => setCreating(true)}>
                New payment link
              </button>
            }
          />
        </div>
      ) : (
        <div className="grid grid--2" style={{ marginTop: 22 }}>
          {state.paymentLinks.map((link) => {
            const products = state.products.filter((p) => link.productIds.includes(p.id));
            const rate = pct(link.conversions, link.visits);
            return (
              <div className="card-premium" key={link.id}>
                <div className="card__head">
                  <div style={{ minWidth: 0 }}>
                    <div className="card__title">{link.name}</div>
                    <div className="card__sub">{link.active ? 'Accepting payments' : 'Paused — checkout disabled'}</div>
                  </div>
                  <div className="card__actions">
                    <Badge tone={link.active ? 'green' : 'default'} dot>
                      {link.active ? 'Active' : 'Paused'}
                    </Badge>
                    <Switch
                      on={link.active}
                      label={`Toggle ${link.name}`}
                      onChange={() => handleToggle(link)}
                    />
                  </div>
                </div>
                <div className="card__body stack" style={{ gap: 12 }}>
                  <div className="row row--between">
                    <span className="hint">Checkout total</span>
                    <strong style={{ fontSize: 18 }}>{currency(link.amount)}</strong>
                  </div>
                  <div className="row" style={{ gap: 5, flexWrap: 'wrap' }}>
                    {products.map((p) => (
                      <span className="tag" key={p.id}>
                        {p.name}
                      </span>
                    ))}
                  </div>
                  <div className="link-url">
                    <span className="mono-cell">{urlFor(link.slug)}</span>
                    <a href={urlFor(link.slug)} target="_blank" rel="noopener noreferrer" className="btn btn--sm" style={{ textDecoration: 'none' }}>
                      <Icon name="link" size={12} /> Open
                    </a>
                    <button type="button" className="btn btn--sm" onClick={() => copy(link)}>
                      <Icon name={copied === link.id ? 'check' : 'copy'} size={12} />
                      {copied === link.id ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
                    <span className="cell-sub">
                      <strong>{num(link.visits)}</strong> visits
                    </span>
                    <span className="cell-sub">
                      <strong>{num(link.conversions)}</strong> conversions
                    </span>
                    <span className="cell-sub">
                      <strong>{rate}</strong> rate
                    </span>
                    <span className="spacer" />
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={() => handleTestVisit(link)}
                    >
                      <Icon name="eye" size={12} /> Test
                    </button>
                    <button
                      type="button"
                      className="btn btn--sm"
                      aria-label={`Delete ${link.name}`}
                      title={`Delete ${link.name}`}
                      onClick={() => handleDelete(link)}
                    >
                      <Icon name="trash" size={12} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {creating && <NewLink onClose={() => setCreating(false)} />}
    </main>
  );
}

function NewLink({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStore();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  const amount = state.products
    .filter((p) => selected.includes(p.id))
    .reduce((sum, p) => sum + p.price, 0);
  const canSave = name.trim().length > 1 && slug.trim().length > 1 && selected.length > 0;

  const toggleProduct = (id: string) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );

  const save = async () => {
    if (!canSave) return;
    const newLink: PaymentLink = {
      id: uid('pl'),
      name: name.trim(),
      productIds: selected,
      amount,
      slug: slug.trim(),
      visits: 0,
      conversions: 0,
      active: true,
      createdAt: new Date().toISOString(),
    };
    try {
      await api.crm.create('paymentLinks', newLink);
    } catch { /* dev fallback */ }
    dispatch({
      type: 'paymentLink/add',
      link: newLink,
    });
    onClose();
  };

  return (
    <Modal
      title="New payment link"
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
          placeholder="Growth package checkout"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (!slugTouched) setSlug(slugify(e.target.value));
          }}
        />
      </div>
      <div className="field" style={{ marginTop: 12 }}>
        <label htmlFor="link-slug">URL slug</label>
        <input
          id="link-slug"
          className="input"
          placeholder="growth-package"
          value={slug}
          onChange={(e) => {
            setSlugTouched(true);
            setSlug(slugify(e.target.value));
          }}
        />
        <div className="cell-sub" style={{ marginTop: 4 }}>
          {slug ? urlFor(slug) : 'go.operza.test/l/…'}
        </div>
      </div>
      <div className="field" style={{ marginTop: 12 }}>
        <label>Products</label>
        <div className="stack" style={{ gap: 8 }}>
          {state.products.map((p) => (
            <label className="checkbox" key={p.id}>
              <input
                type="checkbox"
                checked={selected.includes(p.id)}
                onChange={() => toggleProduct(p.id)}
              />
              <span style={{ flex: 1 }}>{p.name}</span>
              <span className="cell-sub">{currency(p.price)}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="row row--between" style={{ marginTop: 14 }}>
        <span className="hint">Checkout total</span>
        <strong style={{ fontSize: 16 }}>{currency(amount)}</strong>
      </div>
    </Modal>
  );
}
