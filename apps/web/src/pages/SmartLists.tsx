import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Badge } from '../components/ui';
import { uid, useStore } from '../lib/store';
import { num } from '../lib/format';
import { api } from '../lib/api';
import type { SmartList } from '../lib/types';

export default function SmartLists() {
  const { state, dispatch } = useStore();
  const { smartLists } = state;
  const [adding, setAdding] = useState(false);
  const [evaluatingId, setEvaluatingId] = useState<string | null>(null);
  const navigate = useNavigate();

  const { data: v2SmartLists } = useQuery({
    queryKey: ['crm', 'v2', 'smart-lists'],
    queryFn: async ({ signal }) => {
      const res = await fetch('/api/crm/v2/smart-lists', { credentials: 'include', signal });
      if (!res.ok) return { smartLists: [] };
      return res.json();
    },
    staleTime: 20_000,
  });
  void v2SmartLists;

  useEffect(() => {
    api.crm.list<SmartList>('smartLists').then((res) => {
      if (res.data && res.data.length > 0) {
        for (const sl of res.data) {
          if (!smartLists.some((x) => x.id === sl.id)) {
            dispatch({ type: 'smartList/add', list: sl });
          }
        }
      }
    }).catch(() => { /* dev fallback */ });
  }, []);

  const handleEvaluate = async (list: SmartList) => {
    setEvaluatingId(list.id);
    try {
      const res = await api.smartLists.evaluate(list.id);
      if (res && typeof res.count === 'number') {
        dispatch({
          type: 'smartList/update',
          id: list.id,
          patch: { count: res.count }
        });
      }
    } catch { /* dev fallback */ } finally {
      setEvaluatingId(null);
    }
  };

  const total = smartLists.reduce((s, l) => s + l.count, 0);
  const largest = [...smartLists].sort((a, b) => b.count - a.count)[0];

  return (
    <main className="operza-dashboard atlas-dashboard">
      <header className="atlas-dashboard__header">
        <div className="atlas-dashboard__heading">
          <div className="atlas-dashboard__breadcrumb">Workspace <span>/</span> CRM Segmentation</div>
          <h1>Smart Lists</h1>
        </div>
        <div className="atlas-dashboard__toolbar">
          <button className="atlas-quick-action-button" onClick={() => setAdding(true)}>
            <Icon name="plus" size={13} /> New Smart List
          </button>
        </div>
      </header>

      <section className="atlas-hero">
        <div className="atlas-eyebrow">AUDIENCE SEGMENTATION &amp; DYNAMIC FILTERS</div>
        <h2>Real-Time Dynamic Contact Segments</h2>
        <p>Saved audience criteria that continuously re-evaluate as contact attributes, behavior, and deal stages evolve.</p>
      </section>

      <section className="atlas-kpis" aria-label="Smart list metrics">
        <article className="operza-kpi atlas-kpi">
          <div className="operza-kpi__header">
            <span className="operza-kpi__icon"><Icon name="sliders" size={15} /></span>
            <span className="operza-kpi__trend">Lists</span>
          </div>
          <div className="atlas-kpi__label">Smart Lists</div>
          <div className="atlas-kpi__value tabular">{num(smartLists.length)}</div>
          <div className="atlas-kpi__note">Active dynamic segments</div>
          <svg className="operza-kpi__sparkline" viewBox="0 0 100 20" fill="none" preserveAspectRatio="none">
            <path d="M0 16 Q25 12 50 6 T100 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ color: 'var(--accent)', opacity: 0.8 }} />
          </svg>
        </article>

        <article className="operza-kpi atlas-kpi">
          <div className="operza-kpi__header">
            <span className="operza-kpi__icon"><Icon name="users" size={15} /></span>
            <span className="operza-kpi__trend">Audience</span>
          </div>
          <div className="atlas-kpi__label">Covered Contacts</div>
          <div className="atlas-kpi__value tabular">{num(total)}</div>
          <div className="atlas-kpi__note">Total segmented records</div>
          <svg className="operza-kpi__sparkline" viewBox="0 0 100 20" fill="none" preserveAspectRatio="none">
            <path d="M0 14 Q30 8 60 12 T100 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ color: '#3b82f6', opacity: 0.8 }} />
          </svg>
        </article>

        <article className="operza-kpi atlas-kpi">
          <div className="operza-kpi__header">
            <span className="operza-kpi__icon"><Icon name="chart" size={15} /></span>
            <span className="operza-kpi__trend">Top List</span>
          </div>
          <div className="atlas-kpi__label">Largest Segment</div>
          <div className="atlas-kpi__value tabular" style={{ fontSize: 18 }}>{largest?.name ?? '—'}</div>
          <div className="atlas-kpi__note">{num(largest?.count ?? 0)} contacts matched</div>
          <svg className="operza-kpi__sparkline" viewBox="0 0 100 20" fill="none" preserveAspectRatio="none">
            <path d="M0 18 Q35 14 70 6 T100 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ color: '#10b981', opacity: 0.8 }} />
          </svg>
        </article>

        <article className="operza-kpi atlas-kpi">
          <div className="operza-kpi__header">
            <span className="operza-kpi__icon"><Icon name="refresh" size={15} /></span>
            <span className="operza-kpi__trend">Realtime</span>
          </div>
          <div className="atlas-kpi__label">Engine Sync</div>
          <div className="atlas-kpi__value tabular">Live</div>
          <div className="atlas-kpi__note">Dynamic trigger evaluation</div>
          <svg className="operza-kpi__sparkline" viewBox="0 0 100 20" fill="none" preserveAspectRatio="none">
            <path d="M0 10 Q30 14 60 8 T100 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ color: '#f59e0b', opacity: 0.8 }} />
          </svg>
        </article>
      </section>

      <div className="grid grid--3" style={{ marginTop: 22 }}>
        {smartLists.map((list) => (
          <div key={list.id} className="card-premium smart-list" style={{ padding: '18px 20px' }}>
            <div className="card__head">
              <div className="row" style={{ gap: 10, minWidth: 0 }}>
                <span className={`smart-list__dot smart-list__dot--${list.tone}`} />
                <div style={{ minWidth: 0 }}>
                  <div className="card__title">{list.name}</div>
                  <div className="card__sub">{list.rule}</div>
                </div>
              </div>
              <div className="card__actions">
                <Badge>{num(list.count)}</Badge>
              </div>
            </div>
            <div className="card__body row row--between">
              <span className="row" style={{ gap: 6 }}>
                <button
                  type="button"
                  className="btn btn--sm"
                  disabled={evaluatingId === list.id}
                  onClick={() => handleEvaluate(list)}
                >
                  <Icon name="refresh" size={12} /> {evaluatingId === list.id ? 'Evaluating...' : 'Evaluate'}
                </button>
              </span>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => {
                  if (list.rule?.startsWith('tag:')) {
                    navigate(`/contacts?tag=${encodeURIComponent(list.rule.replace('tag:', '').trim())}`);
                  } else {
                    navigate(`/contacts?filter=${encodeURIComponent(list.rule || '')}`);
                  }
                }}
              >
                View contacts <Icon name="arrow-right" size={12} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {adding && <NewListModal onClose={() => setAdding(false)} />}
    </main>
  );
}

function NewListModal({ onClose }: { onClose: () => void }) {
  const { dispatch } = useStore();
  const [name, setName] = useState('');
  const [rule, setRule] = useState('');
  const [tone, setTone] = useState<SmartList['tone']>('blue');

  const canSave = name.trim().length > 1 && rule.trim().length > 2;

  async function save() {
    if (!canSave) return;
    const newList: SmartList = {
      id: uid('sl'),
      name: name.trim(),
      rule: rule.trim(),
      count: 0,
      tone
    };
    try {
      await api.crm.create('smartLists', {
        name: newList.name,
        rule: newList.rule,
        tone: newList.tone,
        count: 0
      });
    } catch { /* dev fallback */ }
    dispatch({
      type: 'smartList/add',
      list: newList,
    });
    onClose();
  }

  return (
    <Modal
      title="New smart list"
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn--primary" type="button" disabled={!canSave} onClick={save}>
            Create list
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="sl-name">List name</label>
        <input
          id="sl-name"
          className="input"
          autoFocus
          placeholder="High-value renewals"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="field" style={{ marginTop: 12 }}>
        <label htmlFor="sl-rule">Rule</label>
        <input
          id="sl-rule"
          className="input"
          placeholder="MRR above $1,000 and renewal within 30 days"
          value={rule}
          onChange={(e) => setRule(e.target.value)}
        />
      </div>
      <div className="field" style={{ marginTop: 12 }}>
        <label>Colour</label>
        <div className="row" style={{ gap: 8 }}>
          {(['blue', 'green', 'amber', 'violet', 'red'] as const).map((t) => (
            <button
              key={t}
              type="button"
              aria-label={t}
              aria-pressed={tone === t}
              className={`smart-list__swatch smart-list__dot--${t}${tone === t ? ' is-active' : ''}`}
              onClick={() => setTone(t)}
            />
          ))}
        </div>
      </div>
    </Modal>
  );
}
