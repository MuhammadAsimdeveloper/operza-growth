import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Badge, EmptyState, PageHeader, StatCard, Switch } from '../components/ui';
import { currency, fullDate, num } from '../lib/format';
import { uid, useStore } from '../lib/store';
import { api } from '../lib/api';
import type { Coupon, CouponKind } from '../lib/types';

type CouponState = 'active' | 'paused' | 'expired' | 'exhausted';

function stateOf(coupon: Coupon): CouponState {
  if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() < Date.now()) return 'expired';
  if (coupon.maxRedemptions !== null && coupon.redemptions >= coupon.maxRedemptions) return 'exhausted';
  return coupon.active ? 'active' : 'paused';
}

const STATE_META: Record<
  CouponState,
  { label: string; tone: 'green' | 'default' | 'red' | 'amber' }
> = {
  active: { label: 'Active', tone: 'green' },
  paused: { label: 'Paused', tone: 'default' },
  expired: { label: 'Expired', tone: 'red' },
  exhausted: { label: 'At limit', tone: 'amber' },
};

export default function Coupons() {
  const { state, dispatch } = useStore();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Coupon | null>(null);
  const [testCode, setTestCode] = useState('');
  const [testResult, setTestResult] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);

  useEffect(() => {
    api.crm.list<Coupon>('coupons').then((res) => {
      if (res.data && res.data.length > 0) {
        for (const c of res.data) {
          if (!state.coupons.some((x) => x.id === c.id)) {
            dispatch({ type: 'coupon/add', coupon: c });
          }
        }
      }
    }).catch(() => { /* dev fallback */ });
  }, []);

  const handleValidateTest = async () => {
    if (!testCode.trim()) return;
    setValidating(true);
    try {
      const res = await api.coupons.validate(testCode.trim(), 200);
      if (res.valid) {
        setTestResult(`✅ Valid! Discount: $${res.discount} (New Subtotal: $${res.newTotal})`);
      } else {
        setTestResult(`❌ Invalid: ${res.error}`);
      }
    } catch (err: any) {
      setTestResult(`❌ ${err.message || 'Validation failed'}`);
    } finally {
      setValidating(false);
    }
  };

  const active = state.coupons.filter((c) => stateOf(c) === 'active');
  const redemptions = state.coupons.reduce((sum, c) => sum + c.redemptions, 0);
  const exhausted = state.coupons.filter((c) => stateOf(c) === 'exhausted');
  const expired = state.coupons.filter((c) => stateOf(c) === 'expired');

  return (
    <div className="content">
      <PageHeader
        title="Coupons"
        subtitle="Discount codes that can be applied at checkout on payment links and invoices."
        actions={
          <button className="btn btn--primary" onClick={() => setCreating(true)}>
            <Icon name="plus" size={16} /> New coupon
          </button>
        }
      />

      <div className="grid grid--4" style={{ marginBottom: 16 }}>
        <StatCard label="Active codes" value={num(active.length)} icon={<Icon name="tag" size={15} />} meta={`${state.coupons.length} total`} />
        <StatCard label="Redemptions" value={num(redemptions)} icon={<Icon name="check" size={15} />} meta="across all codes" />
        <StatCard label="At limit" value={num(exhausted.length)} icon={<Icon name="bell" size={15} />} meta="no redemptions left" />
        <StatCard label="Expired" value={num(expired.length)} icon={<Icon name="clock" size={15} />} meta="past their end date" />
      </div>

      <div className="card">
        <div className="card__head">
          <div>
            <div className="card__title">Discount codes</div>
            <div className="card__sub">{state.coupons.length} codes</div>
          </div>
        </div>

        {state.coupons.length === 0 ? (
          <EmptyState
            icon={<Icon name="tag" size={22} />}
            title="No coupons yet"
            text="Create a discount code to run a promotion or reward repeat customers."
            action={
              <button className="btn btn--sm" onClick={() => setCreating(true)}>
                New coupon
              </button>
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Discount</th>
                  <th>Minimum</th>
                  <th>Redeemed</th>
                  <th>Expires</th>
                  <th>Status</th>
                  <th style={{ width: 72 }}>Active</th>
                  <th style={{ width: 52 }} />
                </tr>
              </thead>
              <tbody>
                {state.coupons.map((coupon) => {
                  const status = stateOf(coupon);
                  return (
                    <tr key={coupon.id}>
                      <td>
                        <span className="mono-cell" style={{ color: 'var(--text)', fontWeight: 600 }}>
                          {coupon.code}
                        </span>
                      </td>
                      <td>
                        {coupon.kind === 'percent' ? `${coupon.value}% off` : `${currency(coupon.value)} off`}
                      </td>
                      <td className="cell-sub">
                        {coupon.minAmount > 0 ? currency(coupon.minAmount) : 'No minimum'}
                      </td>
                      <td className="cell-sub">
                        {num(coupon.redemptions)}
                        {coupon.maxRedemptions !== null ? ` / ${num(coupon.maxRedemptions)}` : ' / unlimited'}
                      </td>
                      <td className="cell-sub">{coupon.expiresAt ? fullDate(coupon.expiresAt) : 'Never'}</td>
                      <td>
                        <Badge tone={STATE_META[status].tone} dot>
                          {STATE_META[status].label}
                        </Badge>
                      </td>
                      <td>
                        <Switch
                          on={coupon.active}
                          label={`Toggle ${coupon.code}`}
                          onChange={() => dispatch({ type: 'coupon/toggle', id: coupon.id })}
                        />
                      </td>
                      <td className="cell-right">
                        <span className="row" style={{ gap: 2, justifyContent: 'flex-end' }}>
                          <button className="icon-btn" aria-label={`Edit ${coupon.code}`} onClick={() => setEditing(coupon)}>
                            <Icon name="edit" size={15} />
                          </button>
                          <button
                            className="icon-btn"
                            aria-label={`Delete ${coupon.code}`}
                            onClick={() => dispatch({ type: 'coupon/delete', id: coupon.id })}
                          >
                            <Icon name="trash" size={15} />
                          </button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card__head">
          <div>
            <div className="card__title">Live Promotion Code Tester</div>
            <div className="card__sub">Verify coupon validity against order subtotals and redemption limits</div>
          </div>
        </div>
        <div className="card__body stack" style={{ gap: 12 }}>
          <div className="row" style={{ gap: 8 }}>
            <input
              type="text"
              className="input"
              style={{ maxWidth: 240 }}
              placeholder="Enter coupon code..."
              value={testCode}
              onChange={(e) => setTestCode(e.target.value.toUpperCase())}
            />
            <button
              className="btn btn--primary"
              type="button"
              disabled={validating || !testCode.trim()}
              onClick={handleValidateTest}
            >
              <Icon name="check" size={14} /> {validating ? 'Checking...' : 'Validate Code'}
            </button>
          </div>
          {testResult && (
            <div style={{ padding: 10, borderRadius: 'var(--radius)', background: 'var(--surface-sunken)', border: '1px solid var(--border)', fontSize: 13 }}>
              {testResult}
            </div>
          )}
        </div>
      </div>

      <div className="hint" style={{ marginTop: 10 }}>
        Expiry and redemption limits are evaluated live — toggling a code pauses it without deleting history.
      </div>

      {(creating || editing) && (
        <CouponModal
          coupon={editing ?? undefined}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSave={async (coupon) => {
            if (editing) {
              try {
                await api.crm.update('coupons', editing.id, coupon);
              } catch { /* dev fallback */ }
              dispatch({ type: 'coupon/update', id: editing.id, patch: coupon });
            } else {
              const newCoupon = {
                ...coupon,
                id: uid('cp'),
                redemptions: 0,
                createdAt: new Date().toISOString(),
              };
              try {
                await api.crm.create('coupons', {
                  code: newCoupon.code,
                  kind: newCoupon.kind,
                  amount: newCoupon.value,
                  minSubtotal: newCoupon.minAmount,
                  maxRedemptions: newCoupon.maxRedemptions,
                  expiresAt: newCoupon.expiresAt,
                  active: newCoupon.active
                });
              } catch { /* dev fallback */ }
              dispatch({
                type: 'coupon/add',
                coupon: newCoupon,
              });
            }
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function CouponModal({
  coupon,
  onClose,
  onSave,
}: {
  coupon?: Coupon;
  onClose: () => void;
  onSave: (coupon: Omit<Coupon, 'id' | 'redemptions' | 'createdAt'>) => void;
}) {
  const [code, setCode] = useState(coupon?.code ?? '');
  const [kind, setKind] = useState<CouponKind>(coupon?.kind ?? 'percent');
  const [value, setValue] = useState(String(coupon?.value ?? ''));
  const [minAmount, setMinAmount] = useState(String(coupon?.minAmount ?? 0));
  const [maxRedemptions, setMaxRedemptions] = useState(
    coupon?.maxRedemptions !== null && coupon?.maxRedemptions !== undefined ? String(coupon.maxRedemptions) : '',
  );
  const [expiresAt, setExpiresAt] = useState(coupon?.expiresAt ? coupon.expiresAt.slice(0, 10) : '');
  const [active, setActive] = useState(coupon?.active ?? true);

  const amount = Number(value);
  const minimum = Number(minAmount) || 0;
  const limit = maxRedemptions.trim() === '' ? null : Number(maxRedemptions);
  const canSave =
    code.trim().length >= 3 &&
    Number.isFinite(amount) &&
    amount > 0 &&
    (kind === 'fixed' || amount <= 100) &&
    (limit === null || (Number.isFinite(limit) && limit > 0));

  const save = () => {
    if (!canSave) return;
    onSave({
      code: code.trim().toUpperCase(),
      kind,
      value: amount,
      minAmount: minimum,
      maxRedemptions: limit,
      active,
      expiresAt: expiresAt ? new Date(`${expiresAt}T23:59:00`).toISOString() : null,
    });
  };

  return (
    <Modal
      title={coupon ? `Edit ${coupon.code}` : 'New coupon'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn--primary" type="button" disabled={!canSave} onClick={save}>
            {coupon ? 'Save changes' : 'Create coupon'}
          </button>
        </>
      }
    >
      <div className="grid grid--2">
        <div className="field">
          <label htmlFor="coupon-code">Code</label>
          <input
            id="coupon-code"
            className="input"
            autoFocus
            placeholder="WELCOME10"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
        </div>
        <div className="field">
          <label htmlFor="coupon-kind">Type</label>
          <select
            id="coupon-kind"
            className="select"
            value={kind}
            onChange={(e) => setKind(e.target.value as CouponKind)}
          >
            <option value="percent">Percentage off</option>
            <option value="fixed">Fixed amount off</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="coupon-value">{kind === 'percent' ? 'Percent off' : 'Amount off (USD)'}</label>
          <input
            id="coupon-value"
            className="input"
            type="number"
            min="1"
            max={kind === 'percent' ? 100 : undefined}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="coupon-min">Minimum order (USD)</label>
          <input
            id="coupon-min"
            className="input"
            type="number"
            min="0"
            value={minAmount}
            onChange={(e) => setMinAmount(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="coupon-limit">Redemption limit</label>
          <input
            id="coupon-limit"
            className="input"
            type="number"
            min="1"
            placeholder="Unlimited"
            value={maxRedemptions}
            onChange={(e) => setMaxRedemptions(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="coupon-expiry">Expires</label>
          <input
            id="coupon-expiry"
            className="input"
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
          />
        </div>
      </div>
      <div className="row row--between" style={{ marginTop: 14 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Accepting redemptions</div>
          <div className="hint">Paused codes keep their history and can be switched back on.</div>
        </div>
        <Switch on={active} label="Coupon active" onChange={() => setActive((v) => !v)} />
      </div>
    </Modal>
  );
}
