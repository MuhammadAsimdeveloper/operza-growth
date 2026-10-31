import { useState } from 'react';
import { Link } from 'react-router-dom';
import { SEO } from '../../components/SEO';
import { Icon } from '../../components/Icon';
import { buildBreadcrumbSchema } from '../../lib/schema';
import { trackEvent } from '../../lib/analytics';

interface ArticleSummary {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  category: string;
  readTime: string;
  date: string;
}

const ARTICLES: ArticleSummary[] = [
  {
    id: 'art_1',
    slug: 'eliminate-agency-software-tax',
    title: 'How Forward-Thinking Agencies Are Eliminating the $1,500/Month SaaS Subscription Tax',
    excerpt:
      'A deep dive into software stack consolidation: why point solutions bleed agency margins, break data continuity, and how unified operating systems restore operational leverage.',
    category: 'Agency Operations',
    readTime: '7 min read',
    date: 'Oct 28, 2026',
  },
  {
    id: 'art_2',
    slug: 'postgres-rls-multi-tenant-security',
    title: 'Multi-Tenant Architecture Guide: Why PostgreSQL Row-Level Security Beats Application Tenancy',
    excerpt:
      'Learn how transaction-scoped RLS policies eliminate cross-tenant data leakage risks in multi-client agency environments, and why fail-closed database isolation is essential.',
    category: 'Engineering & Architecture',
    readTime: '10 min read',
    date: 'Oct 24, 2026',
  },
  {
    id: 'art_3',
    slug: 'automated-client-onboarding-playbook',
    title: 'The 15-Minute Automated Client Onboarding Playbook for Digital Agencies',
    excerpt:
      'Step-by-step workflow blueprint: connecting contract e-signatures, Stripe retainer setup, automatic sub-account provisioning, and client portal welcome drips.',
    category: 'Workflow Automation',
    readTime: '8 min read',
    date: 'Oct 19, 2026',
  },
  {
    id: 'art_4',
    slug: 'high-converting-order-bumps-funnels',
    title: 'How 1-Click Order Bumps Increase Average Order Value by 34% on Agency Landing Pages',
    excerpt:
      'Analyzing checkout psychology: how to structure complementary audit add-ons, snapshot blueprints, and VIP onboarding bonuses without cart friction.',
    category: 'Funnels & Conversion',
    readTime: '6 min read',
    date: 'Oct 15, 2026',
  },
  {
    id: 'art_5',
    slug: 'bullmq-redis-workflow-durability',
    title: 'Zero Lost Events: Architecting Resilient Automation Queues with BullMQ & Redis',
    excerpt:
      'Technical breakdown of exponential backoff retry algorithms, dead-letter queues, and idempotency key deduplication in mission-critical CRM automation engines.',
    category: 'Engineering & Architecture',
    readTime: '9 min read',
    date: 'Oct 10, 2026',
  },
  {
    id: 'art_6',
    slug: 'white-label-client-portals-retention',
    title: 'Why Branded Client Portals Double Retainer Retention for B2B Consultancies',
    excerpt:
      'Client trust is rooted in professional presentation. Discover how white-label CNAME portals with contract e-signing and LMS modules reduce client churn.',
    category: 'Client Experience',
    readTime: '5 min read',
    date: 'Oct 04, 2026',
  },
];

