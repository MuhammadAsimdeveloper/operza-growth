import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Avatar, Badge, EmptyState, ErrorState, LoadingState } from '../components/ui';
import { useAuth } from '../lib/AuthContext';
import {
  useContacts,
  useOpportunities,
  useOpportunityMutations,
  usePipelines,
} from '../hooks/useWorkspaceData';
import { currency, num } from '../lib/format';
import { api } from '../lib/api';

const DEFAULT_STAGES = [
  { id: 'new_lead', name: 'New Lead', color: '#64748b' },
  { id: 'contacted', name: 'Contacted', color: '#3b82f6' },
  { id: 'qualified', name: 'Qualified', color: '#8b5cf6' },
  { id: 'proposal_sent', name: 'Proposal Sent', color: '#f59e0b' },
  { id: 'won', name: 'Won', color: '#10b981' },
  { id: 'lost', name: 'Lost', color: '#ef4444' },
];

export default function Opportunities() {
  const oppsQuery = useOpportunities();
  const pipelinesQuery = usePipelines();
  const contactsQuery = useContacts();
  const mutations = useOpportunityMutations();
  const location = useLocation();
  const navigate = useNavigate();

  const rawPipelines = pipelinesQuery.data?.data ?? pipelinesQuery.data?.pipelines ?? [];
  const pipelines = useMemo(() => {
    if (rawPipelines.length > 0) {
      return rawPipelines.map((p: any) => ({
        id: p.id,
        name: p.name || 'Lead Pipeline',
        stages: Array.isArray(p.stages) && p.stages.length > 0
          ? p.stages.map((s: any, i: number) =>
              typeof s === 'string'
                ? { id: s, name: s, color: DEFAULT_STAGES[i % DEFAULT_STAGES.length].color }
                : { id: s.id || s.name, name: s.name, color: s.color || DEFAULT_STAGES[i % DEFAULT_STAGES.length].color },
            )
          : DEFAULT_STAGES,
      }));
    }
    return [{ id: 'default', name: 'Lead Pipeline', stages: DEFAULT_STAGES }];
  }, [rawPipelines]);

  const [pipelineId, setPipelineId] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);

  const pipeline = pipelines.find((p: any) => p.id === pipelineId) ?? pipelines[0];
  const allOpportunities = oppsQuery.data?.data ?? [];
  const contacts = contactsQuery.data?.data ?? [];

  useEffect(() => {
    const routeState = location.state as { openAddOpportunity?: boolean } | null;
    if (!routeState?.openAddOpportunity || !pipeline?.stages?.[0]?.id) return;
    setAdding(pipeline.stages[0].id);
    navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, navigate, pipeline]);

  const deals = useMemo(
    () =>
      allOpportunities
        .filter((o: any) => !o.pipelineId || o.pipelineId === pipeline?.id || pipeline?.id === 'default')
        .map((o: any) => ({
          ...o,
          value: Number(o.value ?? o.monetaryValue ?? 0),
          status: o.status || 'open',
          owner: o.owner || 'Operator',
          stageId:
            o.stageId ||
            pipeline.stages.find((s: any) => s.name.toLowerCase() === String(o.stage || '').toLowerCase())?.id ||
            pipeline.stages[0]?.id,
        })),
    [allOpportunities, pipeline],
  );

  const openDeals = deals.filter((d: any) => d.status === 'open');
  const won = deals.filter((d: any) => d.status === 'won');
  const totalOpen = openDeals.reduce((s: number, d: any) => s + d.value, 0);
  const totalWon = won.reduce((s: number, d: any) => s + d.value, 0);
  const avgDeal = openDeals.length ? totalOpen / openDeals.length : 0;

  const contactOf = (id: string) => contacts.find((c: any) => c.id === id);

  const drop = async (stageId: string) => {
    if (dragId) {
      const stageName = pipeline.stages.find((s: any) => s.id === stageId)?.name || stageId;
      try {
        await api.opportunities.updateStage(dragId, stageName, stageId);
        await oppsQuery.refetch();
      } catch (err) {
        console.error('Failed to sync stage transition:', err);
      }
    }
    setDragId(null);
    setOverStage(null);
  };

  if (oppsQuery.isLoading || pipelinesQuery.isLoading) {
    return (
      <main className="operza-dashboard atlas-dashboard">
        <LoadingState message="Loading pipeline opportunities..." />
      </main>
    );
  }

  if (oppsQuery.isError) {
    return (
      <main className="operza-dashboard atlas-dashboard">
        <ErrorState
          title="Failed to load opportunities"
          message={(oppsQuery.error as Error)?.message}
          onRetry={() => oppsQuery.refetch()}
        />
      </main>
    );
  }

  return (
    <main className="operza-dashboard atlas-dashboard">
      <header className="atlas-dashboard__header">
        <div className="atlas-dashboard__heading">
          <div className="atlas-dashboard__breadcrumb">Workspace <span>/</span> Sales Pipeline</div>
          <h1>Opportunities</h1>
        </div>
        <div className="atlas-dashboard__toolbar">
          <select
            className="select"
            style={{ width: 190, background: 'var(--surface)', border: '1px solid var(--line)', color: 'var(--text)' }}
            value={pipeline.id}
            onChange={(e) => setPipelineId(e.target.value)}
          >
            {pipelines.map((p: any) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button className="atlas-quick-action-button" onClick={() => setAdding(pipeline.stages[0].id)}>
            <Icon name="plus" size={13} /> Add Opportunity
          </button>
        </div>
      </header>

      <section className="atlas-hero">
        <div className="atlas-eyebrow">DEAL VELOCITY &amp; PIPELINE VALUE</div>
        <h2>Sales Pipeline Management</h2>
        <p>Track deal progression, forecast weighted revenue, and manage conversion stages across your active pipeline.</p>
      </section>

      <section className="atlas-kpis" aria-label="Pipeline metrics">
        <article className="operza-kpi atlas-kpi">
          <div className="operza-kpi__header">
            <span className="operza-kpi__icon"><Icon name="kanban" size={15} /></span>
            <span className="operza-kpi__trend">Pipeline</span>
          </div>
          <div className="atlas-kpi__label">Open Pipeline</div>
          <div className="atlas-kpi__value tabular">{currency(totalOpen)}</div>
          <div className="atlas-kpi__note">{openDeals.length} active deals</div>
        </article>

        <article className="operza-kpi atlas-kpi">
          <div className="operza-kpi__header">
            <span className="operza-kpi__icon"><Icon name="check-circle" size={15} /></span>
            <span className="operza-kpi__trend">Won</span>
          </div>
          <div className="atlas-kpi__label">Closed Won</div>
          <div className="atlas-kpi__value tabular">{currency(totalWon)}</div>
          <div className="atlas-kpi__note">{won.length} deals closed</div>
        </article>

        <article className="operza-kpi atlas-kpi">
          <div className="operza-kpi__header">
            <span className="operza-kpi__icon"><Icon name="target" size={15} /></span>
            <span className="operza-kpi__trend">Avg</span>
          </div>
          <div className="atlas-kpi__label">Average Deal</div>
          <div className="atlas-kpi__value tabular">{currency(avgDeal)}</div>
          <div className="atlas-kpi__note">Per open opportunity</div>
        </article>

        <article className="operza-kpi atlas-kpi">
          <div className="operza-kpi__header">
            <span className="operza-kpi__icon"><Icon name="chart" size={15} /></span>
            <span className="operza-kpi__trend">Win Rate</span>
          </div>
          <div className="atlas-kpi__label">Win Rate</div>
          <div className="atlas-kpi__value tabular">{deals.length ? Math.round((won.length / deals.length) * 100) : 0}%</div>
          <div className="atlas-kpi__note">{deals.length} total opportunities</div>
        </article>
      </section>

      <section className="card-premium" style={{ marginTop: 22, padding: '20px 24px' }}>
        {pipeline.stages.length === 0 ? (
          <EmptyState icon={<Icon name="kanban" size={22} />} title="No stages configured" text="Add stages to your pipeline to track deals." />
        ) : (
          <div className="board">
            {pipeline.stages.map((stage: any) => {
              const stageDeals = deals.filter((d: any) => d.stageId === stage.id);
              const value = stageDeals.reduce((s: number, d: any) => s + d.value, 0);
              return (
                <div
                  key={stage.id}
                  className={`column${overStage === stage.id ? ' is-over' : ''}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setOverStage(stage.id);
                  }}
                  onDragLeave={() => setOverStage((s) => (s === stage.id ? null : s))}
                  onDrop={() => drop(stage.id)}
                >
                  <div className="column__head">
                    <span className="column__dot" style={{ background: stage.color }} />
                    <span className="column__name">{stage.name}</span>
                    <span className="column__count">{stageDeals.length}</span>
                  </div>
                  <div className="column__total">{currency(value)}</div>
                  <div className="column__list">
                    {stageDeals.map((d: any) => {
                      const contact = contactOf(d.contactId);
                      return (
                        <article
                          key={d.id}
                          className={`deal${dragId === d.id ? ' is-dragging' : ''}`}
                          draggable
                          onDragStart={() => setDragId(d.id)}
                          onDragEnd={() => {
                            setDragId(null);
                            setOverStage(null);
                          }}
                        >
                          <div className="deal__name">{d.name}</div>
                          {contact && (
                            <Link to={`/contacts/${contact.id}`} className="deal__contact" style={{ display: 'block' }}>
                              {contact.firstName} {contact.lastName} · {contact.company}
                            </Link>
                          )}
                          <div className="deal__foot">
                            <span className="deal__value">{currency(d.value)}</span>
                            <span className="row" style={{ gap: 5 }}>
                              {d.status !== 'open' && <Badge tone={d.status === 'won' ? 'green' : 'red'}>{d.status}</Badge>}
                              <Avatar name={d.owner} size="xs" />
                            </span>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                  <button className="column__add" onClick={() => setAdding(stage.id)}>
                    <Icon name="plus" size={14} /> Add deal
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div className="hint" style={{ marginTop: 12 }}>
          Tip: drag a card to move it between stages. Changes save to the server automatically.
        </div>
      </section>

      {adding && (
        <AddDeal
          pipeline={pipeline}
          stageId={adding}
          contacts={contacts}
          totalOpportunities={allOpportunities.length}
          totalPipelines={pipelines.length}
          isSaving={mutations.create.isPending}
          onClose={() => setAdding(null)}
          onSave={async (payload) => {
            const stageName = pipeline.stages.find((s: any) => s.id === payload.stageId)?.name || payload.stageId;
            await mutations.create.mutateAsync({ ...payload, stage: stageName });
            setAdding(null);
          }}
        />
      )}
    </main>
  );
}

function AddDeal({
  pipeline,
  stageId,
  contacts,
  totalOpportunities,
  totalPipelines,
  isSaving,
  onClose,
  onSave,
}: {
  pipeline: any;
  stageId: string;
  contacts: any[];
  totalOpportunities: number;
  totalPipelines: number;
  isSaving: boolean;
  onClose: () => void;
  onSave: (o: {
    name: string;
    pipelineId: string;
    stageId: string;
    contactId: string;
    value: number;
    status: 'open';
    owner: string;
  }) => Promise<void>;
}) {
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [contactId, setContactId] = useState(contacts[0]?.id ?? '');
  const [value, setValue] = useState('0');
  const [stage, setStage] = useState(stageId);
  const [owner, setOwner] = useState(user?.name || 'Operator');

  const valid = name.trim().length > 0 && !isSaving;

  return (
    <Modal
      title="Add opportunity"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn--primary"
            disabled={!valid}
            onClick={() =>
              onSave({
                name: name.trim(),
                pipelineId: pipeline.id,
                stageId: stage,
                contactId,
                value: Number(value) || 0,
                status: 'open',
                owner,
              })
            }
          >
            {isSaving ? 'Creating...' : 'Create deal'}
          </button>
        </>
      }
    >
      <div className="field">
        <label>Deal name</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Growth package — Acme" autoFocus />
      </div>
      <div className="field">
        <label>Contact</label>
        <select className="select" value={contactId} onChange={(e) => setContactId(e.target.value)}>
          <option value="">No contact selected</option>
          {contacts.map((c: any) => (
            <option key={c.id} value={c.id}>
              {c.firstName} {c.lastName} {c.company ? `— ${c.company}` : ''}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid--2">
        <div className="field">
          <label>Value (USD)</label>
          <input className="input" type="number" min="0" value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
        <div className="field">
          <label>Stage</label>
          <select className="select" value={stage} onChange={(e) => setStage(e.target.value)}>
            {pipeline.stages.map((s: any) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label>Owner</label>
        <input className="input" value={owner} onChange={(e) => setOwner(e.target.value)} />
      </div>
      <div className="hint">
        Workspace: {num(totalOpportunities)} opportunities across {totalPipelines} pipelines.
      </div>
    </Modal>
  );
}
