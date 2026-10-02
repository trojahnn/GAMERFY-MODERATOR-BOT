/**
 * What this machine says about the app: read from `.env` beside package.json
 * (never committed) and from the environment, the environment winning.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** `KEY=value` lines; `#` comments and blank lines skipped; quotes around a value taken off. */
export function parseEnv(text) {
  const values = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const at = line.indexOf('=');
    if (at <= 0) continue;
    const value = line.slice(at + 1).trim();
    values[line.slice(0, at).trim()] = /^(["']).*\1$/.test(value) ? value.slice(1, -1) : value;
  }
  return values;
}

const flag = (text, fallback) => (text === undefined || text === '' ? fallback : text === 'true' || text === '1');

export function readConfig(env = process.env, file = join(ROOT, '.env')) {
  const fromFile = existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {};
  const value = (name, fallback = '') => env[name] ?? fromFile[name] ?? fallback;
  const port = Number(value('PORT', '8787'));
  const config = {
    /** The public API: `https://api.gamerfy.gg` in production, the local backend's `/api/public` on a developer's machine. */
    api: value('GAMERFY_API', 'https://api.gamerfy.gg').replace(/\/+$/, ''),
    /** The site, where the streamer authorizes the app. */
    site: value('GAMERFY_SITE', 'https://gamerfy.gg').replace(/\/+$/, ''),
    clientId: value('GAMERFY_CLIENT_ID'),
    gatewayKey: value('AI_GATEWAY_API_KEY'),
    /** The cheapest model of the gateway that passed this app's own test (README.md, "O modelo"). */
    model: value('AI_MODEL', 'inclusionai/ling-3.0-flash'),
    port,
    /** Where the streamer comes back after authorizing: registered, exactly so, in the app's "Autorização". */
    redirectUri: `http://localhost:${String(port)}/callback`,
    /** Where the streamer's pair of keys is kept between runs (never committed). */
    keysFile: value('KEYS_FILE', join(ROOT, 'tokens.json')),
    /** Says in the chat why a line was removed. */
    warnInChat: flag(value('WARN_IN_CHAT'), true),
    /** Judges and shows, but deletes nothing and says nothing. */
    dryRun: flag(value('DRY_RUN'), false),
  };
  const missing = [
    ['GAMERFY_CLIENT_ID', config.clientId],
    ['AI_GATEWAY_API_KEY', config.gatewayKey],
  ]
    .filter(([, has]) => has === '')
    .map(([name]) => name);
  if (!Number.isInteger(port) || port < 1 || port > 65535) missing.push('PORT (um número de porta)');
  return { config, missing };
}
