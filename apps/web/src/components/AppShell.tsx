import { useAuth } from '../lib/AuthContext';
import { CopilotHub } from './CopilotHub';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import { Avatar } from './ui';
import { useStore } from '../lib/store';
import { relative } from '../lib/format';

interface NavEntry {
  to: string;
  label: string;
  icon: string;
  end?: boolean;
  badge?: number;
}

function Sidebar({ onNavigate }: { onNavigate: () => void }) {
  const { state } = useStore();
  const unread = state.conversations.reduce((sum, c) => sum + c.unread, 0);

  const groups: Array<{ label?: string; items: NavEntry[] }> = [
    {
      items: [
        { to: '/', label: 'Dashboard', icon: 'dashboard', end: true },
        { to: '/conversations', label: 'Conversations', icon: 'message', badge: unread },
        { to: '/phone', label: 'Phone System', icon: 'phone' },
        { to: '/calendars', label: 'Calendars', icon: 'calendar' },
        { to: '/contacts', label: 'Contacts', icon: 'users' },
        { to: '/tasks', label: 'Tasks', icon: 'task' },
        { to: '/opportunities', label: 'Opportunities', icon: 'kanban' },
        { to: '/reputation', label: 'Reputation', icon: 'star' },
        { to: '/smart-lists', label: 'Smart Lists', icon: 'sliders' },
      ],
    },
    {
      label: 'Marketing',
      items: [
        { to: '/campaigns', label: 'Campaigns', icon: 'megaphone' },
        { to: '/social', label: 'Social Planner', icon: 'share' },
        { to: '/prospecting', label: 'Prospecting', icon: 'target' },
        { to: '/templates', label: 'Email Templates', icon: 'mail' },
        { to: '/links', label: 'Trigger Links', icon: 'link' },
        { to: '/affiliates', label: 'Affiliates', icon: 'users' },
        { to: '/media', label: 'Media Library', icon: 'image' },
        { to: '/reporting', label: 'Reporting', icon: 'chart' },
      ],
    },
    {
      label: 'Sites',
      items: [
        { to: '/funnels', label: 'Funnels', icon: 'funnel' },
        { to: '/websites', label: 'Websites', icon: 'globe' },
        { to: '/forms', label: 'Forms & Surveys', icon: 'clipboard' },
        { to: '/blogs', label: 'Blogs', icon: 'file' },
        { to: '/qr-codes', label: 'QR Codes', icon: 'qr' },
        { to: '/portal', label: 'Client Portal', icon: 'globe' },
      ],
    },
    {
      label: 'Automation',
      items: [{ to: '/workflows', label: 'Workflows', icon: 'zap' }],
    },
    {
      label: 'Commerce',
      items: [
        { to: '/store', label: 'Store', icon: 'store' },
        { to: '/payments', label: 'Payments', icon: 'wallet' },
        { to: '/products', label: 'Products', icon: 'tag' },
        { to: '/payment-links', label: 'Payment Links', icon: 'link' },
        { to: '/coupons', label: 'Coupons', icon: 'tag' },
        { to: '/orders', label: 'Orders', icon: 'clipboard' },
        { to: '/subscriptions', label: 'Subscriptions', icon: 'repeat' },
        { to: '/documents', label: 'Contracts', icon: 'file' },
      ],
    },
    {
      label: 'Client Experience',
      items: [
        { to: '/memberships', label: 'Memberships', icon: 'book' },
        { to: '/snippets', label: 'Snippets', icon: 'message' },
      ],
    },
    {
      label: 'Agency',
      items: [
        { to: '/sub-accounts', label: 'Sub-accounts', icon: 'building' },
        { to: '/snapshots', label: 'Account Snapshots', icon: 'refresh' },
      ],
    },
    {
      label: 'Workspace',
      items: [
        { to: '/custom-values', label: 'Custom Values', icon: 'sliders' },
        { to: '/audit-log', label: 'Audit Log', icon: 'clipboard' },
      ],
    },
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <div className="brand__mark">OP</div>
        <div className="brand__text">
          <div className="brand__name">Operza</div>
          <div className="brand__sub">Agency Workspace</div>
        </div>
        <button className="icon-btn sidebar__toggle" style={{ marginLeft: 'auto' }} onClick={onNavigate} aria-label="Close navigation">
          <Icon name="x" size={17} />
        </button>
      </div>

      <button className="sidebar__account" type="button">
        <span className="account__avatar">AG</span>
        <span style={{ minWidth: 0, flex: 1 }}>
          <span className="account__name" style={{ display: 'block' }}>
            Asim Growth Agency
          </span>
          <span className="account__plan" style={{ display: 'block' }}>
            Agency · Unlimited
          </span>
        </span>
        <Icon name="chevron-down" size={15} />
      </button>

      <nav className="sidebar__nav">
        {groups.map((group, gi) => (
          <div key={group.label ?? `g${gi}`}>
            {group.label && <div className="nav__group-label">{group.label}</div>}
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `nav__item${isActive ? ' is-active' : ''}`}
                onClick={onNavigate}
              >
                <span className="nav__icon">
                  <Icon name={item.icon} size={17} />
                </span>
                <span className="nav__label">{item.label}</span>
                {!!item.badge && <span className="nav__count">{item.badge}</span>}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="sidebar__footer">
        <NavLink to="/settings" className={({ isActive }) => `nav__item${isActive ? ' is-active' : ''}`} onClick={onNavigate}>
          <span className="nav__icon">
            <Icon name="settings" size={17} />
          </span>
          <span className="nav__label">Settings</span>
        </NavLink>
        <button className="nav__item" type="button" style={{ width: '100%' }}>
          <span className="nav__icon">
            <Icon name="sparkles" size={17} />
          </span>
          <span className="nav__label">What&apos;s new</span>
        </button>
      </div>
    </aside>
  );
}

function SearchBox() {
  const { state } = useStore();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

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

  const go = (path: string) => {
    setOpen(false);
    setQuery('');
    navigate(path);
  };

  const hasResults = results.contacts.length > 0 || results.deals.length > 0;

  return (
    <div className="topbar__search" ref={boxRef}>
      <Icon name="search" size={16} />
      <input
        placeholder="Search contacts, deals, pages…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
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

function NotificationsButton() {
  const { state, dispatch } = useStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const unread = state.notifications.filter((n) => !n.read).length;

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button className="icon-btn" onClick={() => setOpen((v) => !v)} aria-label="Notifications">
        <Icon name="bell" size={18} />
        {unread > 0 && <span className="icon-btn__dot" />}
      </button>
      {open && (
        <div
          className="card"
          style={{ position: 'absolute', right: 0, top: 42, width: 330, zIndex: 50, boxShadow: 'var(--shadow-lg)', overflow: 'hidden' }}
        >
          <div className="card__head">
            <div className="card__title">Notifications</div>
            <button
              className="btn btn--ghost btn--sm"
              style={{ marginLeft: 'auto' }}
              onClick={() => dispatch({ type: 'notifications/readAll' })}
            >
              Mark all read
            </button>
          </div>
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            {state.notifications.map((n) => (
              <div
                key={n.id}
                className="list-row"
                style={{ alignItems: 'flex-start', background: n.read ? undefined : 'var(--accent-soft)' }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: n.read ? 'var(--line-strong)' : 'var(--accent)',
                    marginTop: 7,
                    flex: '0 0 auto',
                  }}
                />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>{n.title}</span>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--text-2)', marginTop: 1 }}>{n.body}</span>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--text-3)', marginTop: 3 }}>{relative(n.at)}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
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
      <button className="user-chip" type="button" onClick={() => setOpen((v) => !v)}>
        <span className="user-chip__avatar">{initials}</span>
        <span className="user-chip__name">{user?.name || 'Operator'}</span>
        <Icon name="chevron-down" size={14} />
      </button>

      {open && (
        <div
          className="card"
          style={{
            position: 'absolute',
            right: 0,
            top: 42,
            width: 240,
            zIndex: 100,
            boxShadow: 'var(--shadow-lg)',
            padding: '14px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            background: 'var(--surface-1, #1e293b)',
            border: '1px solid var(--border, #334155)',
            borderRadius: '8px'
          }}
        >
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-1)' }}>{user?.name}</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{user?.email}</div>
            <div style={{ fontSize: 11, color: 'var(--primary, #3b82f6)', marginTop: 2, fontWeight: 500 }}>
              ?? {agency?.name || 'Operza Agency'}
            </div>
          </div>

          {locations.length > 1 && (
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>
                Active Location:
              </label>
              <select
                value={activeLocation?.id || ''}
                onChange={(e) => switchLocation(e.target.value)}
                style={{
                  width: '100%',
                  fontSize: 12,
                  padding: '4px 8px',
                  borderRadius: 4,
                  background: 'var(--surface-2, #0f172a)',
                  color: 'var(--text-1)',
                  border: '1px solid var(--border, #334155)'
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

          <hr style={{ border: 'none', borderTop: '1px solid var(--line, #334155)', margin: 0 }} />

          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={handleLogout}
            style={{ width: '100%', justifyContent: 'flex-start', color: '#ef4444' }}
          >
            <Icon name="logout" size={14} /> Log out
          </button>
        </div>
      )}
    </div>
  );
}

function TopBar({ onOpenNav }: { onOpenNav: () => void }) {
  const location = useLocation();
  const titles: Record<string, string> = {
    '/': 'Dashboard',
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
    '/reporting': 'Reporting',
    '/funnels': 'Funnels',
    '/websites': 'Websites',
    '/forms': 'Forms & Surveys',
    '/workflows': 'Workflows',
    '/payments': 'Payments',
    '/store': 'Store',
    '/products': 'Products',
    '/payment-links': 'Payment Links',
    '/coupons': 'Coupons',
    '/custom-values': 'Custom Values',
    '/audit-log': 'Audit Log',
    '/settings': 'Settings',
  };
  const title = titles[location.pathname] ?? 'Workspace';

  return (
    <header className="topbar">
      <button className="icon-btn sidebar__toggle" onClick={onOpenNav} aria-label="Open navigation">
        <Icon name="menu" size={18} />
      </button>
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-2)', minWidth: 90 }}>{title}</span>
      <SearchBox />
      <span className="topbar__spacer" />
      <div className="topbar__actions">
        <button className="icon-btn" aria-label="Help">
          <Icon name="globe" size={18} />
        </button>
        <NotificationsButton />
        <UserMenu />
      </div>
    </header>
  );
}

export function AppShell({ children }: { children?: ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  return (
    <div className={`shell${navOpen ? ' is-nav-open' : ''}`}>
      <Sidebar onNavigate={() => setNavOpen(false)} />
      <div className="scrim" onClick={() => setNavOpen(false)} />
      <div className="main">
        <TopBar onOpenNav={() => setNavOpen(true)} />
        {children ?? <Outlet />}
      <CopilotHub />
      </div>
    </div>
  );
}


