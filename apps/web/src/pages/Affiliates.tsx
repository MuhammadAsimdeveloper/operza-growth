import { Icon } from '../components/Icon';
import { Avatar, PageHeader, StatCard, StatusBadge } from '../components/ui';
import { useStore } from '../lib/store';
import { currency, num, pct } from '../lib/format';
import type { Affiliate } from '../lib/types';

export default function Affiliates() {
  const { state, dispatch } = useStore();
  const { affiliates } = state;

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
            <button className="btn">
              <Icon name="copy" size={15} /> Payout report
            </button>
            <button className="btn btn--primary">
              <Icon name="plus" size={15} /> Invite affiliate
            </button>
          </>
        }
      />

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
                        onChange={(e) =>
                          dispatch({
                            type: 'affiliate/status',
                            id: a.id,
                            status: e.target.value as Affiliate['status'],
                          })
                        }
                      >
                        <option value="active">Active</option>
                        <option value="pending">Pending</option>
                        <option value="paused">Paused</option>
                      </select>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
