/**
 * What this machine says about the app: read from `.env` beside package.json
 * (never committed) and from the environment, the environment winning — in a
 * container there is no `.env` at all, only the environment.
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

/** The computer's own address: where the app runs when somebody tries it at home. */
function isLoopback(address) {
  try {
    const { hostname } = new URL(address);
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

export function readConfig(env = process.env, file = join(ROOT, '.env')) {
  const fromFile = existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {};
  const value = (name, fallback = '') => {
    const set = env[name] ?? fromFile[name];
    return set === undefined || set === '' ? fallback : set;
  };
  const port = Number(value('PORT', '8787'));
  /** The address people reach the app at: its own on a developer's machine, the public one when it is hosted. */
  const publicUrl = value('PUBLIC_URL', `http://localhost:${String(port)}`).replace(/\/+$/, '');
  const local = isLoopback(publicUrl);
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
    publicUrl,
    /**
     * Which interface the page listens on. At home, the computer's own and nothing else: the page shows a chat's
     * worst lines. Hosted, every interface of the container — the platform's edge is what faces the internet.
     */
    host: value('HOST', local ? '127.0.0.1' : '0.0.0.0'),
    /** Where the streamer comes back after authorizing: registered, exactly so, in the app's "Autorização". */
    redirectUri: `${publicUrl}/callback`,
    /** Whether the cookie that says who is logged in travels over https only: always, except at home. */
    secureCookies: publicUrl.startsWith('https://'),
    /** Where the installations are kept between runs — a volume, when the app is hosted (never committed). */
    dataDir: value('DATA_DIR', ROOT),
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
  const badPort = !Number.isInteger(port) || port < 1 || port > 65535;
  if (badPort) missing.push('PORT (um número de porta)');
  // With no PUBLIC_URL the address is made from the port: a port that is none has already been said.
  if (badPort && value('PUBLIC_URL') === '') return { config, missing };
  try {
    const address = new URL(publicUrl);
    // Out on the internet the streamer's login travels in a cookie: never over plain http.
    if (address.protocol !== 'https:' && !local) missing.push('PUBLIC_URL (https://, fora do seu computador)');
  } catch {
    missing.push('PUBLIC_URL (um endereço)');
  }
  return { config, missing };
}
