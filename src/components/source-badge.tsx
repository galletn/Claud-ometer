import { Briefcase, Monitor } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { SESSION_SOURCE_LABELS, type SessionSource } from '@/lib/claude-data/types';

const ICONS = { 'claude-desktop': Monitor, cowork: Briefcase } as const;

/** Marks sessions that did not come from the Claude Code CLI/IDE. Renders nothing
 * for plain Claude Code sessions so the common case stays uncluttered. */
export function SourceBadge({ source, className = '' }: { source?: SessionSource; className?: string }) {
  if (!source || source === 'claude-code') return null;
  const Icon = ICONS[source];
  return (
    <Badge variant="outline" className={`gap-1 border-primary/30 text-[10px] px-1.5 py-0 text-primary ${className}`}>
      <Icon className="h-2.5 w-2.5" />
      {SESSION_SOURCE_LABELS[source]}
    </Badge>
  );
}
