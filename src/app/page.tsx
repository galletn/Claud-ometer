'use client';

import { useStats } from '@/lib/hooks';
import { useCostMode } from '@/lib/cost-mode-context';
import { CostModeSelector } from '@/components/cost-mode-selector';
import { StatCard } from '@/components/cards/stat-card';
import { UsageOverTime } from '@/components/charts/usage-over-time';
import { ModelBreakdown } from '@/components/charts/model-breakdown';
import { ActivityHeatmap } from '@/components/charts/activity-heatmap';
import { PeakHours } from '@/components/charts/peak-hours';
import { MonthlySpend } from '@/components/charts/monthly-spend';
import { formatTokens, formatCost, formatDuration, timeAgo } from '@/lib/format';
import {
  MessageSquare,
  Layers,
  Coins,
  Activity,
  Clock,
  GitBranch,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SourceBadge } from '@/components/source-badge';
import Link from 'next/link';
import { format, parseISO } from 'date-fns';
import { SESSION_SOURCES, SESSION_SOURCE_LABELS } from '@/lib/claude-data/types';

export default function DashboardPage() {
  const { data: stats, isLoading } = useStats();
  const { pickCost, label: modeLabel } = useCostMode();

  if (isLoading || !stats) {
    return (
      <div className="flex h-[80vh] items-center justify-center">
        <div className="space-y-3 text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading analytics...</p>
        </div>
      </div>
    );
  }

  // Tokens/cost from stats-cache.json whose transcripts are gone, so the
  // headline can exceed the Projects page; say so instead of looking wrong.
  const historyNote = stats.history?.tokens > 0 && stats.history.through
    ? `from history before ${format(parseISO(stats.history.through), 'MMM d')}`
    : '';

  // Only worth a row once something other than the CLI/IDE has been used.
  const sources = stats.sources;
  const showSources = !!sources && (sources['claude-desktop'].sessions > 0 || sources.cowork.sessions > 0);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Overview</h1>
          <p className="text-sm text-muted-foreground">Your Claude Code, Desktop and Cowork usage at a glance</p>
        </div>
        <CostModeSelector />
      </div>

      {/* Hero Stats */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard
          title="Total Sessions"
          value={stats.totalSessions.toLocaleString()}
          subtitle={`across ${stats.projectCount} projects`}
          icon={Layers}
        />
        <StatCard
          title="Total Messages"
          value={stats.totalMessages.toLocaleString()}
          icon={MessageSquare}
        />
        <StatCard
          title="Total Tokens"
          value={formatTokens(stats.totalTokens)}
          subtitle={historyNote ? `${formatTokens(stats.history.tokens)} ${historyNote}` : undefined}
          icon={Activity}
        />
        <StatCard
          title="Estimated Usage"
          value={formatCost(pickCost(stats.estimatedCosts, stats.estimatedCost))}
          subtitle={historyNote
            ? `${formatCost(pickCost(stats.history.estimatedCosts))} ${historyNote}`
            : modeLabel.name.toLowerCase() + ' estimate'}
          icon={Coins}
        />
      </div>

      {showSources && (
        <Card className="border-border/50 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold">Usage by Client</CardTitle>
              <Link href="/desktop" className="text-xs font-medium text-primary hover:underline">
                Claude Desktop
              </Link>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-3 gap-3">
              {SESSION_SOURCES.map(source => {
                const s = sources[source];
                return (
                  <div key={source} className="rounded-lg border border-border/50 px-4 py-3">
                    <p className="text-xs text-muted-foreground">{SESSION_SOURCE_LABELS[source]}</p>
                    <p className="text-lg font-bold">{formatCost(pickCost(s.estimatedCosts, s.estimatedCost))}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {s.sessions.toLocaleString()} sessions · {formatTokens(s.tokens)} tokens
                    </p>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <MonthlySpend data={stats.dailyModelTokens || []} />

      {/* Charts Row 1 */}
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2">
          <UsageOverTime data={stats.dailyActivity} />
        </div>
        <ModelBreakdown data={stats.modelUsage} />
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2">
          <ActivityHeatmap data={stats.dailyActivity} />
        </div>
        <PeakHours data={stats.hourCounts} />
      </div>

      {/* Recent Sessions */}
      <Card className="border-border/50 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">Recent Sessions</CardTitle>
            <Link
              href="/sessions"
              className="text-xs font-medium text-primary hover:underline"
            >
              View all
            </Link>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="space-y-2">
            {stats.recentSessions.map(session => (
              <Link
                key={session.id}
                href={`/sessions/${session.id}`}
                className="flex items-center justify-between rounded-lg border border-border/50 px-4 py-3 transition-colors hover:bg-accent/50"
              >
                <div className="flex items-center gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{session.title || session.projectName}</span>
                      <SourceBadge source={session.source} />
                      {[...new Set(session.models)].map(m => (
                        <Badge key={m} variant="secondary" className="text-[10px] px-1.5 py-0">
                          {m}
                        </Badge>
                      ))}
                    </div>
                    <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
                      {session.gitBranch && (
                        <span className="flex items-center gap-1">
                          <GitBranch className="h-3 w-3" />
                          {session.gitBranch}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatDuration(session.duration)}
                      </span>
                      <span>{session.messageCount} messages</span>
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs font-medium">{formatCost(pickCost(session.estimatedCosts, session.estimatedCost))}</p>
                  <p className="text-[10px] text-muted-foreground">{timeAgo(session.timestamp)}</p>
                </div>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
