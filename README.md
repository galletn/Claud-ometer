# Claud-ometer

A local-first analytics dashboard for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Reads directly from `~/.claude/` to give you full visibility into your usage, costs, sessions, and projects — no cloud, no telemetry, just your data.

> **Fork of the original** [deshraj/Claud-ometer](https://github.com/deshraj/Claud-ometer). This copy adds fixes for missing subagent sessions and corrected model pricing — see [What's changed](#whats-changed-vs-the-original).

![Overview Dashboard](./screenshots/overview.png)

## Features

**Dashboard Overview** — Total sessions, messages, tokens, and estimated costs at a glance. Usage-over-time charts, model breakdown donut, GitHub-style activity heatmap, and peak hours distribution.

**Projects** — See all your Claude Code projects with session counts, token usage, cost estimates, and last activity. Drill into any project to see its sessions and most-used tools.

![Projects](./screenshots/projects.png)

**Sessions** — Browse all sessions with duration, message count, tool calls, token usage, and cost. Compaction events are highlighted in amber so you can see which sessions hit context limits.

![Sessions](./screenshots/sessions.png)

**Session Detail** — Full conversation replay with user prompts and Claude responses, tool call badges, token-per-message counts, and a sidebar with token breakdown, tools used, compaction timeline, and metadata.

![Session Detail](./screenshots/session-detail.png)

**Cost Analytics** — Cost-over-time stacked by model, cost-by-project bar chart, per-model token breakdown, cache efficiency metrics, and a pricing reference table.

![Cost Analytics](./screenshots/costs.png)

**Data Export/Import** — Export all your Claude Code data as a ZIP. Import it on another machine to view the same dashboard. Toggle between live and imported data sources.

![Data Management](./screenshots/data.png)

### What data does it read?

| Source | Path | Contains |
|--------|------|----------|
| Session logs | `~/.claude/projects/<project>/<session>.jsonl` | Every message, tool call, token usage, model, timestamps, compaction events |
| Stats cache | `~/.claude/stats-cache.json` | Pre-computed daily activity, model usage, hourly distribution |
| History | `~/.claude/history.jsonl` | Every prompt you've typed with project context |
| Plans | `~/.claude/plans/*.md` | Implementation plans from sessions |
| Todos | `~/.claude/todos/*.json` | Task lists from sessions |

## Quick Start

```bash
git clone https://github.com/galletn/Claud-ometer.git
cd Claud-ometer
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The dashboard reads from your local `~/.claude/` directory automatically.

## What's changed vs the original

This fork keeps 100% of the upstream functionality and only fixes correctness issues found while using it in production. Nothing was removed.

**1. Subagent sessions are no longer dropped** (`src/lib/claude-data/reader.ts`)
The original only listed the top-level `.jsonl` files in each project directory. Claude Code nests **subagent** session transcripts one level deeper (in a folder named after the parent session's UUID), so all of them were silently excluded from stats, the session list, project counts, and search. Verified on one install this hid **~1.58B cache-read tokens and ~12k messages**. A recursive scan (`listJsonlFilesRecursive`) now walks into those nested folders.

**2. Current-generation models were missing from pricing** (`src/config/pricing.ts`)
Live usage of `claude-opus-5`, `claude-sonnet-5`, and `claude-fable-5-1` fell through to a stale historical entry by family substring, producing silently wrong ("bogus") cost estimates. These current-gen models are now priced explicitly, and `findClosestPricing()` checks them first so a new dated snapshot of the same family matches today's rate instead of an old one. `claude-opus-4-6` was also corrected (it carried Sonnet-era rates).

**3. Fable models got a real identity** (`src/config/pricing.ts`)
`fable`/`mythos` model IDs now map to a distinct "Fable" display name and color, instead of being swallowed into another family.

**4. Pricing Reference table is accurate** (`src/app/costs/page.tsx`, `src/config/pricing.ts`)
The table rendered the first three entries of the pricing dict by chance, which produced a duplicate "Opus, Opus, Sonnet" row and skipped Fable/Haiku. It now uses an explicit `CURRENT_MODEL_IDS` list, so it always shows the current models in order while the superseded dated snapshots stay available for historical cost accuracy.

**5. Next.js bumped** (`package.json`) — `16.1.6` → `^16.2.4`.

## Tech Stack

- **Next.js 15** (App Router, Turbopack)
- **TypeScript**
- **Tailwind CSS v4** + **shadcn/ui**
- **Recharts** for charts
- **SWR** for data fetching
- **Lucide** icons

No database required. Reads `~/.claude/` files directly via Node.js API routes.

## Project Structure

```
src/
├── app/
│   ├── page.tsx                 # Overview dashboard
│   ├── projects/                # Projects list + detail
│   ├── sessions/                # Sessions list + detail
│   ├── costs/                   # Cost analytics
│   ├── data/                    # Export/import management
│   └── api/
│       ├── stats/               # Dashboard stats
│       ├── projects/            # Project data
│       ├── sessions/            # Session list + detail
│       ├── export/              # ZIP export
│       ├── import/              # ZIP import
│       └── data-source/         # Live vs imported toggle
├── components/
│   ├── charts/                  # Recharts components
│   ├── cards/                   # Stat cards
│   └── layout/                  # Sidebar
├── lib/
│   ├── claude-data/
│   │   ├── types.ts             # TypeScript interfaces
│   │   ├── reader.ts            # File parsers + aggregation
│   │   └── data-source.ts       # Live vs imported source
│   ├── hooks.ts                 # SWR hooks
│   └── format.ts                # Number/date formatters
└── config/
    └── pricing.ts               # Model pricing + cost calculator
```

## Data Export/Import

Export your data to share across machines or keep as a backup:

1. Go to the **Data** page in the sidebar
2. Click **Export as ZIP** to download all your Claude Code data
3. On another machine, upload the ZIP via **Import** to view the dashboard with that data
4. Toggle between **Live** (reads ~/.claude/) and **Imported** data at any time

## License

MIT
