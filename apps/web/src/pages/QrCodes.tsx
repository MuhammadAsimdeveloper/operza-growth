import { useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { PageHeader, StatCard } from '../components/ui';
import { uid, useStore } from '../lib/store';
import { num, relative } from '../lib/format';

const GRID = 21;

/** Deterministic decorative QR pattern derived from a seed string. */
function modulesFor(seed: string): boolean[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const cells: boolean[] = new Array(GRID * GRID).fill(false);
  let state = h >>> 0;
  const rand = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  const inFinder = (x: number, y: number) =>
    (x < 8 && y < 8) || (x > GRID - 9 && y < 8) || (x < 8 && y > GRID - 9);
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      if (inFinder(x, y)) continue;
      cells[y * GRID + x] = rand() > 0.52;
    }
  }
  return cells;
}

function QrGraphic({ seed, size = 104 }: { seed: string; size?: number }) {
  const cells = useMemo(() => modulesFor(seed), [seed]);
  const unit = size / GRID;
  const finder = (ox: number, oy: number) => (
    <g key={`${ox}-${oy}`}>
      <rect x={ox * unit} y={oy * unit} width={unit * 7} height={unit * 7} fill="none" stroke="currentColor" strokeWidth={unit} />
      <rect x={(ox + 2) * unit} y={(oy + 2) * unit} width={unit * 3} height={unit * 3} fill="currentColor" />
    </g>
  );
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="QR code preview">
      <rect width={size} height={size} fill="#fff" />
      {cells.map((on, i) =>
        on ? (
          <rect
            key={i}
            x={(i % GRID) * unit}
            y={Math.floor(i / GRID) * unit}
            width={unit}
            height={unit}
            fill="currentColor"
          />
        ) : null,
      )}
      {finder(0, 0)}
      {finder(GRID - 7, 0)}
      {finder(0, GRID - 7)}
    </svg>
  );
}

export default function QrCodes() {
  const { state, dispatch } = useStore();
  const { qrCodes } = state;
  const [adding, setAdding] = useState(false);

  const scans = qrCodes.reduce((s, q) => s + q.scans, 0);
  const best = [...qrCodes].sort((a, b) => b.scans - a.scans)[0];

  return (
    <div className="content">
      <PageHeader
        title="QR Codes"
        subtitle="Print-ready codes that open any funnel, form or booking page."
        actions={
          <button className="btn btn--primary" onClick={() => setAdding(true)}>
            <Icon name="plus" size={15} /> New QR code
          </button>
        }
      />

      <div className="grid grid--4" style={{ marginBottom: 16 }}>
        <StatCard label="Total scans" value={num(scans)} icon={<Icon name="qr" size={15} />} meta="all codes" />
        <StatCard label="Codes" value={num(qrCodes.length)} icon={<Icon name="tag" size={15} />} meta="active" />
        <StatCard label="Top code" value={best?.name ?? '—'} icon={<Icon name="star" size={15} />} meta={`${num(best?.scans ?? 0)} scans`} />
        <StatCard label="Avg. scans" value={num(Math.round(scans / Math.max(qrCodes.length, 1)))} icon={<Icon name="chart" size={15} />} meta="per code" />
      </div>

      <div className="qr-grid">
        {qrCodes.map((q) => (
          <div key={q.id} className="card qr-card">
            <div className="qr-card__art">
              <QrGraphic seed={q.id + q.target} />
            </div>
            <div className="qr-card__body">
              <div style={{ fontSize: 13, fontWeight: 650 }}>{q.name}</div>
              <div className="mono-cell" style={{ marginTop: 2 }}>{q.target}</div>
              <div className="row row--between" style={{ marginTop: 8 }}>
                <span className="cell-sub">{q.scans} scans · {relative(q.createdAt)}</span>
                <button type="button" className="btn btn--sm">
                  <Icon name="copy" size={12} /> PNG
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {adding && <NewQrModal onClose={() => setAdding(false)} onSubmit={(name, target) => {
        dispatch({
          type: 'qr/add',
          code: { id: uid('qr'), name, target, scans: 0, createdAt: new Date().toISOString() },
        });
        setAdding(false);
      }} />}
    </div>
  );
}

function NewQrModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (name: string, target: string) => void }) {
  const [name, setName] = useState('');
  const [target, setTarget] = useState('/book');

  const canSave = name.trim().length > 1 && target.trim().length > 1;

  return (
    <Modal
      title="New QR code"
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn--primary"
            type="button"
            disabled={!canSave}
            onClick={() => onSubmit(name.trim(), target.trim())}
          >
            Create code
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="qr-name">Label</label>
        <input
          id="qr-name"
          className="input"
          autoFocus
          placeholder="Conference banner"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="field" style={{ marginTop: 12 }}>
        <label htmlFor="qr-target">Destination path</label>
        <input
          id="qr-target"
          className="input"
          placeholder="/book"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        />
        <div className="cell-sub" style={{ marginTop: 4 }}>
          The code opens your live site at this path.
        </div>
      </div>
      <div className="row" style={{ justifyContent: 'center', marginTop: 16, color: 'var(--text)' }}>
        <QrGraphic seed={name || 'preview'} size={132} />
      </div>
    </Modal>
  );
}
