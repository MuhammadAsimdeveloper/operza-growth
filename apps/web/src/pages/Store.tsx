import { useState } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Badge, EmptyState, PageHeader, StatCard, Switch } from '../components/ui';
import { currency, num, shortDate } from '../lib/format';
import { uid, useStore } from '../lib/store';
import type { Coupon, Order } from '../lib/types';
import { api } from '../lib/api';

const usd = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);

const roundCents = (value: number) => Math.round(value * 100) / 100;

function couponUsable(coupon: Coupon, subtotal: number): boolean {
  if (!coupon.active || subtotal <= 0) return false;
  if (coupon.minAmount > subtotal) return false;
  if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() < Date.now()) return false;
  if (coupon.maxRedemptions !== null && coupon.redemptions >= coupon.maxRedemptions) return false;
  return true;
}

function discountFor(coupon: Coupon, subtotal: number): number {
  const raw = coupon.kind === 'percent' ? (subtotal * coupon.value) / 100 : coupon.value;
  return Math.min(roundCents(raw), subtotal);
}

function nextNumber(prefix: string, rows: Array<{ number: string }>, floor: number): string {
  const highest = rows.reduce((max, row) => {
    const parsed = Number(row.number.replace(/\D/g, ''));
    return Number.isFinite(parsed) ? Math.max(max, parsed) : max;
  }, floor);
  return `${prefix}-${highest + 1}`;
}

interface Receipt {
  order: Order;
  fee: number;
  net: number;
  couponCode?: string;
}

