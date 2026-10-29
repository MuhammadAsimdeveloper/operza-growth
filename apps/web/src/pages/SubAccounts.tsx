import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Badge, EmptyState, PageHeader, StatCard } from '../components/ui';
import { currency, num, shortDate } from '../lib/format';
import { uid, useStore } from '../lib/store';
import { api } from '../lib/api';
import type { SaasPlan, SubAccount, SubAccountStatus } from '../lib/types';

type Filter = 'all' | SubAccountStatus;

const STATUS_META: Record<SubAccountStatus, { label: string; tone: 'green' | 'blue' | 'amber' }> = {
  active: { label: 'Active', tone: 'green' },
  trial: { label: 'Trial', tone: 'blue' },
  paused: { label: 'Paused', tone: 'amber' },
};

export default function SubAccounts() {
  const { state, dispatch } = useStore();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<SubAccount | null>(null);
  const [editingPlan, setEditingPlan] = useState<SaasPlan | null>(null);

  useEffect(() => {
    let active = true;
    api.agency.getLocations().then((res) => {
      if (!active || !res?.locations) return;
      for (const loc of res.locations) {
        if (!state.subAccounts.some((a) => a.id === loc.id)) {
          dispatch({
            type: 'subAccount/add',
            account: {
              id: loc.id,
              name: loc.name,
              industry: loc.industry || 'General',
              ownerEmail: loc.ownerEmail || 'admin@' + (loc.name.toLowerCase().replace(/[^a-z0-9]/g, '') || 'workspace') + '.com',
              planId: loc.planId || 'growth',
              seats: loc.seats || 2,
              contacts: loc.contactsCount || 0,
              status: (loc.status === 'paused' ? 'paused' : loc.status === 'trial' ? 'trial' : 'active') as SubAccountStatus,
              createdAt: loc.createdAt || new Date().toISOString(),
            },
          });
        }
      }
    }).catch(() => {});
    return () => {
      active = false;
    };
  }, [state.subAccounts, dispatch]);

  const planOf = (id: string) => state.saasPlans.find((p) => p.id === id);
  const planTone = (id: string): 'default' | 'blue' | 'violet' => {
    const index = state.saasPlans.findIndex((p) => p.id === id);
    return index >= 2 ? 'violet' : index === 1 ? 'blue' : 'default';
  };
  const mrrOf = (account: SubAccount) =>
    account.status === 'active' ? planOf(account.planId)?.price ?? 0 : 0;

  const q = query.trim().toLowerCase();
  const rows = state.subAccounts.filter((a) => {
    if (filter !== 'all' && a.status !== filter) return false;
    if (!q) return true;
    return `${a.name} ${a.industry} ${a.ownerEmail}`.toLowerCase().includes(q);
  });

  const active = state.subAccounts.filter((a) => a.status === 'active');
  const trials = state.subAccounts.filter((a) => a.status === 'trial');
  const mrr = state.subAccounts.reduce((sum, a) => sum + mrrOf(a), 0);
  const seats = state.subAccounts.reduce((sum, a) => sum + a.seats, 0);

  const overLimit = state.subAccounts.filter((a) => {
    const plan = planOf(a.planId);
    return plan && a.contacts > plan.contactLimit;
  });

  return (
    <div className="content">
      <PageHeader
        title="Sub-accounts"
        subtitle="Every client workspace your agency runs, with plan limits and billing in one place."
        actions={
          <button className="btn btn--primary" onClick={() => setCreating(true)}>
            <Icon name="plus" size={16} /> New sub-account
          </button>
        }
      />

      <div className="grid grid--4" style={{ marginBottom: 16 }}>
        <StatCard
          label="Sub-accounts"
          value={num(state.subAccounts.length)}
          icon={<Icon name="building" size={15} />}
          meta={`${active.length} active`}
        />
        <StatCard
          label="Monthly recurring"
          value={currency(mrr)}
          icon={<Icon name="wallet" size={15} />}
          meta="from active accounts"
        />
        <StatCard
          label="On trial"
          value={num(trials.length)}
          icon={<Icon name="clock" size={15} />}
          meta="not yet billed"
        />
        <StatCard
          label="Seats sold"
          value={num(seats)}
          icon={<Icon name="users" size={15} />}
          meta="across all accounts"
        />
      </div>

      <div className="grid grid--sidebar">
        <div className="stack">
          <div className="card">
            <div className="card__head">
              <div>
                <div className="card__title">Client workspaces</div>
                <div className="card__sub">{rows.length} of {state.subAccounts.length}</div>
              </div>
              <div className="card__actions">
                <div className="search" style={{ width: 220 }}>
                  <Icon name="search" size={15} />
                  <input
                    className="input"
                    placeholder="Search accounts"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="segmented" style={{ margin: '0 16px 12px' }}>
              {(['all', 'active', 'trial', 'paused'] as Filter[]).map((f) => (
                <button
                  key={f}
                  className={filter === f ? 'is-active' : ''}
                  onClick={() => setFilter(f)}
                  style={{ textTransform: 'capitalize' }}
                >
                  {f === 'all' ? 'All' : STATUS_META[f].label}
                </button>
              ))}
            </div>

            {rows.length === 0 ? (
              <EmptyState
                icon={<Icon name="building" size={22} />}
                title={state.subAccounts.length === 0 ? 'No sub-accounts' : 'No matches'}
                text={
                  state.subAccounts.length === 0
                    ? 'Create a client workspace to start managing plans and usage.'
                    : 'Try another status filter or search term.'
                }
                action={
                  state.subAccounts.length === 0 ? (
                    <button className="btn btn--sm" onClick={() => setCreating(true)}>
                      New sub-account
                    </button>
                  ) : undefined
                }
              />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Sub-account</th>
                      <th>Plan</th>
                      <th>Seats</th>
                      <th>Contacts</th>
                      <th>Created</th>
                      <th>Status</th>
                      <th style={{ width: 86 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((account) => {
                      const plan = planOf(account.planId);
                      const over = Boolean(plan && account.contacts > plan.contactLimit);
                      return (
                        <tr key={account.id}>
                          <td>
                            <div style={{ fontSize: 13, fontWeight: 550 }}>{account.name}</div>
                            <div className="cell-sub">
                              {account.industry} · {account.ownerEmail}
                            </div>
                          </td>
                          <td>
                            <div className="row" style={{ gap: 6 }}>
                              <Badge tone={planTone(account.planId)}>
                                {plan?.name ?? 'Custom'}
                              </Badge>
                              <span className="cell-sub">{currency(mrrOf(account))}/mo</span>
                            </div>
                          </td>
                          <td className="cell-sub">{account.seats}</td>
                          <td>
                            <span className="cell-sub" style={{ color: over ? 'var(--red)' : undefined }}>
                              {num(account.contacts)}
                              {plan ? ` / ${num(plan.contactLimit)}` : ''}
                            </span>
                            {over && (
                              <Badge tone="red" dot>
                                Over limit
                              </Badge>
                            )}
                          </td>
                          <td className="cell-sub">{shortDate(account.createdAt)}</td>
                          <td>
                            <Badge tone={STATUS_META[account.status].tone} dot>
                              {STATUS_META[account.status].label}
                            </Badge>
                          </td>
                          <td className="cell-right">
                            <span className="row" style={{ gap: 2, justifyContent: 'flex-end' }}>
                              <button
                                className="icon-btn"
                                aria-label={`${account.status === 'paused' ? 'Resume' : 'Pause'} ${account.name}`}
                                onClick={async () => {
                                  const nextStatus = account.status === 'paused' ? 'active' : 'paused';
                                  try {
                                    await api.agency.updateLocation(account.id, { status: nextStatus });
                                  } catch (err) {
                                    console.error('Failed to update status on server:', err);
                                  }
                                  dispatch({
                                    type: 'subAccount/status',
                                    id: account.id,
                                    status: nextStatus,
                                  });
                                }}
                              >
                                <Icon name={account.status === 'paused' ? 'play' : 'pause'} size={15} />
                              </button>
                              <button
                                className="icon-btn"
                                aria-label={`Edit ${account.name}`}
                                onClick={() => setEditing(account)}
                              >
                                <Icon name="edit" size={15} />
                              </button>
                              <button
                                className="icon-btn"
                                aria-label={`Delete ${account.name}`}
                                onClick={async () => {
                                  try {
                                    await api.agency.deleteLocation(account.id);
                                  } catch (err) {
                                    console.error('Failed to delete location on server:', err);
                                  }
                                  dispatch({ type: 'subAccount/delete', id: account.id });
                                }}
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

          <div className="hint">
            Pausing an account stops billing and freezes its workspace. Trials are not billed until they convert.
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <div className="card__head">
              <div className="card__title">SaaS plans</div>
              <div className="card__actions">
                <Badge>{state.saasPlans.length}</Badge>
              </div>
            </div>
            <div>
              {state.saasPlans.map((plan) => {
                const assigned = state.subAccounts.filter((a) => a.planId === plan.id).length;
                return (
                  <div className="list-row" key={plan.id}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="row" style={{ gap: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{plan.name}</span>
                        <span className="cell-sub">{currency(plan.price)}/mo</span>
                      </div>
                      <div className="cell-sub">
                        {plan.seats} seat{plan.seats === 1 ? '' : 's'} · {num(plan.contactLimit)} contacts ·{' '}
                        {num(plan.smsCredits)} SMS
                      </div>
                      <div className="cell-sub">
                        {assigned} account{assigned === 1 ? '' : 's'} on this plan
                      </div>
                    </div>
                    <button className="btn btn--sm" onClick={() => setEditingPlan(plan)}>
                      Edit
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card">
            <div className="card__head">
              <div className="card__title">Usage health</div>
              <div className="card__actions">
                <Badge tone={overLimit.length ? 'red' : 'green'}>{overLimit.length} over limit</Badge>
              </div>
            </div>
            {overLimit.length === 0 ? (
              <EmptyState icon={<Icon name="check" size={20} />} title="All accounts within plan limits" />
            ) : (
              <div>
                {overLimit.map((account) => {
                  const plan = planOf(account.planId);
                  const pct = plan ? Math.min(100, Math.round((account.contacts / plan.contactLimit) * 100)) : 0;
                  return (
                    <div className="list-row" key={account.id}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 550 }}>{account.name}</div>
                        <div className="meter" style={{ marginTop: 5 }}>
                          <div className="meter__fill" style={{ width: `${pct}%`, background: 'var(--red)' }} />
                        </div>
                        <div className="cell-sub" style={{ marginTop: 4 }}>
                          {num(account.contacts)} of {num(plan?.contactLimit ?? 0)} contacts
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {(creating || editing) && (
        <SubAccountModal
          account={editing ?? undefined}
          plans={state.saasPlans}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSave={async (draft) => {
            if (editing) {
              try {
                await api.agency.updateLocation(editing.id, draft);
              } catch (err) {
                console.error('Failed to update subaccount:', err);
              }
              dispatch({ type: 'subAccount/update', id: editing.id, patch: draft });
            } else {
              let newId = uid('sa');
              try {
                const res = await api.agency.createLocation({
                  name: draft.name,
                  industry: draft.industry,
                  ownerEmail: draft.ownerEmail,
                  planId: draft.planId,
                  seats: draft.seats,
                  status: draft.status
                });
                if (res?.id) newId = res.id;
              } catch (err) {
                console.error('Failed to create subaccount in backend:', err);
              }
              dispatch({
                type: 'subAccount/add',
                account: { ...draft, id: newId, contacts: 0, createdAt: new Date().toISOString() },
              });
            }
            setCreating(false);
            setEditing(null);
          }}
        />
      )}

      {editingPlan && (
        <PlanModal
          plan={editingPlan}
          onClose={() => setEditingPlan(null)}
          onSave={(patch) => {
            dispatch({ type: 'plan/update', id: editingPlan.id, patch });
            setEditingPlan(null);
          }}
        />
      )}
    </div>
  );
}

function SubAccountModal({
  account,
  plans,
  onClose,
  onSave,
}: {
  account?: SubAccount;
  plans: SaasPlan[];
  onClose: () => void;
  onSave: (draft: Omit<SubAccount, 'id' | 'contacts' | 'createdAt'>) => void;
}) {
  const [name, setName] = useState(account?.name ?? '');
  const [industry, setIndustry] = useState(account?.industry ?? '');
  const [ownerEmail, setOwnerEmail] = useState(account?.ownerEmail ?? '');
  const [planId, setPlanId] = useState(account?.planId ?? plans[0]?.id ?? '');
  const [status, setStatus] = useState<SubAccountStatus>(account?.status ?? 'trial');
  const [seats, setSeats] = useState(String(account?.seats ?? plans[0]?.seats ?? 1));

  const plan = plans.find((p) => p.id === planId);
  const seatCount = Number(seats);
  const canSave =
    name.trim().length > 0 &&
    ownerEmail.includes('@') &&
    planId !== '' &&
    Number.isFinite(seatCount) &&
    seatCount >= 1 &&
    (!plan || seatCount <= plan.seats);

  const save = () => {
    if (!canSave) return;
    onSave({
      name: name.trim(),
      industry: industry.trim() || 'General',
      ownerEmail: ownerEmail.trim(),
      planId,
      status,
      seats: seatCount,
    });
  };

  return (
    <Modal
      title={account ? `Edit ${account.name}` : 'New sub-account'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn--primary" type="button" disabled={!canSave} onClick={save}>
            {account ? 'Save changes' : 'Create sub-account'}
          </button>
        </>
      }
    >
      <div className="grid grid--2">
        <div className="field">
          <label htmlFor="sa-name">Name</label>
          <input
            id="sa-name"
            className="input"
            autoFocus
            placeholder="Northwind Studio"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="sa-industry">Industry</label>
          <input
            id="sa-industry"
            className="input"
            placeholder="Design"
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
          />
        </div>
        <div className="field" style={{ gridColumn: '1 / -1' }}>
          <label htmlFor="sa-email">Owner email</label>
          <input
            id="sa-email"
            className="input"
            type="email"
            placeholder="owner@client.test"
            value={ownerEmail}
            onChange={(e) => setOwnerEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="sa-plan">Plan</label>
          <select id="sa-plan" className="select" value={planId} onChange={(e) => setPlanId(e.target.value)}>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {currency(p.price)}/mo
              </option>
            ))}
          </select>
          {plan && <div className="hint">Up to {plan.seats} seats and {num(plan.contactLimit)} contacts.</div>}
        </div>
        <div className="field">
          <label htmlFor="sa-seats">Seats</label>
          <input
            id="sa-seats"
            className="input"
            type="number"
            min="1"
            max={plan?.seats}
            value={seats}
            onChange={(e) => setSeats(e.target.value)}
          />
          {plan && seatCount > plan.seats && (
            <div className="hint" style={{ color: 'var(--red)' }}>
              This plan only includes {plan.seats} seat{plan.seats === 1 ? '' : 's'}.
            </div>
          )}
        </div>
        <div className="field" style={{ gridColumn: '1 / -1' }}>
          <label htmlFor="sa-status">Status</label>
          <select
            id="sa-status"
            className="select"
            value={status}
            onChange={(e) => setStatus(e.target.value as SubAccountStatus)}
          >
            <option value="trial">Trial — not billed yet</option>
            <option value="active">Active — billed monthly</option>
            <option value="paused">Paused — billing stopped</option>
          </select>
        </div>
      </div>
    </Modal>
  );
}

function PlanModal({
  plan,
  onClose,
  onSave,
}: {
  plan: SaasPlan;
  onClose: () => void;
  onSave: (patch: Partial<SaasPlan>) => void;
}) {
  const [price, setPrice] = useState(String(plan.price));
  const [seats, setSeats] = useState(String(plan.seats));
  const [contactLimit, setContactLimit] = useState(String(plan.contactLimit));
  const [smsCredits, setSmsCredits] = useState(String(plan.smsCredits));

  const numbers = [price, seats, contactLimit, smsCredits].map(Number);
  const canSave = numbers.every((n) => Number.isFinite(n) && n >= 0) && numbers[1] >= 1;

  const save = () => {
    if (!canSave) return;
    onSave({
      price: numbers[0],
      seats: numbers[1],
      contactLimit: numbers[2],
      smsCredits: numbers[3],
    });
  };

  return (
    <Modal
      title={`${plan.name} plan`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn--primary" type="button" disabled={!canSave} onClick={save}>
            Save plan
          </button>
        </>
      }
    >
      <div className="grid grid--2">
        <div className="field">
          <label htmlFor="plan-price">Monthly price (USD)</label>
          <input
            id="plan-price"
            className="input"
            type="number"
            min="0"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="plan-seats">Seats</label>
          <input
            id="plan-seats"
            className="input"
            type="number"
            min="1"
            value={seats}
            onChange={(e) => setSeats(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="plan-contacts">Contact limit</label>
          <input
            id="plan-contacts"
            className="input"
            type="number"
            min="0"
            value={contactLimit}
            onChange={(e) => setContactLimit(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="plan-sms">SMS credits</label>
          <input
            id="plan-sms"
            className="input"
            type="number"
            min="0"
            value={smsCredits}
            onChange={(e) => setSmsCredits(e.target.value)}
          />
        </div>
      </div>
      <div className="hint">Changing a plan updates billing for every active account on it immediately.</div>
    </Modal>
  );
}
