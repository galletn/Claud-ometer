'use client';

import { useCostMode } from '@/lib/cost-mode-context';
import { COST_MODE_LABELS, DEFAULT_COST_MODE, LEGACY_COST_MODES } from '@/config/pricing';
import type { CostMode } from '@/config/pricing';

export function CostModeSelector() {
  const { costMode, setCostMode } = useCostMode();

  const button = (mode: CostMode, legacy: boolean) => (
    <button
      key={mode}
      onClick={() => setCostMode(mode)}
      className={`rounded-md px-2.5 py-1 font-medium transition-colors ${legacy ? 'text-[10px]' : 'text-[11px]'} ${
        costMode === mode
          ? 'bg-background text-foreground shadow-sm'
          : legacy
            ? 'text-muted-foreground/60 hover:text-foreground'
            : 'text-muted-foreground hover:text-foreground'
      }`}
      title={COST_MODE_LABELS[mode].description + (legacy ? ' (legacy)' : '')}
    >
      {COST_MODE_LABELS[mode].name}
    </button>
  );

  return (
    <div className="flex items-center gap-1 rounded-lg bg-muted/50 p-0.5">
      {button(DEFAULT_COST_MODE, false)}
      <span className="ml-1 text-[9px] uppercase tracking-wide text-muted-foreground/60">legacy</span>
      {LEGACY_COST_MODES.map(mode => button(mode, true))}
    </div>
  );
}
