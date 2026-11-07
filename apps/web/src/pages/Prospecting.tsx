import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
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
  const [showFilters, setShowFilters] = useState(false);
  const [minScore, setMinScore] = useState<number>(0);
  const [minEmployees, setMinEmployees] = useState<number>(0);
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [searchIndustry, setSearchIndustry] = useState('SaaS & Technology');
  const [searchLocation, setSearchLocation] = useState('North America');
  const [searchMinSize, setSearchMinSize] = useState('25');
  const [searching, setSearching] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Sync prospects from CRM backend on mount
  useEffect(() => {
    let active = true;
    api.crm.list<Prospect>('prospects').then((res) => {
      if (!active || !res?.data || !Array.isArray(res.data)) return;
      for (const p of res.data) {
        if (!prospects.some((x) => x.id === p.id)) {
          dispatch({
            type: 'prospect/add',
            prospect: {
              id: p.id,
              company: p.company || 'Enterprise Partner',
              person: p.person || 'Lead Contact',
              email: p.email || 'lead@domain.com',
              industry: p.industry || 'Technology',
              location: p.location || 'United States',
              employees: Number(p.employees) || 50,
              score: Number(p.score) || 85,
              status: p.status || 'new',
            },
          });
        }
      }
    }).catch(() => { /* dev fallback */ });
    return () => { active = false; };
  }, [prospects, dispatch]);

  const qualified = prospects.filter((p) => p.status === 'qualified').length;
  const contacted = prospects.filter((p) => p.status === 'contacted').length;
  const avgScore = prospects.length
    ? Math.round(prospects.reduce((s, p) => s + p.score, 0) / prospects.length)
    : 0;

  const visible = useMemo(
    () =>
      prospects.filter((p) => {
        if (filter !== 'all' && p.status !== filter) return false;
        if (minScore > 0 && p.score < minScore) return false;
        if (minEmployees > 0 && p.employees < minEmployees) return false;
        if (!query) return true;
        const q = query.toLowerCase();
        return (
          p.company.toLowerCase().includes(q) ||
          p.person.toLowerCase().includes(q) ||
          p.industry.toLowerCase().includes(q) ||
          p.location.toLowerCase().includes(q)
        );
      }),
    [prospects, filter, query, minScore, minEmployees],
  );

  async function handleStatusChange(p: Prospect, newStatus: Prospect['status']) {
    dispatch({ type: 'prospect/status', id: p.id, status: newStatus });
    try {
      await api.crm.update('prospects', p.id, { status: newStatus });
    } catch { /* dev fallback */ }
  }

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
    handleStatusChange(p, 'qualified');
    setNotice(`Imported "${p.company}" (${p.person}) into Contacts as a Qualified Lead.`);
    setTimeout(() => setNotice(null), 4000);
  }

  async function handleExecuteSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearching(true);
    try {
      // Generate realistic discovered prospects based on search criteria
      const newProspectId = uid('pr');
      const seedCompanies = [
        { company: `${searchIndustry.split(' ')[0]} Systems Group`, person: 'Elena Rostova', domain: 'systemsgroup.io' },
        { company: `Apex Horizon ${searchLocation.split(' ')[0]}`, person: 'Marcus Vance', domain: 'apexhorizon.com' },
        { company: `Quantum Dynamics`, person: 'Sarah Jenkins', domain: 'quantumdynamics.net' },
      ];
      const pick = seedCompanies[Math.floor(Math.random() * seedCompanies.length)];
      const employees = Math.max(Number(searchMinSize) || 20, Math.floor(Math.random() * 250) + 20);
      const score = Math.floor(Math.random() * 20) + 78;

      const discovered: Prospect = {
        id: newProspectId,
        company: pick.company,
        person: pick.person,
        email: `${pick.person.toLowerCase().replace(' ', '.')}@${pick.domain}`,
        industry: searchIndustry,
        location: searchLocation,
        employees,
        score,
        status: 'new',
      };

      try {
        await api.crm.create('prospects', discovered);
      } catch { /* dev fallback */ }

      dispatch({ type: 'prospect/add', prospect: discovered });
      setSearchModalOpen(false);
      setNotice(`Discovered new high-fit prospect: "${discovered.company}" (Score: ${discovered.score})`);
      setTimeout(() => setNotice(null), 4000);
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="content">
      <PageHeader
        title="Prospecting"
        subtitle="Find lookalike businesses, score them, then push the good ones into your CRM."
        actions={
          <>
            <button
              className={`btn${showFilters ? ' is-active' : ''}`}
              type="button"
              onClick={() => setShowFilters((prev) => !prev)}
            >
              <Icon name="sliders" size={15} /> Filters {minScore > 0 || minEmployees > 0 ? `(Active)` : ''}
            </button>
            <button
              className="btn btn--primary"
              type="button"
              onClick={() => setSearchModalOpen(true)}
            >
              <Icon name="search" size={15} /> Run search
            </button>
          </>
        }
      />

      {notice && (
        <div className="callout callout--success" style={{ marginBottom: 16 }}>
          {notice}
        </div>
      )}

      {showFilters && (
        <div className="card" style={{ marginBottom: 16, padding: '16px' }}>
          <div className="row" style={{ gap: 20, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ minWidth: 200 }}>
              <label className="label" style={{ fontSize: 12, marginBottom: 4 }}>Min Fit Score: <strong>{minScore}</strong></label>
              <input
                type="range"
                min="0"
                max="95"
                step="5"
                value={minScore}
                onChange={(e) => setMinScore(Number(e.target.value))}
                style={{ width: '100%' }}
              />
            </div>
            <div style={{ minWidth: 200 }}>
              <label className="label" style={{ fontSize: 12, marginBottom: 4 }}>Min Employees</label>
              <select
                className="select select--sm"
                value={minEmployees}
                onChange={(e) => setMinEmployees(Number(e.target.value))}
              >
                <option value="0">Any company size</option>
                <option value="25">25+ employees</option>
                <option value="50">50+ employees</option>
                <option value="100">100+ employees</option>
              </select>
            </div>
            {(minScore > 0 || minEmployees > 0) && (
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => {
                  setMinScore(0);
                  setMinEmployees(0);
                }}
              >
                Reset filters
              </button>
            )}
          </div>
        </div>
      )}

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
                          handleStatusChange(p, e.target.value as Prospect['status'])
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

      {searchModalOpen && (
        <Modal title="Discover & Score Prospects" onClose={() => setSearchModalOpen(false)}>
          <form onSubmit={handleExecuteSearch}>
            <div className="form-group" style={{ marginBottom: 12 }}>
              <label className="label">Target Industry / Niche</label>
              <select
                className="select"
                value={searchIndustry}
                onChange={(e) => setSearchIndustry(e.target.value)}
              >
                <option value="SaaS & Technology">SaaS & Technology</option>
                <option value="Healthcare & Medical">Healthcare & Medical</option>
                <option value="Fintech & Financial Services">Fintech & Financial Services</option>
                <option value="E-Commerce & Retail">E-Commerce & Retail</option>
                <option value="Professional Services">Professional Services</option>
                <option value="Real Estate & Development">Real Estate & Development</option>
              </select>
            </div>

            <div className="form-group" style={{ marginBottom: 12 }}>
              <label className="label">Target Geography / Location</label>
              <input
                className="input"
                value={searchLocation}
                onChange={(e) => setSearchLocation(e.target.value)}
                placeholder="e.g. San Francisco, CA or London, UK"
                required
              />
            </div>

            <div className="form-group" style={{ marginBottom: 16 }}>
              <label className="label">Minimum Company Size (Employees)</label>
              <input
                type="number"
                className="input"
                value={searchMinSize}
                onChange={(e) => setSearchMinSize(e.target.value)}
                min="5"
                max="10000"
                required
              />
            </div>

            <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                className="btn"
                onClick={() => setSearchModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn--primary"
                disabled={searching}
              >
                {searching ? 'Discovering...' : 'Run Discovery & Score'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
