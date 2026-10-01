# Claud-ometer

A local-first analytics dashboard for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) and the Claude Desktop app. Reads directly from `~/.claude/` (and, on the live machine, the Claude Desktop data folder) to give you full visibility into your usage, costs, sessions, and projects: no cloud, no telemetry, just your data.

> **Fork of the original** [deshraj/Claud-ometer](https://github.com/deshraj/Claud-ometer). This copy adds Claude Desktop + Cowork support, fixes token counts that were ~2.3x too high, fixes missing subagent sessions, corrects model pricing, and makes repeat page loads fast. See [What's changed](#whats-changed-vs-the-original).

![Overview Dashboard](./screenshots/overview.png)

## Features

**Dashboard Overview**: Total sessions, messages, tokens, and estimated costs at a glance. A **Spend per Month** chart in the selected cost mode (months with missing data are dimmed and explained), usage-over-time charts, model breakdown donut, GitHub-style activity heatmap, and peak hours distribution. Once you have used Claude Desktop, a **Usage by Client** row splits cost, sessions, and tokens across Claude Code, Desktop Code tab, and Cowork.

**Projects**: See all your Claude Code projects with session counts, token usage, cost estimates, and last activity. Drill into any project to see its sessions and most-used tools. All Cowork sessions are grouped under one **Cowork** project.

![Projects](./screenshots/projects.png)

**Sessions**: Browse all sessions with duration, message count, tool calls, token usage, and cost. Compaction events are highlighted in amber so you can see which sessions hit context limits. Sessions from Claude Desktop carry a **Cowork** or **Desktop Code** badge, and Cowork sessions show their Desktop title.

![Sessions](./screenshots/sessions.png)

**Session Detail**: Full conversation replay with user prompts and Claude responses, tool call badges, token-per-message counts, and a sidebar with token breakdown, tools used, compaction timeline, and metadata (including which client ran the session).

![Session Detail](./screenshots/session-detail.png)

**Claude Desktop**: A dedicated page for the Desktop app:

- **Token usage**: daily tokens for Cowork and the Code tab, with 30d / 90d / All ranges, plus total tokens, tool calls, and estimated cost
- **Cowork sessions**: Claude Desktop's local agent mode, with titles, tokens, and cost
- **Code tab sessions**: Claude Code sessions started from the Desktop app
- **Connectors**: names of your local MCP servers and installed Desktop extensions

Regular Claude Desktop **chats** are not included; see [Why Claude Desktop chats are not included](#why-claude-desktop-chats-are-not-included).

**Cost Analytics**: Cost-over-time stacked by model, cost-by-project bar chart, per-model token breakdown, cache efficiency metrics, and a pricing reference table. Costs default to **API Equivalent** (every token at published API rates). The older Conservative and Subscription estimates are still selectable as **legacy** modes. Every page with costs has the cost-mode selector in its header. The choice is saved per browser origin, so `localhost:3000` and another port can show different modes.

![Cost Analytics](./screenshots/costs.png)

**Data Export/Import**: Export all your Claude Code data as a ZIP. Import it on another machine to view the same dashboard. Toggle between live and imported data sources.

![Data Management](./screenshots/data.png)

### What data does it read?

| Source | Path | Contains |
| --- | --- | --- |
| Session logs | `~/.claude/projects/<project>/<session>.jsonl` | Every message, tool call, token usage, model, timestamps, compaction events, client (`entrypoint`) |
| Stats cache | `~/.claude/stats-cache.json` | Pre-computed daily activity, model usage, hourly distribution |
| History | `~/.claude/history.jsonl` | Every prompt you've typed with project context |
| Plans | `~/.claude/plans/*.md` | Implementation plans from sessions |
| Todos | `~/.claude/todos/*.json` | Task lists from sessions |
| Cowork sessions | `<Desktop>/local-agent-mode-sessions/<account>/<org>/local_<id>/` | The session's Claude Code transcript (`.claude/projects/*/<cliSessionId>.jsonl`, falling back to `audit.jsonl`) and `local_<id>.json` with the title |
| Connectors | `<Desktop>/claude_desktop_config.json`, `extensions-installations.json` | MCP server and extension **names only** (commands, env vars and tokens are never read out) |

`<Desktop>` is `%APPDATA%\Claude` on Windows, `~/Library/Application Support/Claude` on macOS, and `~/.config/Claude` on Linux. Claude Desktop sources are only read in **Live** mode. They are not part of exported ZIPs. Desktop **Code tab** sessions live in `~/.claude/projects` and are recognised by their `entrypoint`, so they are exported like any other Claude Code session.

### How far back does the detail go?

Claude Code deletes session transcripts older than `cleanupPeriodDays` (default **30 days**, set in `~/.claude/settings.json`). Older history survives only as the daily aggregates in `stats-cache.json`. The Overview charts use those aggregates for older days and the transcripts for recent ones. Projects, Sessions, and per-session detail can only cover what is still on disk. The Overview totals include the older history as well. They can therefore be higher than the sum of all projects; the stat cards show how much comes from history. To keep more detail, raise `cleanupPeriodDays`.

### Why Claude Desktop chats are not included

The Claude Desktop app is a wrapper around claude.ai. Chats are stored on Anthropic's servers, and the app's local storage holds only interface state. The chat stream doesn't carry token counts either (only a usage-limit event), which is why browser extensions that "track tokens" estimate them from the text. Cowork and the Code tab are different: they run an agent on your machine, and it writes full transcripts with real token usage to disk.

The only local signal that includes chats is Claude Desktop's `plan-usage-history.json`: your 5-hour and 7-day usage as a **percentage of your plan limit**, not tokens. Real per-user chat tokens are available only through the [Claude Enterprise Analytics API](https://platform.claude.com/docs/en/api/admin/analytics) (`product: chat`), which requires an organization key with the `read:analytics` scope. On Team and Enterprise plans, data exports are also Primary Owner only.

Chat support will be revisited when one of these becomes usable without an extension or scraping: usage-based billing exposing personal token or spend data, or an admin-provided route to your own analytics numbers.

## Quick Start

```bash
git clone https://github.com/galletn/Claud-ometer.git
cd Claud-ometer
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The dashboard reads from your local `~/.claude/` directory automatically.

For daily use, prefer a production build: it is several times faster than the dev server at parsing large transcript folders.

```bash
npm run build
npm start
```

### Performance

Transcripts can add up to hundreds of MB (637 MB / 529 sessions on the install this was tuned on). Every file is parsed once and the result is cached in memory until that file's modification time or size changes. After the first load, pages only re-read the files that changed:

| Page | First load after server start | Every load after |
| --- | --- | --- |
| Overview (`/api/stats`) | ~6.5 s | ~0.2 s |
| Projects / Sessions | ~5 s | < 0.2 s |

(Measured on the production build. Search scans transcripts per query and takes a few seconds on a large install.)

## What's changed vs the original

This fork keeps 100% of the upstream functionality and only adds to it or fixes correctness issues found while using it in production. Nothing was removed.

**1. Subagent sessions are no longer dropped** (`src/lib/claude-data/reader.ts`)
The original only listed the top-level `.jsonl` files in each project directory. Claude Code nests **subagent** session transcripts one level deeper (in a folder named after the parent session's UUID), so all of them were silently excluded from stats, the session list, project counts, and search. Verified on one install this hid **~1.58B cache-read tokens and ~12k messages**. A recursive scan (`listJsonlFilesRecursive`) now walks into those nested folders.

**2. Current-generation models were missing from pricing** (`src/config/pricing.ts`)
Live usage of `claude-opus-5`, `claude-sonnet-5`, and `claude-fable-5-1` fell through to a stale historical entry by family substring, producing silently wrong ("bogus") cost estimates. These current-gen models are now priced explicitly, and an unknown ID falls back to the current model of its family instead of an old one. `claude-opus-4-6` was also corrected (it carried Sonnet-era rates). See #10 for the full table update.

**3. Fable models got a real identity** (`src/config/pricing.ts`)
`fable`/`mythos` model IDs now map to a distinct "Fable" display name and color, instead of being swallowed into another family.

**4. Pricing Reference table is accurate** (`src/app/costs/page.tsx`, `src/config/pricing.ts`)
The table rendered the first three entries of the pricing dict by chance, which produced a duplicate "Opus, Opus, Sonnet" row and skipped Fable/Haiku. It now uses an explicit `CURRENT_MODEL_IDS` list, so it always shows the current models in order while the superseded dated snapshots stay available for historical cost accuracy.

**5. Next.js bumped** (`package.json`): `16.1.6` → `^16.2.4`.

**6. Tokens and costs were counted ~2.3x too high** (`src/lib/claude-data/reader.ts`)
Claude Code writes one JSONL line per content block of an assistant turn (thinking, text, each tool call), and every line repeats the turn's `usage`. The original summed every line. Each turn (`message.id`) is now counted once, at its final value (`takeUsage`). Validated against an independent re-computation over 532 sessions: tokens and costs match exactly, and no turn appears in more than one file. Before the fix the same data read **2.25x** too high.

**7. Claude Desktop and Cowork support** (`src/lib/claude-data/reader.ts`, `desktop.ts`, `src/app/desktop/`)
Cowork sessions are read from the Desktop data folder and appear in the Overview, Projects (as one **Cowork** project), Sessions, search, and session detail. They are parsed from the session's own Claude Code transcript rather than `audit.jsonl`, which logs usage before a reply finishes streaming (0.4–1.5% short). Code tab sessions are recognised by `entrypoint`. A new **Desktop** page shows daily token usage per client, both session types, and configured connectors. Cowork activity is always counted in the Overview charts, because `stats-cache.json` never includes it.

**8. Fast repeat loads** (`src/lib/claude-data/reader.ts`)
Every API call used to re-parse every transcript, three times per Overview load. Parsed results are now cached per file (shared across API routes and kept across dev hot-reloads), and files are read in 1 MB chunks instead of one `await` per line. Search checks each file's raw text before parsing it, and scans newest files first.

**9. API Equivalent is the default cost mode** (`src/config/pricing.ts`)
Conservative and Subscription are kept as legacy modes. Every page that shows a cost now shows the mode selector, so a number is never shown without its mode.

**10. Pricing table matches the published API rates** (`src/config/pricing.ts`, checked 2026-10-01 against [platform.claude.com pricing](https://platform.claude.com/docs/en/about-claude/pricing))
Opus 4.5 was priced at the old Opus 4.1 rate ($15/$75 instead of $5/$25), which tripled the cost of all Opus 4.5 history. Opus 5.5 ($4/$20, cache reads $0.20), Opus 4.8/4.7, Sonnet 5.5, Fable 5 and older models now have their own entries instead of a family fallback. Dated snapshot IDs resolve by stripping the date suffix. 1-hour cache writes (most of Claude Code's) are priced at 2x input instead of the 5-minute 1.25x. On the install this was checked on, the all-time API-equivalent total went from $12.5K to $7.2K.

**11. History days in cost charts were ~800x too low** (`src/lib/claude-data/reader.ts`)
`stats-cache.json` stores per-day tokens as input + output only, while its totals include cache tokens. The daily cost estimate divided by all tokens, so in cost-over-time charts the Dec–Feb history showed about $4 instead of $3.3K. Each model's history cost is now spread over its days by input + output share, so the monthly bars add up exactly to the Overview total.

**12. Smaller fixes**: The project detail header showed only the last dash-separated part of the folder name (`Claud-ometer` → "ometer"). It now uses the real project name. Projects whose `~/.claude/projects` folder doesn't exist no longer hide Cowork sessions.

## Tech Stack

- **Next.js 16** (App Router, Turbopack)
- **TypeScript**
- **Tailwind CSS v4** + **shadcn/ui**
- **Recharts** for charts
- **SWR** for data fetching
- **Lucide** icons

No database required. Reads `~/.claude/` and the Claude Desktop folder directly via Node.js API routes.

## Project Structure

```text
src/
├── app/
│   ├── page.tsx                 # Overview dashboard
│   ├── projects/                # Projects list + detail
│   ├── sessions/                # Sessions list + detail
│   ├── desktop/                 # Claude Desktop: token usage, Cowork, Code tab, connectors
│   ├── costs/                   # Cost analytics
│   ├── data/                    # Export/import management
│   └── api/
│       ├── stats/               # Dashboard stats
│       ├── projects/            # Project data
│       ├── sessions/            # Session list + detail
│       ├── desktop/             # Claude Desktop data
│       ├── export/              # ZIP export
│       ├── import/              # ZIP import
│       └── data-source/         # Live vs imported toggle
├── components/
│   ├── charts/                  # Recharts components (incl. desktop-tokens)
│   ├── cards/                   # Stat cards
│   ├── source-badge.tsx         # Cowork / Desktop Code badge
│   └── layout/                  # Sidebar
├── lib/
│   ├── claude-data/
│   │   ├── types.ts             # TypeScript interfaces
│   │   ├── reader.ts            # File parsers, caching, aggregation, Cowork discovery
│   │   ├── desktop.ts           # Claude Desktop daily tokens per client + connectors
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

The ZIP contains `~/.claude/` only: Cowork sessions and connectors stay on the machine they came from.

## License

MIT
