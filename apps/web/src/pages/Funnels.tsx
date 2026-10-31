import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Badge, PageHeader, StatCard, StatusBadge, Switch } from '../components/ui';
import { uid, useStore } from '../lib/store';
import { currency, num, pct } from '../lib/format';
import { api } from '../lib/api';
import type { Order, OrderBump, Site, SitePage } from '../lib/types';

const BANNERS = [
  'linear-gradient(135deg, #4f46e5, #7c3aed)',
  'linear-gradient(135deg, #0ea5e9, #2563eb)',
  'linear-gradient(135deg, #10b981, #0d9488)',
  'linear-gradient(135deg, #f59e0b, #ea580c)',
];

function slugPath(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug ? `/${slug}` : '/';
}

const roundCents = (value: number) => Math.round(value * 100) / 100;

function nextNumber(prefix: string, rows: Array<{ number: string }>, floor: number): string {
  const highest = rows.reduce((max, row) => {
    const parsed = Number(row.number.replace(/\D/g, ''));
    return Number.isFinite(parsed) ? Math.max(max, parsed) : max;
  }, floor);
  return `${prefix}-${highest + 1}`;
}

export default function Funnels() {
  const { state, dispatch } = useStore();
  const [filter, setFilter] = useState<'all' | 'published' | 'draft'>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [creatingFunnel, setCreatingFunnel] = useState(false);

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

  const handleTestOptin = async (funnel: Site) => {
    try {
      await api.funnels.optin(funnel.id, {
        firstName: 'Taylor',
        lastName: 'Swift',
        email: 'taylor@growthagency.io',
        bumpAccepted: Boolean(funnel.checkout?.bumps?.some(b => b.enabled))
      });
    } catch { /* dev fallback */ }
  };

  const handleCopyLink = async (funnel: Site) => {
    const url = `${window.location.origin}/api/funnels/public/${funnel.domain || funnel.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(funnel.id);
      window.setTimeout(() => setCopiedId((c) => (c === funnel.id ? null : c)), 1600);
    } catch { /* clipboard unavailable */ }
  };

  const funnels = state.sites.filter((s) => s.kind === 'funnel');
  const rows = funnels.filter((f) => {
    if (filter === 'published') return f.published;
    if (filter === 'draft') return !f.published;
    return true;
  });
  const editing = funnels.find((f) => f.id === editingId) ?? null;

  const visits = funnels.reduce((s, f) => s + f.visits, 0);
  const optins = funnels.reduce((s, f) => s + f.optins, 0);

  const duplicate = (funnel: Site) => {
    dispatch({
      type: 'site/duplicate',
      copy: {
        ...funnel,
        id: uid('f'),
        name: `${funnel.name} copy`,
        published: false,
        visits: 0,
        optins: 0,
        pages: funnel.pages.map((page) => ({ ...page, id: uid('fp'), visits: 0, optins: 0 })),
        checkout: funnel.checkout
          ? { ...funnel.checkout, bumps: funnel.checkout.bumps.map((b) => ({ ...b, id: uid('ob') })) }
          : undefined,
      },
    });
  };

  return (
    <div className="content">
      <PageHeader
        title="Funnels"
        subtitle="Multi-step opt-in flows and their conversion performance."
        actions={
          <div className="row" style={{ gap: 10 }}>
            <div className="segmented">
              {(['all', 'published', 'draft'] as const).map((f) => (
                <button key={f} className={filter === f ? 'is-active' : ''} onClick={() => setFilter(f)} style={{ textTransform: 'capitalize' }}>
                  {f}
                </button>
              ))}
            </div>
            <button className="btn btn--primary" onClick={() => setCreatingFunnel(true)}>
              <Icon name="plus" size={15} /> New funnel
            </button>
          </div>
        }
      />

      <div className="grid grid--4" style={{ marginBottom: 16 }}>
        <StatCard label="Total visits" value={num(visits)} icon={<Icon name="eye" size={15} />} meta="all funnels" />
        <StatCard label="Opt-ins" value={num(optins)} icon={<Icon name="users" size={15} />} meta="form submissions" />
        <StatCard label="Conversion" value={pct(optins, visits || 1)} icon={<Icon name="chart" size={15} />} meta="visits → opt-in" />
        <StatCard label="Live funnels" value={`${funnels.filter((f) => f.published).length}/${funnels.length}`} icon={<Icon name="play" size={15} />} meta="published" />
      </div>

      <div className="grid grid--2">
        {rows.map((funnel, i) => {
          const liveBumps = funnel.checkout?.bumps.filter((b) => b.enabled).length ?? 0;
          return (
            <div className="card" key={funnel.id}>
              <div className="site-card__banner" style={{ background: BANNERS[i % BANNERS.length] }}>
                <Icon name="funnel" size={26} />
              </div>
              <div className="card__body">
                <div className="row" style={{ gap: 8, marginBottom: 4 }}>
                  <strong style={{ fontSize: 14.5, letterSpacing: '-0.01em' }}>{funnel.name}</strong>
                  <StatusBadge status={funnel.published ? 'published' : 'draft'} />
                  <span className="spacer" />
                  <Switch
                    on={funnel.published}
                    label={`Toggle ${funnel.name}`}
                    onChange={() => dispatch({ type: 'site/toggle', id: funnel.id })}
                  />
                </div>
                <div className="row" style={{ gap: 18, margin: '10px 0 12px' }}>
                  <div>
                    <div className="cell-sub">Visits</div>
                    <strong style={{ fontSize: 14 }}>{num(funnel.visits)}</strong>
                  </div>
                  <div>
                    <div className="cell-sub">Opt-ins</div>
                    <strong style={{ fontSize: 14 }}>{num(funnel.optins)}</strong>
                  </div>
                  <div>
                    <div className="cell-sub">Conversion</div>
                    <strong style={{ fontSize: 14, color: 'var(--green)' }}>{pct(funnel.optins, funnel.visits || 1)}</strong>
                  </div>
                </div>
                <div className="funnel-path">
                  {funnel.pages.map((page, idx) => (
                    <span key={page.id} className="row" style={{ gap: 6 }}>
                      {idx > 0 && <Icon name="chevron-right" size={13} className="funnel-arrow" />}
                      <span className="funnel-step">{page.name}</span>
                    </span>
                  ))}
                </div>
                <div className="row" style={{ gap: 8, marginTop: 14 }}>
                  <button className="btn btn--sm" onClick={() => setEditingId(funnel.id)}>
                    <Icon name="sliders" size={14} /> Open builder
                  </button>
                  <button className="btn btn--sm" onClick={() => handleCopyLink(funnel)}>
                    <Icon name={copiedId === funnel.id ? 'check' : 'link'} size={14} /> {copiedId === funnel.id ? 'Copied' : 'Share link'}
                  </button>
                  <button className="btn btn--sm" onClick={() => handleTestOptin(funnel)}>
                    <Icon name="play" size={14} /> Test opt-in
                  </button>
                  <button className="btn btn--sm" onClick={() => duplicate(funnel)}>
                    <Icon name="copy" size={14} /> Duplicate
                  </button>
                  <span className="spacer" />
                  {liveBumps > 0 && (
                    <Badge tone="violet">
                      {liveBumps} bump{liveBumps === 1 ? '' : 's'}
                    </Badge>
                  )}
                  <Badge>{funnel.pages.length} steps</Badge>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {editing && <FunnelBuilder funnel={editing} onClose={() => setEditingId(null)} />}
      {creatingFunnel && <NewFunnelModal onClose={() => setCreatingFunnel(false)} />}
    </div>
  );
}

function FunnelBuilder({ funnel, onClose }: { funnel: Site; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [bumpProductId, setBumpProductId] = useState('');
  const [preview, setPreview] = useState(false);

  const activeProducts = state.products.filter((p) => p.active);
  const checkout = funnel.checkout;
  const offer = checkout ? state.products.find((p) => p.id === checkout.productId) : undefined;

  const addStep = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const cleanPath = path.trim();
    const page: SitePage = {
      id: uid('fp'),
      name: trimmed,
      path: cleanPath.startsWith('/') ? cleanPath : `/${cleanPath || slugPath(trimmed).slice(1)}`,
      visits: 0,
      optins: 0,
    };
    dispatch({ type: 'site/step/add', siteId: funnel.id, page });
    setName('');
    setPath('');
  };

  const addBump = () => {
    const product = activeProducts.find((p) => p.id === bumpProductId);
    if (!product) return;
    const bump: OrderBump = {
      id: uid('ob'),
      productId: product.id,
      title: `Add ${product.name}`,
      copy: `${product.name} at 20% off when you order today.`,
      price: roundCents(product.price * 0.8),
      enabled: true,
    };
    dispatch({ type: 'site/bump/add', siteId: funnel.id, bump });
    setBumpProductId('');
  };

  return (
    <Modal
      title={funnel.name}
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Close
          </button>
          <button className="btn" type="button" disabled={!checkout} onClick={() => setPreview(true)}>
            <Icon name="eye" size={14} /> Preview checkout
          </button>
          <button
            className="btn btn--primary"
            onClick={() => dispatch({ type: 'site/toggle', id: funnel.id })}
          >
            {funnel.published ? 'Unpublish funnel' : 'Publish funnel'}
          </button>
        </>
      }
    >
      <div className="row row--between">
        <div>
          <div className="cell-sub">Public URL</div>
          <div className="row" style={{ gap: 6, fontSize: 13, fontFamily: 'var(--font-mono)' }}>
            go.agency.test/{funnel.name.toLowerCase().replace(/\s+/g, '-')}
          </div>
        </div>
        <StatusBadge status={funnel.published ? 'published' : 'draft'} />
      </div>
      <div className="divider" />
      <div className="row row--between">
        <strong style={{ fontSize: 13 }}>Steps</strong>
        <span className="cell-sub">
          {num(funnel.visits)} visits · {num(funnel.optins)} opt-ins
        </span>
      </div>

      {funnel.pages.length === 0 ? (
        <div className="hint">No steps yet — add the first page below.</div>
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          {funnel.pages.map((page, idx) => (
            <div
              className="list-row"
              key={page.id}
              style={{ border: '1px solid var(--line)', borderRadius: 9, background: 'var(--surface-2)' }}
            >
              <span
                className="avatar avatar--sm"
                style={{ background: 'var(--accent-soft)', color: 'var(--accent)', fontSize: 11 }}
              >
                {idx + 1}
              </span>
              <div style={{ flex: 1, minWidth: 0, display: 'grid', gridTemplateColumns: '1fr 150px', gap: 8 }}>
                <input
                  className="input"
                  aria-label={`Step ${idx + 1} name`}
                  value={page.name}
                  onChange={(e) =>
                    dispatch({
                      type: 'site/step/update',
                      siteId: funnel.id,
                      id: page.id,
                      patch: { name: e.target.value },
                    })
                  }
                />
                <input
                  className="input"
                  aria-label={`Step ${idx + 1} path`}
                  style={{ fontFamily: 'var(--font-mono)' }}
                  value={page.path}
                  onChange={(e) =>
                    dispatch({
                      type: 'site/step/update',
                      siteId: funnel.id,
                      id: page.id,
                      patch: { path: e.target.value },
                    })
                  }
                />
              </div>
              <div style={{ textAlign: 'right', minWidth: 96 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{num(page.visits)}</div>
                <div className="cell-sub">
                  {num(page.optins)} opt-ins · {pct(page.optins, page.visits || 1)}
                </div>
              </div>
              <div className="row" style={{ gap: 2 }}>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Move ${page.name} up`}
                  disabled={idx === 0}
                  onClick={() => dispatch({ type: 'site/step/move', siteId: funnel.id, id: page.id, direction: 'up' })}
                >
                  <Icon name="chevron-up" size={15} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Move ${page.name} down`}
                  disabled={idx === funnel.pages.length - 1}
                  onClick={() => dispatch({ type: 'site/step/move', siteId: funnel.id, id: page.id, direction: 'down' })}
                >
                  <Icon name="chevron-down" size={15} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Delete ${page.name}`}
                  onClick={() => dispatch({ type: 'site/step/delete', siteId: funnel.id, id: page.id })}
                >
                  <Icon name="trash" size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="divider" />
      <div className="grid grid--3" style={{ alignItems: 'end' }}>
        <div className="field">
          <label htmlFor="step-name">Step name</label>
          <input
            id="step-name"
            className="input"
            placeholder="Checkout"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="step-path">Path</label>
          <input
            id="step-path"
            className="input"
            placeholder="/checkout"
            style={{ fontFamily: 'var(--font-mono)' }}
            value={path}
            onChange={(e) => setPath(e.target.value)}
          />
        </div>
        <button className="btn" type="button" disabled={!name.trim()} onClick={addStep}>
          <Icon name="plus" size={14} /> Add step
        </button>
      </div>

      <div className="divider" />
      <div className="row row--between" style={{ marginBottom: 8 }}>
        <strong style={{ fontSize: 13 }}>Checkout & order bumps</strong>
        {checkout && (
          <Badge tone="violet">
            {checkout.bumps.filter((b) => b.enabled).length} live bump
            {checkout.bumps.filter((b) => b.enabled).length === 1 ? '' : 's'}
          </Badge>
        )}
      </div>

      {!checkout ? (
        <div className="grid grid--2" style={{ alignItems: 'end' }}>
          <div className="field">
            <label htmlFor="funnel-offer">Main offer</label>
            <select
              id="funnel-offer"
              className="select"
              value=""
              onChange={(e) => {
                if (e.target.value) {
                  dispatch({ type: 'site/checkout/set', siteId: funnel.id, productId: e.target.value });
                }
              }}
            >
              <option value="" disabled>
                Choose a product…
              </option>
              {activeProducts.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name} — {currency(product.price)}
                </option>
              ))}
            </select>
          </div>
          <div className="hint">Add a checkout to sell one product and attach order bumps to it.</div>
        </div>
      ) : (
        <div className="stack" style={{ gap: 10 }}>
          <div className="grid grid--2" style={{ alignItems: 'end' }}>
            <div className="field">
              <label htmlFor="funnel-offer">Main offer</label>
              <select
                id="funnel-offer"
                className="select"
                value={checkout.productId}
                onChange={(e) =>
                  dispatch({ type: 'site/checkout/set', siteId: funnel.id, productId: e.target.value })
                }
              >
                {activeProducts.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name} — {currency(product.price)}
                  </option>
                ))}
              </select>
            </div>
            <div className="hint">
              {offer
                ? `${currency(offer.price)} · ${offer.kind === 'recurring' ? 'recurring' : 'one-time'}`
                : 'The product on this funnel is no longer active.'}
            </div>
          </div>

          {checkout.bumps.length === 0 ? (
            <div className="hint">No bumps yet — attach an add-on offer below.</div>
          ) : (
            <div className="stack" style={{ gap: 8 }}>
              {checkout.bumps.map((bump) => {
                const product = state.products.find((p) => p.id === bump.productId);
                const overpriced = product !== undefined && bump.price >= product.price;
                return (
                  <div
                    className="list-row"
                    key={bump.id}
                    style={{
                      border: '1px solid var(--line)',
                      borderRadius: 9,
                      background: 'var(--surface-2)',
                      alignItems: 'flex-start',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0, display: 'grid', gap: 8 }}>
                      <div className="grid grid--3" style={{ gap: 8, alignItems: 'end' }}>
                        <div className="field">
                          <label htmlFor={`bump-product-${bump.id}`}>Product</label>
                          <select
                            id={`bump-product-${bump.id}`}
                            className="select"
                            value={bump.productId}
                            onChange={(e) =>
                              dispatch({
                                type: 'site/bump/update',
                                siteId: funnel.id,
                                id: bump.id,
                                patch: { productId: e.target.value },
                              })
                            }
                          >
                            {activeProducts.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="field">
                          <label htmlFor={`bump-title-${bump.id}`}>Offer title</label>
                          <input
                            id={`bump-title-${bump.id}`}
                            className="input"
                            value={bump.title}
                            onChange={(e) =>
                              dispatch({
                                type: 'site/bump/update',
                                siteId: funnel.id,
                                id: bump.id,
                                patch: { title: e.target.value },
                              })
                            }
                          />
                        </div>
                        <div className="field">
                          <label htmlFor={`bump-price-${bump.id}`}>Bump price</label>
                          <input
                            id={`bump-price-${bump.id}`}
                            className="input"
                            type="number"
                            min={0}
                            step={1}
                            value={bump.price}
                            onChange={(e) => {
                              const value = Number(e.target.value);
                              if (!Number.isFinite(value) || value < 0) return;
                              dispatch({
                                type: 'site/bump/update',
                                siteId: funnel.id,
                                id: bump.id,
                                patch: { price: roundCents(value) },
                              });
                            }}
                          />
                        </div>
                      </div>
                      <div className="field">
                        <label htmlFor={`bump-copy-${bump.id}`}>Description</label>
                        <input
                          id={`bump-copy-${bump.id}`}
                          className="input"
                          value={bump.copy}
                          onChange={(e) =>
                            dispatch({
                              type: 'site/bump/update',
                              siteId: funnel.id,
                              id: bump.id,
                              patch: { copy: e.target.value },
                            })
                          }
                        />
                      </div>
                      <div className="row" style={{ gap: 8 }}>
                        <span className="cell-sub">
                          List {currency(product?.price ?? 0)} → {currency(bump.price)}
                        </span>
                        {overpriced && (
                          <span className="hint" style={{ color: 'var(--amber)' }}>
                            Bump price should sit below the list price.
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                      <Switch
                        on={bump.enabled}
                        label={`Toggle ${bump.title}`}
                        onChange={() =>
                          dispatch({
                            type: 'site/bump/update',
                            siteId: funnel.id,
                            id: bump.id,
                            patch: { enabled: !bump.enabled },
                          })
                        }
                      />
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Delete bump ${bump.title}`}
                        onClick={() => dispatch({ type: 'site/bump/delete', siteId: funnel.id, id: bump.id })}
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="grid grid--2" style={{ alignItems: 'end' }}>
            <div className="field">
              <label htmlFor="bump-product">Add a bump</label>
              <select
                id="bump-product"
                className="select"
                value={bumpProductId}
                onChange={(e) => setBumpProductId(e.target.value)}
              >
                <option value="" disabled>
                  Choose a product…
                </option>
                {activeProducts.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name} — list {currency(product.price)}
                  </option>
                ))}
              </select>
            </div>
            <button className="btn" type="button" disabled={!bumpProductId} onClick={addBump}>
              <Icon name="plus" size={14} /> Add bump
            </button>
          </div>
        </div>
      )}

      {preview && <FunnelCheckoutPreview funnel={funnel} onClose={() => setPreview(false)} />}
    </Modal>
  );
}

function FunnelCheckoutPreview({ funnel, onClose }: { funnel: Site; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const checkout = funnel.checkout;
  const offer = checkout ? state.products.find((p) => p.id === checkout.productId) : undefined;
  const bumps = (checkout?.bumps ?? []).filter(
    (b) => b.enabled && state.products.some((p) => p.id === b.productId),
  );
  const [accepted, setAccepted] = useState<string[]>([]);
  const [contactId, setContactId] = useState(state.contacts[0]?.id ?? '');
  const [receipt, setReceipt] = useState<{ number: string; total: number; items: number; bumps: string[] } | null>(
    null,
  );

  if (!checkout || !offer) return null;

  const acceptedBumps = bumps.filter((b) => accepted.includes(b.id));
  const total = roundCents(offer.price + acceptedBumps.reduce((sum, b) => sum + b.price, 0));
  const contact = state.contacts.find((c) => c.id === contactId);

  const toggle = (id: string) =>
    setAccepted((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );

  const complete = () => {
    if (!contactId) return;
    const at = new Date().toISOString();
    const order: Order = {
      id: uid('od'),
      number: nextNumber('ORD', state.orders, 3184),
      contactId,
      items: 1 + acceptedBumps.length,
      total,
      status: 'paid',
      at,
      gateway: state.paymentGateways.find((g) => g.connected)?.name,
      bumps: acceptedBumps.map((b) => b.title),
    };
    dispatch({
      type: 'store/checkout',
      order,
      invoice: {
        id: uid('inv'),
        number: nextNumber('INV', state.invoices, 1047),
        contactId,
        amount: total,
        status: 'paid',
        issuedAt: at,
      },
    });
    setReceipt({ number: order.number, total: order.total, items: order.items, bumps: order.bumps ?? [] });
  };

  return (
    <Modal
      title={receipt ? 'Order complete' : `Checkout · ${funnel.name}`}
      wide
      onClose={onClose}
      footer={
        receipt ? (
          <button className="btn" type="button" onClick={onClose}>
            Close
          </button>
        ) : (
          <>
            <button className="btn" type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn--primary" type="button" disabled={!contactId} onClick={complete}>
              <Icon name="lock" size={14} /> Complete order · {currency(total)}
            </button>
          </>
        )
      }
    >
      {receipt ? (
        <div className="stack" style={{ gap: 12 }}>
          <div className="row" style={{ gap: 10 }}>
            <span className="avatar avatar--md" style={{ background: 'var(--green-soft)', color: 'var(--green)' }}>
              <Icon name="check" size={18} />
            </span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 650 }}>{currency(receipt.total)} charged</div>
              <div className="cell-sub">
                {receipt.number} · {receipt.items} item{receipt.items === 1 ? '' : 's'}
              </div>
            </div>
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <div className="row row--between">
              <span className="hint">Main offer</span>
              <span>{offer.name}</span>
            </div>
            <div className="row row--between">
              <span className="hint">Order bumps</span>
              <span>{receipt.bumps.length ? receipt.bumps.join(', ') : 'None'}</span>
            </div>
            <div className="row row--between">
              <span className="hint">Customer</span>
              <span>{contact ? `${contact.firstName} ${contact.lastName}` : 'Unknown contact'}</span>
            </div>
          </div>
          <div className="callout">
            A paid order and invoice were written to the workspace, and the checkout was recorded in the audit log.
          </div>
        </div>
      ) : (
        <div className="stack" style={{ gap: 12 }}>
          <div className="row row--between">
            <div>
              <div className="cell-sub">Order form</div>
              <div style={{ fontSize: 13, fontFamily: 'var(--font-mono)' }}>
                go.agency.test/{funnel.name.toLowerCase().replace(/\s+/g, '-')}/checkout
              </div>
            </div>
            <Badge tone="green">Secure checkout</Badge>
          </div>

          <div
            className="stack"
            style={{ gap: 4, border: '1px solid var(--line)', borderRadius: 10, padding: 14, background: 'var(--surface-2)' }}
          >
            <div className="row row--between">
              <strong style={{ fontSize: 13.5 }}>{offer.name}</strong>
              <strong style={{ fontSize: 13.5 }}>{currency(offer.price)}</strong>
            </div>
            <span className="cell-sub">
              {offer.kind === 'recurring' ? 'Billed monthly after checkout' : 'Charged once today'} · main offer
            </span>
          </div>

          {bumps.length === 0 ? (
            <div className="hint">No order bumps are enabled on this funnel yet.</div>
          ) : (
            <div className="stack" style={{ gap: 8 }}>
              {bumps.map((bump) => {
                const product = state.products.find((p) => p.id === bump.productId);
                const checked = accepted.includes(bump.id);
                return (
                  <label
                    key={bump.id}
                    className="checkbox"
                    style={{
                      alignItems: 'flex-start',
                      border: `1px solid ${checked ? 'var(--accent)' : 'var(--line)'}`,
                      borderRadius: 10,
                      padding: 12,
                      background: checked ? 'var(--accent-soft)' : 'var(--surface-2)',
                    }}
                  >
                    <input type="checkbox" checked={checked} onChange={() => toggle(bump.id)} />
                    <span style={{ flex: 1 }}>
                      <span className="row row--between" style={{ gap: 8 }}>
                        <strong style={{ fontSize: 13 }}>{bump.title}</strong>
                        <span>
                          {product && product.price > bump.price && (
                            <span className="cell-sub" style={{ textDecoration: 'line-through', marginRight: 6 }}>
                              {currency(product.price)}
                            </span>
                          )}
                          <strong style={{ fontSize: 13 }}>{currency(bump.price)}</strong>
                        </span>
                      </span>
                      <span className="cell-sub" style={{ display: 'block', marginTop: 2 }}>
                        {bump.copy}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}

          <div className="field">
            <label htmlFor="checkout-contact">Customer</label>
            <select
              id="checkout-contact"
              className="select"
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
            >
              {state.contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.firstName} {c.lastName} — {c.company}
                </option>
              ))}
            </select>
          </div>

          <div className="divider" />
          <div className="stack" style={{ gap: 6 }}>
            <div className="row row--between">
              <span className="hint">Main offer</span>
              <span>{currency(offer.price)}</span>
            </div>
            {acceptedBumps.map((bump) => (
              <div className="row row--between" key={bump.id}>
                <span className="hint">{bump.title}</span>
                <span style={{ color: 'var(--green)' }}>+{currency(bump.price)}</span>
              </div>
            ))}
            <div className="row row--between" style={{ marginTop: 2 }}>
              <strong style={{ fontSize: 13 }}>Total due</strong>
              <strong style={{ fontSize: 20, letterSpacing: '-0.02em' }}>{currency(total)}</strong>
            </div>
          </div>
          <div className="hint">
            Simulated checkout — completing it writes a paid order and invoice. No card fields or buyer data are
            collected.
          </div>
        </div>
      )}
    </Modal>
  );
}

function NewFunnelModal({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStore();
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [hasOrderBump, setHasOrderBump] = useState(true);
  const [bumpPrice, setBumpPrice] = useState('97');
  const [bumpTitle, setBumpTitle] = useState('VIP Fast-Track Accelerator Toolkit');
  const [loading, setLoading] = useState(false);

  const canCreate = name.trim().length > 1;

  const handleCreate = async () => {
    if (!canCreate || loading) return;
    setLoading(true);
    const funnelId = uid('fn');
    const slug = (domain.trim() || name.trim()).toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const firstProduct = state.products[0];

    const newFunnel: Site = {
      id: funnelId,
      name: name.trim(),
      kind: 'funnel',
      domain: slug,
      published: true,
      visits: 0,
      optins: 0,
      pages: [
        {
          id: uid('fp'),
          name: 'Opt-in Page',
          path: '/optin',
          visits: 0,
          optins: 0,
          headline: `Free Masterclass: Scale with ${name.trim()}`,
          subhead: 'Learn the exact frameworks used by top agencies to generate predictable revenue.',
          cta: 'Claim Free Access',
          theme: 'gradient',
        },
        {
          id: uid('fp'),
          name: 'Order Confirmation',
          path: '/thank-you',
          visits: 0,
          optins: 0,
          headline: 'Your Strategy Session is Confirmed!',
          subhead: 'Check your inbox for onboarding credentials and private community link.',
          cta: 'Join VIP Community',
          theme: 'plain',
        },
      ],
      checkout: {
        productId: firstProduct?.id ?? 'prod_default',
        bumps: hasOrderBump
          ? [
              {
                id: uid('ob'),
                productId: firstProduct?.id ?? 'prod_default',
                enabled: true,
                price: parseFloat(bumpPrice) || 97,
                title: bumpTitle.trim() || 'VIP Implementation Toolkit',
                copy: 'Get immediate access to copy-paste automation templates and plug-and-play workflows.',
              },
            ]
          : [],
      },
    };

    dispatch({ type: 'site/duplicate', copy: newFunnel });

    try {
      await api.crm.create('websites', newFunnel);
    } catch (err) {
      console.error('Failed to save funnel to server:', err);
    } finally {
      setLoading(false);
      onClose();
    }
  };

  return (
    <Modal
      title="Create New Funnel"
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button className="btn btn--primary" type="button" disabled={!canCreate || loading} onClick={handleCreate}>
            {loading ? 'Creating...' : 'Create funnel'}
          </button>
        </>
      }
    >
      <div className="stack" style={{ gap: 14 }}>
        <div className="field">
          <label htmlFor="fn-name">Funnel Name</label>
          <input
            id="fn-name"
            className="input"
            autoFocus
            placeholder="e.g. High-Ticket Client Acquisition Funnel"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!domain) {
                setDomain(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
              }
            }}
          />
        </div>

        <div className="field">
          <label htmlFor="fn-slug">Public Funnel URL Slug</label>
          <input
            id="fn-slug"
            className="input"
            style={{ fontFamily: 'var(--font-mono)' }}
            placeholder="e.g. high-ticket-funnel"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
          />
          <div className="hint" style={{ marginTop: 4 }}>
            Visitors will access your funnel at /api/funnels/public/{domain || 'high-ticket-funnel'}
          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
          <div className="row row--between" style={{ marginBottom: 10 }}>
            <div>
              <strong style={{ fontSize: 13 }}>1-Click Order Bump Offer</strong>
              <div className="cell-sub">Add high-converting impulse upsell on checkout</div>
            </div>
            <Switch on={hasOrderBump} label="Toggle order bump" onChange={() => setHasOrderBump(!hasOrderBump)} />
          </div>

          {hasOrderBump && (
            <div className="grid grid--2" style={{ gap: 10, marginTop: 8 }}>
              <div className="field">
                <label htmlFor="ob-title">Order Bump Title</label>
                <input
                  id="ob-title"
                  className="input"
                  value={bumpTitle}
                  onChange={(e) => setBumpTitle(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="ob-price">Bump Price ($)</label>
                <input
                  id="ob-price"
                  type="number"
                  className="input"
                  value={bumpPrice}
                  onChange={(e) => setBumpPrice(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
