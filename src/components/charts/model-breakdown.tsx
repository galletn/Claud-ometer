'use client';

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getModelDisplayName, getModelColor } from '@/config/pricing';
import { useCostMode } from '@/lib/cost-mode-context';
import type { ModelUsage, CostEstimates } from '@/lib/claude-data/types';

interface ModelBreakdownProps {
  data: Record<string, ModelUsage & { estimatedCost: number; estimatedCosts?: CostEstimates }>;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

export function ModelBreakdown({ data }: ModelBreakdownProps) {
  const { pickCost } = useCostMode();
  // One slice per family (Opus, Sonnet, ...), matching the cost chart: several
  // dated/versioned IDs per family otherwise produced repeated same-colour rows.
  const byFamily = new Map<string, { name: string; model: string; tokens: number; cost: number; color: string; inputTokens: number; outputTokens: number; cacheRead: number; cacheWrite: number }>();
  for (const [model, usage] of Object.entries(data)) {
    const tokens = usage.inputTokens + usage.outputTokens + usage.cacheReadInputTokens + usage.cacheCreationInputTokens;
    if (tokens === 0) continue; // e.g. Claude Code's zero-usage `<synthetic>` messages
    const name = getModelDisplayName(model);
    const row = byFamily.get(name) || { name, model, tokens: 0, cost: 0, color: getModelColor(model), inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0 };
    row.tokens += tokens;
    row.cost += pickCost(usage.estimatedCosts, usage.estimatedCost);
    row.inputTokens += usage.inputTokens;
    row.outputTokens += usage.outputTokens;
    row.cacheRead += usage.cacheReadInputTokens;
    row.cacheWrite += usage.cacheCreationInputTokens;
    byFamily.set(name, row);
  }
  const chartData = Array.from(byFamily.values()).sort((a, b) => b.tokens - a.tokens);

  const totalTokens = chartData.reduce((sum, d) => sum + d.tokens, 0);

  return (
    <Card className="border-border/50 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">Model Usage</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex items-center gap-6">
          <div className="h-[180px] w-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={80}
                  dataKey="tokens"
                  strokeWidth={2}
                  stroke="var(--card)"
                >
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value) => formatTokens(Number(value))}
                  contentStyle={{
                    backgroundColor: 'var(--card)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex-1 space-y-3">
            {chartData.map(item => (
              <div key={item.model} className="space-y-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="text-sm font-medium">{item.name}</span>
                  </div>
                  <span className="text-sm font-semibold">${item.cost.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{formatTokens(item.tokens)} tokens</span>
                  <span>{totalTokens > 0 ? ((item.tokens / totalTokens) * 100).toFixed(0) : 0}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
