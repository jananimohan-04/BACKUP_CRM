import type { ReactNode } from 'react';

// Lightweight SVG chart components — no external dependencies

export function LineChart({
  data,
  height = 200,
  series,
}: {
  data: Record<string, number | string>[];
  height?: number;
  series: { key: string; color: string; label?: string; name?: string }[];
}) {
  const width = 600;
  const padding = { top: 20, right: 20, bottom: 30, left: 40 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const values = data.flatMap((d) => series.map((s) => Number(d[s.key])));
  const maxVal = Math.max(...values, 1);
  const minVal = 0;
  const range = maxVal - minVal || 1;

  const xStep = chartW / Math.max(data.length - 1, 1);

  const getX = (i: number) => padding.left + i * xStep;
  const getY = (val: number) => padding.top + chartH - ((val - minVal) / range) * chartH;

  const yTicks = 4;
  const tickValues = Array.from({ length: yTicks + 1 }, (_, i) => (maxVal / yTicks) * i);

  return (
    <div className="w-full overflow-x-auto scrollbar-thin">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ minWidth: 400 }}>
        <defs>
          {series.map((s, i) => (
            <linearGradient key={i} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={0.15} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        {tickValues.map((tv, i) => (
          <g key={i}>
            <line
              x1={padding.left}
              y1={getY(tv)}
              x2={width - padding.right}
              y2={getY(tv)}
              stroke="#e2e8f0"
              strokeWidth={1}
              strokeDasharray={i === 0 ? '0' : '3 3'}
            />
            <text x={padding.left - 8} y={getY(tv) + 4} textAnchor="end" className="fill-slate-400" fontSize={10}>
              {tv >= 1000 ? `${(tv / 1000).toFixed(0)}k` : tv.toFixed(0)}
            </text>
          </g>
        ))}
        {data.map((d, i) => (
          <text
            key={i}
            x={getX(i)}
            y={height - 8}
            textAnchor="middle"
            className="fill-slate-400"
            fontSize={10}
          >
            {d.month || d.label || d.name || ''}
          </text>
        ))}
        {series.map((s, si) => {
          const path = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${getX(i)} ${getY(Number(d[s.key]))}`).join(' ');
          const areaPath = `${path} L ${getX(data.length - 1)} ${getY(0)} L ${getX(0)} ${getY(0)} Z`;
          return (
            <g key={si}>
              <path d={areaPath} fill={`url(#grad-${s.key})`} />
              <path d={path} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {data.map((d, i) => (
                <circle key={i} cx={getX(i)} cy={getY(Number(d[s.key]))} r={3} fill="white" stroke={s.color} strokeWidth={2} />
              ))}
            </g>
          );
        })}
      </svg>
      <div className="flex items-center justify-center gap-4 mt-2">
        {series.map((s, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }} />
            <span className="text-xs text-slate-500">{s.label ?? s.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function BarChart({
  data,
  height = 200,
  series,
}: {
  data: Record<string, number | string>[];
  height?: number;
  series: { key: string; color: string; label?: string; name?: string }[];
}) {
  const width = 600;
  const padding = { top: 20, right: 20, bottom: 30, left: 40 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const values = data.flatMap((d) => series.map((s) => Number(d[s.key])));
  const maxVal = Math.max(...values, 1);

  const groupWidth = chartW / data.length;
  const barGap = 4;
  const barWidth = (groupWidth - barGap * (series.length + 1)) / series.length;

  const getY = (val: number) => padding.top + chartH - (val / maxVal) * chartH;
  const yTicks = 4;

  return (
    <div className="w-full overflow-x-auto scrollbar-thin">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ minWidth: 400 }}>
        {Array.from({ length: yTicks + 1 }, (_, i) => {
          const tv = (maxVal / yTicks) * i;
          return (
            <g key={i}>
              <line
                x1={padding.left}
                y1={getY(tv)}
                x2={width - padding.right}
                y2={getY(tv)}
                stroke="#e2e8f0"
                strokeWidth={1}
                strokeDasharray={i === 0 ? '0' : '3 3'}
              />
              <text x={padding.left - 8} y={getY(tv) + 4} textAnchor="end" className="fill-slate-400" fontSize={10}>
                {tv >= 1000 ? `${(tv / 1000).toFixed(0)}k` : tv.toFixed(0)}
              </text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const groupX = padding.left + i * groupWidth;
          return (
            <g key={i}>
              {series.map((s, si) => {
                const val = Number(d[s.key]);
                const barH = (val / maxVal) * chartH;
                const x = groupX + barGap + si * (barWidth + barGap);
                return (
                  <rect
                    key={si}
                    x={x}
                    y={padding.top + chartH - barH}
                    width={barWidth}
                    height={barH}
                    rx={3}
                    fill={s.color}
                    className="transition-all duration-500"
                  >
                    <title>{`${s.label ?? s.name ?? s.key}: ${val}`}</title>
                  </rect>
                );
              })}
              <text x={groupX + groupWidth / 2} y={height - 8} textAnchor="middle" className="fill-slate-400" fontSize={10}>
                {d.month || d.label || d.name || ''}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="flex items-center justify-center gap-4 mt-2">
        {series.map((s, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded" style={{ backgroundColor: s.color }} />
            <span className="text-xs text-slate-500">{s.label ?? s.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DonutChart({
  data,
  size: sizeProp,
  height,
}: {
  data: { label?: string; name?: string; value: number; color: string }[];
  size?: number;
  /** Alias for size (some callers pass height). */
  height?: number;
}) {
  const size = sizeProp ?? height ?? 180;
  const rawTotal = data.reduce((sum, d) => sum + (Number(d.value) || 0), 0);
  const total = rawTotal || 1;
  const radius = size / 2 - 20;
  const innerRadius = radius * 0.62;
  const cx = size / 2;
  const cy = size / 2;

  let cumulativeAngle = -Math.PI / 2;

  const arcs = data.map((raw) => {
    const d = { ...raw, value: Number(raw.value) || 0, label: raw.label ?? raw.name ?? '' };
    const angle = (d.value / total) * Math.PI * 2;
    const startAngle = cumulativeAngle;
    const endAngle = cumulativeAngle + angle;
    cumulativeAngle = endAngle;

    const x1 = cx + radius * Math.cos(startAngle);
    const y1 = cy + radius * Math.sin(startAngle);
    const x2 = cx + radius * Math.cos(endAngle);
    const y2 = cy + radius * Math.sin(endAngle);
    const x3 = cx + innerRadius * Math.cos(endAngle);
    const y3 = cy + innerRadius * Math.sin(endAngle);
    const x4 = cx + innerRadius * Math.cos(startAngle);
    const y4 = cy + innerRadius * Math.sin(startAngle);

    const largeArc = angle > Math.PI ? 1 : 0;

    const path = `M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} L ${x3} ${y3} A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${x4} ${y4} Z`;
    return { path, color: d.color, label: d.label, value: d.value, pct: ((d.value / total) * 100).toFixed(1) };
  });

  return (
    <div className="flex items-center gap-6">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {arcs.map((a, i) => (
          <path key={i} d={a.path} fill={a.color} className="transition-all duration-300 hover:opacity-80">
            <title>{`${a.label}: ${a.value} (${a.pct}%)`}</title>
          </path>
        ))}
        {/* Centre labels scale with the chart so larger donuts don't look type-starved.
            Anchored on the 180px baseline where 22 / 10 was the original sizing. */}
        <text x={cx} y={cy - Math.round(size * 4 / 180)} textAnchor="middle" className="fill-slate-800 font-bold" fontSize={Math.round(size * 22 / 180)}>
          {rawTotal}
        </text>
        <text x={cx} y={cy + Math.round(size * 14 / 180)} textAnchor="middle" className="fill-slate-400" fontSize={Math.round(size * 10 / 180)}>
          Total
        </text>
      </svg>
      <div className="flex flex-col gap-2">
        {arcs.map((a, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: a.color }} />
            <span className="text-xs text-slate-600">{a.label}</span>
            <span className="text-xs font-semibold text-slate-800 ml-auto">{a.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function GaugeChart({
  value,
  max = 100,
  label,
  color = '#4f46e5',
  size = 140,
}: {
  value: number;
  max?: number;
  label?: string;
  color?: string;
  size?: number;
}) {
  const pct = Math.min((value / max) * 100, 100);
  const radius = size / 2 - 12;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = Math.PI * radius;
  const dashOffset = circumference - (pct / 100) * circumference;

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size / 2 + 20} viewBox={`0 0 ${size} ${size / 2 + 20}`}>
        <path
          d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
          fill="none"
          stroke="#e2e8f0"
          strokeWidth={10}
          strokeLinecap="round"
        />
        <path
          d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
          fill="none"
          stroke={color}
          strokeWidth={10}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          className="transition-all duration-700"
        />
        <text x={cx} y={cy - 6} textAnchor="middle" className="fill-slate-800 font-bold" fontSize={20}>
          {pct.toFixed(0)}%
        </text>
      </svg>
      {label && <span className="text-xs text-slate-500 mt-1">{label}</span>}
    </div>
  );
}

export function Sparkline({
  data,
  color = '#4f46e5',
  width = 100,
  height = 30,
}: {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const step = width / Math.max(data.length - 1, 1);
  const path = data
    .map((v, i) => `${i === 0 ? 'M' : 'L'} ${i * step} ${height - ((v - min) / range) * height}`)
    .join(' ');
  return (
    <svg width={width} height={height} className="overflow-visible">
      <path d={path} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ChartCard({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-card">
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}
