import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { Avatar, PageHeader, StatCard } from '../components/ui';
import { useStore } from '../lib/store';
import { currency, num, shortDate } from '../lib/format';
import { api } from '../lib/api';
import type { Order } from '../lib/types';

export default function Orders() {
  const { state, dispatch } = useStore();
  const { orders } = state;
  const [query, setQuery] = useState('');

  useEffect(() => {
    api.crm.list<any>('orders').then((res) => {
      if (res.data && res.data.length > 0) {
        for (const o of res.data) {
          if (!orders.some((x) => x.id === o.id || x.number === o.orderNumber)) {
            dispatch({
              type: 'order/add',
              order: {
                id: o.id,
                number: o.orderNumber || o.number || 'ORD-000',
                contactId: o.contactId,
                items: Array.isArray(o.items) ? o.items.length : 1,
                total: Number(o.amount) || Number(o.total) || 0,
                status: o.status === 'paid' ? 'paid' : (o.status === 'refunded' ? 'refunded' : 'pending'),
                at: o.paidAt || o.createdAt || new Date().toISOString()
              }
            });
          }
        }
      }
    }).catch(() => { /* dev fallback */ });
  }, []);

  const paid = orders.filter((o) => o.status === 'paid');
  const revenue = paid.reduce((s, o) => s + o.total, 0);
  const refunded = orders.filter((o) => o.status === 'refunded').reduce((s, o) => s + o.total, 0);
  const aov = paid.length ? revenue / paid.length : 0;

  const contactName = (id: string) => {
    const c = state.contacts.find((x) => x.id === id);
    return c ? `${c.firstName} ${c.lastName}` : 'Unknown contact';
  };

  const visible = orders.filter((o) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return o.number.toLowerCase().includes(q) || contactName(o.contactId).toLowerCase().includes(q);
  });

  return (
    <div className="content">
      <PageHeader
        title="Orders"
        subtitle="Every checkout from funnels, order forms and payment links."
        actions={
          <>
            <button className="btn">
              <Icon name="copy" size={15} /> Export
            </button>
            <button className="btn btn--primary">
              <Icon name="plus" size={15} /> New order form
            </button>
          </>
        }
      />

      <div className="grid grid--4" style={{ marginBottom: 16 }}>
        <StatCard label="Order revenue" value={currency(revenue)} icon={<Icon name="wallet" size={15} />} meta={`${paid.length} paid orders`} />
        <StatCard label="Orders" value={num(orders.length)} icon={<Icon name="clipboard" size={15} />} meta="all statuses" />
        <StatCard label="Average order" value={currency(Math.round(aov))} icon={<Icon name="chart" size={15} />} meta="paid only" />
        <StatCard label="Refunded" value={currency(refunded)} icon={<Icon name="refresh" size={15} />} meta="lifetime" />
      </div>

      <div className="card">
        <div className="card__head">
          <div>
            <div className="card__title">Recent orders</div>
            <div className="card__sub">{visible.length} shown</div>
          </div>
          <div className="card__actions">
            <div className="search" style={{ width: 220 }}>
              <Icon name="search" size={15} />
              <input
                className="input"
                placeholder="Order # or customer"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th className="cell-right">Items</th>
                <th className="cell-right">Total</th>
                <th>Date</th>
                <th style={{ width: 140 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((o) => (
                <tr key={o.id}>
                  <td style={{ fontWeight: 600, fontFamily: 'var(--font-mono)', fontSize: 12.5 }}>{o.number}</td>
                  <td>
                    <span className="person">
                      <Avatar name={contactName(o.contactId)} size="xs" />
                      {contactName(o.contactId)}
                    </span>
                  </td>
                  <td className="cell-right cell-num">{o.items}</td>
                  <td className="cell-right cell-num">{currency(o.total)}</td>
                  <td className="cell-sub">{shortDate(o.at)}</td>
                  <td>
                    <select
                      className="select select--sm"
                      value={o.status}
                      aria-label={`Status for ${o.number}`}
                      onChange={(e) =>
                        dispatch({ type: 'order/status', id: o.id, status: e.target.value as Order['status'] })
                      }
                    >
                      <option value="paid">Paid</option>
                      <option value="pending">Pending</option>
                      <option value="refunded">Refunded</option>
                    </select>
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
