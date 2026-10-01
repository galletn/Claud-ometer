import fs from 'fs';
import path from 'path';
import os from 'os';
import { calculateCostAllModes, getModelDisplayName, DEFAULT_COST_MODE } from '@/config/pricing';
import { getActiveDataSource, getImportDir } from './data-source';
import type {
  StatsCache,
  HistoryEntry,
  ProjectInfo,
  SessionInfo,
  SessionDetail,
  SessionMessageDisplay,
  DashboardStats,
  DailyActivity,
  DailyModelTokens,
  TokenUsage,
  SessionMessage,
  CostEstimates,
  SessionSource,
  SourceSummary,
} from './types';
import { COWORK_PROJECT_ID } from './types';

function zeroCosts(): CostEstimates {
  return { api: 0, conservative: 0, subscription: 0 };
}

function addCosts(a: CostEstimates, b: CostEstimates): CostEstimates {
  return {
    api: a.api + b.api,
    conservative: a.conservative + b.conservative,
    subscription: a.subscription + b.subscription,
  };
}

function parseJsonlLine(line: string, callback: (msg: SessionMessage) => void): void {
  if (!line.trim()) return;
  try {
    const msg = JSON.parse(line) as SessionMessage;
    // Claude Desktop's local-agent-mode audit.jsonl writes an ISO timestamp
    // under _audit_timestamp instead of the top-level `timestamp` field used
    // by Claude Code. Normalize so the rest of the parser sees one shape.
    const raw = msg as unknown as Record<string, unknown>;
    if (!msg.timestamp && typeof raw._audit_timestamp === 'string') {
      msg.timestamp = raw._audit_timestamp;
    }
    callback(msg);
  } catch { /* skip malformed line */ }
}

/** Streams a JSONL file in 1 MB chunks and splits lines synchronously.
 * `for await` over readline awaited once per line; inside a Next route
 * handler (AsyncLocalStorage on every await) that made a cold load of 637 MB
 * ~4x slower than the same code in plain Node. */
async function forEachJsonlLine(filePath: string, callback: (msg: SessionMessage) => void): Promise<void> {
  let rest = '';
  for await (const chunk of fs.createReadStream(filePath, { encoding: 'utf-8', highWaterMark: 1 << 20 })) {
    const lines = (rest + chunk).split('\n');
    rest = lines.pop() ?? '';
    for (const line of lines) parseJsonlLine(line, callback);
  }
  parseJsonlLine(rest, callback);
}

interface UsageTokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Part of cacheWrite that went to the 1-hour cache (priced 2x input, not 1.25x). */
  cacheWrite1h: number;
}

/** Tracks which assistant turns have already been counted within one file. */
type UsageTracker = Map<string, UsageTokens>;

/** Token usage on an assistant line that has not been counted yet.
 *
 * Claude Code (and Cowork) write one JSONL line per content block of an
 * assistant turn — thinking, text, each tool_use — and every line repeats the
 * turn's `usage`, with output_tokens growing as later blocks stream in. Summing
 * every line overcounted tokens and cost ~2.3x (measured 2026-10-01 on 40
 * recent sessions). Each `message.id` is counted once at its largest value by
 * returning only the increase over what was already counted for that id.
 * `isNewTurn` is true on the first line of a turn. Returns null when the line
 * has no usage. */
function takeUsage(msg: SessionMessage, seen: UsageTracker): { tokens: UsageTokens; isNewTurn: boolean } | null {
  const usage = msg.message?.usage;
  if (!usage) return null;
  const current: UsageTokens = {
    input: usage.input_tokens || 0,
    output: usage.output_tokens || 0,
    cacheRead: usage.cache_read_input_tokens || 0,
    cacheWrite: usage.cache_creation_input_tokens || 0,
    cacheWrite1h: usage.cache_creation?.ephemeral_1h_input_tokens || 0,
  };
  const id = msg.message?.id;
  if (!id) return { tokens: current, isNewTurn: true };

  const prev = seen.get(id);
  if (!prev) {
    seen.set(id, current);
    return { tokens: current, isNewTurn: true };
  }
  seen.set(id, {
    input: Math.max(prev.input, current.input),
    output: Math.max(prev.output, current.output),
    cacheRead: Math.max(prev.cacheRead, current.cacheRead),
    cacheWrite: Math.max(prev.cacheWrite, current.cacheWrite),
    cacheWrite1h: Math.max(prev.cacheWrite1h, current.cacheWrite1h),
  });
  return {
    tokens: {
      input: Math.max(0, current.input - prev.input),
      output: Math.max(0, current.output - prev.output),
      cacheRead: Math.max(0, current.cacheRead - prev.cacheRead),
      cacheWrite: Math.max(0, current.cacheWrite - prev.cacheWrite),
      cacheWrite1h: Math.max(0, current.cacheWrite1h - prev.cacheWrite1h),
    },
    isNewTurn: false,
  };
}

function sumTokens(t: UsageTokens): number {
  return t.input + t.output + t.cacheRead + t.cacheWrite;
}

function costOf(model: string, t: UsageTokens): CostEstimates {
  return calculateCostAllModes(model, t.input, t.output, t.cacheWrite, t.cacheRead, t.cacheWrite1h);
}

/** Classifies a Claude Code session by the client that launched it. Sessions
 * started from the Claude Desktop app's Code tab are written to the same
 * `~/.claude/projects` tree; only the `entrypoint` field tells them apart. */
function sourceFromEntrypoint(entrypoint: string): SessionSource {
  return /desktop/i.test(entrypoint) ? 'claude-desktop' : 'claude-code';
}

function getClaudeDir(): string {
  if (getActiveDataSource() === 'imported') {
    return path.join(getImportDir(), 'claude-data');
  }
  return path.join(os.homedir(), '.claude');
}

function getProjectsDir(): string {
  return path.join(getClaudeDir(), 'projects');
}

/** True when the current data source is live (not an imported ZIP) — we only read local-app dirs then. */
function isLiveSource(): boolean {
  return getActiveDataSource() === 'live';
}

