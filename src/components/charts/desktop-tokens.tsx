'use client';

import { useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { DesktopDailyTokens } from '@/lib/claude-data/types';
import { formatTokens } from '@/lib/format';
import { addDays, format, parseISO, subDays } from 'date-fns';

// Same pair as UsageOverTime; validated on the dark card surface (#2C2C2E).
const SERIES = [
  { key: 'cowork', label: 'Cowork', color: '#D4764E' },
  { key: 'desktopCode', label: 'Code tab', color: '#6B8AE6' },
] as const;

const RANGES = [
  { key: '30d', label: '30d', days: 30 },
  { key: '90d', label: '90d', days: 90 },
  { key: 'all', label: 'All', days: Infinity },
] as const;

type RangeKey = typeof RANGES[number]['key'];

export function DesktopTokensChart({ data }: { data: DesktopDailyTokens[] }) {
  const [range, setRange] = useState<RangeKey>('all');

  // One bar per calendar day, zero-filled, so quiet days read as gaps
  // instead of the bars on either side looking adjacent.
  const chartData = useMemo(() => {
    if (data.length === 0) return [];
    const byDate = new Map(data.map(d => [d.date, d]));
    const today = new Date();
    const span = RANGES.find(r => r.key === range)!.days;
    const first = parseISO(data[0].date);
    const start = span === Infinity ? first : subDays(today, span - 1);
    const rows = [];
    for (let day = start; day <= today; day = addDays(day, 1)) {
      const date = format(day, 'yyyy-MM-dd');
      const d = byDate.get(date);
      rows.push({ date, label: format(day, 'MMM d'), cowork: d?.cowork || 0, desktopCode: d?.desktopCode || 0 });
    }
    return rows;
  }, [data, range]);

  const total = chartData.reduce((n, d) => n + d.cowork + d.desktopCode, 0);

  return (
    <Card className="border-border/50 shadow-sm">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <CardTitle className="text-sm font-semibold">Token Usage</CardTitle>
            <div className="flex items-center gap-3">
              {SERIES.map(s => (
                <span key={s.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: s.color }} />
                  {s.label}
                </span>
              ))}
            </div>
            <span className="text-xs text-muted-foreground">{formatTokens(total)} in range</span>
          </div>
          <div className="flex gap-1">
            {RANGES.map(r => (
              <button
                key={r.key}
                onClick={() => setRange(r.key)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  range === r.key
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {total === 0 ? (
          <p className="py-12 text-center text-xs text-muted-foreground">No Claude Desktop token usage in this range.</p>
        ) : (
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={24}
                />
                <YAxis
                  tickFormatter={(v: number) => formatTokens(v)}
                  tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: 'var(--muted)', opacity: 0.3 }}
                  formatter={(value, name) => [formatTokens(Number(value)), SERIES.find(s => s.key === name)?.label ?? name]}
                  contentStyle={{
                    backgroundColor: 'var(--card)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                />
                {SERIES.map((s, i) => (
                  <Bar
                    key={s.key}
                    dataKey={s.key}
                    stackId="tokens"
                    fill={s.color}
                    stroke="var(--card)"
                    strokeWidth={1}
                    radius={i === SERIES.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]}
                    isAnimationActive={false}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
