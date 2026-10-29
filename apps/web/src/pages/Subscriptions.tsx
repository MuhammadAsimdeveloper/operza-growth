import { useEffect } from 'react';
import { Icon } from '../components/Icon';
import { Avatar, PageHeader, StatCard, StatusBadge } from '../components/ui';
import { useStore } from '../lib/store';
import { currency, num, shortDate } from '../lib/format';
import { api } from '../lib/api';
import type { Subscription } from '../lib/types';

export default function Subscriptions() {
  const { state, dispatch } = useStore();
  const { subscriptions } = state;

  useEffect(() => {
    api.crm.list<Subscription>('subscriptions').then((res) => {
      if (res.data && res.data.length > 0) {
        for (const sub of res.data) {
          if (!subscriptions.some((x) => x.id === sub.id)) {
            dispatch({ type: 'subscription/status', id: sub.id, status: sub.status });
          }
        }
      }
    }).catch(() => { /* dev fallback */ });
  }, []);

  const handleStatusChange = async (s: Subscription, newStatus: Subscription['status']) => {
    dispatch({
      type: 'subscription/status',
      id: s.id,
      status: newStatus,
    });
    try {
      if (newStatus === 'canceled') {
        await api.subscriptions.cancel(s.id);
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
            <button className="btn">
              <Icon name="repeat" size={15} /> Billing settings
            </button>
            <button className="btn btn--primary">
              <Icon name="plus" size={15} /> New plan
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
                        onChange={(e) => handleStatusChange(s, e.target.value as Subscription['status'])}
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
    </div>
  );
}
