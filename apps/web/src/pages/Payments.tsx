import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Avatar, Badge, EmptyState, PageHeader, StatCard, StatusBadge, Switch } from '../components/ui';
import { useStore, uid } from '../lib/store';
import { currency, fullDate, pct } from '../lib/format';
import type { InvoiceStatus } from '../lib/types';

const STATUSES: InvoiceStatus[] = ['draft', 'sent', 'paid', 'overdue'];

export default function Payments() {
  const { state, dispatch } = useStore();
  const [tab, setTab] = useState<'invoices' | 'products'>('invoices');
  const [creating, setCreating] = useState(false);

  const paid = state.invoices.filter((i) => i.status === 'paid').reduce((s, i) => s + i.amount, 0);
  const outstanding = state.invoices
    .filter((i) => i.status === 'sent' || i.status === 'overdue')
    .reduce((s, i) => s + i.amount, 0);
  const overdue = state.invoices.filter((i) => i.status === 'overdue').reduce((s, i) => s + i.amount, 0);
  const total = state.invoices.reduce((s, i) => s + i.amount, 0);

  const contactOf = (id: string) => state.contacts.find((c) => c.id === id);

  return (
    <div className="content">
      <PageHeader
        title="Payments"
        subtitle="Invoices, products and subscription revenue."
        actions={
          <button className="btn btn--primary" onClick={() => setCreating(true)}>
            <Icon name="plus" size={16} /> New invoice
          </button>
        }
      />

      <div className="grid grid--4" style={{ marginBottom: 16 }}>
        <StatCard label="Collected" value={currency(paid)} icon={<Icon name="wallet" size={15} />} meta={`${pct(paid, total)} of billed`} />
        <StatCard label="Outstanding" value={currency(outstanding)} icon={<Icon name="clock" size={15} />} meta="sent + overdue" />
        <StatCard label="Overdue" value={currency(overdue)} icon={<Icon name="bell" size={15} />} meta="needs follow-up" />
        <StatCard label="Invoices" value={String(state.invoices.length)} icon={<Icon name="clipboard" size={15} />} meta="this workspace" />
      </div>

      <div className="card">
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
                          onChange={(e) =>
                            dispatch({ type: 'invoice/status', id: inv.id, status: e.target.value as InvoiceStatus })
                          }
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
                  <Switch on={p.active} label={`Toggle ${p.name}`} onChange={() => dispatch({ type: 'product/toggle', id: p.id })} />
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {tab === 'invoices' && (
        <div className="hint" style={{ marginTop: 10 }}>
          Change an invoice status from the dropdown — totals above update instantly.
        </div>
      )}

      {creating && (
        <NewInvoice
          onClose={() => setCreating(false)}
          onSave={(invoice) => {
            dispatch({ type: 'invoice/add', invoice });
            setCreating(false);
          }}
        />
      )}
    </div>
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
