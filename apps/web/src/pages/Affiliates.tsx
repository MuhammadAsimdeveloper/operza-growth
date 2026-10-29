import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Avatar, EmptyState, PageHeader, StatCard, StatusBadge } from '../components/ui';
import { uid, useStore } from '../lib/store';
import { currency, num, pct } from '../lib/format';
import { api } from '../lib/api';
import type { Affiliate } from '../lib/types';

export default function Affiliates() {
  const { state, dispatch } = useStore();
  const { affiliates } = state;
  const [inviting, setInviting] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    api.crm.list<Affiliate>('affiliates').then((res) => {
      if (res.data && res.data.length > 0) {
        for (const aff of res.data) {
          if (!affiliates.some((x) => x.id === aff.id)) {
            dispatch({
              type: 'affiliate/add',
              affiliate: {
                id: aff.id,
                name: aff.name,
                email: aff.email || `${aff.name.toLowerCase().replace(/[^a-z0-9]/g, '')}@partner.io`,
                code: aff.code,
                commissionPct: Number(aff.commissionPct) || 20,
                clicks: Number(aff.clicks) || 0,
                signups: Number(aff.signups) || 0,
                conversions: Number(aff.conversions) || 0,
                payout: Number(aff.payout) || 0,
                status: (aff.status as any) || 'active',
              },
            });
          }
        }
      }
    }).catch(() => { /* dev fallback */ });
  }, []);

  const handleStatusChange = async (a: Affiliate, newStatus: Affiliate['status']) => {
    dispatch({
      type: 'affiliate/status',
      id: a.id,
      status: newStatus,
    });
    try {
      await api.crm.update('affiliates', a.id, { status: newStatus });
    } catch { /* dev fallback */ }
  };

  const handleTestTrack = async (a: Affiliate) => {
    try {
      const res = await api.affiliates.track(a.code, 1000);
      dispatch({
        type: 'affiliate/status',
        id: a.id,
        status: a.status,
      });
      if (res?.affiliate?.payout !== undefined) {
        setNotice(`Simulated $1,000 order for ${a.name}! Earned ${currency(res.commissionEarned)} commission.`);
      }
    } catch { /* dev fallback */ }
  };

  const clicks = affiliates.reduce((s, a) => s + a.clicks, 0);
  const conversions = affiliates.reduce((s, a) => s + a.conversions, 0);
  const payouts = affiliates.reduce((s, a) => s + a.payout, 0);
  const top = [...affiliates].sort((a, b) => b.conversions - a.conversions)[0];

  return (
    <div className="content">
      <PageHeader
        title="Affiliates"
        subtitle="Partner links, commission tracking and payouts."
        actions={
          <>
            <button className="btn" onClick={() => setReportOpen(true)}>
              <Icon name="copy" size={15} /> Payout report
            </button>
            <button className="btn btn--primary" onClick={() => setInviting(true)}>
              <Icon name="plus" size={15} /> Invite affiliate
            </button>
          </>
        }
      />

      {notice && (
        <div className="callout" style={{ marginBottom: 16 }}>
          {notice}
        </div>
      )}

      <div className="grid grid--4" style={{ marginBottom: 16 }}>
        <StatCard label="Affiliates" value={num(affiliates.length)} icon={<Icon name="users" size={15} />} meta={`${affiliates.filter((a) => a.status === 'active').length} active`} />
        <StatCard label="Link clicks" value={num(clicks)} icon={<Icon name="link" size={15} />} meta="all partners" />
        <StatCard label="Conversions" value={num(conversions)} icon={<Icon name="check" size={15} />} meta={pct(conversions, clicks)} />
        <StatCard label="Commission owed" value={currency(payouts)} icon={<Icon name="dollar" size={15} />} meta="unpaid balance" />
      </div>

      {top && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card__body row row--between">
            <span className="row" style={{ gap: 12 }}>
              <span className="avatar avatar--md" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                <Icon name="star" size={17} />
              </span>
              <span>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 650 }}>
                  Top partner: {top.name}
                </span>
                <span className="cell-sub">
                  {num(top.conversions)} conversions at {top.commissionPct}% commission
                </span>
              </span>
            </span>
            <span className="row" style={{ gap: 8 }}>
              <span className="badge badge--accent">{top.code}</span>
              <span className="cell-num" style={{ fontSize: 14, fontWeight: 650 }}>
                {currency(top.payout)}
              </span>
            </span>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card__head">
          <div>
            <div className="card__title">Partner roster</div>
            <div className="card__sub">{affiliates.length} affiliates</div>
          </div>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Affiliate</th>
                <th>Code</th>
                <th className="cell-right">Clicks</th>
                <th className="cell-right">Signups</th>
                <th className="cell-right">Conversions</th>
                <th className="cell-right">Commission</th>
                <th className="cell-right">Payout</th>
                <th style={{ width: 130 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {affiliates.map((a) => (
                <tr key={a.id}>
                  <td>
                    <span className="person">
                      <Avatar name={a.name} />
                      <span className="person__text">
                        <span className="person__name">{a.name}</span>
                        <span className="person__sub">{a.email}</span>
                      </span>
                    </span>
                  </td>
                  <td>
                    <span className="badge">{a.code}</span>
                  </td>
                  <td className="cell-right cell-num">{num(a.clicks)}</td>
                  <td className="cell-right cell-num">{num(a.signups)}</td>
                  <td className="cell-right cell-num">{num(a.conversions)}</td>
                  <td className="cell-right cell-num">{a.commissionPct}%</td>
                  <td className="cell-right cell-num">{currency(a.payout)}</td>
                  <td>
                    <div className="row" style={{ gap: 8 }}>
                      <StatusBadge status={a.status} />
                      <select
                        className="select select--sm"
                        value={a.status}
                        aria-label={`Status for ${a.name}`}
                        onChange={(e) => handleStatusChange(a, e.target.value as Affiliate['status'])}
                      >
                        <option value="active">Active</option>
                        <option value="pending">Pending</option>
                        <option value="paused">Paused</option>
                      </select>
                      <button
                        type="button"
                        className="btn btn--sm"
                        title="Simulate $1,000 order referral"
                        onClick={() => handleTestTrack(a)}
                      >
                        <Icon name="play" size={12} /> Test
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {inviting && <InviteAffiliateModal onClose={() => setInviting(false)} />}
      {reportOpen && <PayoutReportModal onClose={() => setReportOpen(false)} />}
    </div>
  );
}

function InviteAffiliateModal({ onClose }: { onClose: () => void }) {
  const { dispatch } = useStore();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [commissionPct, setCommissionPct] = useState('20');
  const [submitting, setSubmitting] = useState(false);

  const canSave = name.trim().length > 1 && email.trim().includes('@');

  const handleNameChange = (val: string) => {
    setName(val);
    if (!code || code === name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) + '20') {
      setCode(val.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) + '20');
    }
  };

  const save = async () => {
    if (!canSave || submitting) return;
    setSubmitting(true);
    const newAffiliate: Affiliate = {
      id: uid('aff'),
      name: name.trim(),
      email: email.trim(),
      code: (code || name.trim().slice(0, 5) + '20').toUpperCase().replace(/[^A-Z0-9]/g, ''),
      commissionPct: Math.max(1, Math.min(100, Number(commissionPct) || 20)),
      clicks: 0,
      signups: 0,
      conversions: 0,
      payout: 0,
      status: 'active',
    };
    try {
      const res = await api.crm.create('affiliates', {
        name: newAffiliate.name,
        email: newAffiliate.email,
        code: newAffiliate.code,
        commissionPct: newAffiliate.commissionPct,
        clicks: 0,
        signups: 0,
        conversions: 0,
        payout: 0,
        status: 'active',
      });
      if (res?.id) newAffiliate.id = res.id;
    } catch { /* dev fallback */ }
    dispatch({ type: 'affiliate/add', affiliate: newAffiliate });
    setSubmitting(false);
    onClose();
  };

  return (
    <Modal
      title="Invite Affiliate Partner"
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button className="btn btn--primary" type="button" disabled={!canSave || submitting} onClick={save}>
            {submitting ? 'Inviting...' : 'Send Partner Invite'}
          </button>
        </>
      }
    >
      <div className="stack" style={{ gap: 12 }}>
        <div className="field">
          <label htmlFor="aff-name">Partner Name</label>
          <input
            id="aff-name"
            className="input"
            autoFocus
            placeholder="Elena Rostova"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="aff-email">Partner Email</label>
          <input
            id="aff-email"
            className="input"
            type="email"
            placeholder="elena@growthventures.co"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="row" style={{ gap: 12 }}>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="aff-code">Referral Tracking Code</label>
            <input
              id="aff-code"
              className="input mono-cell"
              placeholder="ELENA20"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            />
          </div>
          <div className="field" style={{ width: 120 }}>
            <label htmlFor="aff-comm">Commission %</label>
            <input
              id="aff-comm"
              className="input"
              type="number"
              min="1"
              max="100"
              value={commissionPct}
              onChange={(e) => setCommissionPct(e.target.value)}
            />
          </div>
        </div>
        <div className="hint">
          Partners can use this code on checkout to credit referral commissions automatically.
        </div>
      </div>
    </Modal>
  );
}

