import { useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Avatar, Badge, EmptyState, PageHeader, StatCard } from '../components/ui';
import { fullDate, num, sameDay, timeOf } from '../lib/format';
import { useStore } from '../lib/store';

export default function AuditLog() {
  const { state, dispatch } = useStore();
  const [query, setQuery] = useState('');
  const [entity, setEntity] = useState('all');
  const [actor, setActor] = useState('all');
  const [confirmClear, setConfirmClear] = useState(false);

  const entities = useMemo(
    () => Array.from(new Set(state.auditLog.map((e) => e.entity))).sort(),
    [state.auditLog],
  );
  const actors = useMemo(
    () => Array.from(new Set(state.auditLog.map((e) => e.actor))).sort(),
    [state.auditLog],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return state.auditLog
      .filter((entry) => {
        if (entity !== 'all' && entry.entity !== entity) return false;
        if (actor !== 'all' && entry.actor !== actor) return false;
        if (!q) return true;
        return `${entry.action} ${entry.entity} ${entry.detail ?? ''} ${entry.actor}`.toLowerCase().includes(q);
      })
      .sort((a, b) => b.at.localeCompare(a.at));
  }, [state.auditLog, entity, actor, query]);

  const today = state.auditLog.filter((e) => sameDay(new Date(e.at), new Date())).length;

  return (
    <div className="content">
      <PageHeader
        title="Audit Log"
        subtitle="A record of the changes made in this workspace, newest first."
        actions={
          <button className="btn" onClick={() => setConfirmClear(true)} disabled={state.auditLog.length === 0}>
            <Icon name="trash" size={15} /> Clear log
          </button>
        }
      />

      <div className="grid grid--4" style={{ marginBottom: 16 }}>
        <StatCard label="Events" value={num(state.auditLog.length)} icon={<Icon name="clipboard" size={15} />} meta="last 250 kept" />
        <StatCard label="Today" value={num(today)} icon={<Icon name="clock" size={15} />} meta="since midnight" />
        <StatCard label="Actors" value={num(actors.length)} icon={<Icon name="users" size={15} />} meta="people and integrations" />
        <StatCard label="Entities" value={num(entities.length)} icon={<Icon name="sliders" size={15} />} meta="record types touched" />
      </div>

      <div className="card">
        <div className="card__head" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div className="search" style={{ flex: '1 1 220px', maxWidth: 300 }}>
            <Icon name="search" size={15} />
            <input
              className="input"
              placeholder="Search actions or details…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <select className="select" style={{ width: 160 }} value={entity} onChange={(e) => setEntity(e.target.value)}>
            <option value="all">All entities</option>
            {entities.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <select className="select" style={{ width: 150 }} value={actor} onChange={(e) => setActor(e.target.value)}>
            <option value="all">All actors</option>
            {actors.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <span className="spacer" />
          <span className="hint">{rows.length} shown</span>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            icon={<Icon name="clipboard" size={22} />}
            title={state.auditLog.length === 0 ? 'No events recorded' : 'No events match'}
            text={
              state.auditLog.length === 0
                ? 'Changes you make across the workspace will appear here.'
                : 'Try clearing the search or filters.'
            }
            action={
              state.auditLog.length > 0 ? (
                <button
                  className="btn btn--sm"
                  onClick={() => {
                    setQuery('');
                    setEntity('all');
                    setActor('all');
                  }}
                >
                  Reset filters
                </button>
              ) : undefined
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Entity</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((entry) => (
                  <tr key={entry.id}>
                    <td className="cell-sub" style={{ whiteSpace: 'nowrap' }}>
                      {fullDate(entry.at)} · {timeOf(entry.at)}
                    </td>
                    <td>
                      <span className="person" style={{ cursor: 'default' }}>
                        <Avatar name={entry.actor} size="xs" />
                        <span>{entry.actor}</span>
                      </span>
                    </td>
                    <td className="cell-main">{entry.action}</td>
                    <td>
                      <Badge>{entry.entity}</Badge>
                    </td>
                    <td className="cell-sub">{entry.detail ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {confirmClear && (
        <Modal
          title="Clear the audit log?"
          onClose={() => setConfirmClear(false)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirmClear(false)}>
                Cancel
              </button>
              <button
                className="btn btn--primary"
                style={{ background: 'var(--red)', borderColor: 'var(--red)' }}
                onClick={() => {
                  dispatch({ type: 'audit/clear' });
                  setConfirmClear(false);
                }}
              >
                Clear log
              </button>
            </>
          }
        >
          <p style={{ fontSize: 13, lineHeight: 1.6 }}>
            This removes all {num(state.auditLog.length)} recorded events. New changes will still be logged afterwards.
          </p>
        </Modal>
      )}
    </div>
  );
}
