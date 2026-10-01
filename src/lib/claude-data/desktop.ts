import fs from 'fs';
import path from 'path';
import { getActiveDataSource } from './data-source';
import { getClaudeDesktopDir, getDailyTokensBySource, getSessionsBySource } from './reader';
import type { DailyModelTokens, DesktopDailyTokens, DesktopInfo } from './types';

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return null;
  }
}

/** Names only — the config files also hold commands, env vars and tokens. */
function readConnectors(desktopDir: string): { mcpServers: string[]; extensions: string[] } {
  const config = readJson<{ mcpServers?: Record<string, unknown> }>(path.join(desktopDir, 'claude_desktop_config.json'));
  const installs = readJson<{ extensions?: Record<string, { manifest?: { display_name?: string; name?: string } }> }>(
    path.join(desktopDir, 'extensions-installations.json'),
  );
  return {
    mcpServers: Object.keys(config?.mcpServers || {}).sort(),
    extensions: Object.entries(installs?.extensions || {})
      .map(([id, ext]) => ext?.manifest?.display_name || ext?.manifest?.name || id)
      .sort(),
  };
}

function mergeDaily(cowork: DailyModelTokens[], desktopCode: DailyModelTokens[]): DesktopDailyTokens[] {
  const days = new Map<string, DesktopDailyTokens>();
  const add = (rows: DailyModelTokens[], key: 'cowork' | 'desktopCode') => {
    for (const row of rows) {
      const day = days.get(row.date) || { date: row.date, cowork: 0, desktopCode: 0 };
      day[key] += Object.values(row.tokensByModel).reduce((a, b) => a + b, 0);
      days.set(row.date, day);
    }
  };
  add(cowork, 'cowork');
  add(desktopCode, 'desktopCode');
  return Array.from(days.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export async function getDesktopInfo(): Promise<DesktopInfo> {
  const dataDir = getClaudeDesktopDir();

  // Code-tab sessions live in ~/.claude/projects, so they are part of an
  // imported ZIP too; Cowork and connectors are only on the live machine.
  const desktopCode = await getSessionsBySource('claude-desktop');
  const desktopCodeDaily = await getDailyTokensBySource('claude-desktop');
  if (getActiveDataSource() !== 'live' || !fs.existsSync(dataDir)) {
    return {
      available: false,
      dataDir,
      dailyTokens: mergeDaily([], desktopCodeDaily),
      mcpServers: [],
      extensions: [],
      cowork: [],
      desktopCode,
    };
  }

  return {
    available: true,
    dataDir,
    dailyTokens: mergeDaily(await getDailyTokensBySource('cowork'), desktopCodeDaily),
    ...readConnectors(dataDir),
    cowork: await getSessionsBySource('cowork'),
    desktopCode,
  };
}
