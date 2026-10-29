import { useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { Avatar, Badge, EmptyState, PageHeader, StatCard } from '../components/ui';
import { uid, useStore } from '../lib/store';
import { num } from '../lib/format';
import { api } from '../lib/api';
import type { Prospect } from '../lib/types';

type Filter = 'all' | Prospect['status'];

export default function Prospecting() {
  const { state, dispatch } = useStore();
  const { prospects } = state;
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');

  const qualified = prospects.filter((p) => p.status === 'qualified').length;
  const contacted = prospects.filter((p) => p.status === 'contacted').length;
  const avgScore = prospects.length
    ? Math.round(prospects.reduce((s, p) => s + p.score, 0) / prospects.length)
    : 0;

  const visible = useMemo(
    () =>
      prospects.filter((p) => {
        if (filter !== 'all' && p.status !== filter) return false;
        if (!query) return true;
        const q = query.toLowerCase();
        return (
          p.company.toLowerCase().includes(q) ||
          p.person.toLowerCase().includes(q) ||
          p.industry.toLowerCase().includes(q) ||
          p.location.toLowerCase().includes(q)
        );
      }),
    [prospects, filter, query],
  );

  async function importToContacts(p: Prospect) {
    const [firstName, ...rest] = p.person.split(' ');
    const newContact = {
      id: uid('c'),
      firstName,
      lastName: rest.join(' ') || '—',
      email: p.email,
      phone: '—',
      company: p.company,
      tags: ['prospect', p.industry.toLowerCase()],
      source: 'Prospecting',
      status: 'lead' as const,
      owner: state.team[0]?.name ?? 'Unassigned',
      createdAt: new Date().toISOString(),
      notes: [{ id: uid('note'), body: `Imported from prospecting · fit score ${p.score}.`, at: new Date().toISOString(), author: 'System' }],
      customFields: { Industry: p.industry, Employees: String(p.employees), Location: p.location },
    };
    try {
      await api.crm.create('contacts', {
        firstName: newContact.firstName,
        lastName: newContact.lastName,
        email: newContact.email,
        company: newContact.company,
        tags: newContact.tags,
        source: newContact.source,
        status: newContact.status
      });
    } catch { /* dev fallback */ }
    dispatch({
      type: 'contact/add',
      contact: newContact,
    });
    dispatch({ type: 'prospect/status', id: p.id, status: 'qualified' });
  }

  return (
    <div className="content">
      <PageHeader
        title="Prospecting"
        subtitle="Find lookalike businesses, score them, then push the good ones into your CRM."
        actions={
          <>
            <button className="btn">
              <Icon name="sliders" size={15} /> Filters
            </button>
            <button className="btn btn--primary">
              <Icon name="search" size={15} /> Run search
            </button>
          </>
        }
      />

      <div className="grid grid--4" style={{ marginBottom: 16 }}>
        <StatCard label="Prospects found" value={num(prospects.length)} icon={<Icon name="target" size={15} />} meta="this search" />
        <StatCard label="Qualified" value={num(qualified)} icon={<Icon name="check" size={15} />} meta="ready to import" />
        <StatCard label="Contacted" value={num(contacted)} icon={<Icon name="send" size={15} />} meta="outreach sent" />
        <StatCard label="Avg. fit score" value={String(avgScore)} icon={<Icon name="chart" size={15} />} meta="out of 100" />
      </div>

      <div className="card">
        <div className="card__head">
          <div>
            <div className="card__title">Results</div>
            <div className="card__sub">{visible.length} matching businesses</div>
          </div>
          <div className="card__actions">
            <div className="search" style={{ width: 230 }}>
              <Icon name="search" size={15} />
              <input
                className="input"
                placeholder="Company, industry, city…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div style={{ padding: '0 16px' }}>
          <div className="tabs">
            {(['all', 'new', 'contacted', 'qualified', 'skipped'] as Filter[]).map((f) => (
              <button
                key={f}
                type="button"
                className={`tab${filter === f ? ' is-active' : ''}`}
                onClick={() => setFilter(f)}
              >
                {f === 'all' ? 'All' : f[0].toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {visible.length === 0 ? (
          <div className="card__body">
            <EmptyState icon={<Icon name="target" size={22} />} title="No prospects" text="Adjust the filters or run a new search." />
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Business</th>
                  <th>Industry</th>
                  <th className="cell-right">Employees</th>
                  <th>Location</th>
                  <th className="cell-right">Fit</th>
                  <th style={{ width: 140 }}>Status</th>
                  <th style={{ width: 150 }} />
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <span className="person">
                        <Avatar name={p.company} />
                        <span className="person__text">
                          <span className="person__name">{p.company}</span>
                          <span className="person__sub">
                            {p.person} · {p.email}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td>{p.industry}</td>
                    <td className="cell-right cell-num">{p.employees}</td>
                    <td>
                      <span className="row" style={{ gap: 5 }}>
                        <Icon name="map-pin" size={13} />
                        {p.location}
                      </span>
                    </td>
                    <td className="cell-right">
                      <Badge tone={p.score >= 85 ? 'green' : p.score >= 70 ? 'amber' : 'default'}>{p.score}</Badge>
                    </td>
                    <td>
                      <select
                        className="select select--sm"
                        value={p.status}
                        aria-label={`Status for ${p.company}`}
                        onChange={(e) =>
                          dispatch({ type: 'prospect/status', id: p.id, status: e.target.value as Prospect['status'] })
                        }
                      >
                        <option value="new">New</option>
                        <option value="contacted">Contacted</option>
                        <option value="qualified">Qualified</option>
                        <option value="skipped">Skipped</option>
                      </select>
                    </td>
                    <td className="cell-right">
                      <button
                        type="button"
                        className="btn btn--sm"
                        onClick={() => importToContacts(p)}
                      >
                        <Icon name="plus" size={13} /> Add contact
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