/** On-disk layout for Claude Desktop (Electron), by platform. Only read in live mode. */
export function getClaudeDesktopDir(): string {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Claude');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Claude');
  }
  return path.join(os.homedir(), '.config', 'Claude');
}

function listSubdirs(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name);
  } catch {
    return [];
  }
}

interface CoworkSessionFile {
  /** Session UUID without Claude Desktop's `local_` prefix. */
  id: string;
  /** The session's Claude Code transcript, or audit.jsonl when there is none. */
  transcriptPath: string;
  metaPath: string;
}

/** Cowork runs Claude Code inside a VM whose `~/.claude` is the session dir's
 * `.claude/`, so the session's own transcript sits at
 * `.claude/projects/<cwd>/<cliSessionId>.jsonl`. Prefer it over audit.jsonl:
 * both hold the same turns, but audit.jsonl logs usage when a reply starts
 * streaming, so its output_tokens run short (0.4–1.5% fewer tokens, measured
 * 2026-10-01 on 3 sessions). */
function findCoworkTranscript(sessionDir: string, metaPath: string): string | null {
  let cliSessionId = '';
  try {
    cliSessionId = (JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as { cliSessionId?: string }).cliSessionId || '';
  } catch { /* no metadata */ }
  if (!cliSessionId) return null;
  const projectsDir = path.join(sessionDir, '.claude', 'projects');
  for (const cwdDir of listSubdirs(projectsDir)) {
    const candidate = path.join(projectsDir, cwdDir, `${cliSessionId}.jsonl`);
    try {
      if (fs.statSync(candidate).size > 0) return candidate;
    } catch { /* not in this dir */ }
  }
  return null;
}

/** Claude Desktop's local agent mode (Cowork) sessions. They live at a fixed depth:
 *   local-agent-mode-sessions/<accountId>/<orgId>/local_<uuid>/audit.jsonl
 * next to a `local_<uuid>.json` with the title and model. Only that depth is
 * read: session dirs also hold `outputs/` and `uploads/` (user files of any
 * size) and plugin caches, none of which need walking. Returns [] when the
 * dir is missing or the data source is an imported ZIP. */
function discoverCoworkSessions(): CoworkSessionFile[] {
  if (!isLiveSource()) return [];
  const root = path.join(getClaudeDesktopDir(), 'local-agent-mode-sessions');
  const found: CoworkSessionFile[] = [];
  for (const account of listSubdirs(root)) {
    for (const org of listSubdirs(path.join(root, account))) {
      const orgDir = path.join(root, account, org);
      for (const name of listSubdirs(orgDir)) {
        if (!name.startsWith('local_')) continue;
        const auditPath = path.join(orgDir, name, 'audit.jsonl');
        try {
          if (fs.statSync(auditPath).size === 0) continue;
        } catch {
          continue; // session created but never ran
        }
        const metaPath = path.join(orgDir, `${name}.json`);
        found.push({
          id: name.slice('local_'.length),
          transcriptPath: findCoworkTranscript(path.join(orgDir, name), metaPath) || auditPath,
          metaPath,
        });
      }
    }
  }
  return found;
}

/** Title shown in the Desktop sidebar, falling back to the first prompt. */
function readCoworkTitle(metaPath: string): string {
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as { title?: string; initialMessage?: string };
    const title = meta.title || meta.initialMessage || '';
    return title.length > 120 ? title.slice(0, 117) + '...' : title;
  } catch {
    return '';
  }
}

const COWORK_PROJECT_NAME = 'Cowork';

function parseCoworkSession(file: CoworkSessionFile): Promise<SessionInfo | null> {
  return getSessionInfo(file.transcriptPath, COWORK_PROJECT_ID, COWORK_PROJECT_NAME, {
    source: 'cowork',
    sessionIdOverride: file.id,
    title: readCoworkTitle(file.metaPath),
  });
}

/** All Cowork sessions, newest first (parsed through the per-file cache). */
async function getCoworkSessions(): Promise<SessionInfo[]> {
  const sessions = await Promise.all(discoverCoworkSessions().map(parseCoworkSession));
  return sessions.filter((s): s is SessionInfo => s !== null).sort(byNewest);
}

/** Recursively collect every .jsonl session file under a project directory.
 * Claude Code nests subagent-session transcripts one level deeper than the
 * top-level session files (in a directory named after the parent session's
 * UUID), so a shallow readdirSync silently drops every subagent session —
 * verified 2026-09-24 as ~1.58B cache-read tokens and ~12k messages missing
 * across this install alone. Returns full paths, not bare filenames. */
function listJsonlFilesRecursive(dirPath: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dirPath)) {
    const full = path.join(dirPath, entry);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue; // broken symlink or race with concurrent deletion
    }
    if (stat.isDirectory()) {
      results.push(...listJsonlFilesRecursive(full));
    } else if (entry.endsWith('.jsonl')) {
      results.push(full);
    }
  }
  return results;
}

export function getStatsCache(): StatsCache | null {
  const statsPath = path.join(getClaudeDir(), 'stats-cache.json');
  if (!fs.existsSync(statsPath)) return null;
  return JSON.parse(fs.readFileSync(statsPath, 'utf-8'));
}

export function getHistory(): HistoryEntry[] {
  const historyPath = path.join(getClaudeDir(), 'history.jsonl');
  if (!fs.existsSync(historyPath)) return [];
  const lines = fs.readFileSync(historyPath, 'utf-8').split('\n').filter(Boolean);
  return lines.map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean) as HistoryEntry[];
}

function projectIdToName(id: string): string {
  const decoded = id.replace(/^-/, '/').replace(/-/g, '/');
  const parts = decoded.split('/');
  return parts[parts.length - 1] || id;
}

function projectIdToFullPath(id: string): string {
  return id.replace(/^-/, '/').replace(/-/g, '/');
}

