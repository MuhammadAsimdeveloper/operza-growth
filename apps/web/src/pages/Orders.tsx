import { useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { Avatar, EmptyState, ErrorState, LoadingState } from '../components/ui';
import { useContacts, useOrders } from '../hooks/useWorkspaceData';
import { currency, num, shortDate } from '../lib/format';
import { api } from '../lib/api';
import type { Order } from '../lib/types';

export default function Orders() {
  const ordersQuery = useOrders();
  const contactsQuery = useContacts();
  const [query, setQuery] = useState('');

  const orders: Order[] = useMemo(() => {
    const raw = ordersQuery.data?.data ?? [];
    return raw.map((o: any) => ({
      id: o.id,
      number: o.orderNumber || o.number || 'ORD-000',
      contactId: o.contactId || '',
      items: Array.isArray(o.items) ? o.items.length : (Number(o.items) || 1),
      total: o.amountCents !== undefined ? Number(o.amountCents) / 100 : (Number(o.amount) || Number(o.total) || 0),
      status: o.status === 'paid' ? 'paid' : (o.status === 'refunded' ? 'refunded' : 'pending'),
      at: o.paidAt || o.createdAt || new Date().toISOString(),
    }));
  }, [ordersQuery.data]);

  const contacts = contactsQuery.data?.data ?? [];
  const paid = orders.filter((o) => o.status === 'paid');
  const revenue = paid.reduce((s, o) => s + o.total, 0);
  const refunded = orders.filter((o) => o.status === 'refunded').reduce((s, o) => s + o.total, 0);
  const aov = paid.length ? revenue / paid.length : 0;

  const contactName = (id: string) => {
    const c = contacts.find((x: any) => x.id === id);
    return c ? `${c.firstName} ${c.lastName}` : 'Customer';
  };

  const visible = orders.filter((o) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return o.number.toLowerCase().includes(q) || contactName(o.contactId).toLowerCase().includes(q);
  });

  if (ordersQuery.isLoading) {
    return (
      <main className="operza-dashboard atlas-dashboard">
        <LoadingState message="Loading orders..." />
      </main>
    );
  }

  if (ordersQuery.isError) {
    return (
      <main className="operza-dashboard atlas-dashboard">
        <ErrorState
          title="Failed to load orders"
          message={(ordersQuery.error as Error)?.message}
          onRetry={() => ordersQuery.refetch()}
        />
      </main>
    );
  }

  return (
    <main className="operza-dashboard atlas-dashboard">
      <header className="atlas-dashboard__header">
        <div className="atlas-dashboard__heading">
          <div className="atlas-dashboard__breadcrumb">Workspace <span>/</span> Commerce &amp; Orders</div>
          <h1>Customer Orders &amp; Transactions</h1>
        </div>
        <div className="atlas-dashboard__toolbar">
          <button className="btn btn--secondary btn--sm" onClick={() => ordersQuery.refetch()}>
            <Icon name="refresh" size={14} /> Refresh
          </button>
        </div>
      </header>

      <section className="atlas-hero">
        <div className="atlas-eyebrow">ORDER MANAGEMENT &amp; FULFILLMENT</div>
        <h2>Direct Sales &amp; Funnel Checkout Stream</h2>
        <p>Complete ledger of sales across order forms, funnel checkout steps, digital products, and payment links.</p>
      </section>

      <section className="atlas-kpis" aria-label="Order metrics">
        <article className="operza-kpi atlas-kpi">
          <div className="atlas-kpi__meta">
            <span className="atlas-kpi__label">Gross Order Volume</span>
            <span className="atlas-status atlas-status--healthy">Processed</span>
          </div>
          <div className="atlas-kpi__value">{currency(revenue)}</div>
          <div className="atlas-kpi__note">{paid.length} settled orders</div>
        </article>
        <article className="operza-kpi atlas-kpi">
          <div className="atlas-kpi__meta">
            <span className="atlas-kpi__label">Total Orders</span>
            <span className="atlas-status atlas-status--healthy">Tracked</span>
          </div>
          <div className="atlas-kpi__value">{num(orders.length)}</div>
          <div className="atlas-kpi__note">All checkout events</div>
        </article>
        <article className="operza-kpi atlas-kpi">
          <div className="atlas-kpi__meta">
            <span className="atlas-kpi__label">Average Order Value</span>
            <span className="atlas-status atlas-status--healthy">Settled</span>
          </div>
          <div className="atlas-kpi__value">{currency(Math.round(aov))}</div>
          <div className="atlas-kpi__note">Net realized per order</div>
        </article>
        <article className="operza-kpi atlas-kpi">
          <div className="atlas-kpi__meta">
            <span className="atlas-kpi__label">Total Refunded</span>
            <span className="atlas-status atlas-status--healthy">Recorded</span>
          </div>
          <div className="atlas-kpi__value">{currency(refunded)}</div>
          <div className="atlas-kpi__note">Processed reversals</div>
        </article>
      </section>

      <div className="card-premium" style={{ marginTop: 22 }}>
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
        {visible.length === 0 ? (
          <EmptyState
            icon={<Icon name="credit-card" size={22} />}
            title="No orders yet"
            text="Completed checkouts and payment-link orders will appear here."
          />
        ) : (
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
                        onChange={async (e) => {
                          await api.crm.update('orders', o.id, { status: e.target.value });
                          await ordersQuery.refetch();
                        }}
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
        )}
      </div>
    </main>
  );
}
