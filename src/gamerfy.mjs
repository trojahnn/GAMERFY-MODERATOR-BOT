/**
 * Everything this app says to the Gamerfy, and nothing else:
 *
 *   • the authorization — the streamer is sent to the authorize screen, comes
 *     back with a code, and the code becomes a pair of keys (`gfp_…` for four
 *     hours, `gfr_…` to renew it). OAuth 2 with PKCE: no secret on this machine;
 *   • the event channel — a WebSocket where the live's chat arrives as it
 *     happens (`channel.chat.message`), resumed when it drops;
 *   • the two things this app DOES in the chat — delete a line
 *     (`chat:moderate`) and write one (`chat:write`).
 *
 * The docs: https://api.gamerfy.gg ("Autorização de apps", "Canal de eventos",
 * "Chat: escrever e moderar").
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

/** What the app asks the streamer for: read the chat, delete a line of it, write in it. */
export const SCOPES = 'chat:read chat:write chat:moderate';
/** The key is renewed this long before it lapses. */
const RENEW_BEFORE_MS = 5 * 60_000;
/** The waits between reconnections: 1, 2, 4, 8, 16 and then 30 seconds, as the docs ask. */
const BACKOFF_MS = [1000, 2000, 4000, 8000, 16_000, 30_000];
/** Closes after which coming back with the same key is pointless (the docs' table of closes). */
const KEY_REFUSED = 4002;
const ACCESS_REMOVED = 4003;
const RESUME_LOST = 4006;
const TOO_MANY_CONNECTIONS = 4010;

/* ------------------------------------------------------------------ PKCE */

/** A new authorization request: the address to send the streamer to, and what to keep until she is back. */
export function authorizationOf(config) {
  const verifier = randomBytes(32).toString('base64url');
  const state = randomBytes(16).toString('base64url');
  const url = new URL(`${config.site}/autorizar`);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: SCOPES,
    state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  }).toString();
  return { url: url.toString(), verifier, state };
}

/* --------------------------------------------------------------- the keys */

/** The pair of keys, kept in a file (`tokens.json` beside package.json, never committed): the app survives a restart. */
export function createKeyStore(file) {
  let keys = null;
  if (existsSync(file)) {
    try {
      keys = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      keys = null;
    }
  }
  return {
    get: () => keys,
    set(next) {
      keys = next;
      writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    },
    clear() {
      keys = null;
      rmSync(file, { force: true });
    },
  };
}

/** `POST /oauth2/token`: a code, or a `gfr_…`, for a new pair. Throws with the server's own sentence. */
async function tokenRequest(config, form) {
  const response = await fetch(`${config.api}/oauth2/token`, { method: 'POST', body: new URLSearchParams({ client_id: config.clientId, ...form }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.error_description ?? body.message ?? `o Gamerfy respondeu ${String(response.status)}`), { code: body.error });
  return { accessToken: body.access_token, refreshToken: body.refresh_token, expiresAt: Date.now() + Number(body.expires_in) * 1000, scope: body.scope };
}

export function createGamerfy(config, store) {
  let renewing = null;

  const exchange = async (code, verifier) => {
    store.set(await tokenRequest(config, { grant_type: 'authorization_code', code, redirect_uri: config.redirectUri, code_verifier: verifier }));
  };

  /** A new pair from the `gfr_…` — one renewal at a time: a `gfr_…` dies the moment it is used. */
  const renew = () => {
    renewing ??= (async () => {
      const keys = store.get();
      if (keys === null) throw new Error('o app ainda não foi autorizado');
      try {
        store.set(await tokenRequest(config, { grant_type: 'refresh_token', refresh_token: keys.refreshToken }));
      } catch (error) {
        // `invalid_grant`: the streamer took the access away (or the pair was renewed elsewhere). Nothing to renew with.
        if (error.code === 'invalid_grant') store.clear();
        throw error;
      }
    })().finally(() => {
      renewing = null;
    });
    return renewing;
  };

  /** A key that is good for a while yet. */
  const accessToken = async () => {
    const keys = store.get();
    if (keys === null) throw new Error('o app ainda não foi autorizado');
    if (keys.expiresAt - Date.now() < RENEW_BEFORE_MS) await renew();
    return store.get().accessToken;
  };

  /** One call of the API with the streamer's key; a key the server no longer takes is renewed once. */
  async function call(method, path, { query, body } = {}, again = true) {
    const url = new URL(`${config.api}${path}`);
    for (const [name, value] of Object.entries(query ?? {})) url.searchParams.set(name, value);
    const response = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${await accessToken()}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status === 401 && again) {
      await renew();
      return call(method, path, { query, body }, false);
    }
    const text = await response.text();
    const answer = text === '' ? null : JSON.parse(text);
    if (!response.ok) throw Object.assign(new Error(answer?.message ?? `o Gamerfy respondeu ${String(response.status)}`), { status: response.status, code: answer?.error });
    return answer;
  }

  return {
    exchange,
    renew,
    accessToken,
    authorized: () => store.get() !== null,
    forget: () => store.clear(),
    /** Whose live this key is for, and what it may: `{ user_id, login, scopes, expires_in }`. */
    whoAmI: async () => {
      const response = await fetch(`${config.api}/oauth2/validate`, { headers: { Authorization: `Bearer ${await accessToken()}` } });
      if (!response.ok) throw new Error(`a chave não foi aceita (${String(response.status)})`);
      return response.json();
    },
    /** `chat:moderate`: the line is gone for everybody. A line already gone is not an error. */
    async deleteLine(broadcasterId, messageId) {
      try {
        await call('DELETE', '/v1/chat/messages', { query: { broadcaster_id: broadcasterId, message_id: messageId } });
        return true;
      } catch (error) {
        if (error.code === 'message_not_found') return false;
        throw error;
      }
    },
    /** `chat:write`: a line by the app's own bot account. */
    say: (broadcasterId, message) => call('POST', '/v1/chat/messages', { body: { broadcaster_id: broadcasterId, message } }),
  };
}

