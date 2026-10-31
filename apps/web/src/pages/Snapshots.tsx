/**
 * ============================================================================
 * Operza Multi-Tenant Snapshot Management & Bi-Directional Diff Sync
 * ============================================================================
 * 
 * Provides agency snapshot capabilities:
 * 1. 1-Click Blueprints: Packages workflows, sales pipelines, calendars, forms,
 *    and payment links into transportable snapshot templates.
 * 2. Bi-Directional Drift Diffing: Performs granular comparison between blueprint
 *    resources and target sub-account installations.
 * 3. Selective Push Synchronization: Allows agencies to selectively push updates
 *    (e.g., new workflows or updated forms) without clobbering sub-account customizations.
 */

import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Badge, EmptyState, PageHeader, StatCard } from '../components/ui';
import { fullDate, num, relative, timeOf } from '../lib/format';
import { uid, useStore } from '../lib/store';
import { api } from '../lib/api';
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
  const [deploying, setDeploying] = useState<Snapshot | null>(null);
  const [diffing, setDiffing] = useState<Snapshot | null>(null);
  const [diffTargetLoc, setDiffTargetLoc] = useState('');
  const [diffData, setDiffData] = useState<any>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [selectedCats, setSelectedCats] = useState<string[]>(['workflows', 'pipelines', 'forms', 'calendars', 'paymentLinks']);
  const [locations, setLocations] = useState<{ id: string; name: string }[]>([]);
  const [confirm, setConfirm] = useState<{ kind: 'restore' | 'delete'; snapshot: Snapshot } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api.agency.getLocations().then((res) => {
      if (active && res?.locations) {
        setLocations(res.locations.map((l: any) => ({ id: l.id, name: l.name })));
      }
    }).catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const fetchDiff = (snapshotId: string, locId: string) => {
    setDiffLoading(true);
    api.agency.diffSnapshot(snapshotId, locId)
      .then((res) => {
        setDiffData(res);
      })
      .catch((err) => {
        console.error('Diff error:', err);
      })
      .finally(() => {
        setDiffLoading(false);
      });
  };

  const handleOpenDiff = (snapshot: Snapshot) => {
    setDiffing(snapshot);
    const firstTarget = locations[0]?.id || '';
    setDiffTargetLoc(firstTarget);
    if (firstTarget) {
      fetchDiff(snapshot.id, firstTarget);
    }
  };

  const handleExecuteSync = async () => {
    if (!diffing || !diffTargetLoc) return;
    setSyncLoading(true);
    try {
      const res = await api.agency.syncSnapshot(diffing.id, diffTargetLoc, selectedCats);
      setNotice(`Selective sync completed! Updated resources: ${Object.entries(res.synced || {}).map(([k, v]) => `${v} ${k}`).join(', ')}.`);
      setDiffing(null);
    } catch (err: any) {
      setNotice(`Sync failed: ${err.message || 'unknown error'}`);
    } finally {
      setSyncLoading(false);
    }
  };

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
                          className="btn btn--sm btn--primary"
                          title="Deploy blueprint to another client workspace"
                          onClick={() => {
                            setNotice(null);
                            setDeploying(snapshot);
                          }}
                        >
                          <Icon name="send" size={13} /> Deploy
                        </button>
                        <button
                          className="btn btn--sm btn--ghost"
                          title="Compare and selectively sync blueprint updates to a client workspace"
                          onClick={() => {
                            setNotice(null);
                            handleOpenDiff(snapshot);
                          }}
                        >
                          <Icon name="sliders" size={13} /> Diff & Sync
                        </button>
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
          onCreate={async (name) => {
            try {
              await api.agency.createSnapshot({ name, includeContacts: true });
            } catch (err) {
              console.error('Failed to create snapshot in backend:', err);
            }
            dispatch({ type: 'snapshot/create', id: uid('snap'), name });
            setCreating(false);
            setNotice(null);
          }}
        />
      )}

      {deploying && (
        <DeploySnapshotModal
          snapshot={deploying}
          locations={locations}
          onClose={() => setDeploying(null)}
          onDeploy={async (targetLocationId, includeContacts) => {
            try {
              const res = await api.agency.deploySnapshot(deploying.id, targetLocationId, { includeContacts });
              setNotice(
                `Blueprint “${deploying.name}” successfully deployed to ${res.targetLocationName || 'workspace'}! Provisioned ${res.deployed?.workflows ?? 0} workflows, ${res.deployed?.pipelines ?? 0} pipelines, and ${res.deployed?.calendars ?? 0} calendars.`,
              );
            } catch (err: any) {
              setNotice(`Deployment failed: ${err.message || 'Unknown error'}`);
            }
            setDeploying(null);
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
                onClick={async () => {
                  if (confirm.kind === 'restore') {
                    try {
                      await api.agency.restoreSnapshot(confirm.snapshot.id);
                    } catch (err) {
                      console.error('Failed to restore snapshot on backend:', err);
                    }
                    dispatch({ type: 'snapshot/restore', id: confirm.snapshot.id });
                    setNotice(
                      `Workspace restored from “${confirm.snapshot.name}”. Changes made after ${fullDate(
                        confirm.snapshot.createdAt,
                      )} at ${timeOf(confirm.snapshot.createdAt)} were rolled back.`,
                    );
                  } else {
                    try {
                      await api.agency.deleteSnapshot(confirm.snapshot.id);
                    } catch (err) {
                      console.error('Failed to delete snapshot on backend:', err);
                    }
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

      {diffing && (
        <Modal
          title={`Bi-Directional Diff & Sync: ${diffing.name}`}
          onClose={() => setDiffing(null)}
          wide
          footer={
            <>
              <button className="btn" type="button" onClick={() => setDiffing(null)}>
                Cancel
              </button>
              <button
                className="btn btn--primary"
                type="button"
                disabled={syncLoading || selectedCats.length === 0}
                onClick={handleExecuteSync}
              >
                {syncLoading ? 'Syncing Updates...' : `Push Selected Updates (${selectedCats.length} categories)`}
              </button>
            </>
          }
        >
          <div className="stack" style={{ gap: 14 }}>
            <div className="row row--between" style={{ alignItems: 'center' }}>
              <div style={{ flex: 1 }}>
                <label className="field-label" style={{ fontSize: 12 }}>Select Client Sub-Account to Diff Against:</label>
                <select
                  className="select"
                  value={diffTargetLoc}
                  onChange={(e) => {
                    const newLoc = e.target.value;
                    setDiffTargetLoc(newLoc);
                    if (diffing && newLoc) fetchDiff(diffing.id, newLoc);
                  }}
                >
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {diffLoading ? (
              <div style={{ padding: '30px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
                Comparing snapshot blueprint against workspace resources...
              </div>
            ) : diffData ? (
              <div className="stack" style={{ gap: 12 }}>
                <div className="grid grid--3">
                  <div className="card" style={{ padding: 10 }}>
                    <div className="cell-sub" style={{ fontSize: 11 }}>NEW IN SNAPSHOT</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--green)' }}>
                      {diffData.summary?.newCount ?? 0} items
                    </div>
                  </div>
                  <div className="card" style={{ padding: 10 }}>
                    <div className="cell-sub" style={{ fontSize: 11 }}>MODIFIED / VERSION GAP</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--amber)' }}>
                      {diffData.summary?.modifiedCount ?? 0} items
                    </div>
                  </div>
                  <div className="card" style={{ padding: 10 }}>
                    <div className="cell-sub" style={{ fontSize: 11 }}>ALREADY SYNCED</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--blue)' }}>
                      {diffData.summary?.syncedCount ?? 0} items
                    </div>
                  </div>
                </div>

                <div className="field">
                  <label className="field-label" style={{ fontSize: 12 }}>Select Resources to Push:</label>
                  <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
                    {['workflows', 'pipelines', 'forms', 'calendars', 'paymentLinks'].map((cat) => (
                      <label key={cat} className="row" style={{ gap: 6, fontSize: 12.5, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={selectedCats.includes(cat)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedCats([...selectedCats, cat]);
                            } else {
                              setSelectedCats(selectedCats.filter(c => c !== cat));
                            }
                          }}
                        />
                        <span style={{ textTransform: 'capitalize', fontWeight: 550 }}>{cat}</span>
                        <span className="cell-sub">({diffData.diff?.[cat]?.length || 0})</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="table-wrap" style={{ maxHeight: 220, overflowY: 'auto' }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Resource</th>
                        <th>Category</th>
                        <th>Status</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(diffData.diff || {}).flatMap(([cat, items]: [string, any]) =>
                        items.map((item: any, idx: number) => (
                          <tr key={`${cat}-${idx}`}>
                            <td style={{ fontWeight: 550, fontSize: 12 }}>{item.name}</td>
                            <td className="cell-sub" style={{ textTransform: 'capitalize', fontSize: 11.5 }}>{cat}</td>
                            <td>
                              {item.status === 'new' && <Badge tone="green">New in Blueprint</Badge>}
                              {item.status === 'modified' && <Badge tone="amber">Modified</Badge>}
                              {item.status === 'synced' && <Badge tone="blue">Synced</Badge>}
                            </td>
                            <td className="cell-sub" style={{ fontSize: 11.5 }}>
                              {item.action === 'create' ? 'Will create' : item.action === 'update' ? 'Will update' : 'Skip (Identical)'}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </div>
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

function DeploySnapshotModal({
  snapshot,
  locations,
  onClose,
  onDeploy,
}: {
  snapshot: Snapshot;
  locations: { id: string; name: string }[];
  onClose: () => void;
  onDeploy: (targetLocationId: string, includeContacts: boolean) => Promise<void>;
}) {
  const [targetId, setTargetId] = useState(locations[0]?.id || '');
  const [includeContacts, setIncludeContacts] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!targetId) return;
    setIsSubmitting(true);
    try {
      await onDeploy(targetId, includeContacts);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      title={`Deploy Blueprint “${snapshot.name}”`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </button>
          <button
            className="btn btn--primary"
            type="button"
            disabled={!targetId || isSubmitting}
            onClick={handleSubmit}
          >
            {isSubmitting ? 'Deploying...' : 'Deploy to Sub-account'}
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>
        Clone this blueprint configuration into a client workspace. Workflows, pipelines, forms, and calendars will be provisioned directly into the target sub-account.
      </p>

      {locations.length === 0 ? (
        <div className="callout callout--warn">
          No sub-accounts found. Create a client sub-account under Sub-accounts first.
        </div>
      ) : (
        <div className="field">
          <label htmlFor="target-location">Target Sub-account</label>
          <select
            id="target-location"
            className="select"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
          >
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="field" style={{ marginTop: 12 }}>
        <label className="row" style={{ gap: 8, cursor: 'pointer', fontSize: 13 }}>
          <input
            type="checkbox"
            checked={includeContacts}
            onChange={(e) => setIncludeContacts(e.target.checked)}
          />
          Include demo contacts in deployment
        </label>
      </div>

      <div className="callout" style={{ marginTop: 14 }}>
        This will deep-clone and scope all snapshot assets into the selected workspace without modifying other sub-accounts.
      </div>
    </Modal>
  );
}
