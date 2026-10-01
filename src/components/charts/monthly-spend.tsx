'use client';

import { useMemo } from 'react';
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useCostMode } from '@/lib/cost-mode-context';
import { formatCost } from '@/lib/format';
import type { DailyModelTokens } from '@/lib/claude-data/types';
import { addMonths, differenceInCalendarDays, format, parseISO, startOfMonth } from 'date-fns';

interface MonthlySpendProps {
  data: DailyModelTokens[];
}

/** Stretches without any data longer than this get flagged. */
const GAP_DAYS = 31;

export function MonthlySpend({ data }: MonthlySpendProps) {
  const { pickCost, label } = useCostMode();

  const { rows, total, gap } = useMemo(() => {
    const byMonth = new Map<string, number>();
    for (const day of data) {
      const cost = Object.values(day.costsByModel || {}).reduce((n, c) => n + pickCost(c), 0);
      const month = day.date.slice(0, 7);
      byMonth.set(month, (byMonth.get(month) || 0) + cost);
    }
    if (byMonth.size === 0) return { rows: [], total: 0, gap: null };

    // Stretches with no data at all, usually because Claude Code deleted those
    // transcripts (cleanupPeriodDays) before stats-cache.json was refreshed past
    // them. A stray Cowork session inside one splits it, so collect every gap.
    const dates = Array.from(new Set(data.map(d => d.date))).sort();
    const gaps: { from: string; to: string }[] = [];
    for (let i = 1; i < dates.length; i++) {
      if (differenceInCalendarDays(parseISO(dates[i]), parseISO(dates[i - 1])) > GAP_DAYS) {
        gaps.push({ from: dates[i - 1], to: dates[i] });
      }
    }
    const gap = gaps.length > 0 ? { from: gaps[0].from, to: gaps[gaps.length - 1].to } : null;
    // A month is incomplete if any of its days falls strictly inside a gap.
    const overlapsGap = (month: Date) => {
      const start = format(month, 'yyyy-MM-dd');
      const end = format(addMonths(month, 1), 'yyyy-MM-dd');
      return gaps.some(g => g.from < end && g.to > start);
    };

    const months = Array.from(byMonth.keys()).sort();
    const current = format(new Date(), 'yyyy-MM');
    const rows = [];
    for (let m = startOfMonth(parseISO(`${months[0]}-01`)); format(m, 'yyyy-MM') <= current; m = addMonths(m, 1)) {
      const key = format(m, 'yyyy-MM');
      const inGap = overlapsGap(m);
      rows.push({
        month: key,
        label: format(m, "MMM ''yy"),
        cost: byMonth.get(key) || 0,
        inGap,
        isCurrent: key === current,
      });
    }
    return { rows, total: rows.reduce((n, r) => n + r.cost, 0), gap };
  }, [data, pickCost]);

  return (
    <Card className="border-border/50 shadow-sm">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">Spend per Month</CardTitle>
          <span className="text-xs text-muted-foreground">
            {formatCost(total)} total · {label.name.toLowerCase()}
          </span>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {rows.length === 0 ? (
          <p className="py-12 text-center text-xs text-muted-foreground">No cost data yet.</p>
        ) : (
          <>
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rows} margin={{ top: 5, right: 5, left: -5, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tickFormatter={(v: number) => formatCost(v)}
                    tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: 'var(--muted)', opacity: 0.3 }}
                    formatter={(value, _name, item) => {
                      const row = item?.payload as (typeof rows)[number] | undefined;
                      const note = row?.inGap ? ' (incomplete: no Claude Code data)' : row?.isCurrent ? ' (so far)' : '';
                      return [`${formatCost(Number(value))}${note}`, 'Spend'];
                    }}
                    contentStyle={{
                      backgroundColor: 'var(--card)',
                      border: '1px solid var(--border)',
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                  />
                  <Bar dataKey="cost" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                    {rows.map(r => (
                      <Cell key={r.month} fill="var(--primary)" fillOpacity={r.inGap ? 0.3 : 0.85} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            {gap && (
              <p className="mt-2 text-[10px] text-muted-foreground">
                Little or no data between {format(parseISO(gap.from), 'MMM d')} and {format(parseISO(gap.to), 'MMM d, yyyy')}:
                Claude Code deletes transcripts after 30 days, and its stats cache was not updated over that period. Dimmed months are incomplete.
                History months are spread per day from Claude Code&apos;s stats cache and are approximate within the month.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
