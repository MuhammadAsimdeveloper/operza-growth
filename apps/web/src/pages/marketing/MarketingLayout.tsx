import { useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { useAuth } from '../../lib/AuthContext';
import { trackEvent } from '../../lib/analytics';

export function MarketingLayout() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [platformDropdown, setPlatformDropdown] = useState(false);

  const isActive = (path: string) => location.pathname === path;

  return (
    <div style={styles.shell}>
      {/* ─── Top Global Announcement / Trust Bar ─── */}
      <div style={styles.topAnnouncement}>
        <div style={styles.announcementInner}>
          <span style={styles.announcementBadge}>NEW V2.0</span>
          <span>
            Operza 2.0 Enterprise Engine: Relational PostgreSQL RLS &amp; BullMQ Queue is live.
          </span>
          <Link
            to="/docs"
            style={styles.announcementLink}
            onClick={() => trackEvent('cta_click', { cta: 'top_banner_docs' })}
          >
            Read Architecture →
          </Link>
        </div>
      </div>

      {/* ─── Semantic Navigation Header ─── */}
      <header style={styles.header}>
        <div style={styles.navContainer}>
          {/* Brand Logo */}
          <Link
            to="/"
            style={styles.brand}
            onClick={() => setMobileMenuOpen(false)}
          >
            <div style={styles.brandIcon}>
              <Icon name="sparkles" size={18} />
            </div>
            <div style={styles.brandText}>
              <span style={styles.brandName}>OPERZA</span>
              <span style={styles.brandTag}>GROWTH OS</span>
            </div>
          </Link>

          {/* Desktop Nav Links */}
          <nav style={styles.desktopNav} aria-label="Main Navigation">
            <div
              style={styles.dropdownWrap}
              onMouseEnter={() => setPlatformDropdown(true)}
              onMouseLeave={() => setPlatformDropdown(false)}
            >
              <button
                type="button"
                style={{
                  ...styles.navLink,
                  ...(location.pathname.startsWith('/platform') ? styles.navLinkActive : {}),
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                Platform <Icon name="chevron-down" size={13} />
              </button>

              {platformDropdown && (
                <div style={styles.dropdownMenu}>
                  <Link
                    to="/platform/crm"
                    style={styles.dropdownItem}
                    onClick={() => setPlatformDropdown(false)}
                  >
                    <div style={styles.dropdownIcon}>
                      <Icon name="users" size={16} />
                    </div>
                    <div>
                      <div style={styles.dropdownTitle}>Agency CRM</div>
                      <div style={styles.dropdownDesc}>Pipelines, contacts &amp; smart lists</div>
                    </div>
                  </Link>

                  <Link
                    to="/platform/automation"
                    style={styles.dropdownItem}
                    onClick={() => setPlatformDropdown(false)}
                  >
                    <div style={styles.dropdownIcon}>
                      <Icon name="zap" size={16} />
                    </div>
                    <div>
                      <div style={styles.dropdownTitle}>Workflow Automation</div>
                      <div style={styles.dropdownDesc}>2D visual node-and-wire canvas</div>
                    </div>
                  </Link>

                  <Link
                    to="/platform/funnels"
                    style={styles.dropdownItem}
                    onClick={() => setPlatformDropdown(false)}
                  >
                    <div style={styles.dropdownIcon}>
                      <Icon name="funnel" size={16} />
                    </div>
                    <div>
                      <div style={styles.dropdownTitle}>Funnels &amp; Landing Pages</div>
                      <div style={styles.dropdownDesc}>WYSIWYG builder &amp; 1-click order bumps</div>
                    </div>
                  </Link>

                  <Link
                    to="/platform/conversations"
                    style={styles.dropdownItem}
                    onClick={() => setPlatformDropdown(false)}
                  >
                    <div style={styles.dropdownIcon}>
                      <Icon name="message" size={16} />
                    </div>
                    <div>
                      <div style={styles.dropdownTitle}>Omnichannel Inbox</div>
                      <div style={styles.dropdownDesc}>SMS, WhatsApp, Email &amp; Messenger</div>
                    </div>
                  </Link>

                  <Link
                    to="/platform/portal"
                    style={styles.dropdownItem}
                    onClick={() => setPlatformDropdown(false)}
                  >
                    <div style={styles.dropdownIcon}>
                      <Icon name="globe" size={16} />
                    </div>
                    <div>
                      <div style={styles.dropdownTitle}>White-Label Client Portal</div>
                      <div style={styles.dropdownDesc}>Contracts, e-signatures &amp; billing</div>
                    </div>
                  </Link>

                  <Link
                    to="/platform/courses"
                    style={styles.dropdownItem}
                    onClick={() => setPlatformDropdown(false)}
                  >
                    <div style={styles.dropdownIcon}>
                      <Icon name="book" size={16} />
                    </div>
                    <div>
                      <div style={styles.dropdownTitle}>LMS &amp; Memberships</div>
                      <div style={styles.dropdownDesc}>Video curriculum &amp; certificates</div>
                    </div>
                  </Link>
                </div>
              )}
            </div>

            <Link
              to="/pricing"
              style={{
                ...styles.navLink,
                ...(isActive('/pricing') ? styles.navLinkActive : {}),
              }}
            >
              Pricing
            </Link>

            <Link
              to="/docs"
              style={{
                ...styles.navLink,
                ...(isActive('/docs') ? styles.navLinkActive : {}),
              }}
            >
              Documentation
            </Link>

            <Link
              to="/blog"
              style={{
                ...styles.navLink,
                ...(isActive('/blog') ? styles.navLinkActive : {}),
              }}
            >
              Resources
            </Link>

            <Link
              to="/about"
              style={{
                ...styles.navLink,
                ...(isActive('/about') ? styles.navLinkActive : {}),
              }}
            >
              About
            </Link>
          </nav>

          {/* Action CTAs */}
          <div style={styles.actions}>
            {isAuthenticated ? (
              <Link
                to="/"
                style={styles.btnPrimary}
                onClick={() => trackEvent('cta_click', { cta: 'header_open_workspace' })}
              >
                Open Workspace →
              </Link>
            ) : (
              <>
                <Link to="/login" style={styles.btnGhost}>
                  Sign in
                </Link>
                <Link
                  to="/signup"
                  style={styles.btnPrimary}
                  onClick={() => trackEvent('signup_start', { source: 'header' })}
                >
                  Get Started Free
                </Link>
              </>
            )}

            {/* Mobile Hamburger Button */}
            <button
              type="button"
              style={styles.mobileToggle}
              aria-label="Toggle navigation menu"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              <Icon name={mobileMenuOpen ? 'x' : 'menu'} size={20} />
            </button>
          </div>
        </div>

        {/* Mobile Navigation Drawer */}
        {mobileMenuOpen && (
          <div style={styles.mobileDrawer}>
            <Link to="/platform/crm" style={styles.mobileLink} onClick={() => setMobileMenuOpen(false)}>
              Agency CRM
            </Link>
            <Link to="/platform/automation" style={styles.mobileLink} onClick={() => setMobileMenuOpen(false)}>
              Workflow Automation
            </Link>
            <Link to="/platform/funnels" style={styles.mobileLink} onClick={() => setMobileMenuOpen(false)}>
              Funnels &amp; Landing Pages
            </Link>
            <Link to="/platform/conversations" style={styles.mobileLink} onClick={() => setMobileMenuOpen(false)}>
              Omnichannel Inbox
            </Link>
            <Link to="/platform/portal" style={styles.mobileLink} onClick={() => setMobileMenuOpen(false)}>
              White-Label Portal
            </Link>
            <Link to="/platform/courses" style={styles.mobileLink} onClick={() => setMobileMenuOpen(false)}>
              LMS &amp; Courses
            </Link>
            <Link to="/pricing" style={styles.mobileLink} onClick={() => setMobileMenuOpen(false)}>
              Pricing
            </Link>
            <Link to="/docs" style={styles.mobileLink} onClick={() => setMobileMenuOpen(false)}>
              Documentation
            </Link>
            <Link to="/blog" style={styles.mobileLink} onClick={() => setMobileMenuOpen(false)}>
              Resources &amp; Blog
            </Link>
            <Link to="/about" style={styles.mobileLink} onClick={() => setMobileMenuOpen(false)}>
              About Operza
            </Link>
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {isAuthenticated ? (
                <Link to="/" style={styles.btnPrimary} onClick={() => setMobileMenuOpen(false)}>
                  Open Workspace →
                </Link>
              ) : (
                <>
                  <Link to="/login" style={styles.btnGhost} onClick={() => setMobileMenuOpen(false)}>
                    Sign in
                  </Link>
                  <Link to="/signup" style={styles.btnPrimary} onClick={() => setMobileMenuOpen(false)}>
                    Get Started Free
                  </Link>
                </>
              )}
            </div>
          </div>
        )}
      </header>

      {/* ─── Main Content Slot ─── */}
      <main style={styles.main}>
        <Outlet />
      </main>

      {/* ─── Semantic Footer ─── */}
      <footer style={styles.footer}>
        <div style={styles.footerInner}>
          {/* Brand Col */}
          <div style={styles.footerBrandCol}>
            <Link to="/" style={styles.brand}>
              <div style={styles.brandIcon}>
                <Icon name="sparkles" size={16} />
              </div>
              <div style={styles.brandText}>
                <span style={styles.brandName}>OPERZA</span>
                <span style={styles.brandTag}>GROWTH OS</span>
              </div>
            </Link>
            <p style={styles.footerBio}>
              The unified, open-architecture business operating system and multi-tenant CRM engineered
              to replace disjointed agency software stacks.
            </p>
            <div style={styles.systemStatus}>
              <span style={styles.statusDot} />
              <span>All Systems Operational (99.98% uptime)</span>
            </div>
          </div>

          {/* Links Cols */}
          <div style={styles.footerLinksGrid}>
            <div>
              <h4 style={styles.footerHeading}>Platform</h4>
              <ul style={styles.footerList}>
                <li><Link to="/platform/crm" style={styles.footerLink}>Agency CRM &amp; Deals</Link></li>
                <li><Link to="/platform/automation" style={styles.footerLink}>Visual Workflows</Link></li>
                <li><Link to="/platform/funnels" style={styles.footerLink}>Funnels &amp; Checkout</Link></li>
                <li><Link to="/platform/conversations" style={styles.footerLink}>Omnichannel Inbox</Link></li>
                <li><Link to="/platform/portal" style={styles.footerLink}>White-Label Portal</Link></li>
                <li><Link to="/platform/courses" style={styles.footerLink}>LMS Memberships</Link></li>
              </ul>
            </div>

            <div>
              <h4 style={styles.footerHeading}>Solutions</h4>
              <ul style={styles.footerList}>
                <li><Link to="/platform/crm" style={styles.footerLink}>Digital Marketing Agencies</Link></li>
                <li><Link to="/platform/automation" style={styles.footerLink}>Growth Consultancies</Link></li>
                <li><Link to="/platform/portal" style={styles.footerLink}>White-Label Resellers</Link></li>
                <li><Link to="/pricing" style={styles.footerLink}>Self-Hosted Deployments</Link></li>
                <li><Link to="/docs" style={styles.footerLink}>Multi-Tenant Architecture</Link></li>
              </ul>
            </div>

            <div>
              <h4 style={styles.footerHeading}>Resources</h4>
              <ul style={styles.footerList}>
                <li><Link to="/docs" style={styles.footerLink}>Developer Documentation</Link></li>
                <li><Link to="/blog" style={styles.footerLink}>Agency Scaling Guides</Link></li>
                <li><Link to="/docs" style={styles.footerLink}>REST API &amp; Webhooks</Link></li>
                <li><Link to="/about" style={styles.footerLink}>Engineering Roadmap</Link></li>
                <li><Link to="/pricing" style={styles.footerLink}>SaaS Pricing Matrix</Link></li>
              </ul>
            </div>

            <div>
              <h4 style={styles.footerHeading}>Company</h4>
              <ul style={styles.footerList}>
                <li><Link to="/about" style={styles.footerLink}>About Operza</Link></li>
                <li><Link to="/signup" style={styles.footerLink}>Start 7-Day Trial</Link></li>
                <li><a href="https://github.com/MuhammadAsimdeveloper/operza-growth" target="_blank" rel="noopener noreferrer" style={styles.footerLink}>GitHub Repository</a></li>
                <li><Link to="/docs" style={styles.footerLink}>Security &amp; RLS Isolation</Link></li>
              </ul>
            </div>
          </div>
        </div>

          <div style={styles.footerBottom}>
          <div>
            © 2026 Operza Technologies Inc. All rights reserved. Built with PostgreSQL, React 19 &amp; BullMQ.
          </div>
          <div style={{ display: 'flex', gap: 16 }}>
            <Link to="/about" style={styles.footerLink}>Privacy Policy</Link>
            <Link to="/about" style={styles.footerLink}>Terms of Service</Link>
            <Link to="/about" style={styles.footerLink}>Security Statement</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  shell: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    background: '#ffffff',
    color: '#0f172a',
    fontFamily: "var(--font, 'Inter', -apple-system, BlinkMacSystemFont, sans-serif)",
  },
  topAnnouncement: {
    background: '#0f172a',
    color: '#e2e8f0',
    padding: '7px 16px',
    fontSize: 12.5,
    borderBottom: '1px solid rgba(255,255,255,0.08)',
  },
  announcementInner: {
    maxWidth: 1200,
    margin: '0 auto',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  announcementBadge: {
    background: '#4f46e5',
    color: '#ffffff',
    padding: '1px 7px',
    borderRadius: 99,
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: '0.04em',
  },
  announcementLink: {
    color: '#818cf8',
    textDecoration: 'none',
    fontWeight: 600,
  },
  header: {
    position: 'sticky',
    top: 0,
    zIndex: 100,
    background: 'rgba(255, 255, 255, 0.92)',
    backdropFilter: 'blur(10px)',
    borderBottom: '1px solid #e2e8f0',
  },
  navContainer: {
    maxWidth: 1200,
    margin: '0 auto',
    padding: '14px 20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    textDecoration: 'none',
    color: '#0f172a',
  },
  brandIcon: {
    width: 34,
    height: 34,
    borderRadius: 8,
    background: 'linear-gradient(135deg, #4f46e5, #3b82f6)',
    color: '#ffffff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 2px 6px rgba(79, 70, 229, 0.28)',
  },
  brandText: {
    display: 'flex',
    flexDirection: 'column',
    lineHeight: 1,
  },
  brandName: {
    fontSize: 17,
    fontWeight: 800,
    letterSpacing: '-0.03em',
    color: '#0f172a',
  },
  brandTag: {
    fontSize: 9.5,
    fontWeight: 700,
    color: '#4f46e5',
    letterSpacing: '0.08em',
    marginTop: 2,
  },
  desktopNav: {
    display: 'flex',
    alignItems: 'center',
    gap: 28,
  },
  navLink: {
    fontSize: 14,
    fontWeight: 500,
    color: '#475569',
    textDecoration: 'none',
    transition: 'color 0.15s ease',
  },
  navLinkActive: {
    color: '#4f46e5',
    fontWeight: 650,
  },
  dropdownWrap: {
    position: 'relative',
  },
  dropdownMenu: {
    position: 'absolute',
    top: '100%',
    left: -20,
    paddingTop: 10,
    width: 320,
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 12,
    boxShadow: '0 12px 32px rgba(15, 23, 42, 0.12)',
    padding: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    zIndex: 110,
  },
  dropdownItem: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    padding: '8px 10px',
    borderRadius: 8,
    textDecoration: 'none',
    color: '#0f172a',
    transition: 'background 0.15s ease',
  },
  dropdownIcon: {
    width: 30,
    height: 30,
    borderRadius: 6,
    background: '#eef0ff',
    color: '#4f46e5',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 2,
  },
  dropdownTitle: {
    fontSize: 13,
    fontWeight: 650,
    color: '#0f172a',
  },
  dropdownDesc: {
    fontSize: 11.5,
    color: '#64748b',
    marginTop: 1,
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  btnGhost: {
    padding: '8px 14px',
    fontSize: 13.5,
    fontWeight: 600,
    color: '#334155',
    textDecoration: 'none',
    borderRadius: 8,
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    transition: 'all 0.15s ease',
  },
  btnPrimary: {
    padding: '8px 16px',
    fontSize: 13.5,
    fontWeight: 600,
    color: '#ffffff',
    textDecoration: 'none',
    borderRadius: 8,
    background: '#4f46e5',
    border: '1px solid #4338ca',
    boxShadow: '0 1px 3px rgba(79, 70, 229, 0.3)',
    transition: 'background 0.15s ease',
  },
  mobileToggle: {
    display: 'none',
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    color: '#0f172a',
    padding: 6,
  },
  mobileDrawer: {
    borderTop: '1px solid #e2e8f0',
    padding: 16,
    background: '#ffffff',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  mobileLink: {
    fontSize: 14,
    color: '#334155',
    textDecoration: 'none',
    padding: '6px 0',
    fontWeight: 500,
  },
  main: {
    flex: 1,
  },
  footer: {
    background: '#090d16',
    color: '#94a3b8',
    borderTop: '1px solid #1e293b',
    paddingTop: 56,
    paddingBottom: 36,
  },
  footerInner: {
    maxWidth: 1200,
    margin: '0 auto',
    padding: '0 20px',
    display: 'grid',
    gridTemplateColumns: '1.2fr 2fr',
    gap: 48,
  },
  footerBrandCol: {
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  },
  footerBio: {
    fontSize: 13.5,
    lineHeight: 1.6,
    color: '#94a3b8',
    maxWidth: 340,
    margin: 0,
  },
  systemStatus: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 12,
    color: '#10b981',
    fontWeight: 500,
    background: 'rgba(16, 185, 129, 0.08)',
    padding: '4px 10px',
    borderRadius: 99,
    width: 'fit-content',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: '#10b981',
  },
  footerLinksGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 28,
  },
  footerHeading: {
    fontSize: 12.5,
    fontWeight: 700,
    color: '#f8fafc',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    marginBottom: 14,
  },
  footerList: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  footerLink: {
    fontSize: 13,
    color: '#94a3b8',
    textDecoration: 'none',
    transition: 'color 0.15s ease',
  },
  footerBottom: {
    maxWidth: 1200,
    margin: '40px auto 0',
    padding: '24px 20px 0',
    borderTop: '1px solid #1e293b',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: 12,
    color: '#64748b',
    flexWrap: 'wrap',
    gap: 12,
  },
};

export default MarketingLayout;
