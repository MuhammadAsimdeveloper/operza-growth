import { useState } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Badge, EmptyState, PageHeader, StatCard } from '../components/ui';
import { fullDate, num, relative, timeOf } from '../lib/format';
import { uid, useStore } from '../lib/store';
import type { Snapshot } from '../lib/types';

const LIMIT = 5;

function sizeOf(snapshot: Snapshot): number {
  return new Blob([JSON.stringify(snapshot.data)]).size;
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function contentsOf(snapshot: Snapshot): string {
  const { contacts, opportunities, orders } = snapshot.data;
  return `${num(contacts.length)} contacts · ${num(opportunities.length)} deals · ${num(orders.length)} orders`;
}

function recordCount(snapshot: Snapshot): number {
  return Object.values(snapshot.data).reduce<number>(
    (sum, value) => sum + (Array.isArray(value) ? value.length : 0),
    0,
  );
}

function exportSnapshot(snapshot: Snapshot) {
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${snapshot.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'snapshot'}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function Snapshots() {
  const { state, dispatch } = useStore();
  const [creating, setCreating] = useState(false);
  const [confirm, setConfirm] = useState<{ kind: 'restore' | 'delete'; snapshot: Snapshot } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const totalSize = state.snapshots.reduce((sum, snapshot) => sum + sizeOf(snapshot), 0);
  const latest = state.snapshots[0];

  return (
    <div className="content">
      <PageHeader
        title="Account Snapshots"
        subtitle="Point-in-time copies of the whole workspace you can roll back to. The five most recent are kept."
        actions={
          <button className="btn btn--primary" onClick={() => setCreating(true)}>
            <Icon name="plus" size={15} /> Take snapshot
          </button>
        }
      />

      <div className="grid grid--3" style={{ marginBottom: 16 }}>
        <StatCard
          label="Snapshots kept"
          value={`${state.snapshots.length} / ${LIMIT}`}
          icon={<Icon name="database" size={15} />}
          meta="oldest rotates out"
        />
        <StatCard
          label="Storage used"
          value={state.snapshots.length ? formatSize(totalSize) : '—'}
          icon={<Icon name="folder" size={15} />}
          meta="in this browser"
        />
        <StatCard
          label="Latest snapshot"
          value={latest ? relative(latest.createdAt) : 'None yet'}
          icon={<Icon name="clock" size={15} />}
          meta={latest ? latest.name : 'take your first copy'}
        />
      </div>

      <div className="callout" style={{ marginBottom: 16 }}>
        Snapshot data lives in this browser with the workspace. Restoring replaces every record — contacts,
        deals, invoices and the rest — while the snapshot archive and audit trail are kept. Download a copy to
        keep it outside the app.
      </div>

      {notice && (
        <div className="callout callout--warn" style={{ marginBottom: 16 }}>
          {notice}
        </div>
      )}

      <div className="card">
        <div className="card__head">
          <div>
            <div className="card__title">Snapshot archive</div>
            <div className="card__sub">
              {state.snapshots.length === 0
                ? 'No snapshots taken'
                : `${state.snapshots.length} of ${LIMIT} slots used`}
            </div>
          </div>
        </div>

        {state.snapshots.length === 0 ? (
          <EmptyState
            icon={<Icon name="database" size={22} />}
            title="No snapshots yet"
            text="Capture the workspace before a bulk import, cleanup or plan change so you can roll back."
            action={
              <button className="btn btn--sm" onClick={() => setCreating(true)}>
                Take snapshot
              </button>
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Snapshot</th>
                  <th>Contents</th>
                  <th>Size</th>
                  <th>Created</th>
                  <th style={{ width: 210 }} />
                </tr>
              </thead>
              <tbody>
                {state.snapshots.map((snapshot, index) => (
                  <tr key={snapshot.id}>
                    <td>
                      <div className="row" style={{ gap: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 550 }}>{snapshot.name}</span>
                        {index === 0 && <Badge tone="blue">Latest</Badge>}
                      </div>
                      <div className="cell-sub">{contentsOf(snapshot)}</div>
                    </td>
                    <td className="cell-sub">{num(recordCount(snapshot))} records</td>
                    <td className="cell-sub">{formatSize(sizeOf(snapshot))}</td>
                    <td className="cell-sub" title={new Date(snapshot.createdAt).toLocaleString()}>
                      {relative(snapshot.createdAt)}
                      <div>{timeOf(snapshot.createdAt)}</div>
                    </td>
                    <td className="cell-right">
                      <span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                        <button
                          className="btn btn--sm"
                          onClick={() => {
                            setNotice(null);
                            setConfirm({ kind: 'restore', snapshot });
                          }}
                        >
                          <Icon name="refresh" size={13} /> Restore
                        </button>
                        <button
                          className="icon-btn"
                          aria-label={`Export ${snapshot.name}`}
                          onClick={() => exportSnapshot(snapshot)}
                        >
                          <Icon name="download" size={15} />
                        </button>
                        <button
                          className="icon-btn"
                          aria-label={`Delete ${snapshot.name}`}
                          onClick={() => {
                            setNotice(null);
                            setConfirm({ kind: 'delete', snapshot });
                          }}
                        >
                          <Icon name="trash" size={15} />
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {creating && (
        <CreateSnapshotModal
          atLimit={state.snapshots.length >= LIMIT}
          onClose={() => setCreating(false)}
          onCreate={(name) => {
            dispatch({ type: 'snapshot/create', id: uid('snap'), name });
            setCreating(false);
            setNotice(null);
          }}
        />
      )}

      {confirm && (
        <Modal
          title={confirm.kind === 'restore' ? 'Restore snapshot' : 'Delete snapshot'}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <button className="btn" type="button" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button
                className={`btn ${confirm.kind === 'delete' ? 'btn--danger' : 'btn--primary'}`}
                type="button"
                onClick={() => {
                  if (confirm.kind === 'restore') {
                    dispatch({ type: 'snapshot/restore', id: confirm.snapshot.id });
                    setNotice(
                      `Workspace restored from “${confirm.snapshot.name}”. Changes made after ${fullDate(
                        confirm.snapshot.createdAt,
                      )} at ${timeOf(confirm.snapshot.createdAt)} were rolled back.`,
                    );
                  } else {
                    dispatch({ type: 'snapshot/delete', id: confirm.snapshot.id });
                    setNotice(null);
                  }
                  setConfirm(null);
                }}
              >
                {confirm.kind === 'restore' ? 'Restore workspace' : 'Delete snapshot'}
              </button>
            </>
          }
        >
          {confirm.kind === 'restore' ? (
            <>
              <p style={{ marginTop: 0 }}>
                Restore <strong>{confirm.snapshot.name}</strong> from{' '}
                {fullDate(confirm.snapshot.createdAt)} at {timeOf(confirm.snapshot.createdAt)}?
              </p>
              <div className="callout">
                {contentsOf(confirm.snapshot)} will replace the current data. The snapshot archive and audit
                log are kept, so you can restore again or take a fresh copy first.
              </div>
            </>
          ) : (
            <>
              <p style={{ marginTop: 0 }}>
                Delete <strong>{confirm.snapshot.name}</strong>? This cannot be undone — export a copy first if
                you may need it.
              </p>
              <div className="callout">{contentsOf(confirm.snapshot)}</div>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}

function CreateSnapshotModal({
  atLimit,
  onClose,
  onCreate,
}: {
  atLimit: boolean;
  onClose: () => void;
  onCreate: (name: string) => void;
}) {
  const { state } = useStore();
  const now = new Date();
  const [name, setName] = useState(`Snapshot — ${fullDate(now.toISOString())} ${timeOf(now.toISOString())}`);

  const trimmed = name.trim();
  const canSave = trimmed.length > 1;

  return (
    <Modal
      title="Take snapshot"
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn--primary" type="button" disabled={!canSave} onClick={() => onCreate(trimmed)}>
            Take snapshot
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="snapshot-name">Snapshot name</label>
        <input
          id="snapshot-name"
          className="input"
          autoFocus
          placeholder="Before Q4 cleanup"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="callout" style={{ marginTop: 12 }}>
        Captures {num(state.contacts.length)} contacts, {num(state.opportunities.length)} deals,{' '}
        {num(state.orders.length)} orders and every other record in the workspace.
        {atLimit && ' The oldest snapshot will be removed to stay within the five-slot limit.'}
      </div>
    </Modal>
  );
}
