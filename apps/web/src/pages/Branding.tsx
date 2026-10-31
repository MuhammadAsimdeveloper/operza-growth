import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { Badge, PageHeader, StatCard, StatusBadge } from '../components/ui';
import { api } from '../lib/api';

interface BrandingConfig {
  platformName: string;
  subdomain: string;
  customDomain: string;
  cnameTarget: string;
  isDomainVerified: boolean;
  sslActive: boolean;
  logoUrl: string;
  faviconUrl: string;
  primaryColor: string;
  accentColor: string;
  supportEmail: string;
  senderName: string;
  senderEmail: string;
  isDkimVerified: boolean;
  portalWelcomeHeading: string;
  portalWelcomeSubhead: string;
}

export default function Branding() {
  const [branding, setBranding] = useState<BrandingConfig>({
    platformName: 'Operza Agency OS',
    subdomain: 'agency-alpha',
    customDomain: 'portal.alpha-growth.io',
    cnameTarget: 'cname.operza.io',
    isDomainVerified: true,
    sslActive: true,
    logoUrl: '',
    faviconUrl: '',
    primaryColor: '#4f46e5',
    accentColor: '#6366f1',
    supportEmail: 'support@operza.io',
    senderName: 'Alpha Growth Operations',
    senderEmail: 'hello@alpha-growth.io',
    isDkimVerified: true,
    portalWelcomeHeading: 'Client Portal · Welcome',
    portalWelcomeSubhead: 'Manage your projects, live pipeline, invoices, and appointments.',
  });

  const [saving, setSaving] = useState(false);
  const [savedBanner, setSavedBanner] = useState(false);
  const [verifyingDomain, setVerifyingDomain] = useState(false);
  const [verifyingEmail, setVerifyingEmail] = useState(false);

  useEffect(() => {
    let active = true;
    api.branding.get().then((res) => {
      if (!active || !res?.branding) return;
      setBranding((prev) => ({ ...prev, ...res.branding }));
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await api.branding.update(branding);
      if (res?.branding) setBranding(res.branding);
      setSavedBanner(true);
      setTimeout(() => setSavedBanner(false), 3000);
    } catch (err) {
      console.error('Failed to save branding:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleVerifyDomain = async () => {
    setVerifyingDomain(true);
    try {
      const res = await api.branding.verifyDomain(branding.customDomain);
      if (res?.branding) setBranding(res.branding);
    } catch (err) {
      console.error('Domain verification failed:', err);
    } finally {
      setVerifyingDomain(false);
    }
  };

  const handleVerifyEmail = async () => {
    setVerifyingEmail(true);
    try {
      const res = await api.branding.verifyEmail();
      if (res?.branding) setBranding(res.branding);
    } catch (err) {
      console.error('Email verification failed:', err);
    } finally {
      setVerifyingEmail(false);
    }
  };

  return (
    <div className="content">
      <PageHeader
        title="Agency White-Label & Custom Branding"
        subtitle="Deliver a high-touch branded experience to your clients with custom domains, themes, and email identity."
        actions={
          <button className="btn btn--primary" onClick={handleSave} disabled={saving}>
            <Icon name="check" size={15} /> {saving ? 'Saving...' : 'Save branding'}
          </button>
        }
      />

      <div className="grid grid--4" style={{ marginBottom: 16 }}>
        <StatCard
          label="Custom Domain"
          value={branding.isDomainVerified ? 'Verified' : 'Pending'}
          icon={<Icon name="globe" size={15} />}
          meta={branding.sslActive ? 'SSL certificate active' : 'Awaiting DNS CNAME'}
        />
        <StatCard
          label="Sender Identity"
          value={branding.isDkimVerified ? 'Authenticated' : 'Unverified'}
          icon={<Icon name="mail" size={15} />}
          meta={branding.senderEmail}
        />
        <StatCard
          label="Primary Theme"
          value={branding.primaryColor.toUpperCase()}
          icon={<Icon name="sliders" size={15} />}
          meta="accent & button styling"
        />
        <StatCard
          label="Portal Subdomain"
          value={`${branding.subdomain}.operza.io`}
          icon={<Icon name="link" size={15} />}
          meta="agency client portal"
        />
      </div>

      {savedBanner && (
        <div
          style={{
            background: 'var(--green-soft)',
            color: 'var(--green)',
            padding: '10px 14px',
            borderRadius: 'var(--r-md)',
            fontSize: 13,
            marginBottom: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <Icon name="check" size={16} /> White-label branding and custom domain settings updated successfully.
        </div>
      )}

      <div className="grid grid--2" style={{ gap: 18, alignItems: 'start' }}>
        {/* Left Column: Domain & Identity */}
        <div className="stack" style={{ gap: 16 }}>
          {/* Custom Domain Card */}
          <div className="card">
            <div className="card__head">
              <div>
                <strong style={{ fontSize: 14 }}>Custom Domain & SSL</strong>
                <div className="cell-sub">Host your agency workspace and client portal on your own domain</div>
              </div>
              <StatusBadge status={branding.isDomainVerified ? 'active' : 'pending'} />
            </div>

            <div style={{ padding: '0 16px 16px' }} className="stack">
              <div className="field">
                <label htmlFor="custom-dom">Custom CNAME Domain</label>
                <input
                  id="custom-dom"
                  className="input"
                  style={{ fontFamily: 'var(--font-mono)' }}
                  placeholder="e.g. portal.myagency.com"
                  value={branding.customDomain}
                  onChange={(e) => setBranding({ ...branding, customDomain: e.target.value })}
                />
              </div>

              <div
                style={{
                  background: 'var(--surface-2)',
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--r-md)',
                  padding: '10px 12px',
                  fontSize: 12,
                }}
              >
                <div style={{ fontWeight: 600, color: 'var(--text-2)', marginBottom: 4 }}>DNS Setup Instructions:</div>
                <div className="cell-sub" style={{ lineHeight: 1.5 }}>
                  Add a <strong>CNAME</strong> record in your DNS provider (Cloudflare, GoDaddy, Namecheap):
                  <div style={{ fontFamily: 'var(--font-mono)', marginTop: 4, background: 'var(--surface)', padding: '4px 8px', borderRadius: 4 }}>
                    CNAME {branding.customDomain || 'portal'} → {branding.cnameTarget}
                  </div>
                </div>
              </div>

              <div className="row" style={{ justifyContent: 'flex-end', marginTop: 4 }}>
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={handleVerifyDomain}
                  disabled={verifyingDomain || !branding.customDomain}
                >
                  <Icon name="refresh" size={13} /> {verifyingDomain ? 'Checking DNS...' : 'Verify DNS & SSL'}
                </button>
              </div>
            </div>
          </div>

          {/* Email Sender Identity */}
          <div className="card">
            <div className="card__head">
              <div>
                <strong style={{ fontSize: 14 }}>Email Sender Identity</strong>
                <div className="cell-sub">DKIM & SPF reputation settings for outbound communications</div>
              </div>
              <Badge tone={branding.isDkimVerified ? 'green' : 'amber'} dot>
                {branding.isDkimVerified ? 'DKIM Verified' : 'Unverified'}
              </Badge>
            </div>

            <div style={{ padding: '0 16px 16px' }} className="stack">
              <div className="grid grid--2">
                <div className="field">
                  <label htmlFor="snd-name">From Name</label>
                  <input
                    id="snd-name"
                    className="input"
                    value={branding.senderName}
                    onChange={(e) => setBranding({ ...branding, senderName: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="snd-email">From Email Address</label>
                  <input
                    id="snd-email"
                    className="input"
                    value={branding.senderEmail}
                    onChange={(e) => setBranding({ ...branding, senderEmail: e.target.value })}
                  />
                </div>
              </div>

              <div className="row" style={{ justifyContent: 'flex-end', marginTop: 4 }}>
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={handleVerifyEmail}
                  disabled={verifyingEmail}
                >
                  <Icon name="check" size={13} /> {verifyingEmail ? 'Authenticating...' : 'Authenticate SPF / DKIM'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Platform Aesthetics & Live Preview */}
        <div className="stack" style={{ gap: 16 }}>
          <div className="card">
            <div className="card__head">
              <div>
                <strong style={{ fontSize: 14 }}>Brand Styling & Colors</strong>
                <div className="cell-sub">Visual theme applied across client portals, proposals, and invoices</div>
              </div>
            </div>

            <div style={{ padding: '0 16px 16px' }} className="stack">
              <div className="field">
                <label htmlFor="plt-name">Platform Brand Name</label>
                <input
                  id="plt-name"
                  className="input"
                  value={branding.platformName}
                  onChange={(e) => setBranding({ ...branding, platformName: e.target.value })}
                />
              </div>

              <div className="grid grid--2">
                <div className="field">
                  <label htmlFor="col-pri">Primary Color</label>
                  <div className="row" style={{ gap: 8 }}>
                    <input
                      id="col-pri"
                      type="color"
                      value={branding.primaryColor}
                      onChange={(e) => setBranding({ ...branding, primaryColor: e.target.value })}
                      style={{ width: 36, height: 34, padding: 0, border: 'none', cursor: 'pointer', borderRadius: 4 }}
                    />
                    <input
                      className="input"
                      value={branding.primaryColor}
                      onChange={(e) => setBranding({ ...branding, primaryColor: e.target.value })}
                      style={{ fontFamily: 'var(--font-mono)' }}
                    />
                  </div>
                </div>

                <div className="field">
                  <label htmlFor="col-acc">Accent Glow Color</label>
                  <div className="row" style={{ gap: 8 }}>
                    <input
                      id="col-acc"
                      type="color"
                      value={branding.accentColor}
                      onChange={(e) => setBranding({ ...branding, accentColor: e.target.value })}
                      style={{ width: 36, height: 34, padding: 0, border: 'none', cursor: 'pointer', borderRadius: 4 }}
                    />
                    <input
                      className="input"
                      value={branding.accentColor}
                      onChange={(e) => setBranding({ ...branding, accentColor: e.target.value })}
                      style={{ fontFamily: 'var(--font-mono)' }}
                    />
                  </div>
                </div>
              </div>

              <div className="field">
                <label htmlFor="wel-heading">Client Portal Welcome Heading</label>
                <input
                  id="wel-heading"
                  className="input"
                  value={branding.portalWelcomeHeading}
                  onChange={(e) => setBranding({ ...branding, portalWelcomeHeading: e.target.value })}
                />
              </div>

              <div className="field">
                <label htmlFor="wel-subhead">Client Portal Welcome Subhead</label>
                <input
                  id="wel-subhead"
                  className="input"
                  value={branding.portalWelcomeSubhead}
                  onChange={(e) => setBranding({ ...branding, portalWelcomeSubhead: e.target.value })}
                />
              </div>
            </div>
          </div>

          {/* Live Preview Card */}
          <div className="card">
            <div className="card__head">
              <div>
                <strong style={{ fontSize: 13.5 }}>Client Portal White-Label Preview</strong>
                <div className="cell-sub">Live simulation of your client&apos;s experience</div>
              </div>
              <Badge tone="blue">White-Label Active</Badge>
            </div>

            <div
              style={{
                margin: '0 16px 16px',
                border: '1px solid var(--line)',
                borderRadius: 'var(--r-lg)',
                overflow: 'hidden',
                background: 'var(--surface-2)',
              }}
            >
              <div
                style={{
                  background: 'var(--surface)',
                  padding: '10px 16px',
                  borderBottom: '1px solid var(--line)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <div
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 6,
                    background: branding.primaryColor,
                    color: '#fff',
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  {branding.platformName.slice(0, 2).toUpperCase()}
                </div>
                <strong style={{ fontSize: 12.5 }}>{branding.platformName}</strong>
                <span className="spacer" />
                <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                  {branding.customDomain || `${branding.subdomain}.operza.io`}
                </span>
              </div>

              <div style={{ padding: '28px 20px', textAlign: 'center' }}>
                <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: 'var(--text)' }}>
                  {branding.portalWelcomeHeading}
                </h3>
                <p style={{ fontSize: 12.5, color: 'var(--text-2)', maxWidth: 360, margin: '8px auto 16px' }}>
                  {branding.portalWelcomeSubhead}
                </p>
                <button
                  type="button"
                  style={{
                    background: branding.primaryColor,
                    color: '#fff',
                    border: 'none',
                    padding: '8px 16px',
                    borderRadius: 'var(--r-md)',
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Access Client Dashboard
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
