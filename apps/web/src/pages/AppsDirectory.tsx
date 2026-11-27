/**
 * ============================================================================
 * Operza Unified Suite Directory (All Apps & Feature Catalog)
 * ============================================================================
 * 
 * Provides an expansive, visually structured bird's-eye view of all 50+ tools
 * and pages across Operza. Eliminates navigation guesswork by cataloging
 * every capability with clear plain-English descriptions, category pillars,
 * live operational tags, and one-click direct access.
 */

import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Badge } from '../components/ui';
import { MarketplaceHub2Panel } from '../components/MarketplaceHub2Panel';
import { OPERZA_APPS, PILLARS, type AppEntry } from '../lib/appsData';

export { OPERZA_APPS, PILLARS, type AppEntry };

export default function AppsDirectory() {
  const navigate = useNavigate();
  const [activePillar, setActivePillar] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredApps = useMemo(() => {
    return OPERZA_APPS.filter((app) => {
      if (activePillar !== 'all' && app.pillarId !== activePillar) return false;
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
  }, [activePillar, searchQuery]);

  return (
    <main className="content" style={{ maxWidth: 1400, margin: '0 auto', paddingBottom: 64 }}>
      {/* Hero Header */}
      <section
        style={{
          padding: '32px 36px',
          borderRadius: 16,
          background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.12) 0%, rgba(14, 165, 233, 0.08) 50%, rgba(16, 185, 129, 0.06) 100%)',
          border: '1px solid var(--border)',
          marginBottom: 28,
          boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: 'var(--accent)',
              display: 'grid',
              placeItems: 'center',
              color: '#ffffff',
            }}
          >
            <Icon name="grid" size={18} />
          </div>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Operza Application Map
          </span>
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 8px', letterSpacing: '-0.02em', color: 'var(--text)' }}>
          Explore All 50+ Unified Operating Tools
        </h1>
        <p style={{ fontSize: 14, color: 'var(--text-2)', maxWidth: 840, margin: 0, lineHeight: 1.6 }}>
          Every capability in Operza is organized by functional department. Never search blindly again—browse, inspect, and launch any tool instantly from this directory.
        </p>

        {/* High-Level Department Stats */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 12,
            marginTop: 24,
          }}
        >
          <div className="card" style={{ padding: '12px 16px', background: 'var(--surface-2, rgba(255,255,255,0.03))' }}>
            <div style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600 }}>TOTAL PAGES</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', marginTop: 2 }}>50 Pages</div>
            <div style={{ fontSize: 11, color: '#10b981', marginTop: 2 }}>100% Discoverable</div>
          </div>
          <div className="card" style={{ padding: '12px 16px', background: 'var(--surface-2, rgba(255,255,255,0.03))' }}>
            <div style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600 }}>CORE PILLARS</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', marginTop: 2 }}>8 Pillars</div>
            <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 2 }}>Organized by Department</div>
          </div>
          <div className="card" style={{ padding: '12px 16px', background: 'var(--surface-2, rgba(255,255,255,0.03))' }}>
            <div style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600 }}>INTEGRATIONS</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', marginTop: 2 }}>Zapier + Native</div>
            <div style={{ fontSize: 11, color: '#3b82f6', marginTop: 2 }}>Bidirectional Webhooks</div>
          </div>
          <div className="card" style={{ padding: '12px 16px', background: 'var(--surface-2, rgba(255,255,255,0.03))' }}>
            <div style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600 }}>SECURITY &amp; RLS</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#10b981', marginTop: 2 }}>Active</div>
            <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 2 }}>Fail-Closed Tenant Isolation</div>
          </div>
        </div>
      </section>

      <MarketplaceHub2Panel />

      {/* Category Pills & Search Bar */}
      <div
        className="card"
        style={{
          padding: '16px 20px',
          marginBottom: 24,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        {/* Category Pills */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {PILLARS.map((p) => {
            const isActive = activePillar === p.id;
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={isActive}
                className={`btn btn--sm ${isActive ? 'btn--primary' : 'btn--subtle'}`}
                style={{
                  fontSize: 12,
                  fontWeight: isActive ? 700 : 500,
                  borderRadius: 20,
                  padding: '5px 12px',
                }}
                onClick={() => setActivePillar(p.id)}
              >
                <Icon name={p.icon} size={13} />
                <span>{p.label}</span>
              </button>
            );
          })}
        </div>

        {/* Live Search Input */}
        <div style={{ position: 'relative', width: 280 }}>
          <input
            type="text"
            className="input"
            style={{ width: '100%', paddingLeft: 32, fontSize: 12.5 }}
            placeholder="Filter apps by name or purpose..."
            value={searchQuery}
            aria-label="Filter apps directory"
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && filteredApps.length > 0) {
                e.preventDefault();
                navigate(filteredApps[0].route);
              }
            }}
          />
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', opacity: 0.5, pointerEvents: 'none' }}>
            <Icon name="search" size={14} />
          </span>
          {searchQuery && (
            <button
              type="button"
              className="icon-btn"
              style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', padding: 2 }}
              onClick={() => setSearchQuery('')}
              aria-label="Clear filter"
            >
              <Icon name="x" size={11} />
            </button>
          )}
        </div>
      </div>

      {/* Results Count Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, padding: '0 4px' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
          Showing {filteredApps.length} of {OPERZA_APPS.length} Available Pages
        </div>
        {searchQuery && (
          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
            Filtered by keyword: <strong>"{searchQuery}"</strong>
          </div>
        )}
      </div>

      {/* Apps Cards Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
          gap: 16,
        }}
      >
        {filteredApps.map((app) => (
          <div
            key={app.id}
            role="button"
            tabIndex={0}
            aria-label={`Open ${app.name}`}
            className="card"
            style={{
              padding: '20px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: 16,
              transition: 'transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease',
              cursor: 'pointer',
              position: 'relative',
              overflow: 'hidden',
            }}
            onClick={() => navigate(app.route)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                navigate(app.route);
              }
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.borderColor = app.accentColor;
              e.currentTarget.style.boxShadow = `0 12px 28px -8px rgba(0,0,0,0.25), 0 0 0 1px ${app.accentColor}33`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.borderColor = 'var(--border)';
              e.currentTarget.style.boxShadow = 'var(--shadow-xs)';
            }}
          >
            <div>
              {/* Card Top: Icon, Pillar, and Status Tag */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
                <div
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: 10,
                    background: `${app.accentColor}18`,
                    border: `1px solid ${app.accentColor}33`,
                    display: 'grid',
                    placeItems: 'center',
                    color: app.accentColor,
                    flexShrink: 0,
                  }}
                >
                  <Icon name={app.icon} size={20} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    {app.pillar}
                  </span>
                  {app.statusTag && (
                    <span style={{ fontSize: 10 }}>
                      <Badge tone="blue">
                        {app.statusTag}
                      </Badge>
                    </span>
                  )}
                </div>
              </div>

              {/* Title & Route */}
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
                <h3 style={{ fontSize: 16, fontWeight: 750, color: 'var(--text)', margin: 0 }}>
                  {app.name}
                </h3>
              </div>
              <div style={{ fontSize: 11, fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-3)', marginBottom: 10 }}>
                {app.route}
              </div>

              {/* Plain English Purpose Description */}
              <p style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.55, margin: 0 }}>
                {app.description}
              </p>
            </div>

            {/* Card Action Footer */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingTop: 14,
                borderTop: '1px solid var(--line, rgba(255,255,255,0.06))',
                fontSize: 12,
              }}
            >
              <span style={{ color: app.accentColor, fontWeight: 650, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                Open Tool <Icon name="arrow-right" size={13} />
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                1-Click Launch
              </span>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
