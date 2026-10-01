import type { CostMode } from '@/config/pricing';

/** Cost estimates in all three modes */
export type CostEstimates = Record<CostMode, number>;

/** Which Claude client wrote a session.
 * - `claude-code`: Claude Code CLI, IDE extension or SDK (`~/.claude/projects`)
 * - `claude-desktop`: Claude Code started from the Claude Desktop app's Code tab
 *   (same `~/.claude/projects` tree, told apart by the `entrypoint` field)
 * - `cowork`: Claude Desktop's local agent mode, read from the Desktop app data dir */
export type SessionSource = 'claude-code' | 'claude-desktop' | 'cowork';

/** Virtual project id grouping every Cowork session (they have no project dir). */
export const COWORK_PROJECT_ID = 'claude-desktop-cowork';

export const SESSION_SOURCES: SessionSource[] = ['claude-code', 'claude-desktop', 'cowork'];

export const SESSION_SOURCE_LABELS: Record<SessionSource, string> = {
  'claude-code': 'Claude Code',
  'claude-desktop': 'Desktop Code',
  cowork: 'Cowork',
};

export interface SourceSummary {
  sessions: number;
  tokens: number;
  estimatedCost: number;
  estimatedCosts: CostEstimates;
}

/** Tokens per day for the two Claude Desktop clients. */
export interface DesktopDailyTokens {
  date: string;
  cowork: number;
  desktopCode: number;
}

export interface DesktopInfo {
  /** False when the data source is an imported ZIP or Claude Desktop isn't installed. */
  available: boolean;
  dataDir: string;
  dailyTokens: DesktopDailyTokens[];
  mcpServers: string[];
  extensions: string[];
  cowork: SessionInfo[];
  desktopCode: SessionInfo[];
}

export interface DailyActivity {
  date: string;
  messageCount: number;
  sessionCount: number;
  toolCallCount: number;
}

export interface DailyModelTokens {
  date: string;
  tokensByModel: Record<string, number>;
  /** Pre-computed daily cost per model in each cost mode */
  costsByModel?: Record<string, CostEstimates>;
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUSD: number;
  contextWindow: number;
  maxOutputTokens: number;
  webSearchRequests: number;
}

export interface LongestSession {
  sessionId: string;
  duration: number;
  messageCount: number;
  timestamp: string;
}

export interface StatsCache {
  version: number;
  lastComputedDate: string;
  dailyActivity: DailyActivity[];
  dailyModelTokens: DailyModelTokens[];
  modelUsage: Record<string, ModelUsage>;
  totalSessions: number;
  totalMessages: number;
  longestSession: LongestSession;
  firstSessionDate: string;
  hourCounts: Record<string, number>;
  totalSpeculationTimeSavedMs: number;
}

export interface HistoryEntry {
  display: string;
  pastedContents: Record<string, unknown>;
  timestamp: number;
  project: string;
}

export interface CompactMetadata {
  trigger: string;
  preTokens: number;
}

export interface MicrocompactMetadata {
  trigger: string;
  preTokens: number;
  tokensSaved: number;
  compactedToolIds: string[];
  clearedAttachmentUUIDs: string[];
}

export interface SessionMessage {
  type: 'user' | 'assistant' | 'progress' | 'system' | 'file-history-snapshot';
  sessionId: string;
  timestamp: string;
  uuid: string;
  parentUuid: string | null;
  cwd: string;
  version: string;
  gitBranch: string;
  /** Client that started the session, e.g. `cli`, `claude-vscode`, `sdk-cli`. */
  entrypoint?: string;
  compactMetadata?: CompactMetadata;
  microcompactMetadata?: MicrocompactMetadata;
  isCompactSummary?: boolean;
  message?: {
    role: string;
    /** API message id. One assistant turn is split over several lines sharing this id. */
    id?: string;
    model?: string;
    content: unknown;
    usage?: TokenUsage;
    stop_reason?: string | null;
  };
  data?: {
    type: string;
    elapsedTimeMs?: number;
    toolName?: string;
    serverName?: string;
    statusMessage?: string;
  };
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  cache_creation?: {
    ephemeral_5m_input_tokens: number;
    ephemeral_1h_input_tokens: number;
  };
  service_tier?: string;
}

export interface ProjectInfo {
  id: string;
  name: string;
  path: string;
  sessionCount: number;
  totalMessages: number;
  totalTokens: number;
  estimatedCost: number;
  estimatedCosts: CostEstimates;
  lastActive: string;
  models: string[];
}

export interface CompactionInfo {
  compactions: number;
  microcompactions: number;
  totalTokensSaved: number;
  compactionTimestamps: string[];
}

export interface SessionInfo {
  id: string;
  projectId: string;
  projectName: string;
  /** Which Claude client this session came from. */
  source: SessionSource;
  /** Raw `entrypoint` from the transcript ('' for Cowork). */
  entrypoint: string;
  /** Session title. Set for Cowork (from Claude Desktop's metadata), '' otherwise. */
  title: string;
  timestamp: string;
  duration: number;
  messageCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  toolCallCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  estimatedCost: number;
  estimatedCosts: CostEstimates;
  model: string;
  models: string[];
  gitBranch: string;
  cwd: string;
  version: string;
  toolsUsed: Record<string, number>;
  compaction: CompactionInfo;
}

export interface SessionDetail extends SessionInfo {
  messages: SessionMessageDisplay[];
}

export interface SessionMessageDisplay {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  model?: string;
  usage?: TokenUsage;
  toolCalls?: { name: string; id: string }[];
}

export interface DashboardStats {
  totalSessions: number;
  totalMessages: number;
  totalTokens: number;
  estimatedCost: number;
  estimatedCosts: CostEstimates;
  /** The part of the totals that comes only from stats-cache.json (through = its lastComputedDate). */
  history: { through: string; tokens: number; estimatedCosts: CostEstimates };
  dailyActivity: DailyActivity[];
  dailyModelTokens: DailyModelTokens[];
  modelUsage: Record<string, ModelUsage & { estimatedCost: number; estimatedCosts: CostEstimates }>;
  hourCounts: Record<string, number>;
  firstSessionDate: string;
  longestSession: LongestSession;
  projectCount: number;
  recentSessions: SessionInfo[];
  sources: Record<SessionSource, SourceSummary>;
}