/* ------------------------------------------------------ the event channel */

/**
 * The live's events, for as long as the app runs. `onEvent(type, data)` for each one; `onState(state)` when the
 * connection changes — `{ connected, broadcaster }`, or `{ connected: false, reason }`.
 */
export function listen(config, gamerfy, { onEvent, onState, log = console.log }) {
  const address = `${config.api.replace(/^http/, 'ws')}/v1/events`;
  let socket = null;
  let beat = null;
  let session = null;
  let seq = null;
  let tries = 0;
  let stopped = false;
  let waiting = null;

  const later = (ms) => {
    clearTimeout(waiting);
    waiting = setTimeout(() => void connect(), ms);
  };
  const again = () => {
    const wait = BACKOFF_MS[Math.min(tries, BACKOFF_MS.length - 1)];
    tries += 1;
    later(wait + Math.floor(Math.random() * 500));
  };

  async function connect() {
    if (stopped) return;
    let token;
    try {
      token = await gamerfy.accessToken();
    } catch (error) {
      onState({ connected: false, reason: error.message });
      // Not authorized (yet, or any more): nothing to connect with until the streamer installs it.
      if (!gamerfy.authorized()) return;
      again();
      return;
    }
    socket = new WebSocket(address);
    socket.addEventListener('message', (message) => {
      const frame = JSON.parse(String(message.data));
      if (frame.op === 'hello') {
        clearInterval(beat);
        beat = setInterval(() => socket?.readyState === WebSocket.OPEN && socket.send(JSON.stringify({ op: 'heartbeat' })), frame.d.heartbeat_interval_ms / 2);
        // The same session, from where it stopped — or a new one.
        socket.send(JSON.stringify(session !== null && seq !== null ? { op: 'resume', d: { token, session_id: session, seq } } : { op: 'identify', d: { token } }));
        return;
      }
      if (frame.op !== 'dispatch') return;
      if (frame.seq !== undefined) seq = frame.seq;
      if (frame.t === 'ready') {
        session = frame.d.session_id;
        tries = 0;
        onState({ connected: true, broadcaster: frame.d.broadcaster, scopes: frame.d.scopes });
        return;
      }
      if (frame.t === 'resumed') {
        tries = 0;
        return;
      }
      onEvent(frame.t, frame.d, frame.id);
    });
    socket.addEventListener('close', (event) => {
      clearInterval(beat);
      socket = null;
      if (stopped) return;
      if (event.code === ACCESS_REMOVED) {
        gamerfy.forget();
        session = null;
        onState({ connected: false, reason: 'o streamer tirou o acesso do app' });
        return;
      }
      if (event.code === TOO_MANY_CONNECTIONS) {
        onState({ connected: false, reason: 'conexões demais com a mesma chave: feche as outras cópias do app' });
        return;
      }
      if (event.code === KEY_REFUSED) {
        // The key lapsed while connected: a new one, and a new session.
        session = null;
        gamerfy.renew().then(
          () => later(500),
          (error) => onState({ connected: false, reason: error.message }),
        );
        return;
      }
      if (event.code === RESUME_LOST) session = null;
      onState({ connected: false, reason: `a conexão caiu (${String(event.code)}); voltando` });
      again();
    });
    socket.addEventListener('error', () => {
      log('canal de eventos: erro de rede');
    });
  }

  void connect();
  return {
    /** After a (new) authorization: a new session with the new key. */
    restart() {
      session = null;
      seq = null;
      tries = 0;
      socket?.close();
      if (socket === null) later(0);
    },
    stop() {
      stopped = true;
      clearTimeout(waiting);
      clearInterval(beat);
      socket?.close();
    },
  };
}
