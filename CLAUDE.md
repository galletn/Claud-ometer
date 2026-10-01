# Claud-ometer — Architecture & Development Guide

Local-first Claude Code + Claude Desktop analytics dashboard. Reads `~/.claude/` (and, in live mode, the Claude Desktop data dir) directly — no database, no cloud, no auth.

## Tech Stack

- **Next.js 16** (App Router, Turbopack) + **React 19** + **TypeScript 5**
- **Tailwind CSS v4** (`@tailwindcss/postcss`) — dark theme default (hardcoded `className="dark"` on `<html>`)
- **shadcn/ui** (New York style, neutral base) — components in `src/components/ui/`
- **Lucide React** for icons
- **SWR** for data fetching (simple `fetch` wrapper, no React Query)
- **Recharts 3** for charts (Area, Bar, Pie)
- **date-fns** for date formatting

## Project Structure

```
src/
├── app/
│   ├── layout.tsx              # Root layout, dark theme, sidebar
│   ├── page.tsx                # Overview dashboard (stats, charts)
│   ├── globals.css             # CSS vars for light/dark themes
│   ├── sessions/page.tsx       # Session list with search (URL ?q= param)
│   ├── sessions/[id]/page.tsx  # Session detail with conversation replay
│   ├── projects/page.tsx       # Project grid
│   ├── projects/[id]/page.tsx  # Project detail + sessions
│   ├── desktop/page.tsx        # Claude Desktop: Cowork + Code-tab token usage, connectors
│   ├── costs/page.tsx          # Cost analytics
│   ├── data/page.tsx           # Export/import ZIP management
│   └── api/                    # All routes are force-dynamic (filesystem reads)
│       ├── stats/route.ts      # GET — DashboardStats
│       ├── projects/route.ts   # GET — ProjectInfo[]
│       ├── sessions/route.ts   # GET — SessionInfo[] (?q=, ?projectId=, ?limit=, ?offset=)
│       ├── sessions/[id]/      # GET — SessionDetail (404 if not found)
│       ├── desktop/            # GET — DesktopInfo (Cowork, Code tab, daily tokens, connectors)
│       ├── data-source/        # GET/PUT — toggle live vs imported data
│       ├── export/route.ts     # GET — ZIP download
│       └── import/route.ts     # POST/DELETE — upload/clear imported data
├── components/
│   ├── layout/sidebar.tsx      # Fixed left nav (60px wide)
│   ├── cards/stat-card.tsx     # Reusable stat card
│   ├── charts/                 # Recharts wrappers (usage-over-time, monthly-spend, model-breakdown, desktop-tokens, etc.)
│   ├── source-badge.tsx        # Cowork / Desktop Code badge (renders nothing for plain Claude Code)
│   ├── cost-mode-selector.tsx  # API (default) + legacy modes; put it in every page header that shows cost
│   └── ui/                     # shadcn components (card, badge, separator, tooltip, tabs, etc.)
├── lib/
│   ├── claude-data/
│   │   ├── types.ts            # All interfaces (SessionInfo, SessionDetail, DashboardStats, etc.)
│   │   ├── reader.ts           # JSONL parsing, per-file caches, stats aggregation, search, Cowork discovery
│   │   ├── desktop.ts          # Claude Desktop page data (connectors, daily tokens per client)
│   │   └── data-source.ts      # Live vs imported data toggle
│   ├── hooks.ts                # SWR hooks: useStats, useProjects, useSessions, useSessionDetail
│   ├── format.ts               # formatTokens, formatCost, formatDuration, timeAgo, formatNumber
│   └── utils.ts                # cn() — clsx + tailwind-merge
└── config/
    └── pricing.ts              # Model pricing table + calculateCost + getModelDisplayName/Color
```

## Data Flow

1. Claude Code writes JSONL files to `~/.claude/projects/<projectId>/<sessionId>.jsonl` (subagents one level deeper). Sessions from the Desktop app's Code tab land here too; `entrypoint` tells them apart.
2. Cowork (Desktop local agent mode) sessions live in `<Desktop>/local-agent-mode-sessions/<account>/<org>/local_<id>/`. The reader prefers the VM transcript at `.claude/projects/*/<cliSessionId>.jsonl` (same format as Claude Code) and falls back to `audit.jsonl`. They are grouped into the virtual project `COWORK_PROJECT_ID`. Live mode only.
3. `reader.ts` parses files in 1 MB chunks (`forEachJsonlLine`) and caches results per file on `globalThis`, keyed by mtime+size
4. API routes (`force-dynamic`) call reader functions and return JSON
5. Pages use SWR hooks to fetch from API routes (auto-caching, revalidation on focus)
6. All pages are `'use client'` components

