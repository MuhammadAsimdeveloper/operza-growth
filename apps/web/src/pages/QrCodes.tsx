import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';

import { uid, useStore } from '../lib/store';
import { num, relative } from '../lib/format';
import { api } from '../lib/api';
import type { QrCode } from '../lib/types';

/** Scannable, RFC-compliant QR code component using qrcode engine */
function QrGraphic({ target, seed, size = 104 }: { target?: string; seed?: string; size?: number }) {
  const [svg, setSvg] = useState<string>('');
  const qrTarget = target || (seed && (seed.startsWith('http') || seed.startsWith('/')) ? seed : `https://operza.io/qr/${encodeURIComponent(seed || 'preview')}`);

  useEffect(() => {
    let active = true;
    QRCode.toString(qrTarget, {
      type: 'svg',
      width: size,
      margin: 1,
      errorCorrectionLevel: 'M'
    }).then((svgString: string) => {
      if (active) setSvg(svgString);
    }).catch(() => {});
    return () => { active = false; };
  }, [qrTarget, size]);

  if (!svg) {
    return (
      <div
        style={{
          width: size,
          height: size,
          background: '#fff',
          borderRadius: 4,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      />
    );
  }

  return (
    <div
      style={{ width: size, height: size, display: 'inline-flex' }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export default function QrCodes() {
  const { state, dispatch } = useStore();
  const { qrCodes } = state;
  const [adding, setAdding] = useState(false);
  const [scanningId, setScanningId] = useState<string | null>(null);

  // Sync with real backend QR codes on mount
  useEffect(() => {
    let active = true;
    api.crm.list<QrCode>('qrCodes')
      .then((res) => {
        if (!active || !res || !Array.isArray(res)) return;
        for (const item of res) {
          if (!qrCodes.some((q) => q.id === item.id)) {
            dispatch({ type: 'qr/add', code: item });
          }
        }
      })
      .catch(() => {});
    return () => { active = false; };
  }, [dispatch, qrCodes]);

  const scans = qrCodes.reduce((s, q) => s + q.scans, 0);
  const best = [...qrCodes].sort((a, b) => b.scans - a.scans)[0];

  async function handleTestScan(qr: QrCode) {
    setScanningId(qr.id);
    try {
      await api.qr.scan(qr.id);
    } catch {
      /* fallback */
    }
    dispatch({ type: 'qr/scan', id: qr.id });
    setTimeout(() => setScanningId(null), 700);
  }

  return (
    <main className="operza-dashboard atlas-dashboard">
      <header className="atlas-dashboard__header">
        <div className="atlas-dashboard__heading">
          <div className="atlas-dashboard__breadcrumb">Workspace <span>/</span> Brand &amp; Offline Routing</div>
          <h1>QR Codes &amp; Dynamic Routers</h1>
        </div>
        <div className="atlas-dashboard__toolbar">
          <button className="atlas-quick-action-button" type="button" onClick={() => setAdding(true)}>
            <Icon name="plus" size={13} /> New QR Code
          </button>
        </div>
      </header>

      <section className="atlas-hero">
        <div className="atlas-eyebrow">DYNAMIC OFFLINE ROUTING</div>
        <h2>Print-Ready Vector QR Generator</h2>
        <p>Dynamic redirectable codes for physical collateral, business cards, point-of-sale, and automated scan attribution.</p>
      </section>

      <section className="atlas-kpis" aria-label="QR code metrics">
        <article className="operza-kpi atlas-kpi">
          <div className="atlas-kpi__meta">
            <span className="atlas-kpi__label">Total Scans</span>
            <span className="atlas-status atlas-status--healthy">Tracked</span>
          </div>
          <div className="atlas-kpi__value">{num(scans)}</div>
          <div className="atlas-kpi__note">Verified redirect events</div>
        </article>
        <article className="operza-kpi atlas-kpi">
          <div className="atlas-kpi__meta">
            <span className="atlas-kpi__label">Active Codes</span>
            <span className="atlas-status atlas-status--healthy">Live</span>
          </div>
          <div className="atlas-kpi__value">{num(qrCodes.length)}</div>
          <div className="atlas-kpi__note">Routing endpoints</div>
        </article>
        <article className="operza-kpi atlas-kpi">
          <div className="atlas-kpi__meta">
            <span className="atlas-kpi__label">Top Scanned</span>
            <span className="atlas-status atlas-status--healthy">Leader</span>
          </div>
          <div className="atlas-kpi__value">{best?.name ?? '—'}</div>
          <div className="atlas-kpi__note">{num(best?.scans ?? 0)} scans</div>
        </article>
        <article className="operza-kpi atlas-kpi">
          <div className="atlas-kpi__meta">
            <span className="atlas-kpi__label">Average Scans</span>
            <span className="atlas-status atlas-status--healthy">Optimal</span>
          </div>
          <div className="atlas-kpi__value">{num(Math.round(scans / Math.max(qrCodes.length, 1)))}</div>
          <div className="atlas-kpi__note">Per dynamic QR asset</div>
        </article>
      </section>

      <div className="qr-grid" style={{ marginTop: 22 }}>
        {qrCodes.map((q) => (
          <div key={q.id} className="card-premium qr-card">
            <div className="qr-card__art">
              <QrGraphic target={q.target} seed={q.id + q.target} />
            </div>
            <div className="qr-card__body">
              <div style={{ fontSize: 13, fontWeight: 650 }}>{q.name}</div>
              <div className="mono-cell" style={{ marginTop: 2 }}>{q.target}</div>
              <div className="row row--between" style={{ marginTop: 10 }}>
                <span className="cell-sub">{q.scans} scans · {relative(q.createdAt)}</span>
                <div className="row" style={{ gap: 6 }}>
                  <button
                    type="button"
                    className="btn btn--sm"
                    disabled={scanningId === q.id}
                    onClick={() => handleTestScan(q)}
                  >
                    <Icon name="zap" size={12} /> {scanningId === q.id ? 'Scanned!' : 'Scan'}
                  </button>
                  <a
                    href={api.qr.getSvgUrl(q.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn--sm"
                    download={`${q.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.svg`}
                  >
                    <Icon name="download" size={12} /> SVG
                  </a>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {adding && (
        <NewQrModal
          onClose={() => setAdding(false)}
          onSubmit={async (name, target) => {
            const newCode: QrCode = {
              id: uid('qr'),
              name,
              target,
              scans: 0,
              createdAt: new Date().toISOString(),
            };

            try {
              const res = await api.crm.create<QrCode>('qrCodes', newCode);
              dispatch({ type: 'qr/add', code: res || newCode });
            } catch {
              dispatch({ type: 'qr/add', code: newCode });
            }
            setAdding(false);
          }}
        />
      )}
    </main>
  );
}

function NewQrModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (name: string, target: string) => void }) {
  const [name, setName] = useState('');
  const [target, setTarget] = useState('/calendars/public/discovery-strategy');

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
        <label htmlFor="qr-target">Destination path or URL</label>
        <input
          id="qr-target"
          className="input"
          placeholder="/calendars/public/discovery-strategy"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        />
        <div className="cell-sub" style={{ marginTop: 4 }}>
          The code routes visitors to this funnel, booking calendar, or checkout.
        </div>
      </div>
      <div className="row" style={{ justifyContent: 'center', marginTop: 16, color: 'var(--text)' }}>
        <QrGraphic target={target || '/calendars/public/discovery-strategy'} seed={name || 'preview'} size={132} />
      </div>
    </Modal>
  );
}