function PayoutReportModal({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStore();
  const { affiliates } = state;
  const [settling, setSettling] = useState<string | null>(null);

  const totalOwed = affiliates.reduce((sum, a) => sum + (Number(a.payout) || 0), 0);
  const totalConversions = affiliates.reduce((sum, a) => sum + (Number(a.conversions) || 0), 0);
  const payablePartners = affiliates.filter((a) => (Number(a.payout) || 0) > 0);

  const handleSettle = async (a: Affiliate) => {
    setSettling(a.id);
    try {
      await api.affiliates.settlePayout(a.id, a.payout);
    } catch { /* dev fallback */ }
    dispatch({ type: 'affiliate/payout', id: a.id, amount: a.payout });
    setSettling(null);
  };

  const downloadCsv = () => {
    const header = 'Name,Email,Code,Conversions,CommissionPct,UnpaidPayout,Status\n';
    const rows = affiliates
      .map((a) => `"${a.name}","${a.email}","${a.code}",${a.conversions},${a.commissionPct}%,$${a.payout},"${a.status}"`)
      .join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `affiliate-payout-report-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Modal
      title="Affiliate Payout Report & Settlements"
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={downloadCsv}>
            <Icon name="download" size={14} /> Export CSV
          </button>
          <button className="btn btn--primary" type="button" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <div className="grid grid--3" style={{ marginBottom: 16 }}>
        <StatCard label="Total Commission Owed" value={currency(totalOwed)} icon={<Icon name="dollar" size={15} />} meta="pending settlement" />
        <StatCard label="Payable Partners" value={num(payablePartners.length)} icon={<Icon name="users" size={15} />} meta="balance > $0" />
        <StatCard label="Total Referrals" value={num(totalConversions)} icon={<Icon name="check" size={15} />} meta="lifetime conversions" />
      </div>

      <div className="card">
        <div className="card__head">
          <div className="card__title">Pending Settlements</div>
        </div>
        {payablePartners.length === 0 ? (
          <div className="card__body">
            <EmptyState icon={<Icon name="check" size={20} />} title="All payouts settled" text="No outstanding commission balances owed to partners." />
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Partner</th>
                  <th>Code</th>
                  <th className="cell-right">Conversions</th>
                  <th className="cell-right">Balance Owed</th>
                  <th className="cell-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {payablePartners.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.name}</strong>
                      <div className="cell-sub">{p.email}</div>
                    </td>
                    <td>
                      <span className="badge">{p.code}</span>
                    </td>
                    <td className="cell-right cell-num">{num(p.conversions)}</td>
                    <td className="cell-right cell-num" style={{ color: 'var(--green)', fontWeight: 650 }}>
                      {currency(p.payout)}
                    </td>
                    <td className="cell-right">
                      <button
                        type="button"
                        className="btn btn--sm btn--primary"
                        disabled={settling === p.id}
                        onClick={() => handleSettle(p)}
                      >
                        {settling === p.id ? 'Settling...' : 'Settle Payout'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}