function extractCwdFromSession(filePath: string): string | null {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(8192); // Read first 8KB, enough for first few lines
    const bytesRead = fs.readSync(fd, buffer, 0, 8192, 0);
    fs.closeSync(fd);
    const text = buffer.toString('utf-8', 0, bytesRead);
    const lines = text.split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        if (msg.cwd) return msg.cwd;
      } catch { /* skip partial line */ }
    }
  } catch { /* skip */ }
  return null;
}

// --- Per-file parse cache ---
// Every API call used to re-read every JSONL file (three full passes per
// /api/stats: projects, recent sessions, supplemental stats; ~44s cold on 529
// sessions). Parsed results are now kept per file and reused until its mtime
// or size changes, so a reload costs one stat() per file plus a re-parse of
// whatever changed.
//
// The caches live on globalThis, not in module scope: Next bundles each API
// route separately, so module-level Maps gave every route its own cold cache,
// and dev-mode HMR wiped them on every edit. Bump CACHE_VERSION whenever
// parsing logic changes so a long-running dev server drops stale results.

const CACHE_VERSION = 4;
/** Directory scans are reused this long so one request (or a burst of SWR revalidations) scans once. */
const DIR_SCAN_TTL_MS = 2_000;

interface ReaderCaches {
  version: number;
  sessions: Map<string, { sig: string; info: SessionInfo }>;
  supplements: Map<string, { sig: string; data: FileSupplement }>;
  dirScan: { root: string; ts: number; dirs: ProjectDir[] } | null;
}

function caches(): ReaderCaches {
  const g = globalThis as typeof globalThis & { __claudometerReader?: ReaderCaches };
  if (!g.__claudometerReader || g.__claudometerReader.version !== CACHE_VERSION) {
    g.__claudometerReader = { version: CACHE_VERSION, sessions: new Map(), supplements: new Map(), dirScan: null };
  }
  return g.__claudometerReader;
}

function fileSignature(filePath: string): string | null {
  try {
    const st = fs.statSync(filePath);
    return `${st.mtimeMs}:${st.size}`;
  } catch {
    return null; // deleted between listing and parsing
  }
}

type ParseOptions = { source?: SessionSource; sessionIdOverride?: string; title?: string };

async function getSessionInfo(
  filePath: string,
  projectId: string,
  projectName: string,
  options: ParseOptions = {},
): Promise<SessionInfo | null> {
  const fileSig = fileSignature(filePath);
  if (!fileSig) return null;
  const sig = `${fileSig}:${projectName}:${options.title || ''}`;
  const cache = caches().sessions;
  const hit = cache.get(filePath);
  if (hit && hit.sig === sig) return hit.info;
  const info = await parseSessionFile(filePath, projectId, projectName, options);
  cache.set(filePath, { sig, info });
  return info;
}

interface ProjectDir {
  id: string;
  name: string;
  fullPath: string;
  files: string[];
}

function readProjectDir(projectId: string): ProjectDir | null {
  const projectPath = path.join(getProjectsDir(), projectId);
  try {
    if (!fs.statSync(projectPath).isDirectory()) return null;
  } catch {
    return null;
  }
  const files = listJsonlFilesRecursive(projectPath);
  if (files.length === 0) return null;
  const cwd = extractCwdFromSession(files[0]);
  return {
    id: projectId,
    name: cwd ? path.basename(cwd) : projectIdToName(projectId),
    fullPath: cwd || projectIdToFullPath(projectId),
    files,
  };
}

function listProjectDirs(): ProjectDir[] {
  const projectsDir = getProjectsDir();
  const c = caches();
  if (c.dirScan && c.dirScan.root === projectsDir && Date.now() - c.dirScan.ts < DIR_SCAN_TTL_MS) {
    return c.dirScan.dirs;
  }
  const dirs = fs.existsSync(projectsDir)
    ? fs.readdirSync(projectsDir).map(readProjectDir).filter((d): d is ProjectDir => d !== null)
    : [];
  c.dirScan = { root: projectsDir, ts: Date.now(), dirs };
  return dirs;
}

async function getProjectDirSessions(dir: ProjectDir): Promise<SessionInfo[]> {
  const sessions: SessionInfo[] = [];
  for (const filePath of dir.files) {
    const s = await getSessionInfo(filePath, dir.id, dir.name);
    if (s) sessions.push(s);
  }
  return sessions;
}

const byNewest = (a: SessionInfo, b: SessionInfo) => b.timestamp.localeCompare(a.timestamp);

/** Every session from every source (Claude Code + Cowork), newest first. */
async function getAllSessions(): Promise<SessionInfo[]> {
  const all: SessionInfo[] = [];
  for (const dir of listProjectDirs()) all.push(...await getProjectDirSessions(dir));
  all.push(...await getCoworkSessions());
  return all.sort(byNewest);
}

function sessionTokens(s: SessionInfo): number {
  return s.totalInputTokens + s.totalOutputTokens + s.totalCacheReadTokens + s.totalCacheWriteTokens;
}

function sessionEnd(s: SessionInfo): string {
  const t = new Date(s.timestamp).getTime() + (s.duration || 0);
  return Number.isNaN(t) ? s.timestamp : new Date(t).toISOString();
}

function summarizeProject(id: string, name: string, projectPath: string, sessions: SessionInfo[]): ProjectInfo {
  let estimatedCosts = zeroCosts();
  let lastActive = '';
  const models = new Set<string>();
  for (const s of sessions) {
    estimatedCosts = addCosts(estimatedCosts, s.estimatedCosts);
    for (const m of s.models) models.add(m);
    const end = sessionEnd(s);
    if (end > lastActive) lastActive = end;
  }
  return {
    id,
    name,
    path: projectPath,
    sessionCount: sessions.length,
    totalMessages: sessions.reduce((n, s) => n + s.messageCount, 0),
    totalTokens: sessions.reduce((n, s) => n + sessionTokens(s), 0),
    estimatedCost: estimatedCosts[DEFAULT_COST_MODE],
    estimatedCosts,
    lastActive,
    models: Array.from(models),
  };
}

