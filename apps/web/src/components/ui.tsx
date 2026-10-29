import type { ReactNode } from 'react';
import { avatarColor, initials } from '../lib/format';

export function Avatar({
  name,
  size = 'sm',
  square = false,
  color,
}: {
  name: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  square?: boolean;
  color?: string;
}) {
  return (
    <span
      className={`avatar avatar--${size}${square ? ' avatar--square' : ''}`}
      style={{ background: color ?? avatarColor(name) }}
      title={name}
    >
      {initials(name)}
    </span>
  );
}

export function Badge({
  children,
  tone = 'default',
  dot = false,
}: {
  children: ReactNode;
  tone?: 'default' | 'green' | 'amber' | 'red' | 'blue' | 'violet' | 'accent';
  dot?: boolean;
}) {
  const cls = tone === 'default' ? 'badge' : `badge badge--${tone}`;
  return <span className={`${cls}${dot ? ' badge--dot' : ''}`}>{children}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { tone: 'green' | 'amber' | 'red' | 'blue' | 'violet' | 'accent' | 'default'; label: string }> = {
    paid: { tone: 'green', label: 'Paid' },
    sent: { tone: 'blue', label: 'Sent' },
    draft: { tone: 'default', label: 'Draft' },
    overdue: { tone: 'red', label: 'Overdue' },
    scheduled: { tone: 'violet', label: 'Scheduled' },
    published: { tone: 'green', label: 'Published' },
    confirmed: { tone: 'green', label: 'Confirmed' },
    pending: { tone: 'amber', label: 'Pending' },
    cancelled: { tone: 'red', label: 'Cancelled' },
    won: { tone: 'green', label: 'Won' },
    lost: { tone: 'red', label: 'Lost' },
    open: { tone: 'blue', label: 'Open' },
    lead: { tone: 'blue', label: 'Lead' },
    customer: { tone: 'green', label: 'Customer' },
    cold: { tone: 'default', label: 'Cold' },
    refunded: { tone: 'red', label: 'Refunded' },
    active: { tone: 'green', label: 'Active' },
    past_due: { tone: 'amber', label: 'Past due' },
    canceled: { tone: 'red', label: 'Canceled' },
    paused: { tone: 'default', label: 'Paused' },
    qualified: { tone: 'green', label: 'Qualified' },
    contacted: { tone: 'amber', label: 'Contacted' },
    skipped: { tone: 'default', label: 'Skipped' },
    replied: { tone: 'green', label: 'Replied' },
    flagged: { tone: 'red', label: 'Flagged' },
    signed: { tone: 'green', label: 'Signed' },
    declined: { tone: 'red', label: 'Declined' },
    new: { tone: 'blue', label: 'New' },
  };
  const item = map[status] ?? { tone: 'default' as const, label: status };
  return (
    <Badge tone={item.tone} dot>
      {item.label}
    </Badge>
  );
}

export function EmptyState({
  icon,
  title,
  text,
  action,
}: {
  icon: ReactNode;
  title: string;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty__icon">{icon}</div>
      <div className="empty__title">{title}</div>
      {text && <div className="empty__text">{text}</div>}
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div className="page-head__text">
        <h1>{title}</h1>
        {subtitle && <div className="page-head__sub">{subtitle}</div>}
      </div>
      {actions && <div className="page-head__actions">{actions}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  meta,
  icon,
  trend,
}: {
  label: string;
  value: string;
  meta?: ReactNode;
  icon?: ReactNode;
  trend?: { direction: 'up' | 'down'; value: string };
}) {
  return (
    <div className="card stat">
      <div className="stat__label">
        {icon}
        {label}
      </div>
      <div className="stat__value">{value}</div>
      <div className="stat__meta">
        {trend && (
          <span className={`trend trend--${trend.direction}`}>
            {trend.direction === 'up' ? '▲' : '▼'} {trend.value}
          </span>
        )}
        {meta}
      </div>
    </div>
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      className={`switch${on ? ' is-on' : ''}`}
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onChange}
    />
  );
}