Claude Code deletes transcripts older than `cleanupPeriodDays` (default 30), so JSONL detail only covers recent weeks; older history exists only as aggregates in `stats-cache.json`. Cowork is never in `stats-cache.json`, so supplemental stats count every Cowork message regardless of the cache date.

## Key Types (src/lib/claude-data/types.ts)

- **SessionInfo** — id, projectId, projectName, source (`claude-code` | `claude-desktop` | `cowork`), entrypoint, title (Cowork only), timestamp, duration, messageCount, toolCallCount, tokens, estimatedCost, models[], gitBranch, toolsUsed, compaction
- **SessionDetail** extends SessionInfo + messages: SessionMessageDisplay[]
- **SessionMessageDisplay** — role, content, timestamp, model?, usage?, toolCalls?
- **ProjectInfo** — id, name, path, sessionCount, totalMessages, totalTokens, estimatedCost, models[]
- **DashboardStats** — totals, dailyActivity[], dailyModelTokens[], modelUsage, hourCounts, recentSessions[]
- **CompactionInfo** — compactions, microcompactions, totalTokensSaved, compactionTimestamps[]
- **DashboardStats.sources** — SourceSummary (sessions, tokens, costs) per SessionSource
- **DesktopInfo** — available, dataDir, dailyTokens[], mcpServers[], extensions[] (names only), cowork[], desktopCode[]

## Conventions

### Defensive data access
Session data from JSONL can have missing fields at runtime even though types say otherwise. Always guard array/object properties:
```tsx
const models = session.models || [];
const compaction = session.compaction || { compactions: 0, microcompactions: 0, totalTokensSaved: 0, compactionTimestamps: [] };
```

### Count usage once per assistant turn
Claude Code writes one JSONL line per content block of an assistant turn, each repeating the turn's `usage` (output_tokens grows on later lines). Never sum `message.usage` per line — go through `takeUsage(msg, tracker)` with one tracker per file. Summing per line overcounted ~2.3x.

### Reader caches live on globalThis
Next bundles each API route separately and dev HMR re-evaluates modules, so module-level caches would be per-route and short-lived. Use `caches()`; bump `CACHE_VERSION` whenever parsing logic or `DEFAULT_COST_MODE` changes, or a running server keeps serving stale results.

### Pricing lookups
Always resolve rates with `getModelPricing(model)` (exact alias, then date suffix stripped, then current model of the family), never `MODEL_PRICING[model]` — transcripts use dated IDs like `claude-sonnet-4-5-20250929`. Pass `usage.cache_creation.ephemeral_1h_input_tokens` as the 6th argument of `calculateCostAllModes`; 1-hour writes cost 2x input, 5-minute writes 1.25x. When rates change, update `MODEL_PRICING` from platform.claude.com/docs/en/about-claude/pricing and bump `CACHE_VERSION` in reader.ts.

### Cost modes
`api` is the default and the recommended mode. `conservative` and `subscription` are legacy (still selectable, shown dimmed). Show `<CostModeSelector />` in the header of every page that displays a cost — the mode is per browser origin, so an unlabelled number is ambiguous.

### SWR fetcher throws on non-OK responses
The global fetcher in `hooks.ts` throws on non-2xx so SWR properly surfaces errors instead of setting malformed data.

### URL search params
Use `useSearchParams()` + `router.replace()` to persist filter/search state in the URL. Must wrap in `<Suspense>` for Next.js SSR compatibility.

### Card styling pattern
```tsx
<Card className="border-border/50 shadow-sm">
  <CardHeader className="pb-3">
    <CardTitle className="text-sm font-semibold">Title</CardTitle>
  </CardHeader>
  <CardContent className="pt-0">...</CardContent>
</Card>
```

### Stat card grid
Use `grid grid-cols-N gap-3` with `<Card>` children for stat rows.

### Text sizing
- Page titles: `text-xl font-bold tracking-tight`
- Card titles: `text-sm font-semibold`
- Labels: `text-xs text-muted-foreground`
- Tiny text: `text-[10px]` or `text-[9px]`
- Monospace IDs/branches: `font-mono`

### Colors
- Primary (Claude orange): CSS var `--primary`
- Amber for compaction warnings: `text-amber-600`, `border-amber-300/50`, `bg-amber-50/30`
- Green for savings: `text-green-600`

### Icons
Always use Lucide. Typical sizing: `h-3 w-3` (inline), `h-3.5 w-3.5` (card headers), `h-4 w-4` (buttons/nav).

## Commands

```bash
npm run dev       # Dev server (Turbopack)
npm run build     # Production build
npm start         # Production server
npm run lint      # ESLint
```
