import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import { Avatar } from './ui';
import { useStore } from '../lib/store';
import { currency } from '../lib/format';

interface CommandItem {
  id: string;
  category: 'Pages' | 'Actions' | 'Contacts' | 'Deals';
  title: string;
  subtitle?: string;
  icon: string;
  badge?: string;
  onSelect: () => void;
}

export function CommandPalette({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { state } = useStore();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<'All' | 'Pages' | 'Actions' | 'Contacts' | 'Deals'>('All');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setSelectedCategory('All');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const toggleTheme = () => {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('operza-theme', next);
  };

  const allItems: CommandItem[] = useMemo(() => {
    const items: CommandItem[] = [];

    // Quick Actions
    items.push(
      {
        id: 'act-copilot',
        category: 'Actions',
        title: 'Open Operza Copilot AI',
        subtitle: 'Ask questions or run autonomous CRM actions',
        icon: 'sparkles',
        badge: 'AI',
        onSelect: () => {
          navigate('/copilot');
          onClose();
        },
      },
      {
        id: 'act-new-wf',
        category: 'Actions',
        title: 'Create Workflow Automation',
        subtitle: 'Build 2D visual automation canvas',
        icon: 'zap',
        badge: 'Action',
        onSelect: () => {
          navigate('/workflows');
          onClose();
        },
      },
      {
        id: 'act-new-funnel',
        category: 'Actions',
        title: 'Create Sales Funnel',
        subtitle: 'Launch multi-step conversion funnel',
        icon: 'funnel',
        badge: 'Action',
        onSelect: () => {
          navigate('/funnels');
          onClose();
        },
      },
      {
        id: 'act-new-contact',
        category: 'Actions',
        title: 'Add New Contact',
        subtitle: 'Record lead in unified CRM',
        icon: 'users',
        badge: 'Action',
        onSelect: () => {
          navigate('/contacts');
          onClose();
        },
      },
      {
        id: 'act-new-deal',
        category: 'Actions',
        title: 'Create Opportunity / Deal',
        subtitle: 'Add deal to sales pipeline',
        icon: 'kanban',
        badge: 'Action',
        onSelect: () => {
          navigate('/opportunities');
          onClose();
        },
      },
      {
        id: 'act-toggle-theme',
        category: 'Actions',
        title: 'Toggle Dark / Light Theme',
        subtitle: 'Switch workspace color mode',
        icon: 'moon',
        badge: 'UI',
        onSelect: () => {
          toggleTheme();
          onClose();
        },
      },
      {
        id: 'act-audit',
        category: 'Actions',
        title: 'View Security Audit Ledger',
        subtitle: 'Inspect immutable tenant activity log',
        icon: 'clipboard',
        badge: 'Security',
        onSelect: () => {
          navigate('/audit-log');
          onClose();
        },
      }
    );

    // Standard Navigation Pages
    const pages = [
      { to: '/', title: 'Dashboard', subtitle: 'Workspace overview and high-level metrics', icon: 'dashboard' },
      { to: '/copilot', title: 'Copilot AI Assistant', subtitle: 'Miss Minutes autonomous business operator', icon: 'sparkles' },
      { to: '/workflows', title: 'Workflow Automations', subtitle: 'Visual node graph and event triggers', icon: 'zap' },
      { to: '/funnels', title: 'Funnels & Landing Pages', subtitle: 'Multi-step opt-in flows and checkouts', icon: 'funnel' },
      { to: '/contacts', title: 'CRM Contacts', subtitle: 'All leads, customers, and client records', icon: 'users' },
      { to: '/opportunities', title: 'Opportunities & Pipelines', subtitle: 'Kanban sales pipeline and deal stages', icon: 'kanban' },
      { to: '/conversations', title: 'Omnichannel Conversations', subtitle: 'SMS, WhatsApp, Email & Chat stream', icon: 'message' },
      { to: '/phone', title: 'Phone System & Dialer', subtitle: 'Inbound numbers, call recordings, IVR', icon: 'phone' },
      { to: '/calendars', title: 'Calendars & Booking', subtitle: 'Appointment scheduling and sync', icon: 'calendar' },
      { to: '/campaigns', title: 'Marketing Campaigns', subtitle: 'Drip email and SMS sequences', icon: 'megaphone' },
      { to: '/social', title: 'Social Media Planner', subtitle: 'Schedule posts across social channels', icon: 'share' },
      { to: '/websites', title: 'Websites & CMS', subtitle: 'Multi-page branded sites and client portal', icon: 'globe' },
      { to: '/forms', title: 'Forms & Surveys', subtitle: 'Lead capture forms and multi-step quizzes', icon: 'clipboard' },
      { to: '/payments', title: 'Payments & Transactions', subtitle: 'Stripe gateway ledger and charges', icon: 'wallet' },
      { to: '/store', title: 'Store & Invoicing', subtitle: 'Product catalog, orders, and receipts', icon: 'store' },
      { to: '/products', title: 'Products & Pricing', subtitle: 'One-time and recurring subscription tiers', icon: 'tag' },
      { to: '/integrations', title: 'App Marketplace', subtitle: 'Stripe, Twilio, OpenAI, Webhooks', icon: 'plug' },
      { to: '/developers', title: 'Developer Hub & API', subtitle: 'API keys, webhooks, and SDK tokens', icon: 'webhook' },
      { to: '/sub-accounts', title: 'Sub-Accounts & Agencies', subtitle: 'Multi-tenant location management', icon: 'building' },
      { to: '/snapshots', title: 'Agency Snapshots', subtitle: '1-click account cloning blueprints', icon: 'refresh' },
      { to: '/branding', title: 'Custom Branding', subtitle: 'White-label CNAME, logo, and themes', icon: 'sliders' },
      { to: '/settings', title: 'Workspace Settings', subtitle: 'Company profile, team access, and billing', icon: 'settings' },
    ];

    pages.forEach((p) => {
      items.push({
        id: `page-${p.to}`,
        category: 'Pages',
        title: p.title,
        subtitle: p.subtitle,
        icon: p.icon,
        onSelect: () => {
          navigate(p.to);
          onClose();
        },
      });
    });

    // CRM Contacts
    state.contacts.forEach((c) => {
      items.push({
        id: `contact-${c.id}`,
        category: 'Contacts',
        title: `${c.firstName} ${c.lastName}`.trim() || 'Unnamed Contact',
        subtitle: `${c.company ? `${c.company} · ` : ''}${c.email || c.phone || 'No contact info'}`,
        icon: 'users',
        badge: c.tags?.[0] || 'Lead',
        onSelect: () => {
          navigate(`/contacts/${c.id}`);
          onClose();
        },
      });
    });

    // CRM Deals / Opportunities
    state.opportunities.forEach((o) => {
      items.push({
        id: `deal-${o.id}`,
        category: 'Deals',
        title: o.name,
        subtitle: `Value: ${currency(o.value || 0)} · Status: ${o.status || 'open'}`,
        icon: 'kanban',
        badge: currency(o.value || 0),
        onSelect: () => {
          navigate('/opportunities');
          onClose();
        },
      });
    });

    return items;
  }, [state.contacts, state.opportunities, navigate, onClose]);

  // Filter items based on query and category
  const filteredItems = useMemo(() => {
    let result = allItems;
    if (selectedCategory !== 'All') {
      result = result.filter((item) => item.category === selectedCategory);
    }
    const q = query.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (item) =>
          item.title.toLowerCase().includes(q) ||
          (item.subtitle && item.subtitle.toLowerCase().includes(q)) ||
          item.category.toLowerCase().includes(q)
      );
    }
    return result.slice(0, 40);
  }, [allItems, query, selectedCategory]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1 < filteredItems.length ? prev + 1 : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 >= 0 ? prev - 1 : filteredItems.length - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredItems[selectedIndex]) {
          filteredItems[selectedIndex].onSelect();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, filteredItems, selectedIndex, onClose]);

  // Scroll active item into view
  useEffect(() => {
    if (listRef.current) {
      const activeElement = listRef.current.querySelector<HTMLElement>('.command-item-active');
      if (activeElement) {
        activeElement.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '80px 20px 20px',
        animation: 'fadeIn 0.15s ease-out',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 640,
          background: 'var(--surface, #ffffff)',
          border: '1px solid var(--line, #e2e8f0)',
          borderRadius: 14,
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(255,255,255,0.05)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '80vh',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input Bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '14px 18px',
            borderBottom: '1px solid var(--line, #e2e8f0)',
            background: 'var(--surface-2, #f8fafc)',
          }}
        >
          <Icon name="search" size={20} style={{ color: 'var(--accent, #4f46e5)', flexShrink: 0 }} />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search commands, pages, leads, deals... (e.g. 'workflow', 'taylor')"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            style={{
              flex: 1,
              border: 'none',
              background: 'transparent',
              fontSize: 15,
              fontWeight: 500,
              color: 'var(--text, #0f172a)',
              outline: 'none',
            }}
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setSelectedIndex(0);
              }}
              style={{
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                color: 'var(--text-3, #94a3b8)',
                padding: 4,
              }}
              aria-label="Clear search"
            >
              <Icon name="x" size={15} />
            </button>
          )}
          <kbd
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: '2px 6px',
              borderRadius: 4,
              background: 'var(--surface, #ffffff)',
              color: 'var(--text-3, #64748b)',
              border: '1px solid var(--line-strong, #cbd5e1)',
              boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
            }}
          >
            ESC
          </kbd>
        </div>

        {/* Filter Categories Chips */}
        <div
          style={{
            display: 'flex',
            gap: 6,
            padding: '8px 16px',
            borderBottom: '1px solid var(--line, #e2e8f0)',
            background: 'var(--surface, #ffffff)',
            overflowX: 'auto',
          }}
        >
          {(['All', 'Pages', 'Actions', 'Contacts', 'Deals'] as const).map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => {
                setSelectedCategory(cat);
                setSelectedIndex(0);
              }}
              style={{
                border: 'none',
                padding: '4px 10px',
                borderRadius: 6,
                fontSize: 12,
                fontWeight: selectedCategory === cat ? 700 : 500,
                cursor: 'pointer',
                background: selectedCategory === cat ? 'var(--accent, #4f46e5)' : 'var(--surface-2, #f1f5f9)',
                color: selectedCategory === cat ? '#ffffff' : 'var(--text-2, #475569)',
                transition: 'all 0.12s ease',
              }}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Results List */}
        <div
          ref={listRef}
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '6px 8px',
            maxHeight: 420,
          }}
        >
          {filteredItems.length === 0 ? (
            <div style={{ padding: '36px 16px', textAlign: 'center', color: 'var(--text-3, #94a3b8)' }}>
              <Icon name="search" size={28} style={{ margin: '0 auto 8px', opacity: 0.4 }} />
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text, #0f172a)' }}>No matches found</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>
                No commands, pages, or records found matching "{query}".
              </div>
            </div>
          ) : (
            filteredItems.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={item.id}
                  className={isSelected ? 'command-item-active' : ''}
                  onClick={item.onSelect}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '8px 12px',
                    borderRadius: 8,
                    cursor: 'pointer',
                    background: isSelected ? 'var(--accent-soft, rgba(79, 70, 229, 0.08))' : 'transparent',
                    border: isSelected ? '1px solid var(--accent, #4f46e5)' : '1px solid transparent',
                    transition: 'background 0.1s ease',
                  }}
                >
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      background: isSelected ? 'var(--accent, #4f46e5)' : 'var(--surface-2, #f1f5f9)',
                      color: isSelected ? '#ffffff' : 'var(--accent, #4f46e5)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {item.category === 'Contacts' ? (
                      <Avatar name={item.title} size="sm" />
                    ) : (
                      <Icon name={item.icon} size={16} />
                    )}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13.5,
                        fontWeight: 650,
                        color: 'var(--text, #0f172a)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                      }}
                    >
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.title}
                      </span>
                      {item.badge && (
                        <span
                          style={{
                            fontSize: 10.5,
                            fontWeight: 700,
                            padding: '1px 6px',
                            borderRadius: 4,
                            background: isSelected ? 'rgba(79, 70, 229, 0.15)' : 'var(--surface-3, #e2e8f0)',
                            color: isSelected ? 'var(--accent, #4f46e5)' : 'var(--text-3, #64748b)',
                          }}
                        >
                          {item.badge}
                        </span>
                      )}
                    </div>
                    {item.subtitle && (
                      <div
                        style={{
                          fontSize: 11.5,
                          color: 'var(--text-3, #64748b)',
                          marginTop: 2,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {item.subtitle}
                      </div>
                    )}
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      fontSize: 11,
                      fontWeight: 600,
                      color: isSelected ? 'var(--accent, #4f46e5)' : 'var(--text-3, #94a3b8)',
                    }}
                  >
                    <span>{item.category}</span>
                    <Icon name="chevron-right" size={13} />
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer Navigation Hints */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 16px',
            borderTop: '1px solid var(--line, #e2e8f0)',
            background: 'var(--surface-2, #f8fafc)',
            fontSize: 11,
            color: 'var(--text-3, #64748b)',
          }}
        >
          <div style={{ display: 'flex', gap: 14 }}>
            <span>
              <kbd style={kbdStyle}>↑</kbd> <kbd style={kbdStyle}>↓</kbd> navigate
            </span>
            <span>
              <kbd style={kbdStyle}>↵</kbd> select
            </span>
            <span>
              <kbd style={kbdStyle}>esc</kbd> close
            </span>
          </div>
          <div>
            <strong>OPERZA</strong> Command Center
          </div>
        </div>
      </div>
    </div>
  );
}

const kbdStyle: React.CSSProperties = {
  padding: '1px 4px',
  borderRadius: 3,
  background: 'var(--surface, #ffffff)',
  border: '1px solid var(--line-strong, #cbd5e1)',
  fontSize: 10,
  fontWeight: 600,
  color: 'var(--text-2, #475569)',
};
