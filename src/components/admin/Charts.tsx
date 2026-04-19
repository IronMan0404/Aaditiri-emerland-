'use client';
import { useMemo } from 'react';

// Lightweight, dependency-free SVG charts shared between the issues and
// clubhouse admin analytics pages. Matches the news-panels precedent of
// avoiding chart libraries to keep the bundle small.

interface LineChartProps {
  data: { date: string; value: number }[];
  height?: number;
  color?: string;
  label?: string;
}

// Single-series line chart with Y-axis grid and last-point highlight.
// Renders "no data" placeholder when the series is empty, so the caller
// doesn't need to gate on length.
export function LineChart({ data, height = 140, color = '#1B5E20', label }: LineChartProps) {
  const { points, minVal, maxVal, last } = useMemo(() => {
    if (data.length === 0) return { points: '', minVal: 0, maxVal: 0, last: null };
    const values = data.map((d) => d.value);
    const max = Math.max(...values, 1);
    const min = Math.min(...values, 0);
    const range = max - min || 1;
    const stepX = data.length > 1 ? 100 / (data.length - 1) : 0;
    const pts = data
      .map((d, i) => `${(i * stepX).toFixed(2)},${(100 - ((d.value - min) / range) * 100).toFixed(2)}`)
      .join(' ');
    return { points: pts, minVal: min, maxVal: max, last: data[data.length - 1] };
  }, [data]);

  if (data.length === 0) {
    return <p className="text-xs text-gray-400 italic py-6 text-center">No data in this window</p>;
  }

  return (
    <div className="relative">
      {label && <p className="text-xs font-semibold text-gray-600 mb-2">{label}</p>}
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full" style={{ height }}>
        {[0, 25, 50, 75, 100].map((y) => (
          <line key={y} x1="0" y1={y} x2="100" y2={y} stroke="#E5E7EB" strokeWidth="0.2" />
        ))}
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth="0.8"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="flex justify-between text-[10px] text-gray-400 mt-1">
        <span>{data[0].date.slice(5)}</span>
        <span>
          {minVal} \u2013 {maxVal}
          {last !== null && ` \u00b7 today: ${last.value}`}
        </span>
        <span>{data[data.length - 1].date.slice(5)}</span>
      </div>
    </div>
  );
}

interface StackedAreaChartProps {
  data: { date: string; segments: { key: string; value: number; color: string }[] }[];
  height?: number;
  label?: string;
}

// Stacked area chart for cumulative-flow-style visualisations. Each row in
// `data` must have the same `segments` keys in the same order; the caller is
// responsible for that. Stacks bottom-up, so the first segment becomes the
// floor and subsequent segments stack on top.
export function StackedAreaChart({ data, height = 160, label }: StackedAreaChartProps) {
  const { polygons, total, keys } = useMemo(() => {
    if (data.length === 0) return { polygons: [], total: 0, keys: [] as string[] };
    const segKeys = data[0].segments.map((s) => s.key);
    const colors = new Map(data[0].segments.map((s) => [s.key, s.color]));
    // Find global max stack height so all segments share a Y scale.
    let max = 0;
    for (const row of data) {
      const sum = row.segments.reduce((acc, s) => acc + s.value, 0);
      if (sum > max) max = sum;
    }
    if (max === 0) max = 1;
    const stepX = data.length > 1 ? 100 / (data.length - 1) : 0;

    // Build cumulative tops per segment per day, then turn each segment into
    // a polygon path (top edge of this segment + bottom edge reversed).
    const tops: number[][] = [];
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const t: number[] = [];
      let acc = 0;
      for (const s of row.segments) {
        acc += s.value;
        t.push(acc);
      }
      tops.push(t);
    }

    const polys = segKeys.map((key, segIdx) => {
      const topPts = data.map((_, i) => {
        const top = tops[i][segIdx];
        return `${(i * stepX).toFixed(2)},${(100 - (top / max) * 100).toFixed(2)}`;
      });
      const bottomPts = data.map((_, i) => {
        const bottom = segIdx === 0 ? 0 : tops[i][segIdx - 1];
        return `${(i * stepX).toFixed(2)},${(100 - (bottom / max) * 100).toFixed(2)}`;
      }).reverse();
      return {
        key,
        color: colors.get(key) ?? '#888',
        points: [...topPts, ...bottomPts].join(' '),
      };
    });

    return { polygons: polys, total: max, keys: segKeys };
  }, [data]);

  if (data.length === 0) {
    return <p className="text-xs text-gray-400 italic py-6 text-center">No data in this window</p>;
  }

  return (
    <div>
      {label && <p className="text-xs font-semibold text-gray-600 mb-2">{label}</p>}
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full" style={{ height }}>
        {[0, 25, 50, 75, 100].map((y) => (
          <line key={y} x1="0" y1={y} x2="100" y2={y} stroke="#E5E7EB" strokeWidth="0.2" />
        ))}
        {polygons.map((p) => (
          <polygon
            key={p.key}
            points={p.points}
            fill={p.color}
            fillOpacity="0.85"
            stroke={p.color}
            strokeWidth="0.2"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <div className="flex flex-wrap items-center gap-3 mt-2">
        {keys.map((k) => {
          const color = data[0].segments.find((s) => s.key === k)?.color ?? '#888';
          return (
            <div key={k} className="flex items-center gap-1.5 text-[10px] text-gray-600">
              <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: color }} />
              {k}
            </div>
          );
        })}
        <span className="ml-auto text-[10px] text-gray-400">peak: {total}</span>
      </div>
      <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
        <span>{data[0].date.slice(5)}</span>
        <span>{data[data.length - 1].date.slice(5)}</span>
      </div>
    </div>
  );
}

interface BarRowsProps {
  data: { label: string; value: number }[];
  color?: string;
  emptyMessage?: string;
}

// Horizontal bar list. Used for "open issues by category" and "passes used
// per facility" \u2014 anything where the labels vary in length.
export function BarRows({ data, color = '#1B5E20', emptyMessage = 'No data' }: BarRowsProps) {
  if (data.length === 0) return <p className="text-xs text-gray-400 italic py-4 text-center">{emptyMessage}</p>;
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="space-y-2">
      {data.map((d) => (
        <div key={d.label}>
          <div className="flex justify-between text-[11px] text-gray-600 mb-0.5">
            <span className="truncate">{d.label}</span>
            <span className="font-semibold">{d.value}</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${(d.value / max) * 100}%`, backgroundColor: color }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

interface KpiTileProps {
  label: string;
  value: string | number;
  hint?: string;
  tone?: 'default' | 'good' | 'warn' | 'bad';
}

export function KpiTile({ label, value, hint, tone = 'default' }: KpiTileProps) {
  const toneClass =
    tone === 'good' ? 'text-green-700'
    : tone === 'warn' ? 'text-amber-700'
    : tone === 'bad' ? 'text-red-700'
    : 'text-gray-900';
  return (
    <div className="bg-white rounded-xl p-3 shadow-sm">
      <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">{label}</p>
      <p className={`text-xl font-bold mt-0.5 ${toneClass}`}>{value}</p>
      {hint && <p className="text-[10px] text-gray-400 mt-0.5">{hint}</p>}
    </div>
  );
}
