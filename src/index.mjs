#!/usr/bin/env node
/**
 * Moderador IA — an example app for the Gamerfy public API.
 *
 * It is a third-party app like any other: a streamer installs it in her live
 * by authorizing it (the same screen every app uses), and from then on it
 * reads the chat, has a language model judge each line against the rules of
 * rules.md, deletes what breaks them and says why in the chat.
 *
 *   npm start      then open http://localhost:8787 and press "Instalar na minha live"
 *
 * README.md says how to register the app and what each file is.
 */
import http from 'node:http';
import { readConfig } from './config.mjs';
import { authorizationOf, createGamerfy, createKeyStore, listen } from './gamerfy.mjs';
import { createJudge, readRules } from './judge.mjs';
import { createModerator } from './moderator.mjs';
import { decisionFrame, pageHtml, stateFrame, stateWord } from './page.mjs';

const { config, missing } = readConfig();
if (missing.length > 0) {
  console.error(`Falta no arquivo .env: ${missing.join(', ')}. Veja o README.md, "Instalar".`);
  process.exit(1);
}

const rules = readRules();
const gamerfy = createGamerfy(config, createKeyStore(config.keysFile));
const judge = createJudge({ key: config.gatewayKey, model: config.model, rules });

/** The pages open right now, each waiting for the next decision. */
const watchers = new Set();
const tell = (frame) => {
  for (const watcher of watchers) watcher.write(frame);
};

let state = { connected: false };
let notice = '';
/** The state as the page shows it, and the word a page compares its own with (page.mjs). */
const shown = () => ({ ...state, authorized: gamerfy.authorized() });
const word = () => stateWord(shown(), notice);
const moderator = createModerator({
  judge,
  gamerfy,
  config,
  onDecision: (decision) => tell(decisionFrame(decision, moderator.totals)),
});

const channel = listen(config, gamerfy, {
  onEvent: (type, data) => moderator.onEvent(type, data),
  onState(next) {
    state = next;
    if (next.connected) {
      moderator.setBroadcaster(next.broadcaster);
      const lacking = ['chat:read', 'chat:moderate'].filter((scope) => !next.scopes.includes(scope));
      notice = lacking.length > 0 ? `Falta a permissão ${lacking.join(' e ')}: autorize de novo.` : next.scopes.includes('chat:write') ? '' : 'Sem a permissão de escrever: o app apaga, mas não avisa no chat.';
      console.log(`conectado: moderando o chat de @${next.broadcaster.login}`);
    } else if (next.reason !== undefined) {
      console.log(`desconectado: ${next.reason}`);
    }
    tell(stateFrame(word()));
  },
});

/** The authorization on its way: what was sent, until the streamer comes back with the code. */
let pending = null;

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://localhost:${String(config.port)}`);
  const html = (status, body) => {
    response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(body);
  };
  const home = (message = '') => {
    notice = message === '' ? notice : message;
    response.writeHead(302, { Location: '/' });
    response.end();
  };

  if (request.method !== 'GET') {
    response.writeHead(405).end();
    return;
  }
  if (url.pathname === '/') {
    html(200, pageHtml({ state: shown(), totals: moderator.totals, decisions: moderator.decisions, config, notice }));
    return;
  }
  if (url.pathname === '/install') {
    pending = authorizationOf(config);
    response.writeHead(302, { Location: pending.url });
    response.end();
    return;
  }
  if (url.pathname === '/callback') {
    const sent = pending;
    pending = null;
    // A return nobody asked for (another `state`) is refused: it is how a forged link is told from the real one.
    if (sent === null || url.searchParams.get('state') !== sent.state) return home('Essa volta não é de um pedido deste app. Clique em "Instalar na minha live" de novo.');
    if (url.searchParams.get('error') !== null) return home('A autorização foi recusada na tela do Gamerfy.');
    const code = url.searchParams.get('code');
    if (code === null) return home('O Gamerfy voltou sem o código. Tente de novo.');
    gamerfy.exchange(code, sent.verifier).then(
      () => {
        channel.restart();
        home('');
        notice = '';
      },
      (error) => home(`Não deu para concluir a autorização: ${error.message}`),
    );
    return;
  }
  if (url.pathname === '/feed') {
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    // The word of now, first: a page drawn a moment ago may already be behind.
    response.write(stateFrame(word()));
    watchers.add(response);
    request.on('close', () => watchers.delete(response));
    return;
  }
  response.writeHead(404).end();
});

// Only this machine: the page shows the chat's worst lines, and "Instalar" starts an authorization.
server.listen(config.port, '127.0.0.1', () => {
  console.log(`Moderador IA em http://localhost:${String(config.port)}`);
  console.log(`  API ${config.api} · modelo ${config.model}${config.dryRun ? ' · MODO DE TESTE (nada é apagado)' : ''}`);
  console.log(gamerfy.authorized() ? '  já autorizado: conectando ao chat…' : '  abra a página e clique em "Instalar na minha live".');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    channel.stop();
    server.close();
    process.exit(0);
  });
}
