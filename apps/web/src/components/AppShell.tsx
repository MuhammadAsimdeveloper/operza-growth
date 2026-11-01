import { useAuth } from '../lib/AuthContext';
import { CopilotHub } from './CopilotHub';
import { OperzaLogo } from './OperzaLogo';
import { CommandPalette } from './CommandPalette';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import { Modal } from './Modal';
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
  const { user, agency, locations, activeLocation, switchLocation } = useAuth();
  const location = useLocation();
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem('operza_nav_collapsed_groups');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const toggleGroup = (groupLabel: string) => {
    setCollapsedGroups((prev) => {
      const next = { ...prev, [groupLabel]: !prev[groupLabel] };
      try {
        localStorage.setItem('operza_nav_collapsed_groups', JSON.stringify(next));
      } catch { /* storage fallback */ }
      return next;
    });
  };

  const unread = state.conversations.reduce((sum, c) => sum + c.unread, 0);
  const isSuperAdmin = user?.role === 'superadmin';

  const groups: Array<{ label?: string; items: NavEntry[] }> = isSuperAdmin
    ? [
        {
          label: 'Platform Control',
          items: [
            { to: '/admin', label: 'Platform Overview', icon: 'shield', end: true },
            { to: '/sub-accounts', label: 'All Agencies', icon: 'building' },
            { to: '/snapshots', label: 'Agency Snapshots', icon: 'refresh' },
          ],
        },
        {
          label: 'Infrastructure & Ledger',
          items: [
            { to: '/developers', label: 'Developer API & Webhooks', icon: 'webhook' },
            { to: '/audit-log', label: 'System Audit Ledger', icon: 'clipboard' },
            { to: '/integrations', label: 'Payment & API Gateways', icon: 'plug' },
            { to: '/reporting', label: 'Global Telemetry', icon: 'chart' },
          ],
        },
      ]
    : [
        {
          items: [
            { to: '/', label: 'Dashboard', icon: 'dashboard', end: true },
            { to: '/copilot', label: 'Copilot AI', icon: 'sparkles' },
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
      label: 'Automation & AI',
      items: [
        { to: '/workflows', label: 'Workflows', icon: 'zap' },
        { to: '/ai-trainer', label: 'AI Bot Training', icon: 'sparkles' },
      ],
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
      label: 'Agency & White-Label',
      items: [
        { to: '/sub-accounts', label: 'Sub-accounts', icon: 'building' },
        { to: '/snapshots', label: 'Account Snapshots', icon: 'refresh' },
        { to: '/branding', label: 'Custom Branding', icon: 'sliders' },
      ],
    },
    {
      label: 'Platform & Ecosystem',
      items: [
        { to: '/integrations', label: 'App Marketplace', icon: 'plug' },
        { to: '/developers', label: 'Developer Hub', icon: 'webhook' },
        { to: '/custom-values', label: 'Custom Values', icon: 'sliders' },
        { to: '/audit-log', label: 'Audit Log', icon: 'clipboard' },
      ],
    },
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <OperzaLogo size={34} isSuperAdmin={isSuperAdmin} />
        <button className="icon-btn sidebar__toggle" style={{ marginLeft: 'auto' }} onClick={onNavigate} aria-label="Close navigation">
          <Icon name="x" size={17} />
        </button>
      </div>

      {!isSuperAdmin && (
        <div style={{ position: 'relative' }}>
          <button
            className="sidebar__account"
            type="button"
            onClick={() => setAccountMenuOpen((v) => !v)}
            title="Switch active sub-account / location"
          >
            <span className="account__avatar">
              {(agency?.name || 'OP').slice(0, 2).toUpperCase()}
            </span>
            <span style={{ minWidth: 0, flex: 1 }}>
              <span className="account__name" style={{ display: 'block' }}>
                {activeLocation?.name || agency?.name || 'Operza Agency'}
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
      )}

      <nav className="sidebar__nav">
        {groups.map((group, gi) => {
          const hasActiveChild = group.items.some(
            (item) => item.to === location.pathname || (item.to !== '/' && location.pathname.startsWith(item.to))
          );
          const isCollapsed = Boolean(group.label && collapsedGroups[group.label] && !hasActiveChild);

          return (
            <div key={group.label ?? `g${gi}`} className="nav__group">
              {group.label ? (
                <button
                  type="button"
                  className="nav__group-header"
                  onClick={() => toggleGroup(group.label!)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                    background: 'none',
                    border: 'none',
                    padding: '8px 12px 4px',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                  title={isCollapsed ? `Expand ${group.label}` : `Collapse ${group.label}`}
                >
                  <span className="nav__group-label" style={{ margin: 0, padding: 0 }}>
                    {group.label}
                  </span>
                  <span
                    style={{
                      color: 'var(--sidebar-text, #94a3b8)',
                      transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                      transition: 'transform 0.15s ease',
                      display: 'inline-flex',
                    }}
                  >
                    <Icon name="chevron-down" size={12} />
                  </span>
                </button>
              ) : null}
              {!isCollapsed && (
                <div className="nav__group-items">
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
              )}
            </div>
          );
        })}
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

function SearchBox({ onOpenCommandPalette }: { onOpenCommandPalette: () => void }) {
  return (
    <div
      className="topbar__search"
      onClick={onOpenCommandPalette}
      style={{ cursor: 'pointer', userSelect: 'none' }}
      title="Open Command Palette (Ctrl+K / ⌘K)"
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpenCommandPalette();
        }
      }}
    >
      <Icon name="search" size={16} />
      <span style={{ fontSize: 13, color: 'var(--text-3)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        Search commands, pages, CRM records…
      </span>
      <kbd
        style={{
          fontSize: 10,
          fontWeight: 600,
          padding: '2px 5px',
          borderRadius: 4,
          background: 'var(--surface-3)',
          color: 'var(--text-3)',
          border: '1px solid var(--line-strong)',
          marginLeft: 6,
          userSelect: 'none',
        }}
      >
        Ctrl K
      </kbd>
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
  const [open, setOpen] = useState(false);
  const [selectedNotification, setSelectedNotification] = useState<any | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const unread = state.notifications.filter((n) => !n.read).length;

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const handleOpenNotification = (n: any) => {
    dispatch({ type: 'notifications/read', id: n.id });
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
              {user?.name || 'Operator'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-3, #64748b)', marginTop: 2 }}>
              {user?.email || 'operator@operza.io'}
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

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {user?.role === 'superadmin' && (
              <Link
                to="/admin"
                className="btn btn--ghost btn--sm"
                onClick={() => setOpen(false)}
                style={{ width: '100%', justifyContent: 'flex-start', color: '#6366f1', fontWeight: 600 }}
              >
                <Icon name="shield" size={14} /> Super Admin Control
              </Link>
            )}
            <Link
              to="/settings"
              className="btn btn--ghost btn--sm"
              onClick={() => setOpen(false)}
              style={{ width: '100%', justifyContent: 'flex-start' }}
            >
              <Icon name="sliders" size={14} /> Workspace Settings
            </Link>
            <Link
              to="/docs"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn--ghost btn--sm"
              onClick={() => setOpen(false)}
              style={{ width: '100%', justifyContent: 'flex-start' }}
            >
              <Icon name="help" size={14} /> Documentation & Help
            </Link>
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

function TopBar({
  onOpenNav,
  onOpenCommandPalette,
}: {
  onOpenNav: () => void;
  onOpenCommandPalette: () => void;
}) {
  const location = useLocation();
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
    '/integrations': 'App Marketplace',
    '/ai-trainer': 'AI Copilot Training',
    '/developers': 'Developer Hub',
    '/branding': 'White-Label Branding',
    '/copilot': 'Operza Copilot AI',
  };
  const title = titles[location.pathname] ?? 'Workspace';

  return (
    <header className="topbar">
      <button className="icon-btn sidebar__toggle" onClick={onOpenNav} aria-label="Open navigation">
        <Icon name="menu" size={18} />
      </button>
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-2)', minWidth: 90 }}>{title}</span>
      <SearchBox onOpenCommandPalette={onOpenCommandPalette} />
      <span className="topbar__spacer" />
      <div className="topbar__actions" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
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
          <Link
            to="/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="icon-btn"
            aria-label="Help & Documentation"
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name="globe" size={18} />
          </Link>
        </Tooltip>

        <NotificationsButton />
        <UserMenu />
      </div>
    </header>
  );
}

export function AppShell({ children }: { children?: ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={`shell${navOpen ? ' is-nav-open' : ''}`}>
      <Sidebar onNavigate={() => setNavOpen(false)} />
      <div className="scrim" onClick={() => setNavOpen(false)} />
      <div className="main">
        <TopBar
          onOpenNav={() => setNavOpen(true)}
          onOpenCommandPalette={() => setCommandPaletteOpen(true)}
        />
        {children ?? <Outlet />}
        <CopilotHub />
        <CommandPalette
          isOpen={commandPaletteOpen}
          onClose={() => setCommandPaletteOpen(false)}
        />
      </div>
    </div>
  );
}


