import type { ButtonHTMLAttributes, CSSProperties, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  disabled,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  const variantCls = variant === 'primary'
    ? 'btn--primary'
    : variant === 'danger'
      ? 'btn--danger'
      : variant === 'ghost'
        ? 'btn--ghost'
        : 'btn--secondary';
  const sizeCls = size === 'sm' ? 'btn--sm' : size === 'lg' ? 'btn--lg' : '';
  return (
    <button
      className={`btn ${variantCls} ${sizeCls} ${className}`.trim()}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? 'Saving...' : children}
    </button>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export function Input({ label, error, id, className = '', ...rest }: InputProps) {
  return (
    <div className="field">
      {label && <label className="field__label" htmlFor={id}>{label}</label>}
      <input id={id} className={`input ${error ? 'input--error' : ''} ${className}`.trim()} {...rest} />
      {error && <div className="field__error" role="alert">{error}</div>}
    </div>
  );
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
}

export function Select({ label, error, id, className = '', children, ...rest }: SelectProps) {
  return (
    <div className="field">
      {label && <label className="field__label" htmlFor={id}>{label}</label>}
      <select id={id} className={`input ${error ? 'input--error' : ''} ${className}`.trim()} {...rest}>
        {children}
      </select>
      {error && <div className="field__error" role="alert">{error}</div>}
    </div>
  );
}

export function Card({
  title,
  subtitle,
  actions,
  children,
  className = '',
  style,
}: {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <section className={`card ${className}`.trim()} style={style}>
      {(title || actions) && (
        <header className="card__head">
          <div>
            {title && <h3 className="card__title">{title}</h3>}
            {subtitle && <p className="card__sub">{subtitle}</p>}
          </div>
          {actions && <div className="card__actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function LoadingState({ message = 'Loading workspace data...' }: { message?: string }) {
  return (
    <div className="empty" role="status" aria-live="polite">
      <div className="empty__title">{message}</div>
    </div>
  );
}

export function ErrorState({
  title = 'Unable to load data',
  message,
  onRetry,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="empty" role="alert">
      <div className="empty__title">{title}</div>
      {message && <div className="empty__text">{message}</div>}
      {onRetry && (
        <div style={{ marginTop: 12 }}>
          <Button variant="secondary" onClick={onRetry}>
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (nextPage: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;
  return (
    <nav aria-label="Pagination" style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end', marginTop: 12 }}>
      <Button size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
        Previous
      </Button>
      <span style={{ fontSize: 13 }}>
        Page {page} of {totalPages}
      </span>
      <Button size="sm" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
        Next
      </Button>
    </nav>
  );
}

export function Skeleton({
  width = '100%',
  height = 16,
  borderRadius = 6,
}: {
  width?: string | number;
  height?: string | number;
  borderRadius?: number;
}) {
  return (
    <div
      aria-hidden="true"
      style={{
        width,
        height,
        borderRadius,
        background: 'var(--surface-3, rgba(148, 163, 184, 0.2))',
      }}
    />
  );
}

export function Alert({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'success' | 'warning' | 'danger';
  title?: string;
  children: ReactNode;
}) {
  const palette: Record<string, { border: string; bg: string }> = {
    info: { border: 'var(--blue, #3b82f6)', bg: 'var(--blue-soft, rgba(59,130,246,0.1))' },
    success: { border: 'var(--green, #10b981)', bg: 'var(--green-soft, rgba(16,185,129,0.1))' },
    warning: { border: 'var(--amber, #f59e0b)', bg: 'var(--amber-soft, rgba(245,158,11,0.1))' },
    danger: { border: 'var(--red, #ef4444)', bg: 'var(--red-soft, rgba(239,68,68,0.1))' },
  };
  const colors = palette[tone] || palette.info;
  return (
    <div
      role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}
      style={{
        border: `1px solid ${colors.border}`,
        background: colors.bg,
        borderRadius: 'var(--r-md, 8px)',
        padding: '10px 14px',
        fontSize: 13,
      }}
    >
      {title && <div style={{ fontWeight: 600, marginBottom: 2 }}>{title}</div>}
      <div>{children}</div>
    </div>
  );
}
