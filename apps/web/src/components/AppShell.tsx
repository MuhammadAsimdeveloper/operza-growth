import { useAuth } from '../lib/AuthContext';
import { api } from '../lib/api';
import { CopilotHub } from './CopilotHub';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import { Avatar } from './ui';
import { Modal } from './Modal';
import { AppLauncherModal } from './AppLauncherModal';
import { useStore } from '../lib/store';
import { relative } from '../lib/format';

interface NavEntry {
  to: string;
  label: string;
  icon: string;
  end?: boolean;
  badge?: number | string;
}

interface PillarGroup {
  id: string;
  label: string;
  icon: string;
  items: NavEntry[];
}

function Sidebar({
  onNavigate,
  onOpenAppsLauncher,
}: {
  onNavigate: () => void;
  onOpenAppsLauncher: () => void;
}) {
  const { state } = useStore();
  const location = useLocation();
  const { user, agency, locations, activeLocation, switchLocation } = useAuth();
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const [menuFilter, setMenuFilter] = useState('');
  const unreadConversations = state.conversations.reduce((sum, c) => sum + c.unread, 0);
  const unreadNotifications = state.notifications.filter((n) => !n.read).length;

  useEffect(() => {
    if (!accountMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (accountMenuRef.current && !accountMenuRef.current.contains(e.target as Node)) {
        setAccountMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAccountMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [accountMenuOpen]);

  // ─── Pinned Primary Workhorses (Always 1-Click Visible at the Top) ───
  const primaryItems: NavEntry[] = [
    { to: '/', label: 'Dashboard', icon: 'dashboard', end: true },
    { to: '/command-center', label: 'Command Center', icon: 'zap' },
    { to: '/notifications', label: 'Notification Center', icon: 'bell', badge: unreadNotifications },
    { to: '/conversations', label: 'Conversations & Inbox', icon: 'message', badge: unreadConversations },
    { to: '/contacts', label: 'Contacts & CRM', icon: 'users' },
    { to: '/workflows', label: 'Visual Workflows (n8n)', icon: 'zap' },
    { to: '/apps', label: 'All Apps Directory', icon: 'grid', badge: '50+' },
  ];

  // ─── Functional Pillar Accordions (50+ Tools Cleanly Categorized) ───
  const pillars: PillarGroup[] = [
    {
      id: 'crm',
      label: 'CRM & Pipelines',
      icon: 'users',
      items: [
        { to: '/phone', label: 'Phone System & Softphone', icon: 'phone' },
        { to: '/calendars', label: 'Calendars & Scheduling', icon: 'calendar' },
        { to: '/tasks', label: 'Tasks & Follow-ups', icon: 'task' },
        { to: '/opportunities', label: 'Opportunities & Kanban', icon: 'kanban' },
        { to: '/reputation', label: 'Reputation & Reviews', icon: 'star' },
        { to: '/smart-lists', label: 'Smart Lists & Segments', icon: 'sliders' },
      ],
    },
    {
      id: 'marketing',
      label: 'Marketing & Outreach',
      icon: 'megaphone',
      items: [
        { to: '/campaigns', label: 'Marketing Campaigns', icon: 'megaphone' },
        { to: '/social', label: 'Social Media Planner', icon: 'share' },
        { to: '/prospecting', label: 'B2B Prospecting & Scoring', icon: 'target' },
        { to: '/templates', label: 'Email Templates', icon: 'mail' },
        { to: '/links', label: 'Trigger Links', icon: 'link' },
        { to: '/affiliates', label: 'Affiliates & Referrals', icon: 'users' },
        { to: '/media', label: 'Media Asset Library', icon: 'image' },
        { to: '/reporting', label: 'Reporting & Analytics', icon: 'chart' },
      ],
    },
    {
      id: 'sites',
      label: 'Sites, Funnels & Portals',
      icon: 'globe',
      items: [
        { to: '/funnels', label: 'Sales Funnels', icon: 'funnel' },
        { to: '/websites', label: 'Websites Builder', icon: 'globe' },
        { to: '/forms', label: 'Forms & Surveys', icon: 'clipboard' },
        { to: '/blogs', label: 'Blogs & Articles', icon: 'file' },
        { to: '/qr-codes', label: 'QR Code Engine', icon: 'qr' },
        { to: '/portal', label: 'Client Portal Hub', icon: 'globe' },
      ],
    },
    {
      id: 'automation',
      label: 'Automation & AI',
      icon: 'zap',
      items: [
        { to: '/copilot-inbox', label: 'Copilot Proposals', icon: 'check-circle' },
        { to: '/ai-trainer', label: 'AI Bot Training & RAG', icon: 'sparkles' },
      ],
    },
    {
      id: 'commerce',
      label: 'Commerce, Billing & Legal',
      icon: 'wallet',
      items: [
        { to: '/store', label: 'Digital Store', icon: 'store' },
        { to: '/payments', label: 'Payments & Transactions', icon: 'wallet' },
        { to: '/products', label: 'Products & Pricing', icon: 'tag' },
        { to: '/payment-links', label: 'Payment Links', icon: 'link' },
        { to: '/coupons', label: 'Coupons & Promos', icon: 'tag' },
        { to: '/orders', label: 'Customer Orders', icon: 'clipboard' },
        { to: '/subscriptions', label: 'Subscriptions & MRR', icon: 'repeat' },
        { to: '/documents', label: 'Contracts & Agreements', icon: 'file' },
      ],
    },
    {
      id: 'experience',
      label: 'Client Experience & LMS',
      icon: 'book',
      items: [
        { to: '/academy', label: 'Operza Cloud Academy & Certs', icon: 'graduation-cap', badge: 'AWS-Grade' },
        { to: '/memberships', label: 'Memberships & Courses', icon: 'book' },
        { to: '/snippets', label: 'Quick Message Snippets', icon: 'message' },
      ],
    },
    {
      id: 'agency',
      label: 'Agency & White-Label',
      icon: 'building',
      items: [
        { to: '/sub-accounts', label: 'Sub-accounts & Locations', icon: 'building' },
        { to: '/snapshots', label: 'Account Snapshots', icon: 'refresh' },
        { to: '/branding', label: 'Custom White-Label Branding', icon: 'sliders' },
      ],
    },
    {
      id: 'governance',
      label: 'Platform & Governance',
      icon: 'shield',
      items: [
        { to: '/integrations', label: 'App Marketplace', icon: 'plug' },
        { to: '/consent-ledger', label: 'Consent Ledger (TCPA)', icon: 'shield' },
        { to: '/plan-usage', label: 'Plan & Usage Meters', icon: 'chart' },
        { to: '/developers', label: 'Developer Hub & Webhooks', icon: 'webhook' },
        { to: '/custom-values', label: 'Custom Values', icon: 'sliders' },
        { to: '/audit-log', label: 'Security & Audit Log', icon: 'clipboard' },
        { to: '/settings', label: 'Workspace Settings', icon: 'settings' },
      ],
    },
    {
      id: 'public',
      label: 'Public & Showcase',
      icon: 'tag',
      items: [
        { to: '/home', label: 'Landing Page & 3D Showcase', icon: 'globe' },
        { to: '/pricing', label: 'Pricing & Plans Matrix', icon: 'tag' },
        { to: '/academy', label: 'Operza Academy & Exam', icon: 'graduation-cap' },
        { to: '/docs', label: 'Documentation & Guides', icon: 'clipboard' },
        { to: '/platform/crm', label: 'Platform Architecture Tour', icon: 'zap' },
      ],
    },
  ];

  // Collapsible Accordion State
  const [expandedPillars, setExpandedPillars] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const p of pillars) {
      if (p.items.some((i) => i.to === location.pathname || location.pathname.startsWith(i.to + '/'))) {
        init[p.id] = true;
      }
    }
    return init;
  });

  // Auto-expand the pillar matching active location
  useEffect(() => {
    for (const p of pillars) {
      if (p.items.some((i) => i.to === location.pathname || location.pathname.startsWith(i.to + '/'))) {
        setExpandedPillars((prev) => ({ ...prev, [p.id]: true }));
      }
    }
  }, [location.pathname]);

  const togglePillar = (id: string) => {
    setExpandedPillars((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleAllPillars = () => {
    const anyCollapsed = pillars.some((p) => !expandedPillars[p.id]);
    const next: Record<string, boolean> = {};
    for (const p of pillars) {
      next[p.id] = anyCollapsed;
    }
    setExpandedPillars(next);
  };

  const allExpanded = useMemo(() => pillars.every((p) => expandedPillars[p.id]), [pillars, expandedPillars]);

  // Search Filter matching across both primary and pillar items
  const filteredPrimary = useMemo(() => {
    if (!menuFilter.trim()) return primaryItems;
    const q = menuFilter.toLowerCase().trim();
    return primaryItems.filter((i) => i.label.toLowerCase().includes(q) || i.to.toLowerCase().includes(q));
  }, [primaryItems, menuFilter]);

  const filteredPillars = useMemo(() => {
    if (!menuFilter.trim()) return pillars;
    const q = menuFilter.toLowerCase().trim();
    return pillars
      .map((pillar) => ({
        ...pillar,
        items: pillar.items.filter((item) => item.label.toLowerCase().includes(q) || item.to.toLowerCase().includes(q)),
      }))
      .filter((pillar) => pillar.items.length > 0);
  }, [pillars, menuFilter]);

  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <div className="brand__mark">OP</div>
        <div className="brand__text">
          <div className="brand__name">Operza</div>
          <div className="brand__sub">Business Operating System</div>
        </div>
        <button className="icon-btn sidebar__toggle" style={{ marginLeft: 'auto' }} onClick={onNavigate} aria-label="Close navigation">
          <Icon name="x" size={17} />
        </button>
      </div>

      <div style={{ position: 'relative' }} ref={accountMenuRef}>
        <button
          className="sidebar__account"
          type="button"
          aria-expanded={accountMenuOpen}
          aria-haspopup="menu"
          onClick={() => setAccountMenuOpen((v) => !v)}
          title="Switch active sub-account / location"
        >
          <span className="account__avatar">
            {(agency?.name || 'OP').slice(0, 2).toUpperCase()}
          </span>
          <span style={{ minWidth: 0, flex: 1 }}>
            <span className="account__name" style={{ display: 'block' }}>
              {activeLocation?.name || agency?.name || 'Operza Workspace'}
            </span>
            <span className="account__plan" style={{ display: 'block' }}>
              {agency?.name || 'Agency Workspace'}
            </span>
          </span>
          <Icon name="chevron-down" size={15} />
        </button>

        {accountMenuOpen && (
          <div
            className="card"
            style={{
              position: 'absolute',
              top: '100%',
              left: 12,
              right: 12,
              zIndex: 50,
              boxShadow: 'var(--shadow-lg)',
              padding: '8px',
              borderRadius: 'var(--r-md)',
              background: 'var(--surface)',
              border: '1px solid var(--line)',
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', padding: '4px 8px' }}>
              SWITCH SUB-ACCOUNT
            </div>
            {locations.map((loc) => (
              <button
                key={loc.id}
                type="button"
                className="btn btn--ghost btn--sm"
                style={{
                  width: '100%',
                  justifyContent: 'flex-start',
                  fontWeight: loc.id === activeLocation?.id ? 700 : 400,
                  color: loc.id === activeLocation?.id ? 'var(--accent)' : 'var(--text)',
                }}
                onClick={() => {
                  switchLocation(loc.id);
                  setAccountMenuOpen(false);
                }}
              >
                <Icon name="building" size={13} /> {loc.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Quick Menu Filter Input */}
      <div style={{ padding: '8px 12px 2px' }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <span style={{ position: 'absolute', left: 8, opacity: 0.5, pointerEvents: 'none' }}>
            <Icon name="search" size={12} />
          </span>
          <input
            type="text"
            placeholder="Filter 50+ pages..."
            value={menuFilter}
            onChange={(e) => setMenuFilter(e.target.value)}
            style={{
              width: '100%',
              fontSize: 11.5,
              padding: '6px 24px 6px 26px',
              borderRadius: 6,
              background: 'var(--surface-2, rgba(255,255,255,0.04))',
              border: '1px solid var(--line, rgba(255,255,255,0.08))',
              color: 'var(--text, #f8fafc)',
              outline: 'none',
            }}
          />
          {menuFilter && (
            <button
              type="button"
              className="icon-btn"
              style={{ position: 'absolute', right: 4, padding: 2 }}
              onClick={() => setMenuFilter('')}
              title="Clear filter"
            >
              <Icon name="x" size={11} />
            </button>
          )}
        </div>
      </div>

      <nav className="sidebar__nav">
        {/* Pinned Primary Workhorses Section */}
        {!menuFilter && (
          <div style={{ marginBottom: 12 }}>
            <div className="nav__group-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px 4px' }}>
              <span>Primary Tools</span>
              <span style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 600 }}>Quick Access</span>
            </div>
            {primaryItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `nav__item${isActive ? ' is-active' : ''}`}
                onClick={onNavigate}
              >
                <span className="nav__icon">
                  <Icon name={item.icon} size={16} />
                </span>
                <span className="nav__label">{item.label}</span>
                {item.badge !== undefined && <span className="nav__count">{item.badge}</span>}
              </NavLink>
            ))}

            {/* Visual 50+ Apps Launcher Banner */}
            <div style={{ padding: '8px 2px 4px' }}>
              <button
                type="button"
                className="btn btn--subtle"
                style={{
                  width: '100%',
                  justifyContent: 'space-between',
                  padding: '8px 10px',
                  background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.16) 0%, rgba(14, 165, 233, 0.08) 100%)',
                  border: '1px solid rgba(99, 102, 241, 0.32)',
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 700,
                  color: 'var(--text, #f8fafc)',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
                }}
                onClick={onOpenAppsLauncher}
                title="Explore Complete Operza 50+ Operating Tools Directory"
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                  <Icon name="grid" size={14} style={{ color: '#818cf8' }} />
                  <span>All Apps (50+)</span>
                </span>
                <span style={{ fontSize: 10.5, color: '#38bdf8', fontWeight: 650 }}>Catalog →</span>
              </button>
            </div>
          </div>
        )}

        {/* Filtered Primary Items (when searching) */}
        {menuFilter && filteredPrimary.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div className="nav__group-label" style={{ padding: '6px 8px 4px' }}>
              Primary Matches ({filteredPrimary.length})
            </div>
            {filteredPrimary.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `nav__item${isActive ? ' is-active' : ''}`}
                onClick={onNavigate}
              >
                <span className="nav__icon">
                  <Icon name={item.icon} size={16} />
                </span>
                <span className="nav__label">{item.label}</span>
                {item.badge !== undefined && <span className="nav__count">{item.badge}</span>}
              </NavLink>
            ))}
          </div>
        )}

        {/* Functional Pillars Section (Collapsible Accordions) */}
        <div>
          {!menuFilter && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 8px 4px' }}>
              <span style={{ fontSize: 10.5, fontWeight: 750, color: 'var(--text-3)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                Operating Pillars
              </span>
              <button
                type="button"
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--accent, #6366f1)',
                  fontSize: 10.5,
                  fontWeight: 650,
                  cursor: 'pointer',
                  padding: 0,
                }}
                onClick={toggleAllPillars}
              >
                {allExpanded ? 'Collapse All' : 'Expand All'}
              </button>
            </div>
          )}

          {filteredPillars.length === 0 && filteredPrimary.length === 0 ? (
            <div style={{ padding: '24px 16px', textAlign: 'center', fontSize: 12, color: 'var(--text-3)' }}>
              No pages match "{menuFilter}"
            </div>
          ) : (
            filteredPillars.map((pillar) => {
              const isExpanded = menuFilter ? true : Boolean(expandedPillars[pillar.id]);
              return (
                <div key={pillar.id} style={{ marginBottom: 4 }}>
                  {/* Accordion Header Button */}
                  <button
                    type="button"
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '7px 8px',
                      background: isExpanded ? 'var(--surface-2, rgba(255,255,255,0.03))' : 'transparent',
                      border: 'none',
                      color: isExpanded ? 'var(--text, #f8fafc)' : 'var(--text-3, #94a3b8)',
                      cursor: 'pointer',
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      transition: 'background 0.12s ease, color 0.12s ease',
                    }}
                    onClick={() => togglePillar(pillar.id)}
                    aria-expanded={isExpanded}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                      <Icon name={pillar.icon} size={13} style={{ opacity: isExpanded ? 1 : 0.7, color: isExpanded ? 'var(--accent)' : 'inherit' }} />
                      <span>{pillar.label}</span>
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span
                        style={{
                          fontSize: 9.5,
                          background: 'var(--line, rgba(255,255,255,0.08))',
                          padding: '1px 5px',
                          borderRadius: 4,
                          fontWeight: 700,
                          color: 'var(--text-3)',
                        }}
                      >
                        {pillar.items.length}
                      </span>
                      <Icon
                        name="chevron-right"
                        size={11}
                        style={{
                          transform: isExpanded ? 'rotate(90deg)' : 'none',
                          transition: 'transform 0.15s ease',
                          opacity: 0.7,
                        }}
                      />
                    </span>
                  </button>

                  {/* Accordion Child Items */}
                  {isExpanded && (
                    <div style={{ paddingLeft: 6, marginTop: 2 }}>
                      {pillar.items.map((item) => (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          end={item.end}
                          className={({ isActive }) => `nav__item${isActive ? ' is-active' : ''}`}
                          onClick={onNavigate}
                        >
                          <span className="nav__icon">
                            <Icon name={item.icon} size={15} />
                          </span>
                          <span className="nav__label">{item.label}</span>
                          {item.badge !== undefined && <span className="nav__count">{item.badge}</span>}
                        </NavLink>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </nav>

      <div className="sidebar__footer">
        <div className="atlas-sidebar__section-label">WORKSPACE</div>
        <NavLink to="/settings" className={({ isActive }) => `nav__item${isActive ? ' is-active' : ''}`} onClick={onNavigate}>
          <span className="nav__icon">
            <Icon name="settings" size={16} />
          </span>
          <span className="nav__label">Settings</span>
        </NavLink>
        <NavLink to="/audit-log" className={({ isActive }) => `nav__item${isActive ? ' is-active' : ''}`} onClick={onNavigate}>
          <span className="nav__icon">
            <Icon name="lock" size={16} />
          </span>
          <span className="nav__label">Audit &amp; Security</span>
        </NavLink>
        <div className="atlas-sidebar__user">{user?.name || "Workspace user"}</div>
      </div>
    </aside>
  );
}

export function SearchBox() {
  const { state } = useStore();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return { contacts: [], deals: [] };
    return {
      contacts: state.contacts
        .filter((c) =>
          `${c.firstName} ${c.lastName} ${c.email} ${c.company}`.toLowerCase().includes(q),
        )
        .slice(0, 5),
      deals: state.opportunities.filter((o) => o.name.toLowerCase().includes(q)).slice(0, 4),
    };
  }, [query, state.contacts, state.opportunities]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const go = (path: string) => {
    setOpen(false);
    setQuery('');
    navigate(path);
  };

  const hasResults = results.contacts.length > 0 || results.deals.length > 0;

  return (
    <div className="topbar__search" ref={boxRef} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      <Icon name="search" size={16} />
      <input
        ref={inputRef}
        placeholder="Search Operza..."
        aria-label="Search workspace"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      <kbd
        style={{
          marginLeft: 'auto',
          fontSize: '10px',
          fontWeight: 650,
          color: 'var(--text-3)',
          background: 'var(--surface-2, rgba(0,0,0,0.06))',
          border: '1px solid var(--line)',
          borderRadius: '4px',
          padding: '2px 5px',
          pointerEvents: 'none',
          marginRight: '6px'
        }}
      >
        ⌘K
      </kbd>
      {open && query.trim() && (
        <div
          className="card"
          style={{ position: 'absolute', top: 40, left: 0, right: 0, zIndex: 50, boxShadow: 'var(--shadow-lg)', overflow: 'hidden' }}
        >
          {!hasResults && <div className="empty" style={{ padding: '22px 16px' }}>No matches for “{query}”</div>}
          {results.contacts.map((c) => (
            <button
              key={c.id}
              type="button"
              className="list-row"
              style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', borderBottom: '1px solid var(--line)' }}
              onClick={() => go(`/contacts/${c.id}`)}
            >
              <Avatar name={`${c.firstName} ${c.lastName}`} size="sm" />
              <span style={{ textAlign: 'left', minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>
                  {c.firstName} {c.lastName}
                </span>
                <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-3)' }}>{c.company || c.email}</span>
              </span>
              <Icon name="chevron-right" size={15} style={{ marginLeft: 'auto', color: 'var(--text-3)' }} />
            </button>
          ))}
          {results.deals.map((o) => (
            <button
              key={o.id}
              type="button"
              className="list-row"
              style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', borderBottom: '1px solid var(--line)' }}
              onClick={() => go('/opportunities')}
            >
              <span className="nav__icon">
                <Icon name="kanban" size={16} />
              </span>
              <span style={{ textAlign: 'left', fontSize: 13 }}>{o.name}</span>
              <Icon name="chevron-right" size={15} style={{ marginLeft: 'auto', color: 'var(--text-3)' }} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Floating Tooltip Component ───────────────────────────────────────
function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  const [visible, setVisible] = useState(false);

  return (
    <div
      style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {children}
      {visible && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 7px)',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--text, #0f172a)',
            color: 'var(--surface, #ffffff)',
            fontSize: 11,
            fontWeight: 600,
            padding: '3px 8px',
            borderRadius: 6,
            whiteSpace: 'nowrap',
            zIndex: 1000,
            pointerEvents: 'none',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            letterSpacing: '0.01em',
            animation: 'fadeIn 0.15s ease-out',
          }}
        >
          {label}
        </div>
      )}
    </div>
  );
}

function NotificationsButton() {
  const { state, dispatch } = useStore();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [selectedNotification, setSelectedNotification] = useState<any | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const unread = state.notifications.filter((n) => !n.read).length;

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);

    // Sync backend internal notifications into client notification feed
    api.notifications.list().then((res) => {
      const items = res?.data || [];
      if (Array.isArray(items) && items.length > 0) {
        for (const item of items) {
          dispatch({
            type: 'notification/add',
            notification: {
              id: item.id,
              title: item.title,
              body: item.message,
              read: Boolean(item.read),
              at: item.createdAt || new Date().toISOString()
            }
          });
        }
      }
    }).catch(() => {});

    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const handleOpenNotification = (n: any) => {
    dispatch({ type: 'notifications/read', id: n.id });
    api.notifications.markRead(n.id).catch(() => {});
    setSelectedNotification(n);
    setOpen(false);
  };

  return (
    <>
      <div style={{ position: 'relative' }} ref={ref}>
        <Tooltip label={`Notifications${unread > 0 ? ` (${unread} unread)` : ''}`}>
          <button
            className="icon-btn"
            onClick={() => setOpen((v) => !v)}
            aria-label="Notifications"
            style={{ transition: 'transform 0.15s ease, background 0.15s ease' }}
          >
            <Icon name="bell" size={18} />
            {unread > 0 && <span className="icon-btn__dot" />}
          </button>
        </Tooltip>

        {open && (
          <div
            className="card"
            style={{
              position: 'absolute',
              right: 0,
              top: 42,
              width: 340,
              zIndex: 100,
              boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.12), 0 8px 10px -6px rgba(0, 0, 0, 0.08)',
              overflow: 'hidden',
              background: 'var(--surface, #ffffff)',
              border: '1px solid var(--line, #e2e8f0)',
              borderRadius: '12px'
            }}
          >
            <div className="card__head" style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
              <div className="card__title" style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                Notifications
              </div>
              <button
                className="btn btn--ghost btn--sm"
                style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--accent)' }}
                onClick={() => dispatch({ type: 'notifications/readAll' })}
              >
                Mark all read
              </button>
            </div>
            <div style={{ maxHeight: 340, overflowY: 'auto' }}>
              {state.notifications.length === 0 ? (
                <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-3)', fontSize: 12.5 }}>
                  No notifications yet. You're all caught up!
                </div>
              ) : (
                state.notifications.map((n) => (
                  <div
                    key={n.id}
                    className="list-row"
                    onClick={() => handleOpenNotification(n)}
                    style={{
                      alignItems: 'flex-start',
                      background: n.read ? undefined : 'var(--accent-soft)',
                      cursor: 'pointer',
                      padding: '12px 16px',
                      borderBottom: '1px solid var(--line)',
                      transition: 'background 0.15s ease'
                    }}
                  >
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        background: n.read ? 'var(--line-strong)' : 'var(--accent)',
                        marginTop: 6,
                        flex: '0 0 auto',
                      }}
                    />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 650, color: 'var(--text)' }}>{n.title}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2, lineHeight: 1.4 }}>{n.body}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>{relative(n.at)}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div
              style={{
                padding: '8px 12px',
                background: 'var(--surface-2, #0d111a)',
                borderTop: '1px solid var(--line)',
                textAlign: 'center',
              }}
            >
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                style={{ width: '100%', fontSize: 12, fontWeight: 650, color: 'var(--accent)' }}
                onClick={() => {
                  setOpen(false);
                  navigate('/notifications');
                }}
              >
                Open Notification Center →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Notification Message Detail Modal */}
      {selectedNotification && (
        <Modal
          title={selectedNotification.title || 'Notification Details'}
          onClose={() => setSelectedNotification(null)}
          footer={
            <div style={{ display: 'flex', justifyContent: 'flex-end', width: '100%', gap: 8 }}>
              <button className="btn btn--primary" onClick={() => setSelectedNotification(null)}>
                Close
              </button>
            </div>
          }
        >
          <div className="stack" style={{ gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 10,
                  background: 'var(--accent-soft)',
                  color: 'var(--accent)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <Icon name="bell" size={20} />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)' }}>
                  {selectedNotification.title}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                  Received {relative(selectedNotification.at)}
                </div>
              </div>
            </div>

            <div
              style={{
                padding: '16px',
                background: 'var(--surface-2, #f8fafc)',
                borderRadius: '8px',
                border: '1px solid var(--line, #e2e8f0)',
                color: 'var(--text)',
                fontSize: 13.5,
                lineHeight: 1.6,
                whiteSpace: 'pre-wrap'
              }}
            >
              {selectedNotification.body}
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

function UserMenu() {
  const { user, agency, locations, activeLocation, switchLocation, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const initials = (user?.name || 'OP')
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login');
    } catch {
      navigate('/login');
    }
  };

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <Tooltip label="My Account">
        <button
          className="user-chip"
          type="button"
          onClick={() => setOpen((v) => !v)}
          style={{ transition: 'transform 0.15s ease, box-shadow 0.15s ease' }}
        >
          <span className="user-chip__avatar">{initials}</span>
          <span className="user-chip__name">{user?.name || 'Operator'}</span>
          <Icon name="chevron-down" size={14} />
        </button>
      </Tooltip>

      {open && (
        <div
          className="card"
          style={{
            position: 'absolute',
            right: 0,
            top: 42,
            width: 260,
            zIndex: 100,
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.12), 0 8px 10px -6px rgba(0, 0, 0, 0.08)',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            background: 'var(--surface, #ffffff)',
            border: '1px solid var(--line, #e2e8f0)',
            borderRadius: '12px'
          }}
        >
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text, #0f172a)' }}>
              {user?.name || 'Workspace User'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-3, #64748b)', marginTop: 2 }}>
              {user?.email || 'user@workspace.local'}
            </div>
            <div
              style={{
                fontSize: 12,
                color: 'var(--accent, #4f46e5)',
                marginTop: 6,
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: 6
              }}
            >
              <Icon name="building" size={13} /> {agency?.name || 'Agency Workspace'}
            </div>
          </div>

          {locations.length > 1 && (
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3, #64748b)', display: 'block', marginBottom: 4 }}>
                Active Location:
              </label>
              <select
                value={activeLocation?.id || ''}
                onChange={(e) => switchLocation(e.target.value)}
                style={{
                  width: '100%',
                  fontSize: 12,
                  padding: '6px 8px',
                  borderRadius: 6,
                  background: 'var(--surface-2, #f8fafc)',
                  color: 'var(--text, #0f172a)',
                  border: '1px solid var(--line, #e2e8f0)'
                }}
              >
                {locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <NavLink
              to="/home"
              className="btn btn--ghost btn--sm"
              style={{ width: '100%', justifyContent: 'flex-start', fontSize: 12 }}
              onClick={() => setOpen(false)}
            >
              <Icon name="globe" size={13} /> View Landing Page
            </NavLink>
            <NavLink
              to="/pricing"
              className="btn btn--ghost btn--sm"
              style={{ width: '100%', justifyContent: 'flex-start', fontSize: 12 }}
              onClick={() => setOpen(false)}
            >
              <Icon name="tag" size={13} /> Public Pricing &amp; Plans
            </NavLink>
            <NavLink
              to="/docs"
              className="btn btn--ghost btn--sm"
              style={{ width: '100%', justifyContent: 'flex-start', fontSize: 12 }}
              onClick={() => setOpen(false)}
            >
              <Icon name="clipboard" size={13} /> Developer Docs
            </NavLink>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid var(--line, #e2e8f0)', margin: '4px 0' }} />

          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={handleLogout}
            style={{ width: '100%', justifyContent: 'flex-start', color: '#ef4444', fontWeight: 600 }}
          >
            <Icon name="logout" size={14} /> Log out
          </button>
        </div>
      )}
    </div>
  );
}

function TopBar({ onOpenNav, onOpenAppsLauncher }: { onOpenNav: () => void; onOpenAppsLauncher: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('operza-theme');
    if (saved === 'dark' || saved === 'light') return saved;
    return typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('operza-theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  const titles: Record<string, string> = {
    '/': 'Dashboard',
    '/apps': 'All Apps Directory',
    '/directory': 'All Apps Directory',
    '/notifications': 'Notification Center',
    '/conversations': 'Conversations',
    '/phone': 'Phone System',
    '/snippets': 'Snippets',
    '/sub-accounts': 'Sub-accounts',
    '/snapshots': 'Account Snapshots',
    '/calendars': 'Calendars',
    '/contacts': 'Contacts',
    '/tasks': 'Tasks',
    '/opportunities': 'Opportunities',
    '/campaigns': 'Campaigns',
    '/social': 'Social Planner',
    '/prospecting': 'B2B Prospecting & Scoring',
    '/templates': 'Email Templates',
    '/links': 'Trigger Links',
    '/affiliates': 'Affiliates & Referrals',
    '/media': 'Media Library',
    '/reporting': 'Reporting',
    '/funnels': 'Funnels',
    '/websites': 'Websites',
    '/forms': 'Forms & Surveys',
    '/blogs': 'Blogs & Articles',
    '/qr-codes': 'QR Code Engine',
    '/portal': 'Client Portal Hub',
    '/workflows': 'Workflows',
    '/copilot-inbox': 'Copilot Proposals',
    '/ai-trainer': 'AI Bot Training',
    '/payments': 'Payments',
    '/store': 'Digital Store',
    '/products': 'Products',
    '/payment-links': 'Payment Links',
    '/coupons': 'Coupons',
    '/orders': 'Customer Orders',
    '/subscriptions': 'Subscriptions & MRR',
    '/documents': 'Contracts & Legal OS',
    '/memberships': 'Memberships & Courses',
    '/custom-values': 'Custom Values',
    '/consent-ledger': 'Consent Ledger (TCPA)',
    '/plan-usage': 'Plan & Usage Meters',
    '/audit-log': 'Security & Audit Log',
    '/command-center': 'Command Center',
    '/command': 'Command Center',
    '/home': 'Public Landing Page',
    '/pricing': 'Public Pricing & Plans',
    '/docs': 'Documentation & API Guides',
    '/settings': 'Settings',
    '/integrations': 'App Marketplace',
    '/developers': 'Developer Hub',
    '/branding': 'White-Label Branding',
  };
  const title = titles[location.pathname] ?? 'Workspace';

  return (
    <header className="topbar">
      <button className="icon-btn sidebar__toggle" onClick={onOpenNav} aria-label="Open navigation">
        <Icon name="menu" size={18} />
      </button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-2)', minWidth: 90 }}>{title}</span>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 11.5,
            fontWeight: 650,
            color: 'var(--accent, #6366f1)',
            padding: '4px 9px',
            borderRadius: 6,
            background: 'var(--accent-soft, rgba(99, 102, 241, 0.08))',
            border: '1px solid rgba(99, 102, 241, 0.22)',
            cursor: 'pointer',
          }}
          onClick={onOpenAppsLauncher}
          title="Open Operza 50+ Apps Quick Launcher (9-Dots)"
        >
          <Icon name="grid" size={13} />
          <span>All Apps (50) ▾</span>
        </button>
      </div>
      <SearchBox />
      <span className="topbar__spacer" />
      <div className="topbar__actions" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <NavLink
          to="/apps"
          className="btn btn--sm btn--ghost"
          style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--text-2)', padding: '5px 10px' }}
          title="Browse All 50+ Operza Applications Directory"
        >
          <Icon name="grid" size={14} />
          <span>Directory</span>
        </NavLink>
        <NavLink
          to="/home"
          className="btn btn--sm btn--ghost"
          style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--text-2)', padding: '5px 10px' }}
          title="Visit Public Landing Page"
        >
          <Icon name="globe" size={14} />
          <span>Landing Page</span>
        </NavLink>
        <NavLink
          to="/pricing"
          className="btn btn--sm btn--ghost"
          style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--text-2)', padding: '5px 10px' }}
          title="View Public Pricing & Plans"
        >
          <Icon name="tag" size={14} />
          <span>Pricing</span>
        </NavLink>
        <NavLink
          to="/academy"
          className="btn btn--sm btn--ghost"
          style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--text-2)', padding: '5px 10px' }}
          title="AWS-Style Operza Cloud Academy & Certification"
        >
          <Icon name="graduation-cap" size={14} />
          <span>Academy</span>
        </NavLink>

        <Tooltip label={theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode'}>
          <button
            className="icon-btn"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
          >
            <Icon name={theme === 'light' ? 'moon' : 'sun'} size={18} />
          </button>
        </Tooltip>

        <Tooltip label="Help & Documentation">
          <button className="icon-btn" aria-label="Help & Documentation" onClick={() => navigate('/docs')}>
            <Icon name="clipboard" size={18} />
          </button>
        </Tooltip>

        <NotificationsButton />
        <UserMenu />
      </div>
    </header>
  );
}

export function AppShell({ children }: { children?: ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);
  const [appsLauncherOpen, setAppsLauncherOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  return (
    <div className={["shell", "shell--overview", navOpen && "is-nav-open"].filter(Boolean).join(" ")}>
      <Sidebar onNavigate={() => setNavOpen(false)} onOpenAppsLauncher={() => setAppsLauncherOpen(true)} />
      <div className="scrim" onClick={() => setNavOpen(false)} />
      <div className="main">
        <TopBar onOpenNav={() => setNavOpen(true)} onOpenAppsLauncher={() => setAppsLauncherOpen(true)} />
        {children ?? <Outlet />}
        <CopilotHub />
      </div>
      <AppLauncherModal isOpen={appsLauncherOpen} onClose={() => setAppsLauncherOpen(false)} />
    </div>
  );
}


