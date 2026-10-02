#!/usr/bin/env node
/**
 * Moderador IA — an example app for the Gamerfy public API.
 *
 * It is a third-party app like any other: a streamer installs it in her live
 * by authorizing it (the same screen every app uses), and from then on it
 * reads the chat, has a language model judge each line against the rules of
 * rules.md, deletes what breaks them and says why in the chat.
 *
 * One process serves every streamer who installed it: each has her own keys,
 * her own connection to her live and her own panel, which opens for her alone.
 *
 *   npm start      then open the app's address and press "Instalar na minha live"
 *
 * README.md says how to register the app, how to host it and what each file is.
 */
import http from 'node:http';
import { readConfig } from './config.mjs';
import { authorizationOf, exchangeCode, whoIs } from './gamerfy.mjs';
import { createInstalls } from './installs.mjs';
import { createJudge, readRules } from './judge.mjs';
import { decisionFrame, frontHtml, panelHtml, stateFrame, stateWord } from './page.mjs';
import { cookiesOf, PENDING_COOKIE, PENDING_MS, SESSION_COOKIE, SESSION_MS, sessionUser, sessionValue, setCookie } from './session.mjs';
import { createStore } from './store.mjs';

const { config, missing } = readConfig();
if (missing.length > 0) {
  console.error(`Falta na configuração (.env ou variáveis de ambiente): ${missing.join(', ')}. Veja o README.md.`);
  process.exit(1);
}

const rules = readRules();
const store = createStore(config.dataDir);
const judge = createJudge({ key: config.gatewayKey, model: config.model, rules });
const installs = createInstalls({ config, store, judge });

/** What a streamer's panel shows of the connection: what the channel says, and whether she still has the app installed. */
const shown = (userId) => ({ ...(installs.of(userId)?.state ?? { connected: false }), installed: store.get(userId) !== null });
const wordOf = (userId) => stateWord(shown(userId), installs.of(userId)?.notice ?? '');
/** What a panel is told while it is open: each decision, and the state when it changes. */
const frames = {
  onDecision: (decision, totals) => decisionFrame(decision, totals),
  onState: (entry) => stateFrame(wordOf(entry.userId)),
};

/** The authorizations on their way: by `state`, what was sent, until the streamer comes back with the code. */
const pending = new Map();
const PENDING_MAX = 2000;
const FEED_PING_MS = 25_000;
function forgetOld(now) {
  for (const [state, sent] of pending) if (now - sent.at > PENDING_MS) pending.delete(state);
  // A flood of clicks on "Instalar" must not grow this for ever: the oldest go first.
  while (pending.size >= PENDING_MAX) pending.delete(pending.keys().next().value);
}

/** What the front page says when an authorization did not finish — a closed list: nothing of the address is ever written on the page. */
const PROBLEMS = {
  pedido: 'Essa volta não é de um pedido deste navegador. Clique em "Instalar na minha live" de novo.',
  recusado: 'A autorização foi recusada na tela do Gamerfy.',
  codigo: 'O Gamerfy voltou sem o código. Tente de novo.',
  troca: 'Não deu para concluir a autorização. Tente de novo em instantes.',
};

const HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  // The pages draw themselves: one inline style, one inline script, and the feed of this same address.
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? '/', config.publicUrl);
  const cookies = cookiesOf(request.headers.cookie);
  const userId = sessionUser(store.secret, cookies[SESSION_COOKIE]);
  const cookie = (name, value, maxAgeMs) => setCookie(name, value, { maxAgeMs, secure: config.secureCookies });
  const html = (body) => {
    response.writeHead(200, HEADERS);
    response.end(body);
  };
  const go = (location, setCookies = []) => {
    response.writeHead(302, { Location: location, 'Cache-Control': 'no-store', ...(setCookies.length === 0 ? {} : { 'Set-Cookie': setCookies }) });
    response.end();
  };

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405).end();
    return;
  }
  // The platform's health check: the process is up and answering.
  if (url.pathname === '/health') {
    response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end('ok');
    return;
  }
  if (url.pathname === '/') {
    if (userId !== null) return go('/painel');
    html(frontHtml({ rules, config, notice: PROBLEMS[url.searchParams.get('erro')] ?? '' }));
    return;
  }
  if (url.pathname === '/install') {
    const sent = authorizationOf(config);
    forgetOld(Date.now());
    pending.set(sent.state, { verifier: sent.verifier, at: Date.now() });
    go(sent.url, [cookie(PENDING_COOKIE, sent.state, PENDING_MS)]);
    return;
  }
  if (url.pathname === '/callback') {
    const state = url.searchParams.get('state') ?? '';
    const sent = pending.get(state);
    pending.delete(state);
    const clear = [cookie(PENDING_COOKIE, '', 0)];
    // The return has to be of a request THIS browser made: the cookie it left with says which. A link somebody else
    // forged — to log a streamer into a panel that is not hers — carries a `state` this browser never asked for.
    if (sent === undefined || Date.now() - sent.at > PENDING_MS || cookies[PENDING_COOKIE] !== state) return go('/?erro=pedido', clear);
    if (url.searchParams.get('error') !== null) return go('/?erro=recusado', clear);
    const code = url.searchParams.get('code');
    if (code === null) return go('/?erro=codigo', clear);
    exchangeCode(config, code, sent.verifier)
      .then(async (keys) => {
        const who = await whoIs(config, keys.accessToken);
        installs.install({ userId: String(who.user_id), login: who.login, name: who.login, ...keys }, frames);
        console.log(`[${String(who.login)}] instalou o app`);
        // Authorizing IS the login: she proved who she is on the Gamerfy, and comes back with her panel open.
        go('/painel', [...clear, cookie(SESSION_COOKIE, sessionValue(store.secret, String(who.user_id)), SESSION_MS)]);
      })
      .catch((error) => {
        console.log(`autorização não concluída: ${error instanceof Error ? error.message : String(error)}`);
        go('/?erro=troca', clear);
      });
    return;
  }
  if (url.pathname === '/logout') return go('/', [cookie(SESSION_COOKIE, '', 0)]);
  if (url.pathname === '/painel') {
    if (userId === null) return go('/');
    const entry = installs.of(userId);
    const kept = store.get(userId);
    html(
      panelHtml({
        streamer: { login: kept?.login ?? '', name: kept?.name ?? kept?.login ?? '' },
        state: shown(userId),
        totals: entry?.moderator.totals ?? { judged: 0, removed: 0, failed: 0 },
        decisions: entry?.moderator.decisions ?? [],
        config,
        notice: entry?.notice ?? '',
      }),
    );
    return;
  }
  if (url.pathname === '/feed') {
    if (userId === null) {
      response.writeHead(401).end();
      return;
    }
    // `no-cache`, `no-transform` and `X-Accel-Buffering`: an edge in front of the app must hand each event on as it
    // comes, and keep none of it (a CDN caches an event stream like any other answer unless it is told not to).
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-store, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    // The word of now, first: a panel drawn a moment ago may already be behind.
    response.write(stateFrame(wordOf(userId)));
    // A line nobody reads, every so often: an edge closes a connection that stays silent for long.
    const alive = setInterval(() => response.write(': ainda aqui\n\n'), FEED_PING_MS);
    const entry = installs.of(userId);
    entry?.watchers.add(response);
    request.on('close', () => {
      clearInterval(alive);
      entry?.watchers.delete(response);
    });
    return;
  }
  response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('não encontrado');
});

server.listen(config.port, config.host, () => {
  console.log(`Moderador IA em ${config.publicUrl} (porta ${String(config.port)}, em ${config.host})`);
  console.log(`  API ${config.api} · modelo ${config.model}${config.dryRun ? ' · MODO DE TESTE (nada é apagado)' : ''}`);
  const count = installs.startAll(frames);
  console.log(count === 0 ? '  nenhuma live instalada ainda: abra a página e clique em "Instalar na minha live".' : `  ${String(count)} live(s) instalada(s): conectando…`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    installs.stopAll();
    server.close();
    process.exit(0);
  });
}
