/**
 * What the app remembers between runs, in ONE file (`installs.json`, in the
 * data directory — a volume when the app is hosted): each streamer who
 * installed it, with the pair of keys the Gamerfy gave for her live, and the
 * secret the login cookies are signed with.
 *
 * A file, and not a database, because that is the size of it: a few hundred
 * streamers are a few hundred lines. Every change rewrites the whole file —
 * to a temporary one first, then renamed over the old, so a crash in the
 * middle leaves the file of before and never half of the new one.
 *
 * The keys are a streamer's permission to read, write and delete in her
 * chat: the file is written for its owner alone, and belongs nowhere but this
 * directory. Losing it logs nobody out of the Gamerfy — every streamer just
 * installs the app again.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const FILE = 'installs.json';

function read(file) {
  if (!existsSync(file)) return null;
  try {
    const kept = JSON.parse(readFileSync(file, 'utf8'));
    return typeof kept === 'object' && kept !== null && typeof kept.installs === 'object' && kept.installs !== null ? kept : null;
  } catch {
    return null;
  }
}

export function createStore(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const file = join(dataDir, FILE);
  const kept = read(file);
  const state = {
    /** Signs the login cookies: born with the file, so a restart logs nobody out. */
    secret: typeof kept?.secret === 'string' && kept.secret.length >= 32 ? kept.secret : randomBytes(32).toString('base64url'),
    /** By the streamer's id: `{ userId, login, name, accessToken, refreshToken, expiresAt, scope, installedAt }`. */
    installs: kept?.installs ?? {},
  };

  function save() {
    const draft = `${file}.${String(process.pid)}.tmp`;
    writeFileSync(draft, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    renameSync(draft, file);
  }
  if (kept?.secret !== state.secret) save();

  return {
    secret: state.secret,
    all: () => Object.values(state.installs),
    get: (userId) => state.installs[userId] ?? null,
    /** A new installation, or the same streamer's with new keys. */
    put(install) {
      state.installs[install.userId] = { ...(state.installs[install.userId] ?? {}), ...install };
      save();
      return state.installs[install.userId];
    },
    remove(userId) {
      if (state.installs[userId] === undefined) return;
      delete state.installs[userId];
      save();
    },
  };
}
