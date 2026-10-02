/**
 * The streamers who installed the app, each with a moderator of her own.
 *
 * An installation is three things running for one streamer: her pair of keys
 * (renewed as it lapses), one connection to her live's event channel, and one
 * moderator judging her chat. They share nothing with the next streamer's —
 * the decisions of one chat are never shown to another — except the judge
 * (one model, one set of rules) and the file everything is kept in.
 *
 * Installations start when the app does (every streamer in the store), when a
 * streamer comes back from authorizing, and end when she takes the access
 * away in the Gamerfy — the channel closes with 4003, and her keys are deleted
 * here at once.
 */
import { createGamerfy, listen } from './gamerfy.mjs';
import { createModerator } from './moderator.mjs';

/** One connection is opened this long after the last, when the app starts with many streamers: the channel counts new connections per minute. */
const STAGGER_MS = 250;

export function createInstalls({ config, store, judge, connect = listen, log = console.log }) {
  /** By the streamer's id: `{ userId, gamerfy, channel, moderator, state, notice, watchers }`. */
  const running = new Map();

  const tell = (entry, frame) => {
    for (const watcher of entry.watchers) watcher.write(frame(entry));
  };

  /** What the connection says about the permissions the streamer gave: what is missing, in her words. */
  function noticeOf(scopes) {
    const lacking = ['chat:read', 'chat:moderate'].filter((scope) => !scopes.includes(scope));
    if (lacking.length > 0) return `Falta a permissão ${lacking.join(' e ')}: instale de novo.`;
    return scopes.includes('chat:write') ? '' : 'Sem a permissão de escrever: o app apaga, mas não avisa no chat.';
  }

  function start(userId, { onDecision, onState }) {
    stop(userId);
    const keys = {
      get: () => store.get(userId),
      set: (pair) => store.put({ userId, ...pair }),
      clear: () => store.remove(userId),
    };
    const gamerfy = createGamerfy(config, keys);
    const entry = { userId, gamerfy, state: { connected: false }, notice: '', watchers: new Set(), channel: null, moderator: null };
    entry.moderator = createModerator({
      judge,
      gamerfy,
      config,
      log: (line) => log(`[${store.get(userId)?.login ?? userId}] ${line}`),
      onDecision: (decision) => tell(entry, () => onDecision(decision, entry.moderator.totals)),
    });
    entry.channel = connect(config, gamerfy, {
      log,
      onEvent: (type, data) => entry.moderator.onEvent(type, data),
      onState(next) {
        entry.state = next;
        if (next.connected) {
          entry.moderator.setBroadcaster(next.broadcaster);
          entry.notice = noticeOf(next.scopes);
          // The name she goes by today: what the panel greets her with.
          if (store.get(userId) !== null) store.put({ userId, login: next.broadcaster.login, name: next.broadcaster.name });
          log(`[${next.broadcaster.login}] conectado: moderando o chat`);
        } else if (next.reason !== undefined) {
          log(`[${store.get(userId)?.login ?? userId}] desconectado: ${next.reason}`);
        }
        tell(entry, () => onState(entry));
        // The access is gone, and the keys with it: nothing of hers is left running.
        if (!next.connected && store.get(userId) === null) stop(userId, { keepWatchers: true });
      },
    });
    running.set(userId, entry);
    return entry;
  }

  function stop(userId, { keepWatchers = false } = {}) {
    const entry = running.get(userId);
    if (entry === undefined) return;
    entry.channel?.stop();
    if (!keepWatchers) {
      for (const watcher of entry.watchers) watcher.end();
      running.delete(userId);
    }
  }

  return {
    /** Every streamer the store remembers, one connection after another. */
    startAll(frames) {
      store.all().forEach((install, at) => {
        setTimeout(() => start(install.userId, frames), at * STAGGER_MS);
      });
      return store.all().length;
    },
    /** A streamer just (re)installed: her new keys, a new connection. */
    install(record, frames) {
      store.put({ ...record, installedAt: store.get(record.userId)?.installedAt ?? new Date().toISOString() });
      return start(record.userId, frames);
    },
    /** What is running for a streamer, or `null`. */
    of: (userId) => running.get(userId) ?? null,
    count: () => running.size,
    stopAll() {
      for (const userId of [...running.keys()]) stop(userId);
    },
  };
}
