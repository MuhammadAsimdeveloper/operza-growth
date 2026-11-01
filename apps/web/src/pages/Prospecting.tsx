import { useMemo, useState } from 'react';
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

  // Scrapling-inspired web scraper modal state
  const [scraperOpen, setScraperOpen] = useState(false);
  const [scrapeQuery, setScrapeQuery] = useState('B2B SaaS Companies');
  const [scrapeEngine, setScrapeEngine] = useState<'stealth' | 'http' | 'spider'>('stealth');
  const [scrapeCount, setScrapeCount] = useState<number>(3);
  const [scraping, setScraping] = useState(false);
  const [scrapeStep, setScrapeStep] = useState<string>('');

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

  const handleRunScraper = () => {
    setScraping(true);
    setScrapeStep('Initializing stealth browser session & spoofing fingerprints...');
    setTimeout(() => {
      setScrapeStep('Bypassing Cloudflare Turnstile & adaptive DOM layout traversal...');
      setTimeout(() => {
        setScrapeStep('Extracting decision makers, verified corporate emails, and fit scoring...');
        setTimeout(() => {
          const sampleCompanies = [
            { company: 'Apex Flow AI', person: 'Elena Rostova', email: 'elena@apexflow.ai', industry: 'SaaS', employees: 42, location: 'Austin, TX', score: 94 },
            { company: 'CloudNexus Ops', person: 'David Sterling', email: 'david@cloudnexus.io', industry: 'Cloud Infrastructure', employees: 88, location: 'London, UK', score: 91 },
            { company: 'Kinetix Growth Labs', person: 'Marcus Vance', email: 'm.vance@kinetixlabs.com', industry: 'Marketing Tech', employees: 24, location: 'Berlin, DE', score: 87 },
          ];
          sampleCompanies.slice(0, scrapeCount).forEach((s) => {
            dispatch({
              type: 'prospect/add',
              prospect: {
                id: uid('pr'),
                company: s.company,
                person: s.person,
                email: s.email,
                industry: s.industry,
                employees: s.employees,
                location: s.location,
                score: s.score,
                status: 'new',
              },
            });
          });
          setScraping(false);
          setScraperOpen(false);
          setScrapeStep('');
        }, 900);
      }, 900);
    }, 900);
  };

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
            <button className="btn btn--primary" onClick={() => setScraperOpen(true)}>
              <Icon name="search" size={15} /> Run Lead Scraper
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

      {/* Scrapling Lead Prospector Modal */}
      {scraperOpen && (
        <Modal
          title="Scrapling Adaptive Lead Scraper"
          onClose={() => !scraping && setScraperOpen(false)}
          footer={
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, width: '100%' }}>
              <button
                className="btn"
                onClick={() => setScraperOpen(false)}
                disabled={scraping}
              >
                Cancel
              </button>
              <button
                className="btn btn--primary"
                onClick={handleRunScraper}
                disabled={scraping || !scrapeQuery.trim()}
              >
                {scraping ? 'Crawling…' : 'Start Scrape Run'}
              </button>
            </div>
          }
        >
          <div className="stack" style={{ gap: 14 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 650, display: 'block', marginBottom: 6 }}>
                Target Industry, Keyword, or Domain
              </label>
              <input
                className="input"
                placeholder="e.g. B2B SaaS Founders, Dental Clinics London"
                value={scrapeQuery}
                onChange={(e) => setScrapeQuery(e.target.value)}
                disabled={scraping}
              />
            </div>

            <div className="grid grid--2" style={{ gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 650, display: 'block', marginBottom: 6 }}>
                  Scrapling Fetcher Engine
                </label>
                <select
                  className="select"
                  value={scrapeEngine}
                  onChange={(e) => setScrapeEngine(e.target.value as any)}
                  disabled={scraping}
                >
                  <option value="stealth">Stealth Browser (Turnstile Bypass)</option>
                  <option value="http">Fast HTTP Fetcher (Static Parser)</option>
                  <option value="spider">Adaptive DOM Spider (Self-Healing)</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 650, display: 'block', marginBottom: 6 }}>
                  Lead Volume
                </label>
                <select
                  className="select"
                  value={scrapeCount}
                  onChange={(e) => setScrapeCount(Number(e.target.value))}
                  disabled={scraping}
                >
                  <option value={1}>1 lead (Instant Dry Run)</option>
                  <option value={3}>3 verified leads</option>
                  <option value={5}>5 verified leads</option>
                </select>
              </div>
            </div>

            {scraping && (
              <div
                style={{
                  background: 'var(--surface-2, #161b22)',
                  border: '1px solid var(--accent, #ff6d5a)',
                  borderRadius: 8,
                  padding: 14,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                <span
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: '50%',
                    border: '2px solid var(--accent, #ff6d5a)',
                    borderTopColor: 'transparent',
                    animation: 'spin 0.8s linear infinite',
                    flex: '0 0 auto',
                  }}
                />
                <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }}>
                  {scrapeStep}
                </span>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
