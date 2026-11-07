/**
 * ============================================================================
 * Operza Global App Launcher (Visual 9-Dots Mega-Menu & Catalog)
 * ============================================================================
 * 
 * Provides instantaneous visual discovery of all 50+ pages in Operza.
 * Features category tabs, fast fuzzy search, colored icon badges, 1-line
 * capability descriptions, and recent pages quick jump.
 */

import { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { OPERZA_APPS, PILLARS, type AppEntry } from '../lib/appsData';

interface AppLauncherModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AppLauncherModal({ isOpen, onClose }: AppLauncherModalProps) {
  const navigate = useNavigate();
  const [selectedPillar, setSelectedPillar] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [recentRoutes, setRecentRoutes] = useState<string[]>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Load recently visited routes from local storage
  useEffect(() => {
    if (isOpen) {
      try {
        const stored = JSON.parse(localStorage.getItem('operza_recent_routes') || '[]');
        if (Array.isArray(stored)) {
          setRecentRoutes(stored.slice(0, 5));
        }
      } catch {}
      // Auto-focus search input
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const filteredApps = useMemo(() => {
    return OPERZA_APPS.filter((app) => {
      if (selectedPillar !== 'all' && app.pillarId !== selectedPillar) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        return (
          app.name.toLowerCase().includes(q) ||
          app.description.toLowerCase().includes(q) ||
          app.route.toLowerCase().includes(q) ||
          app.pillar.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [selectedPillar, searchQuery]);

  const recentApps = useMemo(() => {
    return recentRoutes
      .map((r) => OPERZA_APPS.find((a) => a.route === r))
      .filter((a): a is AppEntry => Boolean(a));
  }, [recentRoutes]);

  const handleLaunch = (route: string) => {
    // Record into recent routes
    try {
      const stored = JSON.parse(localStorage.getItem('operza_recent_routes') || '[]');
      const updated = [route, ...stored.filter((r: string) => r !== route)].slice(0, 8);
      localStorage.setItem('operza_recent_routes', JSON.stringify(updated));
    } catch {}

    onClose();
    navigate(route);
  };

  if (!isOpen) return null;

  return (
    <Modal
      title="Operza Suite Directory (50+ Operating Tools)"
      wide
      onClose={onClose}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', fontSize: 12 }}>
          <span style={{ color: 'var(--text-3)' }}>
            Tip: Press <kbd style={{ padding: '2px 5px', borderRadius: 4, background: 'var(--line)', fontSize: 11 }}>Esc</kbd> to close
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn btn--subtle btn--sm"
              onClick={() => {
                onClose();
                navigate('/apps');
              }}
            >
              Open Full-Page Directory →
            </button>
            <button type="button" className="btn btn--primary btn--sm" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Search Header */}
        <div style={{ position: 'relative' }}>
          <input
            ref={searchInputRef}
            type="text"
            className="input"
            style={{ width: '100%', paddingLeft: 34, fontSize: 13, height: 38 }}
            placeholder="Search all 50+ tools (e.g. Workflows, Softphone, Contracts, Billing, SEO)..."
            value={searchQuery}
            aria-label="Search all tools"
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && filteredApps.length > 0) {
                e.preventDefault();
                handleLaunch(filteredApps[0].route);
              }
            }}
          />
          <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', opacity: 0.5, pointerEvents: 'none' }}>
            <Icon name="search" size={16} />
          </span>
          {searchQuery && (
            <button
              type="button"
              className="icon-btn"
              style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', padding: 2 }}
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
            >
              <Icon name="x" size={13} />
            </button>
          )}
        </div>

        {/* Recently Visited Quick Pills */}
        {!searchQuery && recentApps.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '6px 10px', background: 'var(--surface-2)', borderRadius: 8, border: '1px solid var(--line)' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Recent:
            </span>
            {recentApps.map((app) => (
              <button
                key={app.id}
                type="button"
                className="btn btn--ghost btn--sm"
                style={{
                  fontSize: 11.5,
                  padding: '2px 8px',
                  height: 24,
                  borderRadius: 12,
                  color: 'var(--text)',
                }}
                onClick={() => handleLaunch(app.route)}
              >
                <Icon name={app.icon} size={12} style={{ color: app.accentColor }} />
                <span>{app.name}</span>
              </button>
            ))}
          </div>
        )}

        {/* Department Filter Tabs */}
        <div role="tablist" style={{ display: 'flex', alignItems: 'center', gap: 5, overflowX: 'auto', paddingBottom: 4 }}>
          {PILLARS.map((p) => {
            const isActive = selectedPillar === p.id;
            return (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`btn btn--sm ${isActive ? 'btn--primary' : 'btn--subtle'}`}
                style={{
                  fontSize: 11.5,
                  padding: '4px 10px',
                  borderRadius: 16,
                  whiteSpace: 'nowrap',
                  fontWeight: isActive ? 700 : 500,
                }}
                onClick={() => setSelectedPillar(p.id)}
              >
                <Icon name={p.icon} size={12} />
                <span>{p.label}</span>
              </button>
            );
          })}
        </div>

        {/* 50+ Apps Visual Cards Grid */}
        <div
          style={{
            maxHeight: 460,
            overflowY: 'auto',
            paddingRight: 4,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: 10,
          }}
        >
          {filteredApps.length === 0 ? (
            <div style={{ gridColumn: '1 / -1', padding: '36px 0', textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
              No tools match "{searchQuery}"
            </div>
          ) : (
            filteredApps.map((app) => (
              <div
                key={app.id}
                role="button"
                tabIndex={0}
                aria-label={`Open ${app.name}`}
                className="card"
                style={{
                  padding: '12px 14px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  cursor: 'pointer',
                  border: '1px solid var(--line)',
                  borderRadius: 10,
                  background: 'var(--surface)',
                  transition: 'background 0.12s ease, border-color 0.12s ease, transform 0.12s ease',
                }}
                onClick={() => handleLaunch(app.route)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleLaunch(app.route);
                  }
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = app.accentColor;
                  e.currentTarget.style.background = 'var(--surface-2)';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--line)';
                  e.currentTarget.style.background = 'var(--surface)';
                  e.currentTarget.style.transform = 'none';
                }}
              >
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    background: `${app.accentColor}18`,
                    border: `1px solid ${app.accentColor}33`,
                    display: 'grid',
                    placeItems: 'center',
                    color: app.accentColor,
                    flexShrink: 0,
                  }}
                >
                  <Icon name={app.icon} size={18} />
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {app.name}
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono, monospace)', marginTop: 1 }}>
                    {app.route}
                  </div>
                  <div
                    style={{
                      fontSize: 11.5,
                      color: 'var(--text-2)',
                      marginTop: 4,
                      lineHeight: 1.4,
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {app.description}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}
