import { useState } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Badge, EmptyState, PageHeader, StatCard, Switch } from '../components/ui';
import { currency, num, pct } from '../lib/format';
import { uid, useStore } from '../lib/store';
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
    <div className="content">
      <PageHeader
        title="Payment Links"
        subtitle="Shareable checkouts that bundle products for one-time or recurring payments."
        actions={
          <button className="btn btn--primary" onClick={() => setCreating(true)}>
            <Icon name="plus" size={16} /> New payment link
          </button>
        }
      />

      <div className="grid grid--4" style={{ marginBottom: 16 }}>
        <StatCard label="Links" value={num(state.paymentLinks.length)} icon={<Icon name="link" size={15} />} meta={`${active} active`} />
        <StatCard label="Visits" value={num(visits)} icon={<Icon name="eye" size={15} />} meta="all links" />
        <StatCard label="Conversions" value={num(conversions)} icon={<Icon name="check" size={15} />} meta="completed checkouts" />
        <StatCard label="Conversion rate" value={pct(conversions, visits)} icon={<Icon name="chart" size={15} />} meta="visits → paid" />
      </div>

      {state.paymentLinks.length === 0 ? (
        <div className="card">
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
        <div className="grid grid--2">
          {state.paymentLinks.map((link) => {
            const products = state.products.filter((p) => link.productIds.includes(p.id));
            const rate = pct(link.conversions, link.visits);
            return (
              <div className="card" key={link.id}>
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
                      onChange={() => dispatch({ type: 'paymentLink/toggle', id: link.id })}
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
                      onClick={() => dispatch({ type: 'paymentLink/visit', id: link.id })}
                    >
                      <Icon name="eye" size={12} /> Test
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {creating && <NewLink onClose={() => setCreating(false)} />}
    </div>
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

  const save = () => {
    if (!canSave) return;
    dispatch({
      type: 'paymentLink/add',
      link: {
        id: uid('pl'),
        name: name.trim(),
        productIds: selected,
        amount,
        slug: slug.trim(),
        visits: 0,
        conversions: 0,
        active: true,
        createdAt: new Date().toISOString(),
      },
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
