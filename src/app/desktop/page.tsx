'use client';

import { useDesktop } from '@/lib/hooks';
import { useCostMode } from '@/lib/cost-mode-context';
import { CostModeSelector } from '@/components/cost-mode-selector';
import { StatCard } from '@/components/cards/stat-card';
import { DesktopTokensChart } from '@/components/charts/desktop-tokens';
import { formatCost, formatDuration, formatTokens, timeAgo } from '@/lib/format';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Activity, Briefcase, Clock, Monitor, Plug, Wrench, Coins } from 'lucide-react';
import type { SessionInfo } from '@/lib/claude-data/types';
import Link from 'next/link';

function SessionList({ sessions, empty }: { sessions: SessionInfo[]; empty: string }) {
  const { pickCost } = useCostMode();
  if (sessions.length === 0) {
    return <p className="px-5 py-8 text-center text-xs text-muted-foreground">{empty}</p>;
  }
  return (
    <div className="divide-y divide-border/50">
      {sessions.map(session => (
        <Link
          key={session.id}
          href={`/sessions/${session.id}`}
          className="flex items-center justify-between px-5 py-3 transition-colors hover:bg-accent/50"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium">{session.title || session.projectName}</span>
              {[...new Set(session.models || [])].map(m => (
                <Badge key={m} variant="secondary" className="text-[10px] px-1.5 py-0">{m}</Badge>
              ))}
            </div>
            <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {formatDuration(session.duration)}
              </span>
              <span>{session.messageCount} msgs</span>
              <span>{session.toolCallCount} tools</span>
              <span>{formatTokens(session.totalInputTokens + session.totalOutputTokens)} tokens</span>
            </div>
          </div>
          <div className="ml-4 flex-shrink-0 text-right">
            <p className="text-sm font-semibold">{formatCost(pickCost(session.estimatedCosts, session.estimatedCost))}</p>
            <p className="text-[10px] text-muted-foreground">{timeAgo(session.timestamp)}</p>
          </div>
        </Link>
      ))}
    </div>
  );
}

export default function DesktopPage() {
  const { data, isLoading } = useDesktop();
  const { pickCost, label: modeLabel } = useCostMode();

  if (isLoading || !data) {
    return (
      <div className="flex h-[80vh] items-center justify-center">
        <div className="space-y-3 text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading Claude Desktop data...</p>
        </div>
      </div>
    );
  }

  const cowork = data.cowork || [];
  const desktopCode = data.desktopCode || [];
  const desktopSessions = [...cowork, ...desktopCode];
  const desktopCost = desktopSessions.reduce(
    (sum, s) => sum + pickCost(s.estimatedCosts, s.estimatedCost),
    0,
  );
  const ioTokens = desktopSessions.reduce((n, s) => n + s.totalInputTokens + s.totalOutputTokens, 0);
  const cacheTokens = desktopSessions.reduce((n, s) => n + s.totalCacheReadTokens + s.totalCacheWriteTokens, 0);
  const toolCalls = desktopSessions.reduce((n, s) => n + s.toolCallCount, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Claude Desktop</h1>
          <p className="text-sm text-muted-foreground">
            Token usage from Cowork and the Code tab of the Desktop app
          </p>
        </div>
        <CostModeSelector />
      </div>

      {!data.available && (
        <Card className="border-border/50 shadow-sm">
          <CardContent className="p-5 text-sm text-muted-foreground">
            Claude Desktop data is only read in <span className="font-medium text-foreground">Live</span> mode
            on a machine with the Desktop app installed (looked in <span className="font-mono text-xs">{data.dataDir}</span>).
            Cowork sessions are not part of exported ZIPs.
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-4 gap-4">
        <StatCard
          title="Desktop Sessions"
          value={desktopSessions.length.toLocaleString()}
          subtitle={`${cowork.length} Cowork · ${desktopCode.length} Code tab`}
          icon={Monitor}
        />
        <StatCard
          title="Total Tokens"
          value={formatTokens(ioTokens + cacheTokens)}
          subtitle={`${formatTokens(ioTokens)} in/out · ${formatTokens(cacheTokens)} cache`}
          icon={Activity}
        />
        <StatCard
          title="Tool Calls"
          value={toolCalls.toLocaleString()}
          icon={Wrench}
        />
        <StatCard
          title="Estimated Usage"
          value={formatCost(desktopCost)}
          subtitle={modeLabel.name.toLowerCase() + ' estimate'}
          icon={Coins}
        />
      </div>

      <DesktopTokensChart data={data.dailyTokens || []} />

      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 space-y-4">
          <Card className="border-border/50 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-1.5 text-sm font-semibold">
                <Briefcase className="h-3.5 w-3.5" />
                Cowork Sessions
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <SessionList sessions={cowork} empty="No Cowork sessions found." />
            </CardContent>
          </Card>

          <Card className="border-border/50 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-1.5 text-sm font-semibold">
                <Monitor className="h-3.5 w-3.5" />
                Code Tab Sessions
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <SessionList
                sessions={desktopCode.slice(0, 20)}
                empty="No Claude Code sessions started from the Desktop app's Code tab."
              />
            </CardContent>
          </Card>
        </div>

        <Card className="border-border/50 shadow-sm h-fit">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-1.5 text-sm font-semibold">
              <Plug className="h-3.5 w-3.5" />
              Connectors
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">Local MCP servers</p>
              {data.mcpServers.length === 0 ? (
                <p className="text-xs text-muted-foreground/70">None configured</p>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {data.mcpServers.map(name => (
                    <Badge key={name} variant="secondary" className="font-mono text-[10px] px-1.5 py-0">{name}</Badge>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">Desktop extensions</p>
              {data.extensions.length === 0 ? (
                <p className="text-xs text-muted-foreground/70">None installed</p>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {data.extensions.map(name => (
                    <Badge key={name} variant="secondary" className="text-[10px] px-1.5 py-0">{name}</Badge>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
