import { api } from '../lib/api';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Avatar, Badge, PageHeader, StatCard } from '../components/ui';
import { useStore, uid } from '../lib/store';
import { currency, num } from '../lib/format';

export default function Opportunities() {
  const { state, dispatch } = useStore();
  const [pipelineId, setPipelineId] = useState(state.pipelines[0]?.id ?? '');
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null); // stage id

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
    <div className="content">
      <PageHeader
        title="Opportunities"
        subtitle="Track deals through every stage of the pipeline."
        actions={
          <>
            <select
              className="select"
              style={{ width: 180 }}
              value={pipeline.id}
              onChange={(e) => setPipelineId(e.target.value)}
            >
              {state.pipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button className="btn btn--primary" onClick={() => setAdding(pipeline.stages[0].id)}>
              <Icon name="plus" size={16} /> Add opportunity
            </button>
          </>
        }
      />

      <div className="grid grid--4" style={{ marginBottom: 16 }}>
        <StatCard label="Open pipeline" value={currency(totalOpen)} icon={<Icon name="kanban" size={15} />} meta={`${openDeals.length} deals`} />
        <StatCard label="Won" value={currency(totalWon)} icon={<Icon name="check" size={15} />} meta={`${won.length} closed won`} />
        <StatCard label="Average deal" value={currency(Math.round(avgDeal))} icon={<Icon name="dollar" size={15} />} meta="open deals only" />
        <StatCard
          label="Win rate"
          value={`${deals.length ? Math.round((won.length / deals.length) * 100) : 0}%`}
          icon={<Icon name="chart" size={15} />}
          meta={`${deals.length} total`}
        />
      </div>

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

      <div className="hint" style={{ marginTop: 4 }}>
        Tip: drag a card to move it between stages. Changes save automatically.
      </div>

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
    </div>
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

