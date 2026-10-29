import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Avatar, PageHeader, StatCard, StatusBadge } from '../components/ui';
import { useStore, uid } from '../lib/store';
import { currency, num, shortDate } from '../lib/format';
import { api } from '../lib/api';
import type { Subscription, SubscriptionStatus } from '../lib/types';

export default function Subscriptions() {
  const { state, dispatch } = useStore();
  const { subscriptions } = state;
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api.subscriptions.list().then((res) => {
      if (res.data && res.data.length > 0) {
        for (const sub of res.data) {
          dispatch({ type: 'subscription/add', subscription: sub });
        }
      }
    }).catch(() => {
      api.crm.list<Subscription>('subscriptions').then((res) => {
        if (res.data && res.data.length > 0) {
          for (const sub of res.data) {
            dispatch({ type: 'subscription/add', subscription: sub });
          }
        }
      }).catch(() => { /* dev fallback */ });
    });
  }, []);

  const handleStatusChange = async (s: Subscription, newStatus: SubscriptionStatus) => {
    dispatch({
      type: 'subscription/status',
      id: s.id,
      status: newStatus,
    });
    try {
      if (newStatus === 'canceled') {
        await api.subscriptions.cancel(s.id);
      } else if (newStatus === 'active') {
        await api.subscriptions.resume(s.id);
      } else {
        await api.crm.update('subscriptions', s.id, { status: newStatus });
      }
    } catch { /* dev fallback */ }
  };

  const active = subscriptions.filter((s) => s.status === 'active');
  const mrr = active.reduce((s, sub) => s + (sub.interval === 'year' ? sub.amount / 12 : sub.amount), 0);
  const pastDue = subscriptions.filter((s) => s.status === 'past_due');
  const dueSoon = active.filter((s) => {
    const days = (new Date(s.renewsAt).getTime() - Date.now()) / 86_400_000;
    return days >= 0 && days <= 7;
  });

  const contactName = (id: string) => {
    const c = state.contacts.find((x) => x.id === id);
    return c ? `${c.firstName} ${c.lastName}` : 'Unknown contact';
  };

  return (
    <div className="content">
      <PageHeader
        title="Subscriptions"
        subtitle="Recurring revenue, renewals and dunning in one list."
        actions={
          <>
            <button className="btn" type="button" onClick={() => window.location.reload()}>
              <Icon name="repeat" size={15} /> Refresh
            </button>
            <button className="btn btn--primary" type="button" onClick={() => setCreating(true)}>
              <Icon name="plus" size={15} /> New subscription
            </button>
          </>
        }
      />

      <div className="grid grid--4" style={{ marginBottom: 16 }}>
        <StatCard label="MRR" value={currency(Math.round(mrr))} icon={<Icon name="repeat" size={15} />} trend={{ direction: 'up', value: '7.1%' }} meta="active plans" />
        <StatCard label="Active" value={num(active.length)} icon={<Icon name="check" size={15} />} meta="paying customers" />
        <StatCard label="Renewing in 7 days" value={num(dueSoon.length)} icon={<Icon name="calendar" size={15} />} meta="next cycle" />
        <StatCard label="Past due" value={num(pastDue.length)} icon={<Icon name="bell" size={15} />} meta={currency(pastDue.reduce((s, x) => s + x.amount, 0))} />
      </div>

      <div className="card">
        <div className="card__head">
          <div>
            <div className="card__title">All subscriptions</div>
            <div className="card__sub">{subscriptions.length} records</div>
          </div>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Plan</th>
                <th className="cell-right">Amount</th>
                <th>Interval</th>
                <th>Renews</th>
                <th style={{ width: 140 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {subscriptions.map((s) => (
                <tr key={s.id}>
                  <td>
                    <span className="person">
                      <Avatar name={contactName(s.contactId)} />
                      <span className="person__text">
                        <span className="person__name">{contactName(s.contactId)}</span>
                        <span className="person__sub">
                          {state.contacts.find((c) => c.id === s.contactId)?.company ?? ''}
                        </span>
                      </span>
                    </span>
                  </td>
                  <td style={{ fontWeight: 600 }}>{s.plan}</td>
                  <td className="cell-right cell-num">{currency(s.amount)}</td>
                  <td className="cell-sub">per {s.interval}</td>
                  <td className="cell-sub">{shortDate(s.renewsAt)}</td>
                  <td>
                    <div className="row" style={{ gap: 8 }}>
                      <StatusBadge status={s.status} />
                      <select
                        className="select select--sm"
                        value={s.status}
                        aria-label={`Status for ${s.plan}`}
                        onChange={(e) => handleStatusChange(s, e.target.value as SubscriptionStatus)}
                      >
                        <option value="active">Active</option>
                        <option value="past_due">Past due</option>
                        <option value="canceled">Canceled</option>
                      </select>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {creating && (
        <NewSubscriptionModal
          contacts={state.contacts}
          onClose={() => setCreating(false)}
          onCreate={async (subData) => {
            try {
              const res = await api.subscriptions.create(subData);
              if (res.subscription) {
                dispatch({ type: 'subscription/add', subscription: res.subscription });
              }
            } catch {
              // Dev store fallback
              const fallbackSub: Subscription = {
                id: uid('sub'),
                contactId: subData.contactId,
                plan: subData.plan,
                amount: subData.amount,
                interval: subData.interval,
                status: subData.status,
                renewsAt: subData.renewsAt || new Date(Date.now() + 30 * 86400000).toISOString(),
              };
              dispatch({ type: 'subscription/add', subscription: fallbackSub });
            }
            setCreating(false);
          }}
        />
      )}
    </div>
  );
}

function NewSubscriptionModal({
  contacts,
  onClose,
  onCreate,
}: {
  contacts: any[];
  onClose: () => void;
  onCreate: (data: {
    contactId: string;
    plan: string;
    amount: number;
    interval: 'month' | 'year';
    status: SubscriptionStatus;
    renewsAt?: string;
  }) => void;
}) {
  const [contactId, setContactId] = useState(contacts[0]?.id || '');
  const [plan, setPlan] = useState('Growth Accelerator Retainer');
  const [amount, setAmount] = useState('1500');
  const [interval, setInterval] = useState<'month' | 'year'>('month');
  const [status, setStatus] = useState<SubscriptionStatus>('active');
  const [renewsDays, setRenewsDays] = useState('30');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactId || !plan.trim() || Number(amount) <= 0) return;
    setSaving(true);
    const renewsAt = new Date(Date.now() + (Number(renewsDays) || 30) * 86400000).toISOString();
    await onCreate({
      contactId,
      plan: plan.trim(),
      amount: Number(amount),
      interval,
      status,
      renewsAt,
    });
    setSaving(false);
  };

  return (
    <Modal
      title="Create New Subscription"
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            className="btn btn--primary"
            type="button"
            disabled={saving || !contactId || !plan.trim() || Number(amount) <= 0}
            onClick={handleSubmit}
          >
            {saving ? 'Creating...' : 'Provision Subscription'}
          </button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="stack" style={{ gap: 14 }}>
        <div className="field">
          <label htmlFor="sub-contact">Client / Account</label>
          <select
            id="sub-contact"
            className="select"
            value={contactId}
            onChange={(e) => setContactId(e.target.value)}
            required
          >
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.firstName} {c.lastName} {c.company ? `(${c.company})` : ''} — {c.email || 'No email'}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid--2" style={{ gap: 12 }}>
          <div className="field">
            <label htmlFor="sub-plan">Plan Name</label>
            <input
              id="sub-plan"
              className="input"
              value={plan}
              onChange={(e) => setPlan(e.target.value)}
              placeholder="e.g. AI Growth Accelerator"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="sub-amount">Amount ($)</label>
            <input
              id="sub-amount"
              type="number"
              min="1"
              step="1"
              className="input"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>
        </div>

        <div className="grid grid--3" style={{ gap: 12 }}>
          <div className="field">
            <label htmlFor="sub-interval">Billing Interval</label>
            <select
              id="sub-interval"
              className="select"
              value={interval}
              onChange={(e) => setInterval(e.target.value as 'month' | 'year')}
            >
              <option value="month">Monthly</option>
              <option value="year">Annually</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="sub-status">Initial Status</label>
            <select
              id="sub-status"
              className="select"
              value={status}
              onChange={(e) => setStatus(e.target.value as SubscriptionStatus)}
            >
              <option value="active">Active</option>
              <option value="past_due">Past Due</option>
              <option value="canceled">Canceled</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="sub-days">Renews In (Days)</label>
            <input
              id="sub-days"
              type="number"
              min="1"
              max="365"
              className="input"
              value={renewsDays}
              onChange={(e) => setRenewsDays(e.target.value)}
            />
          </div>
        </div>
      </form>
    </Modal>
  );
}
