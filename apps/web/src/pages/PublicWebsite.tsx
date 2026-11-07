/**
 * ============================================================================
 * Operza Public Hosted Website & Headless CMS Engine
 * ============================================================================
 * 
 * Provides production-grade public hosting for all multi-page websites deployed
 * through Operza's Headless CMS.
 * 
 * Features:
 * 1. Multi-Page Navigation: Real-time routing across Home, Services, About, Pricing, etc.
 * 2. Dynamic Block Rendering: Headlines, two-column grids, testimonials, hero media, and countdowns.
 * 3. Live Lead Ingress: Form submissions create/match CRM contacts with `website-lead` tags.
 * 4. Production Hosting Status: Displays SSL TLS 1.3 edge status and staging preview banners.
 */

import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { useStore } from '../lib/store';
import { api } from '../lib/api';
import type { Site, SitePage } from '../lib/types';
import type { FunnelBlock } from '../components/VisualPageBuilder';

export default function PublicWebsite() {
  const { slug, pageSlug } = useParams<{ slug: string; pageSlug?: string }>();
  const { state, dispatch } = useStore();

  const [site, setSite] = useState<Site | null>(null);
  const [activePageId, setActivePageId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Lead capture form state
  const [leadName, setLeadName] = useState('');
  const [leadEmail, setLeadEmail] = useState('');
  const [leadPhone, setLeadPhone] = useState('');
  const [leadMessage, setLeadMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Live countdown timer state for blocks
  const [countdownSeconds, setCountdownSeconds] = useState(14 * 60 + 22);

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdownSeconds((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Fetch website data
  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    setError(null);

    // 1. Check local store first (immediate responsive load)
    const localMatch = state.sites.find(
      (s) =>
        s.domain?.toLowerCase() === slug.toLowerCase() ||
        s.id === slug ||
        s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') === slug.toLowerCase()
    );

    if (localMatch) {
      setSite(localMatch);
      resolveActivePage(localMatch, pageSlug);
      setLoading(false);
    }

    // 2. Fetch from backend API to ensure fresh live state & track visit
    api.websites
      .getPublic(slug, pageSlug)
      .then((res: any) => {
        if (res && res.id) {
          const freshSite: Site = {
            id: res.id,
            name: res.name,
            kind: res.kind || 'website',
            domain: res.domain || slug,
            published: Boolean(res.published),
            visits: res.visits || 1,
            optins: res.optins || 0,
            pages: res.pages || [],
            globalHeader: res.globalHeader,
            globalFooter: res.globalFooter,
          };
          setSite(freshSite);
          resolveActivePage(freshSite, pageSlug);
        }
      })
      .catch(() => {
        if (!localMatch) {
          setError('Website not found or not yet published to the edge CDN.');
        }
      })
      .finally(() => {
        setLoading(false);
      });
  }, [slug, pageSlug]);

  const resolveActivePage = (currentSite: Site, targetSlug?: string) => {
    if (!currentSite.pages || currentSite.pages.length === 0) return;
    if (targetSlug) {
      const cleanTarget = targetSlug.replace(/^\//, '').toLowerCase();
      const match = currentSite.pages.find(
        (p) =>
          p.path.replace(/^\//, '').toLowerCase() === cleanTarget ||
          p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') === cleanTarget
      );
      if (match) {
        setActivePageId(match.id);
        return;
      }
    }
    // Default to home page (path '/' or first page)
    const home = currentSite.pages.find((p) => p.path === '/') || currentSite.pages[0];
    setActivePageId(home.id);
  };

  const activePage = site?.pages?.find((p) => p.id === activePageId) || site?.pages?.[0] || ({} as SitePage);
  const blocks: FunnelBlock[] = (activePage.blocks as FunnelBlock[]) || [];

  const handleLeadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!leadEmail || submitting || !site) return;
    setSubmitting(true);
    setSubmitError(null);

    try {
      // Dispatches lead directly through public unauthenticated website ingress endpoint
      await api.websites.submitInquiry(site.id || slug || '', {
        firstName: leadName.trim().split(' ')[0] || 'Web',
        lastName: leadName.trim().split(' ').slice(1).join(' ') || 'Visitor',
        email: leadEmail.trim(),
        phone: leadPhone.trim(),
        company: site.name,
        message: leadMessage.trim(),
        pageSlug: activePage.path,
      });

      // Update opt-in count locally
      dispatch({ type: 'site/update', id: site.id, patch: { optins: (site.optins || 0) + 1 } });
      setSubmitted(true);
    } catch (err: any) {
      setSubmitError(err.message || 'Failed to submit inquiry. Please check your network and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div style={styles.centerContainer}>
        <div style={{ width: 44, height: 44, borderRadius: '50%', border: '3px solid #e2e8f0', borderTopColor: '#4f46e5', animation: 'spin 0.8s linear infinite' }} />
        <p style={{ marginTop: 16, color: '#64748b', fontSize: 14 }}>Connecting to Operza Edge Hosting...</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (error || !site) {
    return (
      <div style={styles.centerContainer}>
        <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#fee2e2', color: '#dc2626', display: 'grid', placeItems: 'center', fontSize: 24, marginBottom: 16 }}>
          ✕
        </div>
        <h2 style={{ fontSize: 24, fontWeight: 800, color: '#0f172a', margin: '0 0 8px' }}>Website Not Found</h2>
        <p style={{ color: '#64748b', maxWidth: 460, margin: '0 0 24px', lineHeight: 1.5 }}>
          {error || `The hosted website "${slug}" does not exist or has not been deployed.`}
        </p>
        <Link to="/websites" style={styles.btnPrimary}>
          ← Back to Websites Dashboard
        </Link>
      </div>
    );
  }

  const formatCountdown = (totalSecs: number) => {
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  return (
    <div style={styles.pageWrapper}>
      {/* ─── Production Edge Hosting Status Topbar ─── */}
      <div style={site.published ? styles.liveBanner : styles.stagingBanner}>
        <div style={styles.bannerContent}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: site.published ? '#10b981' : '#f59e0b', boxShadow: site.published ? '0 0 8px #10b981' : 'none' }} />
            <strong style={{ fontSize: 12 }}>
              {site.published ? 'LIVE HOSTED ON OPERZA CLUSTER' : 'STAGING PREVIEW (DRAFT)'}
            </strong>
            <span style={{ fontSize: 11, opacity: 0.85 }}>
              · {site.published ? "Edge CDN Active · TLS 1.3 Let's Encrypt" : 'Not yet deployed to public domain'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 11, fontFamily: 'monospace' }}>
              {site.domain ? `https://${site.domain}` : `https://${slug}.operza.site`}
            </span>
            <Link to="/websites" style={styles.dashboardLink}>
              Dashboard ↗
            </Link>
          </div>
        </div>
      </div>

      {/* ─── Synchronized Global Navigation Header ─── */}
      <header style={styles.globalHeader}>
        <div style={styles.container}>
          <div style={styles.headerInner}>
            {/* Brand Logo / Text */}
            <Link
              to={`/site/${slug}`}
              style={{ ...styles.brand, textDecoration: 'none' }}
              onClick={() => {
                const home = site.pages.find((p) => p.path === '/') || site.pages[0];
                if (home) setActivePageId(home.id);
              }}
            >
              <div style={styles.brandIcon}>
                <Icon name="globe" size={16} />
              </div>
              <span style={styles.brandName}>{site.globalHeader?.brandText || site.name}</span>
            </Link>

            {/* Navigation Page Links */}
            <nav style={styles.navLinks}>
              {site.pages.map((p) => {
                const isActive = p.id === activePageId;
                const pathSlug = p.path === '/' ? '' : p.path.replace(/^\//, '');
                return (
                  <Link
                    key={p.id}
                    to={pathSlug ? `/site/${slug}/${pathSlug}` : `/site/${slug}`}
                    style={{
                      ...styles.navButton,
                      ...(isActive ? styles.navButtonActive : {}),
                      textDecoration: 'none',
                      display: 'inline-flex',
                      alignItems: 'center',
                    }}
                    onClick={() => setActivePageId(p.id)}
                  >
                    {p.name}
                  </Link>
                );
              })}
            </nav>

            {/* Header Action Button */}
            <div>
              <button
                type="button"
                style={styles.headerCtaBtn}
                onClick={() => {
                  const formEl = document.getElementById('website-contact-form');
                  if (formEl) formEl.scrollIntoView({ behavior: 'smooth' });
                }}
              >
                {site.globalHeader?.ctaLabel || 'Get Started →'}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* ─── Main Page Content Stream ─── */}
      <main style={styles.mainContent}>
        {/* Page Hero Header */}
        <section style={styles.heroSection}>
          <div style={styles.container}>
            <div style={{ textAlign: 'center', maxWidth: 840, margin: '0 auto' }}>
              <span style={styles.pagePill}>{activePage.name}</span>
              <h1 style={styles.pageTitle}>{activePage.headline || `Welcome to ${activePage.name}`}</h1>
              <p style={styles.pageSubhead}>
                {activePage.subhead || 'Tailored enterprise solutions built to accelerate revenue and operational velocity.'}
              </p>
              {activePage.cta && (
                <button
                  type="button"
                  style={styles.heroActionBtn}
                  onClick={() => {
                    const formEl = document.getElementById('website-contact-form');
                    if (formEl) formEl.scrollIntoView({ behavior: 'smooth' });
                  }}
                >
                  {activePage.cta} →
                </button>
              )}
            </div>
          </div>
        </section>

        {/* Dynamic FunnelBlocks Stream */}
        <section style={styles.blocksSection}>
          <div style={styles.container}>
            <div style={styles.blocksStream}>
              {blocks.map((block) => {
                if (block.type === 'headline') {
                  return (
                    <h2 key={block.id} style={{ ...styles.blockHeadline, textAlign: block.align || 'center' }}>
                      {block.content}
                    </h2>
                  );
                }
                if (block.type === 'subheadline') {
                  return (
                    <p key={block.id} style={{ ...styles.blockSubheadline, textAlign: block.align || 'center' }}>
                      {block.content}
                    </p>
                  );
                }
                if (block.type === 'paragraph') {
                  return (
                    <div key={block.id} style={{ ...styles.blockParagraph, textAlign: block.align || 'left' }}>
                      {block.content}
                    </div>
                  );
                }
                if (block.type === 'countdown') {
                  return (
                    <div key={block.id} style={styles.countdownCard}>
                      <span style={{ fontSize: 11, fontWeight: 750, color: '#dc2626', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        {block.content || 'Special Limited Availability Offer:'}
                      </span>
                      <div style={styles.countdownTimer}>
                        {formatCountdown(countdownSeconds)}
                      </div>
                    </div>
                  );
                }
                if (block.type === 'hero_image' && block.imageUrl) {
                  return (
                    <div key={block.id} style={styles.heroImageWrapper}>
                      <img src={block.imageUrl} alt={block.content || 'Featured'} style={styles.heroImg} />
                      {block.content && <p style={styles.heroCaption}>{block.content}</p>}
                    </div>
                  );
                }
                if (block.type === 'two_columns') {
                  return (
                    <div key={block.id} style={styles.twoColsGrid}>
                      <div style={styles.colCard}>
                        <div style={styles.colContent}>
                          {block.columnA?.split('\n').map((line, idx) => (
                            <p key={idx} style={{ margin: '0 0 8px', lineHeight: 1.6 }}>
                              {line.startsWith('**') ? <strong>{line.replace(/\*\*/g, '')}</strong> : line}
                            </p>
                          ))}
                        </div>
                      </div>
                      <div style={styles.colCard}>
                        <div style={styles.colContent}>
                          {block.columnB?.split('\n').map((line, idx) => (
                            <p key={idx} style={{ margin: '0 0 8px', lineHeight: 1.6 }}>
                              {line.startsWith('**') ? <strong>{line.replace(/\*\*/g, '')}</strong> : line}
                            </p>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                }
                if (block.type === 'testimonials') {
                  return (
                    <div key={block.id} style={styles.testimonialCard}>
                      <div style={{ color: '#f59e0b', fontSize: 18, marginBottom: 8 }}>★★★★★</div>
                      <blockquote style={styles.testimonialQuote}>
                        "{block.content}"
                      </blockquote>
                      <div style={styles.testimonialAuthor}>
                        <strong>{block.authorName || 'Verified Client'}</strong>
                        <span style={{ color: '#64748b', fontSize: 13 }}> · {block.authorRole || 'Enterprise Partner'}</span>
                      </div>
                    </div>
                  );
                }
                if (block.type === 'cta_button') {
                  const safeLink = /^(https?:\/\/|\/|#)/i.test(block.buttonLink || '')
                    ? block.buttonLink!
                    : '#website-contact-form';
                  return (
                    <div key={block.id} style={{ textAlign: block.align || 'center', margin: '32px 0' }}>
                      <a
                        href={safeLink}
                        style={{ ...styles.blockCtaBtn, background: block.buttonColor || '#4f46e5' }}
                        onClick={(e) => {
                          if (safeLink.startsWith('#')) {
                            e.preventDefault();
                            const formEl = document.getElementById('website-contact-form');
                            if (formEl) formEl.scrollIntoView({ behavior: 'smooth' });
                          }
                        }}
                      >
                        {block.buttonText || 'Take Action Now →'}
                      </a>
                    </div>
                  );
                }
                return null;
              })}
            </div>
          </div>
        </section>

        {/* ─── Real Live Lead Ingress Form ─── */}
        <section id="website-contact-form" style={styles.formSection}>
          <div style={styles.container}>
            <div style={styles.formCard}>
              <div style={{ textAlign: 'center', marginBottom: 28 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: '#4f46e5', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  CONNECT WITH OUR SPECIALISTS
                </span>
                <h3 style={{ fontSize: 26, fontWeight: 800, color: '#0f172a', margin: '8px 0 10px' }}>
                  Request Consultation &amp; Growth Scope
                </h3>
                <p style={{ fontSize: 14, color: '#64748b', margin: 0 }}>
                  Leave your inquiry below. Our team receives this directly into our Operza CRM inbox.
                </p>
              </div>

              {submitted ? (
                <div style={styles.successBox}>
                  <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#dcfce7', color: '#15803d', display: 'grid', placeItems: 'center', fontSize: 22, margin: '0 auto 12px' }}>
                    ✓
                  </div>
                  <h4 style={{ fontSize: 18, fontWeight: 750, color: '#0f172a', margin: '0 0 6px' }}>
                    Inquiry Received!
                  </h4>
                  <p style={{ fontSize: 13.5, color: '#475569', margin: 0, lineHeight: 1.5 }}>
                    Your message has been captured into our CRM pipeline. A dedicated client manager will contact you at <strong>{leadEmail}</strong> within 24 hours.
                  </p>
                </div>
              ) : (
                <form onSubmit={handleLeadSubmit} style={styles.formGrid}>
                  {submitError && (
                    <div style={{ padding: '10px 14px', borderRadius: 8, background: '#fee2e2', border: '1px solid #fca5a5', color: '#b91c1c', fontSize: 13, marginBottom: 14 }}>
                      ⚠️ {submitError}
                    </div>
                  )}

                  <div style={styles.inputGroup}>
                    <label htmlFor="lead-full-name" style={styles.label}>Full Name *</label>
                    <input
                      id="lead-full-name"
                      type="text"
                      required
                      placeholder="e.g. Sarah Jenkins"
                      value={leadName}
                      onChange={(e) => setLeadName(e.target.value)}
                      style={styles.input}
                    />
                  </div>

                  <div style={styles.inputGroup}>
                    <label htmlFor="lead-work-email" style={styles.label}>Work Email Address *</label>
                    <input
                      id="lead-work-email"
                      type="email"
                      required
                      placeholder="sarah@company.com"
                      value={leadEmail}
                      onChange={(e) => setLeadEmail(e.target.value)}
                      style={styles.input}
                    />
                  </div>

                  <div style={styles.inputGroup}>
                    <label htmlFor="lead-phone-number" style={styles.label}>Phone Number</label>
                    <input
                      id="lead-phone-number"
                      type="tel"
                      placeholder="+1 (555) 234-5678"
                      value={leadPhone}
                      onChange={(e) => setLeadPhone(e.target.value)}
                      style={styles.input}
                    />
                  </div>

                  <div style={styles.inputGroup}>
                    <label htmlFor="lead-project-scope" style={styles.label}>Project Scope / Inquiry Details</label>
                    <textarea
                      id="lead-project-scope"
                      rows={3}
                      placeholder="How can our practice or agency assist your goals?"
                      value={leadMessage}
                      onChange={(e) => setLeadMessage(e.target.value)}
                      style={styles.textarea}
                    />
                  </div>

                  <button type="submit" disabled={submitting} style={styles.submitBtn}>
                    {submitting ? 'Routing to CRM...' : 'Send Inquiry to Team →'}
                  </button>
                </form>
              )}
            </div>
          </div>
        </section>
      </main>

      {/* ─── Synchronized Global Footer ─── */}
      <footer style={styles.globalFooter}>
        <div style={styles.container}>
          <div style={styles.footerContent}>
            <div style={{ fontSize: 13, color: '#64748b' }}>
              {site.globalFooter?.copyrightText || `© ${new Date().getFullYear()} ${site.name}. All rights reserved.`}
            </div>

            <div style={styles.footerLinks}>
              {(site.globalFooter?.footerLinks || [
                { id: '1', label: 'Privacy Policy', url: '#' },
                { id: '2', label: 'Terms of Service', url: '#' },
              ]).map((l) => (
                <a key={l.id || l.label} href={l.url} style={styles.footerLink}>
                  {l.label}
                </a>
              ))}
            </div>

            <div style={{ fontSize: 11, color: '#94a3b8' }}>
              Hosted with ⚡ by Operza Cloud Engine
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  pageWrapper: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    background: '#ffffff',
    color: '#0f172a',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  centerContainer: {
    minHeight: '80vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    textAlign: 'center',
  },
  liveBanner: {
    background: '#064e3b',
    color: '#ecfdf5',
    padding: '8px 16px',
    borderBottom: '1px solid #047857',
  },
  stagingBanner: {
    background: '#78350f',
    color: '#fef3c7',
    padding: '8px 16px',
    borderBottom: '1px solid #b45309',
  },
  bannerContent: {
    maxWidth: 1140,
    margin: '0 auto',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  dashboardLink: {
    color: '#ffffff',
    fontWeight: 700,
    fontSize: 11,
    textDecoration: 'underline',
  },
  globalHeader: {
    position: 'sticky',
    top: 0,
    background: 'rgba(255, 255, 255, 0.94)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    borderBottom: '1px solid #e2e8f0',
    zIndex: 100,
  },
  container: {
    maxWidth: 1120,
    margin: '0 auto',
    padding: '0 20px',
  },
  headerInner: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 64,
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    cursor: 'pointer',
  },
  brandIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    background: '#4f46e5',
    color: '#ffffff',
    display: 'grid',
    placeItems: 'center',
  },
  brandName: {
    fontSize: 17,
    fontWeight: 800,
    color: '#0f172a',
    letterSpacing: '-0.02em',
  },
  navLinks: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    overflowX: 'auto',
    maxWidth: '100%',
    WebkitOverflowScrolling: 'touch',
  },
  navButton: {
    background: 'transparent',
    border: 'none',
    padding: '8px 14px',
    borderRadius: 6,
    fontSize: 13.5,
    fontWeight: 500,
    color: '#475569',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  navButtonActive: {
    color: '#4f46e5',
    fontWeight: 700,
    background: 'rgba(79, 70, 229, 0.08)',
  },
  headerCtaBtn: {
    padding: '9px 18px',
    background: '#4f46e5',
    color: '#ffffff',
    border: 'none',
    borderRadius: 8,
    fontSize: 13.5,
    fontWeight: 700,
    cursor: 'pointer',
    boxShadow: '0 2px 8px rgba(79, 70, 229, 0.3)',
  },
  mainContent: {
    flex: 1,
  },
  heroSection: {
    padding: '64px 20px 48px',
    background: 'radial-gradient(ellipse at top, #f8fafc 0%, #ffffff 80%)',
    borderBottom: '1px solid #f1f5f9',
  },
  pagePill: {
    display: 'inline-block',
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: '#4f46e5',
    background: '#eef2ff',
    padding: '4px 12px',
    borderRadius: 99,
    marginBottom: 16,
  },
  pageTitle: {
    fontSize: 42,
    fontWeight: 850,
    letterSpacing: '-0.03em',
    color: '#0f172a',
    lineHeight: 1.15,
    margin: '0 0 16px',
  },
  pageSubhead: {
    fontSize: 17,
    color: '#475569',
    lineHeight: 1.6,
    margin: '0 0 24px',
  },
  heroActionBtn: {
    padding: '13px 26px',
    background: '#0f172a',
    color: '#ffffff',
    border: 'none',
    borderRadius: 9,
    fontSize: 14.5,
    fontWeight: 700,
    cursor: 'pointer',
    boxShadow: '0 4px 14px rgba(15, 23, 42, 0.15)',
  },
  blocksSection: {
    padding: '48px 20px',
  },
  blocksStream: {
    display: 'flex',
    flexDirection: 'column',
    gap: 32,
    maxWidth: 960,
    margin: '0 auto',
  },
  blockHeadline: {
    fontSize: 30,
    fontWeight: 800,
    letterSpacing: '-0.02em',
    color: '#0f172a',
    margin: '20px 0 8px',
  },
  blockSubheadline: {
    fontSize: 16,
    color: '#64748b',
    lineHeight: 1.6,
    maxWidth: 720,
    margin: '0 auto',
  },
  blockParagraph: {
    fontSize: 15,
    color: '#334155',
    lineHeight: 1.7,
    maxWidth: 760,
    margin: '0 auto',
  },
  countdownCard: {
    background: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: 12,
    padding: '20px',
    textAlign: 'center',
    maxWidth: 420,
    margin: '16px auto',
  },
  countdownTimer: {
    fontFamily: 'monospace',
    fontSize: 36,
    fontWeight: 900,
    color: '#b91c1c',
    marginTop: 6,
  },
  heroImageWrapper: {
    textAlign: 'center',
    margin: '24px 0',
  },
  heroImg: {
    maxWidth: '100%',
    borderRadius: 14,
    boxShadow: '0 12px 36px rgba(15, 23, 42, 0.1)',
  },
  heroCaption: {
    fontSize: 12.5,
    color: '#64748b',
    marginTop: 8,
  },
  twoColsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: 24,
    margin: '24px 0',
  },
  colCard: {
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
    borderRadius: 12,
    padding: '24px',
  },
  colContent: {
    fontSize: 14,
    color: '#334155',
  },
  testimonialCard: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 14,
    padding: '28px',
    boxShadow: '0 4px 16px rgba(15, 23, 42, 0.04)',
    textAlign: 'center',
    maxWidth: 680,
    margin: '20px auto',
  },
  testimonialQuote: {
    fontSize: 17,
    fontStyle: 'italic',
    lineHeight: 1.6,
    color: '#1e293b',
    margin: '0 0 16px',
  },
  testimonialAuthor: {
    fontSize: 13.5,
  },
  blockCtaBtn: {
    display: 'inline-block',
    padding: '13px 28px',
    color: '#ffffff',
    borderRadius: 9,
    fontSize: 15,
    fontWeight: 700,
    textDecoration: 'none',
    boxShadow: '0 4px 14px rgba(79, 70, 229, 0.3)',
  },
  formSection: {
    padding: '60px 20px',
    background: '#f8fafc',
    borderTop: '1px solid #e2e8f0',
  },
  formCard: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 16,
    padding: '36px',
    maxWidth: 640,
    margin: '0 auto',
    boxShadow: '0 8px 30px rgba(15, 23, 42, 0.05)',
  },
  formGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  inputGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: 650,
    color: '#334155',
  },
  input: {
    padding: '11px 14px',
    borderRadius: 8,
    border: '1px solid #cbd5e1',
    fontSize: 14,
    outline: 'none',
    color: '#0f172a',
  },
  textarea: {
    padding: '11px 14px',
    borderRadius: 8,
    border: '1px solid #cbd5e1',
    fontSize: 14,
    outline: 'none',
    color: '#0f172a',
    resize: 'vertical',
  },
  submitBtn: {
    padding: '13px',
    background: '#4f46e5',
    color: '#ffffff',
    border: 'none',
    borderRadius: 8,
    fontSize: 14.5,
    fontWeight: 750,
    cursor: 'pointer',
    marginTop: 8,
    boxShadow: '0 4px 14px rgba(79, 70, 229, 0.35)',
  },
  successBox: {
    textAlign: 'center',
    padding: '24px 16px',
  },
  globalFooter: {
    padding: '40px 20px',
    background: '#0f172a',
    color: '#94a3b8',
    borderTop: '1px solid #1e293b',
  },
  footerContent: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 16,
  },
  footerLinks: {
    display: 'flex',
    gap: 16,
  },
  footerLink: {
    color: '#cbd5e1',
    fontSize: 13,
    textDecoration: 'none',
  },
  btnPrimary: {
    display: 'inline-block',
    padding: '11px 22px',
    background: '#4f46e5',
    color: '#ffffff',
    borderRadius: 8,
    fontWeight: 650,
    fontSize: 14,
    textDecoration: 'none',
  },
};