export async function getProjects(): Promise<ProjectInfo[]> {
  const projects: ProjectInfo[] = [];
  for (const dir of listProjectDirs()) {
    projects.push(summarizeProject(dir.id, dir.name, dir.fullPath, await getProjectDirSessions(dir)));
  }

  // Cowork sessions have no project dir; group them into one virtual project.
  const cowork = await getCoworkSessions();
  if (cowork.length > 0) {
    projects.push(summarizeProject(
      COWORK_PROJECT_ID,
      COWORK_PROJECT_NAME,
      path.join(getClaudeDesktopDir(), 'local-agent-mode-sessions'),
      cowork,
    ));
  }

  return projects.sort((a, b) => b.lastActive.localeCompare(a.lastActive));
}

export async function getProjectSessions(projectId: string): Promise<SessionInfo[]> {
  if (projectId === COWORK_PROJECT_ID) return getCoworkSessions();
  const dir = readProjectDir(projectId);
  if (!dir) return [];
  return (await getProjectDirSessions(dir)).sort(byNewest);
}

export async function getSessions(limit = 50, offset = 0): Promise<SessionInfo[]> {
  return (await getAllSessions()).slice(offset, offset + limit);
}

export async function getSessionsBySource(source: SessionSource): Promise<SessionInfo[]> {
  if (source === 'cowork') return getCoworkSessions();
  return (await getAllSessions()).filter(s => s.source === source);
}

/** Tokens and cost per day and model for one client, from every message in
 * its transcripts (dated by message, so a session spanning midnight splits). */
