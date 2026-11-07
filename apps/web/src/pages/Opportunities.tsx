import { api } from '../lib/api';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Avatar, Badge } from '../components/ui';
import { useStore, uid } from '../lib/store';
import { currency, num } from '../lib/format';

export default function Opportunities() {
  const { state, dispatch } = useStore();
  const location = useLocation();
  const navigate = useNavigate();
  const [pipelineId, setPipelineId] = useState(state.pipelines[0]?.id ?? '');
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null); // stage id

  useEffect(() => {
    const routeState = location.state as { openAddOpportunity?: boolean } | null;
    if (!routeState?.openAddOpportunity) return;
    const firstStage = state.pipelines[0]?.stages[0]?.id;
    if (firstStage) setAdding(firstStage);
    navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, navigate, state.pipelines]);

  const pipeline = state.pipelines.find((p) => p.id === pipelineId) ?? state.pipelines[0];
  const deals = useMemo(
    () => state.opportunities.filter((o) => o.pipelineId === pipeline?.id),
    [state.opportunities, pipeline?.id],
  );

  const openDeals = deals.filter((d) => d.status === 'open');
  const won = deals.filter((d) => d.status === 'won');
  const totalOpen = openDeals.reduce((s, d) => s + d.value, 0);
  const totalWon = won.reduce((s, d) => s + d.value, 0);
  const avgDeal = openDeals.length ? totalOpen / openDeals.length : 0;

  const contactOf = (id: string) => state.contacts.find((c) => c.id === id);

  const drop = async (stageId: string) => {
    if (dragId) {
      dispatch({ type: 'opportunity/move', id: dragId, stageId });
      const stageName = pipeline.stages.find((s) => s.id === stageId)?.name || stageId;
      try {
        await api.opportunities.updateStage(dragId, stageName, stageId);
      } catch (err) {
        console.error('Failed to sync stage transition:', err);
      }
    }
    setDragId(null);
    setOverStage(null);
  };

  if (!pipeline) return null;

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
            {state.pipelines.map((p) => (
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
        <div className="atlas-eyebrow">DEAL VELOCITY &amp; REVENUE PIPELINE</div>
        <h2>Interactive Sales Pipeline &amp; Conversion Throughput</h2>
        <p>Track high-value prospects, stage progression velocity, won deal values, and forecasted revenue from an interactive Kanban board.</p>
      </section>

      <section className="atlas-kpis" aria-label="Pipeline metrics">
        <article className="operza-kpi atlas-kpi">
          <div className="operza-kpi__header">
            <span className="operza-kpi__icon"><Icon name="kanban" size={15} /></span>
            <span className="operza-kpi__trend"><Icon name="arrow-up-right" size={12} /> +14%</span>
          </div>
          <div className="atlas-kpi__label">Open Pipeline</div>
          <div className="atlas-kpi__value tabular">{currency(totalOpen)}</div>
          <div className="atlas-kpi__note">{openDeals.length} active deals</div>
          <svg className="operza-kpi__sparkline" viewBox="0 0 100 20" fill="none" preserveAspectRatio="none">
            <path d="M0 16 Q25 12 50 6 T100 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ color: 'var(--accent)', opacity: 0.8 }} />
          </svg>
        </article>

        <article className="operza-kpi atlas-kpi">
          <div className="operza-kpi__header">
            <span className="operza-kpi__icon"><Icon name="check" size={15} /></span>
            <span className="operza-kpi__trend"><Icon name="arrow-up-right" size={12} /> +22%</span>
          </div>
          <div className="atlas-kpi__label">Won Revenue</div>
          <div className="atlas-kpi__value tabular">{currency(totalWon)}</div>
          <div className="atlas-kpi__note">{won.length} closed won</div>
          <svg className="operza-kpi__sparkline" viewBox="0 0 100 20" fill="none" preserveAspectRatio="none">
            <path d="M0 14 Q30 8 60 12 T100 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ color: '#10b981', opacity: 0.8 }} />
          </svg>
        </article>

        <article className="operza-kpi atlas-kpi">
          <div className="operza-kpi__header">
            <span className="operza-kpi__icon"><Icon name="dollar" size={15} /></span>
            <span className="operza-kpi__trend"><Icon name="arrow-up-right" size={12} /> +5%</span>
          </div>
          <div className="atlas-kpi__label">Average Deal</div>
          <div className="atlas-kpi__value tabular">{currency(Math.round(avgDeal))}</div>
          <div className="atlas-kpi__note">Open pipeline avg</div>
          <svg className="operza-kpi__sparkline" viewBox="0 0 100 20" fill="none" preserveAspectRatio="none">
            <path d="M0 18 Q35 14 70 6 T100 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ color: '#3b82f6', opacity: 0.8 }} />
          </svg>
        </article>

        <article className="operza-kpi atlas-kpi">
          <div className="operza-kpi__header">
            <span className="operza-kpi__icon"><Icon name="chart" size={15} /></span>
            <span className="operza-kpi__trend">Solid</span>
          </div>
          <div className="atlas-kpi__label">Win Rate</div>
          <div className="atlas-kpi__value tabular">{deals.length ? Math.round((won.length / deals.length) * 100) : 0}%</div>
          <div className="atlas-kpi__note">{deals.length} total opportunities</div>
          <svg className="operza-kpi__sparkline" viewBox="0 0 100 20" fill="none" preserveAspectRatio="none">
            <path d="M0 10 Q30 14 60 8 T100 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ color: '#f59e0b', opacity: 0.8 }} />
          </svg>
        </article>
      </section>

      <section className="card-premium" style={{ marginTop: 22, padding: '20px 24px' }}>

      <div className="board">
        {pipeline.stages.map((stage) => {
          const stageDeals = deals.filter((d) => d.stageId === stage.id);
          const value = stageDeals.reduce((s, d) => s + d.value, 0);
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
                {stageDeals.map((d) => {
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

      <div className="hint" style={{ marginTop: 12 }}>
        Tip: drag a card to move it between stages. Changes save automatically.
      </div>
    </section>

      {adding && (
        <AddDeal
          pipelineId={pipeline.id}
          stageId={adding}
          onClose={() => setAdding(null)}
          onSave={(payload) => {
            dispatch({ type: 'opportunity/add', opportunity: payload });
            const stageName = pipeline.stages.find((s) => s.id === payload.stageId)?.name || payload.stageId;
            api.crm.create('opportunities', { ...payload, stage: stageName }).catch(() => {});
            setAdding(null);
          }}
        />
      )}
    </main>
  );
}

function AddDeal({
  pipelineId,
  stageId,
  onClose,
  onSave,
}: {
  pipelineId: string;
  stageId: string;
  onClose: () => void;
  onSave: (o: {
    id: string;
    name: string;
    pipelineId: string;
    stageId: string;
    contactId: string;
    value: number;
    status: 'open';
    owner: string;
    createdAt: string;
  }) => void;
}) {
  const { state } = useStore();
  const pipeline = state.pipelines.find((p) => p.id === pipelineId)!;
  const [name, setName] = useState('');
  const [contactId, setContactId] = useState(state.contacts[0]?.id ?? '');
  const [value, setValue] = useState('0');
  const [stage, setStage] = useState(stageId);
  const [owner, setOwner] = useState('Asim R.');

  const valid = name.trim() && contactId;

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
                id: uid('o'),
                name: name.trim(),
                pipelineId,
                stageId: stage,
                contactId,
                value: Number(value) || 0,
                status: 'open',
                owner,
                createdAt: new Date().toISOString(),
              })
            }
          >
            Create deal
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
          {state.contacts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.firstName} {c.lastName} — {c.company}
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
            {pipeline.stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label>Owner</label>
        <select className="select" value={owner} onChange={(e) => setOwner(e.target.value)}>
          {state.team.map((t) => (
            <option key={t.id} value={t.name}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      <div className="hint">
        Demo workspace: {num(state.opportunities.length)} opportunities across {state.pipelines.length} pipelines.
      </div>
    </Modal>
  );
}

