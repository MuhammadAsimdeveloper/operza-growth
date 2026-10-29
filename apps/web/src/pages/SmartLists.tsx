import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Badge, PageHeader, StatCard } from '../components/ui';
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
    <div className="content">
      <PageHeader
        title="Smart Lists"
        subtitle="Saved filters that update themselves as contacts change."
        actions={
          <>
            <button className="btn">
              <Icon name="sliders" size={15} /> Manage rules
            </button>
            <button className="btn btn--primary" onClick={() => setAdding(true)}>
              <Icon name="plus" size={15} /> New smart list
            </button>
          </>
        }
      />

      <div className="grid grid--4" style={{ marginBottom: 16 }}>
        <StatCard label="Smart lists" value={num(smartLists.length)} icon={<Icon name="sliders" size={15} />} meta="saved filters" />
        <StatCard label="Contacts covered" value={num(total)} icon={<Icon name="users" size={15} />} meta="across all lists" />
        <StatCard label="Largest list" value={largest?.name ?? '—'} icon={<Icon name="chart" size={15} />} meta={`${num(largest?.count ?? 0)} contacts`} />
        <StatCard label="Updated" value="Live" icon={<Icon name="refresh" size={15} />} meta="recalculated on change" />
      </div>

      <div className="grid grid--3">
        {smartLists.map((list) => (
          <div key={list.id} className="card smart-list">
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
              <button type="button" className="btn btn--sm" onClick={() => navigate('/contacts')}>
                View contacts <Icon name="arrow-right" size={12} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {adding && <NewListModal onClose={() => setAdding(false)} />}
    </div>
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