export async function getDailyTokensBySource(source: SessionSource): Promise<DailyModelTokens[]> {
  const files: string[] = [];
  if (source === 'cowork') {
    files.push(...discoverCoworkSessions().map(f => f.transcriptPath));
  } else {
    for (const dir of listProjectDirs()) {
      for (const filePath of dir.files) {
        const s = await getSessionInfo(filePath, dir.id, dir.name);
        if (s?.source === source) files.push(filePath);
      }
    }
  }

  const tokens = new Map<string, Record<string, number>>();
  const costs = new Map<string, Record<string, CostEstimates>>();
  for (const filePath of files) {
    const f = await getFileSupplement({ filePath, skipThrough: '' });
    if (!f) continue;
    for (const [date, byModel] of Object.entries(f.dailyModelTokens)) {
      const day = tokens.get(date) || {};
      for (const [model, n] of Object.entries(byModel)) day[model] = (day[model] || 0) + n;
      tokens.set(date, day);
    }
    for (const [date, byModel] of Object.entries(f.dailyModelCosts)) {
      const day = costs.get(date) || {};
      for (const [model, c] of Object.entries(byModel)) day[model] = day[model] ? addCosts(day[model], c) : { ...c };
      costs.set(date, day);
    }
  }
  return Array.from(tokens.entries())
    .map(([date, tokensByModel]) => ({ date, tokensByModel, costsByModel: costs.get(date) || {} }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Session count, tokens and cost per client (Claude Code / Desktop Code tab / Cowork). */
export async function getSourceBreakdown(): Promise<Record<SessionSource, SourceSummary>> {
  const empty = (): SourceSummary => ({ sessions: 0, tokens: 0, estimatedCost: 0, estimatedCosts: zeroCosts() });
  const out: Record<SessionSource, SourceSummary> = { 'claude-code': empty(), 'claude-desktop': empty(), cowork: empty() };
  for (const s of await getAllSessions()) {
    const b = out[s.source] || out['claude-code'];
    b.sessions++;
    b.tokens += sessionTokens(s);
    b.estimatedCosts = addCosts(b.estimatedCosts, s.estimatedCosts);
    b.estimatedCost = b.estimatedCosts[DEFAULT_COST_MODE];
  }
  return out;
}

async function parseSessionFile(
  filePath: string,
  projectId: string,
  projectName: string,
  options: ParseOptions = {},
): Promise<SessionInfo> {
  // Cowork audit.jsonl is always named `audit.jsonl`, so callers pass the real
  // session id through the override. Claude Code callers leave it undefined.
  const sessionId = options.sessionIdOverride || path.basename(filePath, '.jsonl');

  let firstTimestamp = '';
  let lastTimestamp = '';
  let userMessageCount = 0;
  let assistantMessageCount = 0;
  let toolCallCount = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalCacheWriteTokens = 0;
  let estimatedCosts = zeroCosts();
  let gitBranch = '';
  let cwd = '';
  let version = '';
  let entrypoint = '';
  const modelsSet = new Set<string>();
  const toolsUsed: Record<string, number> = {};
  const usageSeen: UsageTracker = new Map();

  // Compaction tracking
  let compactions = 0;
  let microcompactions = 0;
  let totalTokensSaved = 0;
  const compactionTimestamps: string[] = [];

  await forEachJsonlLine(filePath, (msg) => {
    if (msg.timestamp) {
      if (!firstTimestamp) firstTimestamp = msg.timestamp;
      lastTimestamp = msg.timestamp;
    }
    if (msg.gitBranch && !gitBranch) gitBranch = msg.gitBranch;
    if (msg.cwd && !cwd) cwd = msg.cwd;
    if (msg.version && !version) version = msg.version;
    if (msg.entrypoint && !entrypoint) entrypoint = msg.entrypoint;

    // Track compaction events
    if (msg.compactMetadata) {
      compactions++;
      if (msg.timestamp) compactionTimestamps.push(msg.timestamp);
    }
    if (msg.microcompactMetadata) {
      microcompactions++;
      totalTokensSaved += msg.microcompactMetadata.tokensSaved || 0;
      if (msg.timestamp) compactionTimestamps.push(msg.timestamp);
    }

    if (msg.type === 'user') {
      if (msg.message?.role === 'user' && typeof msg.message.content === 'string') {
        userMessageCount++;
      } else if (msg.message?.role === 'user') {
        userMessageCount++;
      }
    }
    if (msg.type === 'assistant') {
      assistantMessageCount++;
      const model = msg.message?.model || '';
      if (model) modelsSet.add(model);
      const usage = takeUsage(msg, usageSeen);
      if (usage) {
        totalInputTokens += usage.tokens.input;
        totalOutputTokens += usage.tokens.output;
        totalCacheReadTokens += usage.tokens.cacheRead;
        totalCacheWriteTokens += usage.tokens.cacheWrite;
        estimatedCosts = addCosts(estimatedCosts, costOf(model, usage.tokens));
      }
      const content = msg.message?.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          if (c && typeof c === 'object' && 'type' in c && c.type === 'tool_use') {
            toolCallCount++;
            const name = ('name' in c ? c.name : 'unknown') as string;
            toolsUsed[name] = (toolsUsed[name] || 0) + 1;
          }
        }
      }
    }
  });

  const duration = firstTimestamp && lastTimestamp
    ? new Date(lastTimestamp).getTime() - new Date(firstTimestamp).getTime()
    : 0;

  const models = Array.from(modelsSet);

  return {
    id: sessionId,
    projectId,
    projectName,
    source: options.source || sourceFromEntrypoint(entrypoint),
    entrypoint,
    title: options.title || '',
    timestamp: firstTimestamp || new Date().toISOString(),
    duration,
    messageCount: userMessageCount + assistantMessageCount,
    userMessageCount,
    assistantMessageCount,
    toolCallCount,
    totalInputTokens,
    totalOutputTokens,
    totalCacheReadTokens,
    totalCacheWriteTokens,
    estimatedCost: estimatedCosts[DEFAULT_COST_MODE],
    estimatedCosts,
    model: models[0] || 'unknown',
    models: models.map(getModelDisplayName),
    gitBranch,
    cwd,
    version,
    toolsUsed,
    compaction: {
      compactions,
      microcompactions,
      totalTokensSaved,
      compactionTimestamps,
    },
  };
}

export async function getSessionDetail(sessionId: string): Promise<SessionDetail | null> {
  // Cowork sessions live outside getProjectsDir(), under the Claude Desktop data dir.
  const cowork = discoverCoworkSessions().find(f => f.id === sessionId);
  if (cowork) {
    const sessionInfo = await parseCoworkSession(cowork);
    if (!sessionInfo) return null;
    return { ...sessionInfo, messages: await readMessages(cowork.transcriptPath) };
  }

  if (!fs.existsSync(getProjectsDir())) return null;
  for (const entry of fs.readdirSync(getProjectsDir())) {
    const dir = readProjectDir(entry);
    const filePath = dir?.files.find(f => path.basename(f, '.jsonl') === sessionId);
    if (!dir || !filePath) continue;

    const sessionInfo = await getSessionInfo(filePath, dir.id, dir.name);
    if (!sessionInfo) return null;
    return { ...sessionInfo, messages: await readMessages(filePath) };
  }

  return null;
}

/** Display-ready conversation for one session file. Claude Code and Cowork share the record schema. */
async function readMessages(filePath: string): Promise<SessionMessageDisplay[]> {
  const out: SessionMessageDisplay[] = [];
  await forEachJsonlLine(filePath, (msg) => {
    if (msg.type === 'user' && msg.message?.role === 'user') {
      const content = msg.message.content;
      let text = '';
      if (typeof content === 'string') {
        text = content;
      } else if (Array.isArray(content)) {
        text = content
          .map((c: Record<string, unknown>) => {
            if (c.type === 'text') return c.text as string;
            if (c.type === 'tool_result') return '[Tool Result]';
            return '';
          })
          .filter(Boolean)
          .join('\n');
      }
      if (text && !text.startsWith('[Tool Result]')) {
        out.push({ role: 'user', content: text, timestamp: msg.timestamp });
      }
    }
    if (msg.type === 'assistant' && msg.message?.content) {
      const content = msg.message.content;
      const toolCalls: { name: string; id: string }[] = [];
      let text = '';
      if (Array.isArray(content)) {
        for (const c of content) {
          if (c && typeof c === 'object') {
            if ('type' in c && c.type === 'text' && 'text' in c) {
              text += (c.text as string) + '\n';
            }
            if ('type' in c && c.type === 'tool_use' && 'name' in c) {
              toolCalls.push({ name: c.name as string, id: (c.id as string) || '' });
            }
          }
        }
      }
      if (text.trim() || toolCalls.length > 0) {
        out.push({
          role: 'assistant',
          content: text.trim() || `[Used ${toolCalls.length} tool(s): ${toolCalls.map(t => t.name).join(', ')}]`,
          timestamp: msg.timestamp,
          model: msg.message.model,
          usage: msg.message.usage as TokenUsage | undefined,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        });
      }
    }
  });
  return out;
}

function hasTextMatch(content: unknown, lowerQuery: string): boolean {
  if (typeof content === 'string') return content.toLowerCase().includes(lowerQuery);
  if (!Array.isArray(content)) return false;
  return content.some(c =>
    c && typeof c === 'object' && 'type' in c && c.type === 'text' && 'text' in c &&
    typeof c.text === 'string' && c.text.toLowerCase().includes(lowerQuery));
}

/** Case-insensitive regex for a cheap raw-text prefilter, or null when the
 * query contains characters JSON escapes (quotes, backslashes) and so may not
 * appear verbatim in the file. A raw hit is only a candidate: it can also come
 * from tool output or JSON keys, so the parsed check below has the final say. */
function rawPrefilter(query: string): RegExp | null {
  if (/["\\\u0000-\u001f]/.test(query)) return null;
  return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
}

/** True if any user prompt or assistant text in the file contains the query. */
async function sessionFileMatches(filePath: string, lowerQuery: string, prefilter: RegExp | null): Promise<boolean> {
  if (prefilter) {
    try {
      if (!prefilter.test(fs.readFileSync(filePath, 'utf-8'))) return false;
    } catch {
      return false;
    }
  }
  let hasMatch = false;
  await forEachJsonlLine(filePath, (msg) => {
    if (hasMatch) return;
    if (msg.type === 'user' && msg.message?.role === 'user') {
      hasMatch = hasTextMatch(msg.message.content, lowerQuery);
    } else if (msg.type === 'assistant' && Array.isArray(msg.message?.content)) {
      hasMatch = hasTextMatch(msg.message.content, lowerQuery);
    }
  });
  return hasMatch;
}

export async function searchSessions(query: string, limit = 50): Promise<SessionInfo[]> {
  if (!query.trim()) return getSessions(limit, 0);

  const lowerQuery = query.toLowerCase();
  const prefilter = rawPrefilter(query);
  const matchingSessions: SessionInfo[] = [];

  for (const file of discoverCoworkSessions()) {
    // Cowork titles are generated summaries — match them too, not just the transcript.
    const s = await parseCoworkSession(file);
    if (!s) continue;
    if (s.title.toLowerCase().includes(lowerQuery) || await sessionFileMatches(file.transcriptPath, lowerQuery, prefilter)) {
      matchingSessions.push(s);
    }
  }

  // Newest files first, stopping at `limit` matches: results are newest-first
  // anyway, and a common term no longer forces a pass over every transcript.
  const candidates = listProjectDirs()
    .flatMap(dir => dir.files.map(filePath => ({ dir, filePath, mtime: fs.statSync(filePath).mtimeMs })))
    .sort((a, b) => b.mtime - a.mtime);
  for (const { dir, filePath } of candidates) {
    if (matchingSessions.length >= limit * 2) break; // headroom: mtime order ≈ start-time order
    if (!await sessionFileMatches(filePath, lowerQuery, prefilter)) continue;
    const s = await getSessionInfo(filePath, dir.id, dir.name);
    if (s) matchingSessions.push(s);
  }

  return matchingSessions.sort(byNewest).slice(0, limit);
}

// --- Supplemental stats: bridge stale stats-cache.json with fresh JSONL data ---

interface SupplementalModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  estimatedCosts: CostEstimates;
}

interface SupplementalStats {
  dailyActivity: DailyActivity[];
  dailyModelTokens: DailyModelTokens[];
  modelUsage: Record<string, SupplementalModelUsage>;
  hourCounts: Record<string, number>;
  totalSessions: number;
  totalMessages: number;
  totalTokens: number;
  estimatedCosts: CostEstimates;
}

/** One file's contribution to the supplemental stats. Cached per file. */
interface FileSupplement {
  counted: boolean;
  firstQualifyingDate: string;
  messages: number;
  tokens: number;
  costs: CostEstimates;
  daily: Record<string, { messageCount: number; toolCallCount: number }>;
  dailyModelTokens: Record<string, Record<string, number>>;
  dailyModelCosts: Record<string, Record<string, CostEstimates>>;
  modelUsage: Record<string, SupplementalModelUsage>;
  hourCounts: Record<string, number>;
}

interface SupplementalFile {
  filePath: string;
  /** Messages on or before this date are already in stats-cache.json. '' = count everything. */
  skipThrough: string;
}

function getRecentSessionFiles(afterDate: string): SupplementalFile[] {
  const cutoff = afterDate ? new Date(afterDate + 'T23:59:59Z').getTime() : 0;
  const files: SupplementalFile[] = [];

  for (const dir of listProjectDirs()) {
    for (const filePath of dir.files) {
      try {
        if (fs.statSync(filePath).mtimeMs > cutoff) files.push({ filePath, skipThrough: afterDate });
      } catch { /* deleted mid-scan */ }
    }
  }

  // stats-cache.json is written by Claude Code and never includes Cowork, so
  // every Cowork message is counted regardless of the cache boundary date.
  for (const file of discoverCoworkSessions()) {
    files.push({ filePath: file.transcriptPath, skipThrough: '' });
  }

  return files;
}

async function computeFileSupplement(filePath: string, skipThrough: string): Promise<FileSupplement> {
  const r: FileSupplement = {
    counted: false,
    firstQualifyingDate: '',
    messages: 0,
    tokens: 0,
    costs: zeroCosts(),
    daily: {},
    dailyModelTokens: {},
    dailyModelCosts: {},
    modelUsage: {},
    hourCounts: {},
  };
  const usageSeen: UsageTracker = new Map();

  await forEachJsonlLine(filePath, (msg) => {
    if (!msg.timestamp) return;
    const msgDate = msg.timestamp.slice(0, 10);
    if (skipThrough && msgDate <= skipThrough) return;

    if (!r.counted) {
      r.counted = true;
      r.firstQualifyingDate = msgDate;
    }

    if (msg.type === 'user' || msg.type === 'assistant') {
      r.messages++;
      const day = (r.daily[msgDate] ||= { messageCount: 0, toolCallCount: 0 });
      day.messageCount++;
    }
    if (msg.type !== 'assistant') return;

    const model = msg.message?.model || '';
    const usage = takeUsage(msg, usageSeen);
    if (usage) {
      const tokens = sumTokens(usage.tokens);
      const costs = costOf(model, usage.tokens);
      r.tokens += tokens;
      r.costs = addCosts(r.costs, costs);

      if (model) {
        const mu = (r.modelUsage[model] ||= { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, estimatedCosts: zeroCosts() });
        mu.inputTokens += usage.tokens.input;
        mu.outputTokens += usage.tokens.output;
        mu.cacheReadInputTokens += usage.tokens.cacheRead;
        mu.cacheCreationInputTokens += usage.tokens.cacheWrite;
        mu.estimatedCosts = addCosts(mu.estimatedCosts, costs);

        const dayTokens = (r.dailyModelTokens[msgDate] ||= {});
        dayTokens[model] = (dayTokens[model] || 0) + tokens;
        const dayCosts = (r.dailyModelCosts[msgDate] ||= {});
        dayCosts[model] = dayCosts[model] ? addCosts(dayCosts[model], costs) : { ...costs };
      }

      // One per assistant turn, not per content-block line.
      if (usage.isNewTurn) {
        const hour = msg.timestamp.slice(11, 13);
        r.hourCounts[hour] = (r.hourCounts[hour] || 0) + 1;
      }
    }

    const content = msg.message?.content;
    if (Array.isArray(content)) {
      const toolCalls = content.filter(c => c && typeof c === 'object' && 'type' in c && c.type === 'tool_use').length;
      if (toolCalls > 0 && r.daily[msgDate]) r.daily[msgDate].toolCallCount += toolCalls;
    }
  });

  return r;
}

async function getFileSupplement(file: SupplementalFile): Promise<FileSupplement | null> {
  const fileSig = fileSignature(file.filePath);
  if (!fileSig) return null;
  // Keyed by cutoff too: the Desktop page reads Code-tab files with no cutoff
  // while the Overview reads them with the stats-cache date.
  const key = `${file.filePath}|${file.skipThrough}`;
  const cache = caches().supplements;
  const hit = cache.get(key);
  if (hit && hit.sig === fileSig) return hit.data;
  const data = await computeFileSupplement(file.filePath, file.skipThrough);
  cache.set(key, { sig: fileSig, data });
  return data;
}

async function computeSupplementalStats(afterDate: string): Promise<SupplementalStats> {
  const dailyMap = new Map<string, DailyActivity>();
  const dailyModelMap = new Map<string, Record<string, number>>();
  const dailyModelCostMap = new Map<string, Record<string, CostEstimates>>();
  const modelUsage: Record<string, SupplementalModelUsage> = {};
  const hourCounts: Record<string, number> = {};
  let totalSessions = 0;
  let totalMessages = 0;
  let totalTokens = 0;
  let estimatedCosts = zeroCosts();

  const dayOf = (date: string) => {
    let day = dailyMap.get(date);
    if (!day) {
      day = { date, messageCount: 0, sessionCount: 0, toolCallCount: 0 };
      dailyMap.set(date, day);
    }
    return day;
  };

  for (const file of getRecentSessionFiles(afterDate)) {
    const f = await getFileSupplement(file);
    if (!f || !f.counted) continue;

    totalSessions++;
    totalMessages += f.messages;
    totalTokens += f.tokens;
    estimatedCosts = addCosts(estimatedCosts, f.costs);

    for (const [date, d] of Object.entries(f.daily)) {
      const day = dayOf(date);
      day.messageCount += d.messageCount;
      day.toolCallCount += d.toolCallCount;
    }
    // Session counted on the day of its first qualifying message
    if (f.daily[f.firstQualifyingDate]) dayOf(f.firstQualifyingDate).sessionCount++;

    for (const [date, byModel] of Object.entries(f.dailyModelTokens)) {
      const dayTokens = dailyModelMap.get(date) || {};
      for (const [model, tokens] of Object.entries(byModel)) dayTokens[model] = (dayTokens[model] || 0) + tokens;
      dailyModelMap.set(date, dayTokens);
    }
    for (const [date, byModel] of Object.entries(f.dailyModelCosts)) {
      const dayCosts = dailyModelCostMap.get(date) || {};
      for (const [model, costs] of Object.entries(byModel)) dayCosts[model] = dayCosts[model] ? addCosts(dayCosts[model], costs) : { ...costs };
      dailyModelCostMap.set(date, dayCosts);
    }
    for (const [model, u] of Object.entries(f.modelUsage)) {
      const mu = (modelUsage[model] ||= { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, estimatedCosts: zeroCosts() });
      mu.inputTokens += u.inputTokens;
      mu.outputTokens += u.outputTokens;
      mu.cacheReadInputTokens += u.cacheReadInputTokens;
      mu.cacheCreationInputTokens += u.cacheCreationInputTokens;
      mu.estimatedCosts = addCosts(mu.estimatedCosts, u.estimatedCosts);
    }
    for (const [hour, count] of Object.entries(f.hourCounts)) hourCounts[hour] = (hourCounts[hour] || 0) + count;
  }

  const dailyActivity = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  const dailyModelTokens: DailyModelTokens[] = Array.from(dailyModelMap.entries())
    .map(([date, tokensByModel]) => ({
      date,
      tokensByModel,
      costsByModel: dailyModelCostMap.get(date) || {},
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    dailyActivity,
    dailyModelTokens,
    modelUsage,
    hourCounts,
    totalSessions,
    totalMessages,
    totalTokens,
    estimatedCosts,
  };
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const stats = getStatsCache();
  const projects = await getProjects();
  const afterDate = stats?.lastComputedDate || '';

  // Compute supplemental stats from JSONL files modified after the cache date
  const supplemental = await computeSupplementalStats(afterDate);

  // --- Base stats from cache ---
  let totalTokens = 0;
  let totalEstimatedCosts = zeroCosts();
  const modelUsageWithCost: Record<string, DashboardStats['modelUsage'][string]> = {};

  if (stats?.modelUsage) {
    for (const [model, usage] of Object.entries(stats.modelUsage)) {
      const costs = calculateCostAllModes(
        model,
        usage.inputTokens,
        usage.outputTokens,
        usage.cacheCreationInputTokens,
        usage.cacheReadInputTokens
      );
      const tokens = usage.inputTokens + usage.outputTokens + usage.cacheReadInputTokens + usage.cacheCreationInputTokens;
      totalTokens += tokens;
      totalEstimatedCosts = addCosts(totalEstimatedCosts, costs);
      modelUsageWithCost[model] = { ...usage, estimatedCost: costs[DEFAULT_COST_MODE], estimatedCosts: costs };
    }
  }

  // History only stats-cache.json still has: its transcripts are usually gone
  // (Claude Code deletes them after cleanupPeriodDays), so Projects can't show it.
  const history = { through: afterDate, tokens: totalTokens, estimatedCosts: totalEstimatedCosts };

  // --- Merge supplemental model usage ---
  for (const [model, usage] of Object.entries(supplemental.modelUsage)) {
    const costs = usage.estimatedCosts;
    totalTokens += usage.inputTokens + usage.outputTokens + usage.cacheReadInputTokens + usage.cacheCreationInputTokens;
    totalEstimatedCosts = addCosts(totalEstimatedCosts, costs);
    if (modelUsageWithCost[model]) {
      modelUsageWithCost[model].inputTokens += usage.inputTokens;
      modelUsageWithCost[model].outputTokens += usage.outputTokens;
      modelUsageWithCost[model].cacheReadInputTokens += usage.cacheReadInputTokens;
      modelUsageWithCost[model].cacheCreationInputTokens += usage.cacheCreationInputTokens;
      modelUsageWithCost[model].estimatedCost += costs[DEFAULT_COST_MODE];
      modelUsageWithCost[model].estimatedCosts = addCosts(modelUsageWithCost[model].estimatedCosts, costs);
    } else {
      modelUsageWithCost[model] = {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadInputTokens: usage.cacheReadInputTokens,
        cacheCreationInputTokens: usage.cacheCreationInputTokens,
        costUSD: 0,
        contextWindow: 0,
        maxOutputTokens: 0,
        webSearchRequests: 0,
        estimatedCost: costs[DEFAULT_COST_MODE],
        estimatedCosts: costs,
      };
    }
  }

  // --- Merge dailyActivity ---
  const dailyActivityMap = new Map<string, DailyActivity>();
  for (const d of (stats?.dailyActivity || [])) {
    dailyActivityMap.set(d.date, { ...d });
  }
  for (const d of supplemental.dailyActivity) {
    const existing = dailyActivityMap.get(d.date);
    if (existing) {
      existing.messageCount += d.messageCount;
      existing.sessionCount += d.sessionCount;
      existing.toolCallCount += d.toolCallCount;
    } else {
      dailyActivityMap.set(d.date, { ...d });
    }
  }
  const mergedDailyActivity = Array.from(dailyActivityMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  // --- Merge dailyModelTokens (with costsByModel) ---
  // stats-cache.json's per-day tokensByModel holds input + output only, while
  // its modelUsage totals (and their cost) include cache tokens, which are
  // ~99.9% of the volume. So spread each model's *history* cost over its days in
  // proportion to that day's input + output. Approximate per day, but the days
  // sum exactly to the history total. (The old ratio divided by all tokens,
  // which put history days ~800x too low in every cost-over-time chart.)
  const modelCostPerToken: Record<string, CostEstimates> = {};
  for (const [model, usage] of Object.entries(stats?.modelUsage || {})) {
    const ioTokens = usage.inputTokens + usage.outputTokens;
    if (ioTokens <= 0) continue;
    const costs = calculateCostAllModes(model, usage.inputTokens, usage.outputTokens, usage.cacheCreationInputTokens, usage.cacheReadInputTokens);
    modelCostPerToken[model] = {
      api: costs.api / ioTokens,
      conservative: costs.conservative / ioTokens,
      subscription: costs.subscription / ioTokens,
    };
  }

  const dailyModelTokenMap = new Map<string, Record<string, number>>();
  const dailyModelCostMergeMap = new Map<string, Record<string, CostEstimates>>();

  for (const d of (stats?.dailyModelTokens || [])) {
    dailyModelTokenMap.set(d.date, { ...d.tokensByModel });
    // Estimate costs for cache-sourced days using per-model ratio
    const dayCosts: Record<string, CostEstimates> = {};
    for (const [model, tokens] of Object.entries(d.tokensByModel)) {
      const ratio = modelCostPerToken[model];
      if (ratio) {
        dayCosts[model] = { api: tokens * ratio.api, conservative: tokens * ratio.conservative, subscription: tokens * ratio.subscription };
      }
    }
    dailyModelCostMergeMap.set(d.date, dayCosts);
  }

  for (const d of supplemental.dailyModelTokens) {
    const existingTokens = dailyModelTokenMap.get(d.date);
    const existingCosts = dailyModelCostMergeMap.get(d.date);
    if (existingTokens) {
      for (const [model, tokens] of Object.entries(d.tokensByModel)) {
        existingTokens[model] = (existingTokens[model] || 0) + tokens;
      }
      if (d.costsByModel && existingCosts) {
        for (const [model, costs] of Object.entries(d.costsByModel)) {
          existingCosts[model] = existingCosts[model] ? addCosts(existingCosts[model], costs) : { ...costs };
        }
      }
    } else {
      dailyModelTokenMap.set(d.date, { ...d.tokensByModel });
      dailyModelCostMergeMap.set(d.date, d.costsByModel ? { ...d.costsByModel } : {});
    }
  }

  const mergedDailyModelTokens: DailyModelTokens[] = Array.from(dailyModelTokenMap.entries())
    .map(([date, tokensByModel]) => ({
      date,
      tokensByModel,
      costsByModel: dailyModelCostMergeMap.get(date) || {},
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // --- Merge hourCounts ---
  const mergedHourCounts = { ...(stats?.hourCounts || {}) };
  for (const [hour, count] of Object.entries(supplemental.hourCounts)) {
    mergedHourCounts[hour] = (mergedHourCounts[hour] || 0) + count;
  }

  const recentSessions = await getSessions(10);

  // All-time totals: stats-cache history up to its date + transcripts after it.
  // These used to come from the Projects page totals, which only cover
  // transcripts still on disk — that dropped 4.2B tokens of history on one
  // install while the charts and Model Usage on the same page included them.
  return {
    totalSessions: (stats?.totalSessions || 0) + supplemental.totalSessions,
    totalMessages: (stats?.totalMessages || 0) + supplemental.totalMessages,
    totalTokens,
    estimatedCost: totalEstimatedCosts[DEFAULT_COST_MODE],
    estimatedCosts: totalEstimatedCosts,
    history,
    dailyActivity: mergedDailyActivity,
    dailyModelTokens: mergedDailyModelTokens,
    modelUsage: modelUsageWithCost,
    hourCounts: mergedHourCounts,
    firstSessionDate: stats?.firstSessionDate || '',
    longestSession: stats?.longestSession || { sessionId: '', duration: 0, messageCount: 0, timestamp: '' },
    projectCount: projects.length,
    recentSessions,
    sources: await getSourceBreakdown(),
  };
}