export default function Blog() {
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const categories = ['All', 'Agency Operations', 'Workflow Automation', 'Funnels & Conversion', 'Engineering & Architecture', 'Client Experience'];

  const filtered = ARTICLES.filter((art) => {
    const matchesCat = selectedCategory === 'All' || art.category === selectedCategory;
    const matchesSearch =
      !searchQuery.trim() ||
      art.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      art.excerpt.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCat && matchesSearch;
  });

  const jsonLd = [
    buildBreadcrumbSchema([
      { name: 'Home', url: '/' },
      { name: 'Resources & Blog', url: '/blog' },
    ]),
  ];

  return (
    <>
      <SEO
        title="Agency Growth & Software Engineering Knowledge Hub"
        description="Authoritative guides, architectural blueprints, and growth playbooks for digital agencies, technical operators, and SaaS architects using Operza."
        canonical="/blog"
        keywords={[
          'agency management software guides',
          'workflow automation software',
          'marketing agency CRM playbooks',
          'agency client onboarding',
        ]}
        jsonLd={jsonLd}
      />

      <div style={styles.pageHeader}>
        <div style={styles.container}>
          <div style={styles.breadcrumbs}>
            <Link to="/" style={styles.breadLink}>Home</Link>
            <span>/</span>
            <span style={{ color: '#4f46e5' }}>Resources &amp; Knowledge Hub</span>
          </div>

          <h1 style={styles.h1}>Agency Scaling &amp; Engineering Hub</h1>
          <p style={styles.lead}>
            Actionable playbooks, architectural deep dives, and conversion strategies designed to help
            agencies scale sustainably without operational bloat.
          </p>

          {/* Search Input */}
          <div style={styles.searchBox}>
            <Icon name="search" size={16} />
            <input
              type="text"
              placeholder="Search guides, workflow blueprints, architecture docs..."
              style={styles.searchInput}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
      </div>

      <section style={styles.section}>
        <div style={styles.container}>
          {/* Category Filter Pills */}
          <div style={styles.categoryPills}>
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                style={{
                  ...styles.pillBtn,
                  ...(selectedCategory === c ? styles.pillBtnActive : {}),
                }}
                onClick={() => setSelectedCategory(c)}
              >
                {c}
              </button>
            ))}
          </div>

          {/* Articles Grid */}
          <div style={styles.articlesGrid}>
            {filtered.map((art) => (
              <article key={art.id} style={styles.artCard}>
                <div style={styles.artMeta}>
                  <span style={styles.artCategory}>{art.category}</span>
                  <span style={styles.artDate}>{art.date} · {art.readTime}</span>
                </div>
                <h2 style={styles.artTitle}>
                  <Link
                    to={`/blog#${art.slug}`}
                    style={styles.artLink}
                    onClick={() => trackEvent('cta_click', { article: art.slug })}
                  >
                    {art.title}
                  </Link>
                </h2>
                <p style={styles.artExcerpt}>{art.excerpt}</p>
                <div style={styles.artFooter}>
                  <Link
                    to={`/blog#${art.slug}`}
                    style={styles.readMoreLink}
                    onClick={() => trackEvent('cta_click', { article: art.slug })}
                  >
                    Read Guide →
                  </Link>
                </div>
              </article>
            ))}
          </div>

          {filtered.length === 0 && (
            <div style={styles.emptyState}>
              <Icon name="search" size={24} />
              <p style={{ margin: '8px 0 0', color: '#64748b' }}>
                No articles found matching "{searchQuery}". Try searching for workflows, CRM, or architecture.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Newsletter / Guide Capture */}
      <section style={styles.newsletterBox}>
        <div style={styles.container}>
          <div style={{ maxWidth: 540, margin: '0 auto', textAlign: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#4f46e5', letterSpacing: '0.08em' }}>NEWSLETTER</span>
            <h2 style={{ fontSize: 26, fontWeight: 800, color: '#0f172a', margin: '8px 0 10px' }}>
              The Autonomous Agency Dispatch
            </h2>
            <p style={{ fontSize: 14, color: '#64748b', lineHeight: 1.6, margin: '0 0 20px' }}>
              Get our weekly breakdown of agency automation blueprints, PostgreSQL architectures, and CRO experiments.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <input
                type="email"
                placeholder="Enter your work email..."
                style={styles.emailInput}
              />
              <button
                type="button"
                style={styles.subscribeBtn}
                onClick={() => trackEvent('cta_click', { cta: 'newsletter_subscribe' })}
              >
                Subscribe
              </button>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  pageHeader: {
    padding: '60px 20px 48px',
    background: 'radial-gradient(ellipse at top, #eef2ff 0%, #ffffff 80%)',
    borderBottom: '1px solid #e2e8f0',
  },
  container: {
    maxWidth: 1120,
    margin: '0 auto',
  },
  breadcrumbs: {
    display: 'flex',
    gap: 8,
    fontSize: 12.5,
    color: '#64748b',
    marginBottom: 16,
    alignItems: 'center',
  },
  breadLink: {
    color: '#475569',
    textDecoration: 'none',
  },
  h1: {
    fontSize: 40,
    fontWeight: 800,
    letterSpacing: '-0.03em',
    color: '#0f172a',
    margin: '0 0 16px',
    lineHeight: 1.15,
  },
  lead: {
    fontSize: 17,
    color: '#475569',
    maxWidth: 720,
    lineHeight: 1.6,
    margin: '0 0 24px',
  },
  searchBox: {
    maxWidth: 480,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    background: '#ffffff',
    border: '1px solid #cbd5e1',
    borderRadius: 8,
    padding: '8px 14px',
    boxShadow: '0 2px 6px rgba(15, 23, 42, 0.04)',
    color: '#64748b',
  },
  searchInput: {
    border: 'none',
    outline: 'none',
    width: '100%',
    fontSize: 13.5,
    color: '#0f172a',
  },
  section: {
    padding: '48px 20px 72px',
  },
  categoryPills: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    marginBottom: 32,
  },
  pillBtn: {
    padding: '6px 14px',
    borderRadius: 99,
    border: '1px solid #e2e8f0',
    background: '#ffffff',
    color: '#475569',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  pillBtnActive: {
    background: '#4f46e5',
    color: '#ffffff',
    borderColor: '#4338ca',
  },
  articlesGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: 28,
  },
  artCard: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 12,
    padding: 24,
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 4px 14px rgba(15, 23, 42, 0.03)',
  },
  artMeta: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  artCategory: {
    fontSize: 11,
    fontWeight: 700,
    color: '#4f46e5',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },
  artDate: {
    fontSize: 12,
    color: '#94a3b8',
  },
  artTitle: {
    fontSize: 20,
    fontWeight: 750,
    color: '#0f172a',
    margin: '0 0 10px',
    lineHeight: 1.35,
  },
  artLink: {
    color: '#0f172a',
    textDecoration: 'none',
    transition: 'color 0.15s ease',
  },
  artExcerpt: {
    fontSize: 13.5,
    color: '#475569',
    lineHeight: 1.6,
    margin: '0 0 20px',
    flex: 1,
  },
  artFooter: {
    borderTop: '1px solid #f8fafc',
    paddingTop: 12,
  },
  readMoreLink: {
    fontSize: 13.5,
    fontWeight: 650,
    color: '#4f46e5',
    textDecoration: 'none',
  },
  emptyState: {
    textAlign: 'center',
    padding: '48px 20px',
    color: '#94a3b8',
  },
  newsletterBox: {
    background: '#f8fafc',
    padding: '60px 20px',
    borderTop: '1px solid #e2e8f0',
  },
  emailInput: {
    flex: 1,
    maxWidth: 280,
    padding: '10px 14px',
    border: '1px solid #cbd5e1',
    borderRadius: 8,
    fontSize: 13.5,
    outline: 'none',
  },
  subscribeBtn: {
    padding: '10px 18px',
    background: '#4f46e5',
    color: '#ffffff',
    border: 'none',
    borderRadius: 8,
    fontSize: 13.5,
    fontWeight: 650,
    cursor: 'pointer',
  },
};
