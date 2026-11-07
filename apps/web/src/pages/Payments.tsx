import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Avatar, Badge, EmptyState, StatusBadge, Switch } from '../components/ui';
import { useStore, uid } from '../lib/store';
import { currency, fullDate, pct } from '../lib/format';
import { api } from '../lib/api';
import type { InvoiceStatus } from '../lib/types';

const STATUSES: InvoiceStatus[] = ['draft', 'sent', 'paid', 'overdue'];

export default function Payments() {
  const { state, dispatch } = useStore();
  const [tab, setTab] = useState<'invoices' | 'products'>('invoices');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([
      api.crm.list('invoices').catch(() => null),
      api.crm.list('products').catch(() => null),
    ]).then(([invRes, prodRes]) => {
      if (!active) return;
      if (invRes?.data && Array.isArray(invRes.data)) {
        for (const item of invRes.data) {
          if (!state.invoices.some((i) => i.id === item.id)) {
            dispatch({
              type: 'invoice/add',
              invoice: {
                id: item.id,
                number: item.number || `INV-${item.id.slice(0, 4)}`,
                contactId: item.contactId || '',
                amount: Number(item.amount) || 0,
                status: (item.status || 'draft') as InvoiceStatus,
                issuedAt: item.dueDate || item.createdAt || new Date().toISOString(),
              },
            });
          }
        }
      }
      if (prodRes?.data && Array.isArray(prodRes.data)) {
        for (const p of prodRes.data) {
          if (!state.products.some((sp) => sp.id === p.id)) {
            dispatch({
              type: 'product/add',
              product: {
                id: p.id,
                name: p.name || 'Custom Product',
                price: Number(p.price) || 0,
                kind: p.sku?.includes('rec') || p.type === 'recurring' ? 'recurring' : 'one_time',
                active: p.active !== false && p.status !== 'inactive',
              },
            });
          }
        }
      }
    });
    return () => {
      active = false;
    };
  }, [state.invoices, state.products, dispatch]);

  const handleStatusChange = async (invoiceId: string, newStatus: InvoiceStatus) => {
    dispatch({ type: 'invoice/status', id: invoiceId, status: newStatus });
    try {
      await api.crm.update('invoices', invoiceId, { status: newStatus });
    } catch (err) {
      console.error('Failed to update invoice status:', err);
    }
  };

  const handleProductToggle = async (productId: string, currentActive: boolean) => {
    dispatch({ type: 'product/toggle', id: productId });
    try {
      await api.crm.update('products', productId, {
        active: !currentActive,
        status: !currentActive ? 'active' : 'inactive',
      });
    } catch (err) {
      console.error('Failed to toggle product status:', err);
    }
  };

  const paid = state.invoices.filter((i) => i.status === 'paid').reduce((s, i) => s + i.amount, 0);
  const outstanding = state.invoices
    .filter((i) => i.status === 'sent' || i.status === 'overdue')
    .reduce((s, i) => s + i.amount, 0);
  const overdue = state.invoices.filter((i) => i.status === 'overdue').reduce((s, i) => s + i.amount, 0);
  const total = state.invoices.reduce((s, i) => s + i.amount, 0);

  const contactOf = (id: string) => state.contacts.find((c) => c.id === id);

  return (
    <main className="operza-dashboard atlas-dashboard">
      <header className="atlas-dashboard__header">
        <div className="atlas-dashboard__heading">
          <div className="atlas-dashboard__breadcrumb">Workspace <span>/</span> Revenue OS</div>
          <h1>Payments &amp; Invoices</h1>
        </div>
        <div className="atlas-dashboard__toolbar">
          <button className="atlas-quick-action-button" onClick={() => setCreating(true)}>
            <Icon name="plus" size={13} /> New Invoice
          </button>
        </div>
      </header>

      <section className="atlas-hero">
        <div className="atlas-eyebrow">REVENUE OPERATIONS &amp; BILLING ENGINE</div>
        <h2>Accounts Receivable, Invoicing &amp; Product Catalog</h2>
        <p>Track cash collections, outstanding invoices, customer billing history, and configure one-time and recurring product plans.</p>
      </section>

      <section className="atlas-kpis" aria-label="Revenue metrics">
        <article className="operza-kpi atlas-kpi">
          <div className="operza-kpi__header">
            <span className="operza-kpi__icon"><Icon name="wallet" size={15} /></span>
            <span className="operza-kpi__trend"><Icon name="arrow-up-right" size={12} /> +19%</span>
          </div>
          <div className="atlas-kpi__label">Collected Revenue</div>
          <div className="atlas-kpi__value tabular">{currency(paid)}</div>
          <div className="atlas-kpi__note">{pct(paid, total)} of billed amount</div>
          <svg className="operza-kpi__sparkline" viewBox="0 0 100 20" fill="none" preserveAspectRatio="none">
            <path d="M0 16 Q25 12 50 6 T100 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ color: '#10b981', opacity: 0.8 }} />
          </svg>
        </article>

        <article className="operza-kpi atlas-kpi">
          <div className="operza-kpi__header">
            <span className="operza-kpi__icon"><Icon name="clock" size={15} /></span>
            <span className="operza-kpi__trend">Pending</span>
          </div>
          <div className="atlas-kpi__label">Outstanding</div>
          <div className="atlas-kpi__value tabular">{currency(outstanding)}</div>
          <div className="atlas-kpi__note">Sent &amp; overdue receivables</div>
          <svg className="operza-kpi__sparkline" viewBox="0 0 100 20" fill="none" preserveAspectRatio="none">
            <path d="M0 14 Q30 8 60 12 T100 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ color: '#3b82f6', opacity: 0.8 }} />
          </svg>
        </article>

        <article className="operza-kpi atlas-kpi">
          <div className="operza-kpi__header">
            <span className="operza-kpi__icon"><Icon name="bell" size={15} /></span>
            <span className="operza-kpi__trend">Overdue</span>
          </div>
          <div className="atlas-kpi__label">Past Due Invoices</div>
          <div className="atlas-kpi__value tabular">{currency(overdue)}</div>
          <div className="atlas-kpi__note">Requires dunning follow-up</div>
          <svg className="operza-kpi__sparkline" viewBox="0 0 100 20" fill="none" preserveAspectRatio="none">
            <path d="M0 18 Q35 14 70 6 T100 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ color: '#ef4444', opacity: 0.8 }} />
          </svg>
        </article>

        <article className="operza-kpi atlas-kpi">
          <div className="operza-kpi__header">
            <span className="operza-kpi__icon"><Icon name="clipboard" size={15} /></span>
            <span className="operza-kpi__trend">Total</span>
          </div>
          <div className="atlas-kpi__label">Total Invoices</div>
          <div className="atlas-kpi__value tabular">{state.invoices.length}</div>
          <div className="atlas-kpi__note">Workspace invoice volume</div>
          <svg className="operza-kpi__sparkline" viewBox="0 0 100 20" fill="none" preserveAspectRatio="none">
            <path d="M0 10 Q30 14 60 8 T100 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ color: 'var(--accent)', opacity: 0.8 }} />
          </svg>
        </article>
      </section>

      <section className="card-premium" style={{ marginTop: 22, padding: '20px 24px' }}>
        <div className="card__head" style={{ paddingBottom: 0, borderBottom: 'none' }}>
          <div className="tabs" style={{ borderBottom: 'none', padding: 0 }}>
            <button className={`tab${tab === 'invoices' ? ' is-active' : ''}`} onClick={() => setTab('invoices')}>
              Invoices
            </button>
            <button className={`tab${tab === 'products' ? ' is-active' : ''}`} onClick={() => setTab('products')}>
              Products
            </button>
          </div>
          <div className="card__actions">
            <button className="btn btn--sm">
              <Icon name="filter" size={14} /> Filter
            </button>
          </div>
        </div>

        {tab === 'invoices' ? (
          <div className="table-wrap" style={{ borderTop: '1px solid var(--line)' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Contact</th>
                  <th>Issued</th>
                  <th>Status</th>
                  <th className="cell-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {state.invoices.map((inv) => {
                  const contact = contactOf(inv.contactId);
                  return (
                    <tr key={inv.id}>
                      <td className="cell-main">{inv.number}</td>
                      <td>
                        {contact ? (
                          <Link className="person" to={`/contacts/${contact.id}`}>
                            <Avatar name={`${contact.firstName} ${contact.lastName}`} size="xs" />
                            <span>
                              {contact.firstName} {contact.lastName}
                            </span>
                          </Link>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="cell-sub">{fullDate(inv.issuedAt)}</td>
                      <td>
                        <select
                          className="select"
                          style={{ height: 28, width: 116, fontSize: 12 }}
                          value={inv.status}
                          onChange={(e) => handleStatusChange(inv.id, e.target.value as InvoiceStatus)}
                        >
                          {STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="cell-right cell-num">{currency(inv.amount)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ borderTop: '1px solid var(--line)' }}>
            {state.products.length === 0 ? (
              <EmptyState icon={<Icon name="wallet" size={20} />} title="No products" />
            ) : (
              state.products.map((p) => (
                <div className="list-row" key={p.id}>
                  <div
                    className="avatar avatar--md avatar--square"
                    style={{ background: p.kind === 'recurring' ? 'var(--violet-soft)' : 'var(--accent-soft)', color: p.kind === 'recurring' ? 'var(--violet)' : 'var(--accent)' }}
                  >
                    <Icon name={p.kind === 'recurring' ? 'refresh' : 'dollar'} size={16} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</div>
                    <div className="cell-sub">
                      {p.kind === 'recurring' ? 'Recurring monthly' : 'One-time payment'}
                    </div>
                  </div>
                  <Badge tone={p.active ? 'green' : 'default'} dot>
                    {p.active ? 'Active' : 'Inactive'}
                  </Badge>
                  <strong className="cell-num" style={{ width: 90, textAlign: 'right' }}>
                    {currency(p.price)}
                  </strong>
                  <Switch on={p.active} label={`Toggle ${p.name}`} onChange={() => handleProductToggle(p.id, p.active)} />
                </div>
              ))
            )}
          </div>
        )}
      </section>

      {tab === 'invoices' && (
        <div className="hint" style={{ marginTop: 10 }}>
          Change an invoice status from the dropdown — totals above update instantly.
        </div>
      )}

      {creating && (
        <NewInvoice
          onClose={() => setCreating(false)}
          onSave={async (invoice) => {
            let finalId = invoice.id;
            try {
              const res = await api.crm.create('invoices', {
                number: invoice.number,
                contactId: invoice.contactId,
                amount: invoice.amount,
                status: invoice.status,
                dueDate: invoice.issuedAt,
              });
              if (res?.id) finalId = res.id;
            } catch (err) {
              console.error('Failed to persist invoice to API:', err);
            }
            dispatch({ type: 'invoice/add', invoice: { ...invoice, id: finalId } });
            setCreating(false);
          }}
        />
      )}
    </main>
  );
}

function NewInvoice({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (i: {
    id: string;
    number: string;
    contactId: string;
    amount: number;
    status: InvoiceStatus;
    issuedAt: string;
  }) => void;
}) {
  const { state } = useStore();
  const nextNumber = `INV-${1042 + state.invoices.length}`;
  const [contactId, setContactId] = useState(state.contacts[0]?.id ?? '');
  const [productId, setProductId] = useState(state.products[0]?.id ?? '');
  const [amount, setAmount] = useState(String(state.products[0]?.price ?? 0));

  const pickProduct = (id: string) => {
    setProductId(id);
    const product = state.products.find((p) => p.id === id);
    if (product) setAmount(String(product.price));
  };

  return (
    <Modal
      title={`New invoice · ${nextNumber}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn--primary"
            disabled={!contactId || Number(amount) <= 0}
            onClick={() =>
              onSave({
                id: uid('inv'),
                number: nextNumber,
                contactId,
                amount: Number(amount),
                status: 'draft',
                issuedAt: new Date().toISOString(),
              })
            }
          >
            Create invoice
          </button>
        </>
      }
    >
      <div className="field">
        <label>Contact</label>
        <select className="select" value={contactId} onChange={(e) => setContactId(e.target.value)}>
          {state.contacts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.firstName} {c.lastName} — {c.company}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Product</label>
        <select className="select" value={productId} onChange={(e) => pickProduct(e.target.value)}>
          {state.products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} — {currency(p.price)}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Amount (USD)</label>
        <input className="input" type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      <div className="row" style={{ gap: 8 }}>
        <StatusBadge status="draft" />
        <span className="hint">Invoices start as drafts. Mark them sent once delivered.</span>
      </div>
    </Modal>
  );
}
