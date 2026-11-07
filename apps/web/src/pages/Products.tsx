import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Badge, Switch } from '../components/ui';
import { currency, num } from '../lib/format';
import { uid, useStore } from '../lib/store';
import { api } from '../lib/api';
import type { Product } from '../lib/types';

export default function Products() {
  const { state, dispatch } = useStore();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);

  useEffect(() => {
    api.crm.list<Product>('products').then((res) => {
      if (res.data && res.data.length > 0) {
        for (const p of res.data) {
          if (!state.products.some((x) => x.id === p.id)) {
            dispatch({ type: 'product/add', product: p });
          }
        }
      }
    }).catch(() => { /* dev fallback */ });
  }, []);

  const active = state.products.filter((p) => p.active);
  const recurring = active.filter((p) => p.kind === 'recurring');
  const mrr = recurring.reduce((sum, p) => sum + p.price, 0);
  const average = state.products.length
    ? Math.round(state.products.reduce((sum, p) => sum + p.price, 0) / state.products.length)
    : 0;

  const linkedCount = (id: string) =>
    state.paymentLinks.filter((link) => link.productIds.includes(id)).length;

  return (
    <main className="operza-dashboard atlas-dashboard">
      <header className="atlas-dashboard__header">
        <div className="atlas-dashboard__heading">
          <div className="atlas-dashboard__breadcrumb">Workspace <span>/</span> Commerce &amp; Catalog</div>
          <h1>Products &amp; Price Book</h1>
        </div>
        <div className="atlas-dashboard__toolbar">
          <button className="atlas-quick-action-button" onClick={() => setCreating(true)}>
            <Icon name="plus" size={13} /> New Product
          </button>
        </div>
      </header>

      <section className="atlas-hero">
        <div className="atlas-eyebrow">COMMERCE &amp; INVENTORY</div>
        <h2>Enterprise Product Catalog &amp; Subscriptions</h2>
        <p>Define one-time items, recurring subscriptions, SKUs, and attach products directly to checkout funnels and payment links.</p>
      </section>

      <section className="atlas-kpis" aria-label="Product metrics">
        <article className="operza-kpi atlas-kpi">
          <div className="atlas-kpi__meta">
            <span className="atlas-kpi__label">Catalog Items</span>
            <span className="atlas-status atlas-status--healthy">Active</span>
          </div>
          <div className="atlas-kpi__value">{num(state.products.length)}</div>
          <div className="atlas-kpi__note">Price book entries</div>
        </article>
        <article className="operza-kpi atlas-kpi">
          <div className="atlas-kpi__meta">
            <span className="atlas-kpi__label">Active Sellable</span>
            <span className="atlas-status atlas-status--healthy">Live</span>
          </div>
          <div className="atlas-kpi__value">{num(active.length)}</div>
          <div className="atlas-kpi__note">Available in checkout</div>
        </article>
        <article className="operza-kpi atlas-kpi">
          <div className="atlas-kpi__meta">
            <span className="atlas-kpi__label">Recurring Potential MRR</span>
            <span className="atlas-status atlas-status--healthy">Growing</span>
          </div>
          <div className="atlas-kpi__value">{currency(mrr)}</div>
          <div className="atlas-kpi__note">{recurring.length} recurring plans</div>
        </article>
        <article className="operza-kpi atlas-kpi">
          <div className="atlas-kpi__meta">
            <span className="atlas-kpi__label">Average Unit Price</span>
            <span className="atlas-status atlas-status--healthy">Computed</span>
          </div>
          <div className="atlas-kpi__value">{currency(average)}</div>
          <div className="atlas-kpi__note">Blended catalog price</div>
        </article>
      </section>

      <div className="card-premium" style={{ marginTop: 22 }}>
        <div className="card__head">
          <div>
            <div className="card__title">Price book</div>
            <div className="card__sub">{state.products.length} items</div>
          </div>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Type</th>
                <th className="cell-right">Price</th>
                <th>Used in</th>
                <th style={{ width: 72 }}>Active</th>
                <th style={{ width: 52 }} />
              </tr>
            </thead>
            <tbody>
              {state.products.map((p) => {
                const links = linkedCount(p.id);
                return (
                  <tr key={p.id}>
                    <td>
                      <span className="row" style={{ gap: 10 }}>
                        <span
                          className="avatar avatar--sm avatar--square"
                          style={{
                            background: p.kind === 'recurring' ? 'var(--violet-soft)' : 'var(--accent-soft)',
                            color: p.kind === 'recurring' ? 'var(--violet)' : 'var(--accent)',
                          }}
                        >
                          <Icon name={p.kind === 'recurring' ? 'refresh' : 'dollar'} size={13} />
                        </span>
                        <span style={{ fontWeight: 600 }}>{p.name}</span>
                      </span>
                    </td>
                    <td>
                      <Badge tone={p.kind === 'recurring' ? 'violet' : 'blue'}>
                        {p.kind === 'recurring' ? 'Recurring' : 'One-time'}
                      </Badge>
                    </td>
                    <td className="cell-right cell-num">{currency(p.price)}</td>
                    <td className="cell-sub">{links === 0 ? '—' : `${links} payment link${links === 1 ? '' : 's'}`}</td>
                    <td>
                      <Switch
                        on={p.active}
                        label={`Toggle ${p.name}`}
                        onChange={() => dispatch({ type: 'product/toggle', id: p.id })}
                      />
                    </td>
                    <td className="cell-right">
                      <button className="icon-btn" aria-label={`Edit ${p.name}`} onClick={() => setEditing(p)}>
                        <Icon name="edit" size={15} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {(creating || editing) && (
        <ProductModal
          product={editing ?? undefined}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSave={async (product) => {
            if (editing) {
              try {
                await api.crm.update('products', editing.id, product);
              } catch { /* dev fallback */ }
              dispatch({ type: 'product/update', id: editing.id, patch: product });
            } else {
              const newProd: Product = { ...product, id: uid('pr') };
              try {
                await api.crm.create('products', {
                  name: newProd.name,
                  price: newProd.price,
                  sku: newProd.sku,
                  status: newProd.active ? 'active' : 'draft',
                });
              } catch { /* dev fallback */ }
              dispatch({ type: 'product/add', product: newProd });
            }
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </main>
  );
}

function ProductModal({
  product,
  onClose,
  onSave,
}: {
  product?: Product;
  onClose: () => void;
  onSave: (product: Omit<Product, 'id'>) => void;
}) {
  const [name, setName] = useState(product?.name ?? '');
  const [price, setPrice] = useState(String(product?.price ?? ''));
  const [kind, setKind] = useState<Product['kind']>(product?.kind ?? 'one_time');
  const [active, setActive] = useState(product?.active ?? true);

  const amount = Number(price);
  const canSave = name.trim().length > 1 && Number.isFinite(amount) && amount > 0;

  return (
    <Modal
      title={product ? 'Edit product' : 'New product'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn--primary"
            type="button"
            disabled={!canSave}
            onClick={() =>
              onSave({ name: name.trim(), price: amount, kind, active })
            }
          >
            {product ? 'Save changes' : 'Add product'}
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="product-name">Name</label>
        <input
          id="product-name"
          className="input"
          autoFocus
          placeholder="Onboarding package"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="grid grid--2" style={{ marginTop: 12 }}>
        <div className="field">
          <label htmlFor="product-price">Price (USD)</label>
          <input
            id="product-price"
            className="input"
            type="number"
            min="1"
            placeholder="900"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="product-kind">Billing</label>
          <select
            id="product-kind"
            className="select"
            value={kind}
            onChange={(e) => setKind(e.target.value as Product['kind'])}
          >
            <option value="one_time">One-time payment</option>
            <option value="recurring">Recurring monthly</option>
          </select>
        </div>
      </div>
      <div className="row row--between" style={{ marginTop: 14 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Available to sell</div>
          <div className="hint">Inactive items stay in the price book but are hidden from checkout.</div>
        </div>
        <Switch on={active} label="Product active" onChange={() => setActive((v) => !v)} />
      </div>
    </Modal>
  );
}
