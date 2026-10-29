export interface Point {
  label: string;
  value: number;
}

/** Responsive bar chart drawn with SVG. */
export function BarChart({
  data,
  color = '#4f46e5',
  height = 190,
  valueFormat = (n: number) => String(n),
}: {
  data: Point[];
  color?: string;
  height?: number;
  valueFormat?: (n: number) => string;
}) {
  const width = 640;
  const padX = 34;
  const padTop = 18;
  const padBottom = 26;
  const innerW = width - padX * 2;
  const innerH = height - padTop - padBottom;
  const max = Math.max(...data.map((d) => d.value), 1);
  const step = innerW / Math.max(data.length, 1);
  const barW = Math.min(step * 0.56, 46);

  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Bar chart">
      {[0, 0.5, 1].map((t) => (
        <line
          key={t}
          x1={padX}
          x2={width - padX}
          y1={padTop + innerH * t}
          y2={padTop + innerH * t}
          stroke="#eceff4"
          strokeWidth="1"
        />
      ))}
      {data.map((d, i) => {
        const h = Math.max((d.value / max) * innerH, 2);
        const x = padX + step * i + (step - barW) / 2;
        const y = padTop + innerH - h;
        return (
          <g key={d.label}>
            <rect x={x} y={y} width={barW} height={h} rx="4" fill={color} opacity={0.92} />
            <text x={x + barW / 2} y={y - 6} textAnchor="middle" fontSize="10.5" fill="#7b8794">
              {valueFormat(d.value)}
            </text>
            <text
              x={x + barW / 2}
              y={height - 8}
              textAnchor="middle"
              fontSize="11"
              fill="#7b8794"
            >
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Responsive multi-series line chart. */
export function LineChart({
  series,
  labels,
  height = 210,
}: {
  series: Array<{ name: string; color: string; values: number[] }>;
  labels: string[];
  height?: number;
}) {
  const width = 640;
  const padL = 40;
  const padR = 12;
  const padTop = 14;
  const padBottom = 26;
  const innerW = width - padL - padR;
  const innerH = height - padTop - padBottom;
  const max = Math.max(...series.flatMap((s) => s.values), 1);
  const pointX = (i: number) => padL + (innerW / Math.max(labels.length - 1, 1)) * i;
  const pointY = (v: number) => padTop + innerH - (v / max) * innerH;

  return (
    <>
      <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Line chart">
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line
              x1={padL}
              x2={width - padR}
              y1={padTop + innerH * t}
              y2={padTop + innerH * t}
              stroke="#eceff4"
            />
            <text x={padL - 8} y={padTop + innerH * t + 3} textAnchor="end" fontSize="10" fill="#9aa4b2">
              {Math.round(max * (1 - t))}
            </text>
          </g>
        ))}
        {labels.map((label, i) => (
          <text key={label + i} x={pointX(i)} y={height - 8} textAnchor="middle" fontSize="10.5" fill="#9aa4b2">
            {label}
          </text>
        ))}
        {series.map((s) => {
          const d = s.values.map((v, i) => `${i === 0 ? 'M' : 'L'}${pointX(i)},${pointY(v)}`).join(' ');
          const area = `${d} L${pointX(s.values.length - 1)},${padTop + innerH} L${pointX(0)},${padTop + innerH} Z`;
          return (
            <g key={s.name}>
              <path d={area} fill={s.color} opacity="0.07" />
              <path d={d} fill="none" stroke={s.color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              {s.values.map((v, i) => (
                <circle key={i} cx={pointX(i)} cy={pointY(v)} r="2.8" fill="#fff" stroke={s.color} strokeWidth="2" />
              ))}
            </g>
          );
        })}
      </svg>
      <div className="chart__legend">
        {series.map((s) => (
          <span className="legend-item" key={s.name}>
            <span className="legend-swatch" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
    </>
  );
}

export function Donut({
  segments,
  centerLabel,
  centerValue,
  size = 172,
}: {
  segments: Array<{ label: string; value: number; color: string }>;
  centerLabel: string;
  centerValue: string;
  size?: number;
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0) || 1;
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
      <svg width={size} height={size} viewBox="0 0 140 140" role="img" aria-label={centerLabel}>
        <g transform="rotate(-90 70 70)">
          <circle cx="70" cy="70" r={radius} fill="none" stroke="#f1f3f6" strokeWidth="17" />
          {segments.map((s) => {
            const len = (s.value / total) * circumference;
            const dash = `${Math.max(len - 2, 0)} ${circumference - Math.max(len - 2, 0)}`;
            const el = (
              <circle
                key={s.label}
                cx="70"
                cy="70"
                r={radius}
                fill="none"
                stroke={s.color}
                strokeWidth="17"
                strokeDasharray={dash}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
              />
            );
            offset += len;
            return el;
          })}
        </g>
        <text x="70" y="66" textAnchor="middle" fontSize="17" fontWeight="650" fill="#0f172a">
          {centerValue}
        </text>
        <text x="70" y="83" textAnchor="middle" className="donut-center">
          {centerLabel}
        </text>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {segments.map((s) => (
          <span className="legend-item" key={s.label}>
            <span className="legend-swatch" style={{ background: s.color }} />
            {s.label}
            <strong style={{ fontWeight: 600, color: '#475569' }}>{s.value}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Tiny inline bar sparkline used inside stat rows. */
export function Spark({ values, color = '#4f46e5' }: { values: number[]; color?: string }) {
  const max = Math.max(...values, 1);
  return (
    <svg width={58} height={20} viewBox="0 0 58 20" aria-hidden="true">
      {values.map((v, i) => {
        const h = Math.max((v / max) * 18, 2);
        return <rect key={i} x={i * 8} y={20 - h} width="5" height={h} rx="1.5" fill={color} opacity={0.35 + (i / values.length) * 0.65} />;
      })}
    </svg>
  );
}