export default function Store() {
  const { state, dispatch } = useStore();
  const [cart, setCart] = useState<Record<string, number>>({});
  const [couponInput, setCouponInput] = useState('');
  const [appliedCouponId, setAppliedCouponId] = useState<string | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [contactId, setContactId] = useState(state.contacts[0]?.id ?? '');
  const [gatewayId, setGatewayId] = useState(
    state.paymentGateways.find((g) => g.connected)?.id ?? state.paymentGateways[0]?.id ?? '',
  );
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  const activeProducts = state.products.filter((p) => p.active);
  const lines = activeProducts
    .filter((p) => (cart[p.id] ?? 0) > 0)
    .map((p) => ({ product: p, qty: cart[p.id] }));
  const itemCount = lines.reduce((sum, line) => sum + line.qty, 0);
  const subtotal = lines.reduce((sum, line) => sum + line.product.price * line.qty, 0);

  const appliedCoupon = state.coupons.find((c) => c.id === appliedCouponId);
  const couponUsableNow = appliedCoupon ? couponUsable(appliedCoupon, subtotal) : false;
  const discount = appliedCoupon && couponUsableNow ? discountFor(appliedCoupon, subtotal) : 0;
  const chargeable = subtotal - discount;

  const gateway =
    state.paymentGateways.find((g) => g.id === gatewayId && g.connected) ??
    state.paymentGateways.find((g) => g.connected);
  const fee = gateway ? roundCents((chargeable * gateway.feePct) / 100 + gateway.feeFixed) : 0;
  const total = roundCents(chargeable);
  const net = roundCents(total - fee);

  const paidOrders = state.orders.filter((o) => o.status === 'paid');
  const storeRevenue = paidOrders.reduce((sum, o) => sum + o.total, 0);
  const average = paidOrders.length ? storeRevenue / paidOrders.length : 0;
  const couponOrders = state.orders.filter((o) => o.couponCode).length;
  const recentCheckouts = state.orders.filter((o) => o.gateway).slice(0, 6);

  const addToCart = (productId: string) =>
    setCart((current) => ({ ...current, [productId]: (current[productId] ?? 0) + 1 }));

  const changeQty = (productId: string, qty: number) =>
    setCart((current) => {
      const next = { ...current };
      if (qty <= 0) delete next[productId];
      else next[productId] = qty;
      return next;
    });

  const applyCoupon = () => {
    const code = couponInput.trim().toUpperCase();
    if (!code) return;
    const coupon = state.coupons.find((c) => c.code === code);
    if (!coupon) {
      setCouponError('No coupon matches that code.');
      setAppliedCouponId(null);
      return;
    }
    if (!coupon.active) {
      setCouponError('That coupon is paused.');
      setAppliedCouponId(null);
      return;
    }
    if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() < Date.now()) {
      setCouponError('That coupon has expired.');
      setAppliedCouponId(null);
      return;
    }
    if (coupon.maxRedemptions !== null && coupon.redemptions >= coupon.maxRedemptions) {
      setCouponError('That coupon has reached its redemption limit.');
      setAppliedCouponId(null);
      return;
    }
    if (subtotal < coupon.minAmount) {
      setCouponError(`Minimum spend for this coupon is ${currency(coupon.minAmount)}.`);
      setAppliedCouponId(null);
      return;
    }
    setCouponError(null);
    setAppliedCouponId(coupon.id);
  };

  const pay = () => {
    if (!lines.length || !gateway || !contactId) return;
    const at = new Date().toISOString();
    const order: Order = {
      id: uid('od'),
      number: nextNumber('ORD', state.orders, 3184),
      contactId,
      items: itemCount,
      total,
      status: 'paid',
      at,
      gateway: gateway.name,
      couponCode: couponUsableNow ? appliedCoupon?.code : undefined,
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
      couponId: couponUsableNow && appliedCoupon ? appliedCoupon.id : undefined,
    });
    api.crm.create('orders', {
      orderNumber: order.number,
      contactId,
      amount: total,
      currency: 'USD',
      status: 'paid',
      items: lines.map((l) => ({ name: l.product.name, price: l.product.price, qty: l.qty })),
      paidAt: at,
    }).catch(() => {});
    api.crm.create('invoices', {
      number: nextNumber('INV', state.invoices, 1047),
      contactName: state.contacts.find((c) => c.id === contactId)?.firstName || 'Store Customer',
      amount: total,
      status: 'paid',
      dueDate: at.slice(0, 10),
    }).catch(() => {});
    setReceipt({ order, fee, net, couponCode: order.couponCode });
    setCart({});
    setCouponInput('');
    setAppliedCouponId(null);
    setCouponError(null);
  };

  return (
    <div className="content">
      <PageHeader
        title="Store"
        subtitle="Sell your price book through a hosted checkout with simulated payment processing."
        actions={
          <button className="btn">
            <Icon name="eye" size={15} /> View storefront
          </button>
        }
      />

      <div className="grid grid--4" style={{ marginBottom: 16 }}>
        <StatCard
          label="Store revenue"
          value={currency(storeRevenue)}
          icon={<Icon name="wallet" size={15} />}
          meta={`${paidOrders.length} paid orders`}
        />
        <StatCard label="Average order" value={currency(Math.round(average))} icon={<Icon name="chart" size={15} />} meta="paid only" />
        <StatCard label="Coupons used" value={num(couponOrders)} icon={<Icon name="tag" size={15} />} meta="checkouts with a code" />
        <StatCard label="Gateways" value={`${state.paymentGateways.filter((g) => g.connected).length}/${state.paymentGateways.length}`} icon={<Icon name="credit-card" size={15} />} meta="connected processors" />
      </div>

      <div className="store-layout">
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card__head">
              <div>
                <div className="card__title">Storefront</div>
                <div className="card__sub">{activeProducts.length} sellable products</div>
              </div>
              <div className="card__actions">
                <Badge>{itemCount} in cart</Badge>
              </div>
            </div>
            <div className="card__body">
              {activeProducts.length === 0 ? (
                <EmptyState
                  icon={<Icon name="store" size={22} />}
                  title="Nothing for sale"
                  text="Activate a product in the price book to stock the storefront."
                />
              ) : (
                <div className="grid grid--2">
                  {activeProducts.map((product) => {
                    const qty = cart[product.id] ?? 0;
                    return (
                      <div
                        key={product.id}
                        className="stack"
                        style={{
                          gap: 10,
                          border: '1px solid var(--line)',
                          borderRadius: 10,
                          padding: 14,
                          background: 'var(--surface-2)',
                        }}
                      >
                        <div className="row row--between">
                          <span
                            className="avatar avatar--md avatar--square"
                            style={{
                              background: product.kind === 'recurring' ? 'var(--violet-soft)' : 'var(--accent-soft)',
                              color: product.kind === 'recurring' ? 'var(--violet)' : 'var(--accent)',
                            }}
                          >
                            <Icon name={product.kind === 'recurring' ? 'refresh' : 'dollar'} size={16} />
                          </span>
                          <Badge tone={product.kind === 'recurring' ? 'violet' : 'blue'}>
                            {product.kind === 'recurring' ? 'Subscription' : 'One-time'}
                          </Badge>
                        </div>
                        <div>
                          <div style={{ fontSize: 13.5, fontWeight: 650 }}>{product.name}</div>
                          <div className="cell-sub">
                            {product.kind === 'recurring' ? 'Billed monthly after checkout' : 'Charged once today'}
                          </div>
                        </div>
                        <div className="row row--between" style={{ marginTop: 2 }}>
                          <strong style={{ fontSize: 16 }}>{currency(product.price)}</strong>
                          <button
                            type="button"
                            className="btn btn--sm btn--primary"
                            aria-label={`Add ${product.name} to cart`}
                            onClick={() => addToCart(product.id)}
                          >
                            <Icon name="plus" size={13} /> Add{qty > 0 ? ` (${qty})` : ''}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card__head">
              <div>
                <div className="card__title">Payment gateways</div>
                <div className="card__sub">Simulated processors — fees apply, no card data is stored</div>
              </div>
            </div>
            <div style={{ borderTop: '1px solid var(--line)' }}>
              {state.paymentGateways.map((g) => (
                <div className="list-row" key={g.id}>
                  <span
                    className="avatar avatar--sm avatar--square"
                    style={{ background: 'var(--surface-3)', color: 'var(--text-2)' }}
                  >
                    <Icon name="credit-card" size={14} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{g.name}</div>
                    <div className="cell-sub">
                      {g.feePct}% + {usd(g.feeFixed)} per charge
                    </div>
                  </div>
                  <div className="segmented">
                    {(['test', 'live'] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        className={g.mode === mode ? 'is-active' : ''}
                        aria-label={`${g.name} ${mode} mode`}
                        onClick={() => dispatch({ type: 'gateway/mode', id: g.id, mode })}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>
                  <Switch
                    on={g.connected}
                    label={`Toggle ${g.name}`}
                    onChange={() => dispatch({ type: 'gateway/toggle', id: g.id })}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="stack" style={{ gap: 16 }}>
          <div className="card">
            <div className="card__head">
              <div>
                <div className="card__title">Cart</div>
                <div className="card__sub">{itemCount === 0 ? 'Empty' : `${itemCount} item${itemCount === 1 ? '' : 's'}`}</div>
              </div>
            </div>
            <div className="card__body stack" style={{ gap: 12 }}>
              {lines.length === 0 ? (
                <div className="hint">Add a product to start a simulated checkout.</div>
              ) : (
                lines.map(({ product, qty }) => (
                  <div key={product.id} className="row row--between" style={{ gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600 }}>{product.name}</div>
                      <div className="cell-sub">{currency(product.price)} each</div>
                    </div>
                    <div className="row" style={{ gap: 2 }}>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Decrease ${product.name}`}
                        onClick={() => changeQty(product.id, qty - 1)}
                      >
                        <Icon name="minus" size={13} />
                      </button>
                      <span className="cart-qty">{qty}</span>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Increase ${product.name}`}
                        onClick={() => changeQty(product.id, qty + 1)}
                      >
                        <Icon name="plus" size={13} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Remove ${product.name}`}
                        onClick={() => changeQty(product.id, 0)}
                      >
                        <Icon name="trash" size={13} />
                      </button>
                    </div>
                  </div>
                ))
              )}

              <div className="field">
                <label htmlFor="store-contact">Customer</label>
                <select
                  id="store-contact"
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

              <div className="field">
                <label htmlFor="store-coupon">Coupon</label>
                <div className="row" style={{ gap: 6 }}>
                  <input
                    id="store-coupon"
                    className="input"
                    placeholder="SUMMER20"
                    value={couponInput}
                    onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        applyCoupon();
                      }
                    }}
                  />
                  <button type="button" className="btn btn--sm" onClick={applyCoupon}>
                    Apply
                  </button>
                </div>
                {couponError && (
                  <div className="hint" style={{ color: 'var(--red)' }}>
                    {couponError}
                  </div>
                )}
                {appliedCoupon && (
                  <div className="row" style={{ gap: 6, marginTop: 4 }}>
                    <Badge tone={couponUsableNow ? 'green' : 'amber'}>
                      {appliedCoupon.code} ·{' '}
                      {appliedCoupon.kind === 'percent' ? `${appliedCoupon.value}% off` : `${usd(appliedCoupon.value)} off`}
                    </Badge>
                    {!couponUsableNow && <span className="cell-sub">no longer applies</span>}
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="Remove coupon"
                      style={{ marginLeft: 'auto' }}
                      onClick={() => {
                        setAppliedCouponId(null);
                        setCouponInput('');
                        setCouponError(null);
                      }}
                    >
                      <Icon name="x" size={13} />
                    </button>
                  </div>
                )}
              </div>

              <div className="field">
                <label htmlFor="store-gateway">Payment gateway</label>
                <select
                  id="store-gateway"
                  className="select"
                  value={gateway?.id ?? ''}
                  disabled={!state.paymentGateways.some((g) => g.connected)}
                  onChange={(e) => setGatewayId(e.target.value)}
                >
                  {state.paymentGateways
                    .filter((g) => g.connected)
                    .map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name} ({g.mode})
                      </option>
                    ))}
                </select>
                {!state.paymentGateways.some((g) => g.connected) && (
                  <div className="hint" style={{ color: 'var(--red)' }}>
                    Connect a gateway below to take payments.
                  </div>
                )}
              </div>

              <div className="divider" />

              <div className="stack" style={{ gap: 6 }}>
                <div className="row row--between">
                  <span className="hint">Subtotal</span>
                  <span>{usd(subtotal)}</span>
                </div>
                <div className="row row--between">
                  <span className="hint">Discount</span>
                  <span style={{ color: discount > 0 ? 'var(--green)' : undefined }}>
                    {discount > 0 ? `−${usd(discount)}` : '—'}
                  </span>
                </div>
                <div className="row row--between">
                  <span className="hint">Processing fee</span>
                  <span>{fee > 0 ? `−${usd(fee)}` : '—'}</span>
                </div>
                <div className="row row--between" style={{ marginTop: 2 }}>
                  <strong style={{ fontSize: 13 }}>Total due</strong>
                  <strong style={{ fontSize: 20, letterSpacing: '-0.02em' }}>{usd(total)}</strong>
                </div>
              </div>

              <button
                type="button"
                className="btn btn--primary"
                style={{ width: '100%' }}
                disabled={!lines.length || !gateway || !contactId}
                onClick={pay}
              >
                <Icon name="lock" size={14} /> Pay {usd(total)}
              </button>
              <div className="hint">
                Simulated processor — no card fields, credentials or buyer data are collected. The order and a
                paid invoice are written to the workspace.
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card__head">
              <div className="card__title">Recent checkouts</div>
              <div className="card__actions">
                <Badge>{recentCheckouts.length}</Badge>
              </div>
            </div>
            <div style={{ borderTop: '1px solid var(--line)' }}>
              {recentCheckouts.length === 0 ? (
                <div className="hint" style={{ padding: 14 }}>
                  No store checkouts yet.
                </div>
              ) : (
                recentCheckouts.map((order) => {
                  const contact = state.contacts.find((c) => c.id === order.contactId);
                  return (
                    <div className="list-row" key={order.id}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600 }}>{order.number}</div>
                        <div className="cell-sub">
                          {contact ? `${contact.firstName} ${contact.lastName}` : 'Unknown contact'} ·{' '}
                          {shortDate(order.at)}
                        </div>
                      </div>
                      <Badge>{order.gateway}</Badge>
                      <strong className="cell-num" style={{ width: 76, textAlign: 'right', fontSize: 12.5 }}>
                        {currency(order.total)}
                      </strong>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {receipt && (
        <Modal
          title="Payment approved"
          onClose={() => setReceipt(null)}
          footer={
            <>
              <button className="btn" type="button" onClick={() => setReceipt(null)}>
                Close
              </button>
              <button className="btn btn--primary" type="button" onClick={() => setReceipt(null)}>
                New sale
              </button>
            </>
          }
        >
          <div className="stack" style={{ gap: 12 }}>
            <div className="row" style={{ gap: 10 }}>
              <span
                className="avatar avatar--md"
                style={{ background: 'var(--green-soft)', color: 'var(--green)' }}
              >
                <Icon name="check" size={18} />
              </span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 650 }}>{usd(receipt.order.total)} charged</div>
                <div className="cell-sub">
                  {receipt.order.number} · {receipt.order.gateway}
                </div>
              </div>
            </div>
            <div className="stack" style={{ gap: 6 }}>
              <div className="row row--between">
                <span className="hint">Items</span>
                <span>{receipt.order.items}</span>
              </div>
              <div className="row row--between">
                <span className="hint">Coupon</span>
                <span>{receipt.couponCode ?? '—'}</span>
              </div>
              <div className="row row--between">
                <span className="hint">Processing fee</span>
                <span>{usd(receipt.fee)}</span>
              </div>
              <div className="row row--between">
                <span className="hint">Net to you</span>
                <strong>{usd(receipt.net)}</strong>
              </div>
            </div>
            <div className="callout">
              A paid invoice was created and the coupon redemption count was updated. Everything is recorded in
              the audit log.
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
