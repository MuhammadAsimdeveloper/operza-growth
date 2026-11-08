import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from './Icon';

interface CommandItem {
  id: string;
  category: 'Navigation' | 'Actions' | 'Tools';
  title: string;
  description: string;
  icon: string;
  shortcut?: string;
  run: () => void;
}

export function CommandPalette() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  // Global Ctrl+K / Cmd+K listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    const handleCustomTrigger = () => {
      setIsOpen(true);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('operza:open-command-palette', handleCustomTrigger);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('operza:open-command-palette', handleCustomTrigger);
    };
  }, []);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const items: CommandItem[] = [
    // Navigation
    {
      id: 'nav-cockpit',
      category: 'Navigation',
      title: 'Command Center Cockpit',
      description: 'Executive KPI telemetry and autonomous agent control',
      icon: 'terminal',
      shortcut: 'C',
      run: () => navigate('/command-center'),
    },
    {
      id: 'nav-dashboard',
      category: 'Navigation',
      title: 'Executive Dashboard',
      description: 'Main overview of agency metrics and operational stats',
      icon: 'layout',
      run: () => navigate('/'),
    },
    {
      id: 'nav-contacts',
      category: 'Navigation',
      title: 'Contacts & CRM (GHL-Grade)',
      description: 'Lead timelines, smart lists, and contact 360 profiles',
      icon: 'users',
      shortcut: 'L',
      run: () => navigate('/contacts'),
    },
    {
      id: 'nav-workflows',
      category: 'Navigation',
      title: 'Visual Workflows (n8n Engine)',
      description: '2D nodal canvas, execution inspector, and automation triggers',
      icon: 'zap',
      shortcut: 'W',
      run: () => navigate('/workflows'),
    },
    {
      id: 'nav-websites',
      category: 'Navigation',
      title: 'Websites & Edge Hosting',
      description: 'Multi-page CMS, custom DNS verification, and static ZIP exports',
      icon: 'globe',
      shortcut: 'S',
      run: () => navigate('/websites'),
    },
    {
      id: 'nav-phone',
      category: 'Navigation',
      title: 'WebRTC Softphone & Telephony',
      description: 'Browser audio calls, DTMF dialpad, and Twilio/SIP trunking',
      icon: 'phone',
      shortcut: 'P',
      run: () => navigate('/phone'),
    },
    {
      id: 'nav-conversations',
      category: 'Navigation',
      title: 'Unified Conversations Inbox',
      description: 'Omnichannel SMS, Email, WhatsApp, and Webchat threads',
      icon: 'message',
      run: () => navigate('/conversations'),
    },
    {
      id: 'nav-calendars',
      category: 'Navigation',
      title: 'Calendars & Appointments',
      description: '2-way Google/Outlook sync and booking links',
      icon: 'calendar',
      run: () => navigate('/calendars'),
    },
    {
      id: 'nav-invoices',
      category: 'Navigation',
      title: 'Invoicing & Commerce',
      description: 'Recurring retainers, checkout links, and cash receipts',
      icon: 'wallet',
      run: () => navigate('/invoices'),
    },
    {
      id: 'nav-apps',
      category: 'Navigation',
      title: 'All Apps Directory (50+)',
      description: 'Search complete suite of native enterprise tools',
      icon: 'grid',
      run: () => navigate('/apps'),
    },
    {
      id: 'nav-academy',
      category: 'Navigation',
      title: 'Operza Mastery Academy',
      description: 'Complete video course certification and hands-on labs',
      icon: 'book',
      run: () => navigate('/academy'),
    },
    {
      id: 'nav-settings',
      category: 'Navigation',
      title: 'Workspace Settings & Team',
      description: 'Agency branding, domains, carrier credentials, and members',
      icon: 'settings',
      run: () => navigate('/settings'),
    },

    // Actions
    {
      id: 'act-tour',
      category: 'Actions',
      title: 'Take Product Onboarding Tour',
      description: 'Launch the interactive 6-step guided walkthrough',
      icon: 'play',
      run: () => window.dispatchEvent(new CustomEvent('operza:open-tour')),
    },
    {
      id: 'act-new-contact',
      category: 'Actions',
      title: 'Create New Contact',
      description: 'Add a new lead or customer to CRM pipeline',
      icon: 'plus',
      run: () => navigate('/contacts'),
    },
    {
      id: 'act-new-workflow',
      category: 'Actions',
      title: 'Create Automation Workflow',
      description: 'Launch a new visual 2D node automation canvas',
      icon: 'zap',
      run: () => navigate('/workflows'),
    },
    {
      id: 'act-new-site',
      category: 'Actions',
      title: 'Provision Multi-Page Website',
      description: 'Select an industry template kit and deploy with DNS',
      icon: 'globe',
      run: () => navigate('/websites'),
    },
    {
      id: 'act-softphone',
      category: 'Actions',
      title: 'Open WebRTC Softphone Dialer',
      description: 'Launch dialpad with microphone audio level visualizer',
      icon: 'phone',
      run: () => navigate('/phone'),
    },
  ];

  const filtered = items.filter((item) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      item.title.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q) ||
      item.category.toLowerCase().includes(q)
    );
  });

  const handleSelect = (item: CommandItem) => {
    setIsOpen(false);
    item.run();
  };

  const handleKeyDownInInput = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % (filtered.length || 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + (filtered.length || 1)) % (filtered.length || 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[selectedIndex]) {
        handleSelect(filtered[selectedIndex]);
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div
      style={styles.backdrop}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setIsOpen(false);
      }}
    >
      <div style={styles.palette} role="dialog" aria-modal="true" aria-label="Command Palette">
        {/* Search Input Bar */}
        <div style={styles.searchBar}>
          <Icon name="search" size={17} />
          <input
            ref={inputRef}
            style={styles.searchInput}
            placeholder="Type a command, search 50+ apps, or jump to a tool..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDownInInput}
          />
          <kbd style={styles.escBadge}>ESC</kbd>
        </div>

        {/* Results List */}
        <div style={styles.resultsList}>
          {filtered.length === 0 ? (
            <div style={styles.empty}>
              <Icon name="search" size={24} />
              <div style={{ fontWeight: 600 }}>No results found</div>
              <div className="hint" style={{ fontSize: 12 }}>
                Try searching for &quot;workflows&quot;, &quot;crm&quot;, &quot;hosting&quot;, or &quot;softphone&quot;
              </div>
            </div>
          ) : (
            filtered.map((item, index) => {
              const isSelected = index === selectedIndex;
              return (
                <div
                  key={item.id}
                  style={{
                    ...styles.item,
                    ...(isSelected ? styles.itemSelected : {}),
                  }}
                  onMouseEnter={() => setSelectedIndex(index)}
                  onClick={() => handleSelect(item)}
                >
                  <div
                    style={{
                      ...styles.itemIcon,
                      ...(isSelected ? styles.itemIconSelected : {}),
                    }}
                  >
                    <Icon name={item.icon} size={15} />
                  </div>
                  <div style={styles.itemMeta}>
                    <div style={styles.itemTitleRow}>
                      <span style={styles.itemTitle}>{item.title}</span>
                      <span style={styles.itemCategory}>{item.category}</span>
                    </div>
                    <div style={styles.itemDesc}>{item.description}</div>
                  </div>
                  {item.shortcut && <kbd style={styles.shortcutBadge}>{item.shortcut}</kbd>}
                </div>
              );
            })
          )}
        </div>

        {/* Footer shortcuts hint */}
        <div style={styles.paletteFoot}>
          <div style={styles.footHints}>
            <span>
              <kbd style={styles.miniKbd}>↑</kbd> <kbd style={styles.miniKbd}>↓</kbd> to navigate
            </span>
            <span>
              <kbd style={styles.miniKbd}>↵</kbd> to select
            </span>
            <span>
              <kbd style={styles.miniKbd}>esc</kbd> to close
            </span>
          </div>
          <div style={styles.footTag}>Operza Atlas 2.0</div>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(5, 8, 15, 0.65)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'flex-start',
    paddingTop: '12vh',
    zIndex: 99998,
  },
  palette: {
    width: '100%',
    maxWidth: 620,
    background: 'var(--surface)',
    border: '1px solid var(--border-strong, var(--border))',
    borderRadius: 'var(--r-xl, 14px)',
    boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.45)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    animation: 'pop-in 0.18s ease-out',
  },
  searchBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '16px 20px',
    borderBottom: '1px solid var(--line)',
    color: 'var(--text-3)',
  },
  searchInput: {
    flex: 1,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    fontSize: 15,
    color: 'var(--text)',
    fontFamily: 'inherit',
  },
  escBadge: {
    fontSize: 10,
    fontWeight: 700,
    background: 'var(--surface-2)',
    border: '1px solid var(--line)',
    borderRadius: 4,
    padding: '2px 6px',
    color: 'var(--text-3)',
  },
  resultsList: {
    maxHeight: 360,
    overflowY: 'auto',
    padding: '8px 10px',
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
  },
  empty: {
    padding: '40px 20px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
    color: 'var(--text-3)',
    textAlign: 'center',
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '10px 14px',
    borderRadius: 'var(--r-md, 8px)',
    cursor: 'pointer',
    transition: 'background 0.12s',
  },
  itemSelected: {
    background: 'rgba(99, 102, 241, 0.12)',
  },
  itemIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    background: 'var(--surface-2)',
    color: 'var(--text-2)',
    display: 'grid',
    placeItems: 'center',
    flexShrink: 0,
    transition: 'all 0.12s',
  },
  itemIconSelected: {
    background: '#4f46e5',
    color: '#ffffff',
  },
  itemMeta: {
    flex: 1,
    minWidth: 0,
  },
  itemTitleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  itemTitle: {
    fontSize: 13.5,
    fontWeight: 600,
    color: 'var(--text)',
  },
  itemCategory: {
    fontSize: 10.5,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    color: 'var(--text-3)',
    background: 'var(--surface-2)',
    padding: '1px 5px',
    borderRadius: 4,
  },
  itemDesc: {
    fontSize: 12,
    color: 'var(--text-3)',
    marginTop: 2,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  shortcutBadge: {
    fontSize: 11,
    fontWeight: 700,
    background: 'var(--surface-2)',
    border: '1px solid var(--line)',
    borderRadius: 4,
    padding: '2px 7px',
    color: 'var(--text-2)',
    fontFamily: 'var(--font-mono, monospace)',
  },
  paletteFoot: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 18px',
    borderTop: '1px solid var(--line)',
    background: 'var(--surface-2)',
    fontSize: 11.5,
    color: 'var(--text-3)',
  },
  footHints: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  miniKbd: {
    background: 'var(--surface)',
    border: '1px solid var(--line)',
    borderRadius: 3,
    padding: '1px 4px',
    fontSize: 10,
    color: 'var(--text)',
  },
  footTag: {
    fontWeight: 600,
    letterSpacing: '0.04em',
    fontSize: 10.5,
  },
};
