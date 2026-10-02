/**
 * What makes the app safe to host for many streamers, with no network: the
 * file the installations are kept in, the cookie that says who is looking at a
 * panel, and the installations themselves — each streamer with her own keys,
 * her own connection and her own decisions, none ever shown to another.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { createInstalls } from '../src/installs.mjs';
import { cookiesOf, PENDING_COOKIE, SESSION_COOKIE, SESSION_MS, sessionUser, sessionValue, setCookie } from '../src/session.mjs';
import { createStore } from '../src/store.mjs';

const dirs = [];
const dataDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'moderador-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const KEYS = { accessToken: 'gfp_a', refreshToken: 'gfr_a', expiresAt: Date.now() + 3_600_000, scope: 'chat:read chat:write chat:moderate' };

describe('the store', () => {
  it('keeps each streamer’s installation in one file, and reads it back after a restart', () => {
    const dir = dataDir();
    const first = createStore(dir);
    assert.deepEqual(first.all(), []);
    first.put({ userId: '100', login: 'bia', ...KEYS });
    first.put({ userId: '200', login: 'ana', ...KEYS, accessToken: 'gfp_b' });
    // A renewal changes the keys and keeps the rest.
    first.put({ userId: '100', accessToken: 'gfp_a2', refreshToken: 'gfr_a2' });
    assert.deepEqual(first.get('100'), { userId: '100', login: 'bia', ...KEYS, accessToken: 'gfp_a2', refreshToken: 'gfr_a2' });
    assert.equal(first.get('300'), null);

    const second = createStore(dir);
    assert.deepEqual(second.all().map((install) => [install.userId, install.login, install.accessToken]), [['100', 'bia', 'gfp_a2'], ['200', 'ana', 'gfp_b']]);
    second.remove('100');
    second.remove('nobody');
    assert.deepEqual(createStore(dir).all().map((install) => install.userId), ['200']);
    // One file, and no draft left beside it.
    assert.deepEqual(readdirSync(dir), ['installs.json']);
  });

  it('the secret the cookies are signed with is born with the file and survives a restart', () => {
    const dir = dataDir();
    const first = createStore(dir);
    assert.ok(first.secret.length >= 32);
    assert.equal(createStore(dir).secret, first.secret);
    assert.notEqual(createStore(dataDir()).secret, first.secret);
    assert.equal(JSON.parse(readFileSync(join(dir, 'installs.json'), 'utf8')).secret, first.secret);
  });

  it('a file that is not what it should be is started over, never trusted', () => {
    const dir = dataDir();
    for (const broken of ['{ not json', '[]', '{"installs":null}', '{"installs":{},"secret":"curto"}']) {
      writeFileSync(join(dir, 'installs.json'), broken);
      const store = createStore(dir);
      assert.deepEqual(store.all(), [], broken);
      assert.ok(store.secret.length >= 32, broken);
    }
    // A directory that does not exist yet is made.
    const fresh = join(dir, 'a', 'b');
    createStore(fresh);
    assert.ok(existsSync(join(fresh, 'installs.json')));
  });
});

describe('the session cookie', () => {
  const SECRET = 'um-segredo-de-teste-bem-comprido-para-assinar';

  it('says who is logged in, for thirty days, and nobody else can make one', () => {
    const now = 1_800_000_000_000;
    const value = sessionValue(SECRET, '98310748255252480', now);
    assert.equal(sessionUser(SECRET, value, now), '98310748255252480');
    assert.equal(sessionUser(SECRET, value, now + SESSION_MS - 1), '98310748255252480');
    // Lapsed, signed with another secret, or touched: nobody.
    assert.equal(sessionUser(SECRET, value, now + SESSION_MS), null);
    assert.equal(sessionUser('outro-segredo', value, now), null);
    const [id, until, signature] = value.split('.');
    assert.equal(sessionUser(SECRET, `999.${until}.${signature}`, now), null);
    assert.equal(sessionUser(SECRET, `${id}.${String(Number(until) + 1)}.${signature}`, now), null);
    for (const junk of [undefined, null, '', 'abc', `${id}.${until}`, `${id}.${until}.${signature}.x`, `a.${until}.${signature}`, `${id}.x.${signature}`, `${id}.${until}.`]) {
      assert.equal(sessionUser(SECRET, junk, now), null, String(junk));
    }
  });

  it('is written for the server alone, for the same site, and over https wherever the app is hosted', () => {
    assert.equal(setCookie(SESSION_COOKIE, 'v', { maxAgeMs: 60_000, secure: true }), 'moderador_sessao=v; Path=/; HttpOnly; SameSite=Lax; Max-Age=60; Secure');
    assert.equal(setCookie(PENDING_COOKIE, '', { maxAgeMs: 0, secure: false }), 'moderador_pedido=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    assert.deepEqual(cookiesOf('a=1; moderador_sessao=x.y.z ; sem-valor; b=c=d'), { a: '1', moderador_sessao: 'x.y.z', b: 'c=d' });
    assert.deepEqual(cookiesOf(undefined), {});
  });
});

describe('the installations', () => {
  /** A channel that does nothing by itself: the test says what the Gamerfy says. */
  function arrange() {
    const store = createStore(dataDir());
    const channels = new Map();
    const connect = (_config, gamerfy, handlers) => {
      const channel = { gamerfy, ...handlers, stopped: false, stop: () => (channel.stopped = true) };
      channels.set(channel, channel);
      return channel;
    };
    const judged = [];
    const installs = createInstalls({
      config: { warnInChat: false, dryRun: true },
      store,
      judge: async (who, text) => (judged.push([who, text]), { action: 'allow', rule: 0, reason: '', ms: 1, tokens: 1 }),
      connect,
      log: () => undefined,
    });
    const frames = { onDecision: (decision, totals) => `decision:${decision.text}:${String(totals.judged)}`, onState: (entry) => `state:${entry.userId}:${String(entry.state.connected)}` };
    const watcher = () => {
      const got = [];
      return { got, write: (frame) => got.push(frame), end: () => got.push('END') };
    };
    const channelOf = (userId) => [...channels.values()].filter((channel) => !channel.stopped).find((channel) => channel.gamerfy.authorized() !== undefined && installs.of(userId)?.channel === channel);
    const line = (id, text) => ({ message_id: id, user_id: '900', user_login: 'tiago', user_name: 'Tiago', text, kind: 'default', is_command: false, badges: [] });
    return { store, installs, frames, watcher, channelOf, judged, line, channels };
  }
  const ready = (channel, id, login) => channel.onState({ connected: true, broadcaster: { id, login, name: login.toUpperCase() }, scopes: ['chat:read', 'chat:write', 'chat:moderate'] });

  it('each streamer has her own keys, her own connection and her own decisions', async () => {
    const { store, installs, frames, watcher, channelOf, judged, line } = arrange();
    installs.install({ userId: '100', login: 'bia', name: 'bia', ...KEYS }, frames);
    installs.install({ userId: '200', login: 'ana', name: 'ana', ...KEYS, accessToken: 'gfp_b' }, frames);
    assert.equal(installs.count(), 2);
    assert.deepEqual(store.all().map((install) => install.userId), ['100', '200']);
    assert.match(store.get('100').installedAt, /^\d{4}-/);

    const bia = watcher();
    const ana = watcher();
    installs.of('100').watchers.add(bia);
    installs.of('200').watchers.add(ana);
    ready(channelOf('100'), '100', 'bia');
    ready(channelOf('200'), '200', 'ana');
    // The name she goes by on the Gamerfy is what the store keeps for her panel.
    assert.equal(store.get('100').name, 'BIA');

    channelOf('100').onEvent('channel.chat.message', line('1', 'no chat da bia'));
    await settle();
    assert.deepEqual(judged, [['Tiago', 'no chat da bia']]);
    assert.deepEqual(installs.of('100').moderator.decisions.map((decision) => decision.text), ['no chat da bia']);
    // Nothing of Bia's chat reaches Ana — not her list, not her open panel.
    assert.deepEqual(installs.of('200').moderator.decisions, []);
    assert.deepEqual(bia.got, ['state:100:true', 'decision:no chat da bia:1']);
    assert.deepEqual(ana.got, ['state:200:true']);
    assert.equal(installs.of('300'), null);
  });

  it('a renewal of one streamer’s keys is kept for her alone', () => {
    const { store, installs, frames } = arrange();
    installs.install({ userId: '100', login: 'bia', name: 'bia', ...KEYS }, frames);
    installs.install({ userId: '200', login: 'ana', name: 'ana', ...KEYS, accessToken: 'gfp_b' }, frames);
    const keys = installs.of('100').gamerfy;
    assert.equal(keys.authorized(), true);
    // What `gamerfy.mjs` does after `POST /oauth2/token`: the pair of this streamer, replaced.
    store.put({ userId: '100', accessToken: 'gfp_novo', refreshToken: 'gfr_novo' });
    assert.equal(store.get('100').accessToken, 'gfp_novo');
    assert.equal(store.get('200').accessToken, 'gfp_b');
  });

  it('a permission that is missing is said on her panel', () => {
    const { installs, frames, channelOf } = arrange();
    installs.install({ userId: '100', login: 'bia', name: 'bia', ...KEYS }, frames);
    const channel = channelOf('100');
    channel.onState({ connected: true, broadcaster: { id: '100', login: 'bia', name: 'Bia' }, scopes: ['chat:read'] });
    assert.equal(installs.of('100').notice, 'Falta a permissão chat:moderate: instale de novo.');
    channel.onState({ connected: true, broadcaster: { id: '100', login: 'bia', name: 'Bia' }, scopes: ['chat:read', 'chat:moderate'] });
    assert.equal(installs.of('100').notice, 'Sem a permissão de escrever: o app apaga, mas não avisa no chat.');
    channel.onState({ connected: true, broadcaster: { id: '100', login: 'bia', name: 'Bia' }, scopes: ['chat:read', 'chat:write', 'chat:moderate'] });
    assert.equal(installs.of('100').notice, '');
  });

  it('the access taken away: her keys are gone, her connection stops, and her open panel is told', () => {
    const { store, installs, frames, watcher, channelOf } = arrange();
    installs.install({ userId: '100', login: 'bia', name: 'bia', ...KEYS }, frames);
    installs.install({ userId: '200', login: 'ana', name: 'ana', ...KEYS }, frames);
    const bia = watcher();
    installs.of('100').watchers.add(bia);
    const channel = channelOf('100');
    ready(channel, '100', 'bia');
    // What the channel does on a 4003: forgets the keys, then says why.
    channel.gamerfy.forget();
    channel.onState({ connected: false, reason: 'o streamer tirou o acesso do app' });
    assert.equal(store.get('100'), null);
    assert.equal(channel.stopped, true);
    assert.deepEqual(bia.got, ['state:100:true', 'state:100:false']);
    // The panel still has what to show her (the reason), and the other streamer is untouched.
    assert.equal(installs.of('100').state.reason, 'o streamer tirou o acesso do app');
    assert.notEqual(store.get('200'), null);
  });

  it('installing again starts over: the old connection stops, the open panels reconnect to the new one', () => {
    const { installs, frames, watcher, channelOf, store } = arrange();
    installs.install({ userId: '100', login: 'bia', name: 'bia', ...KEYS }, frames);
    const first = channelOf('100');
    const panel = watcher();
    installs.of('100').watchers.add(panel);
    const since = store.get('100').installedAt;
    installs.install({ userId: '100', login: 'bia', name: 'bia', ...KEYS, accessToken: 'gfp_novo' }, frames);
    assert.equal(first.stopped, true);
    assert.deepEqual(panel.got, ['END']);
    assert.equal(installs.count(), 1);
    assert.equal(store.get('100').accessToken, 'gfp_novo');
    // Since when she has it is the first time.
    assert.equal(store.get('100').installedAt, since);
  });

  it('when the app starts, every streamer the store remembers is connected again; when it stops, all are let go', async () => {
    const { store, installs, frames, channels } = arrange();
    store.put({ userId: '100', login: 'bia', ...KEYS });
    store.put({ userId: '200', login: 'ana', ...KEYS });
    assert.equal(installs.startAll(frames), 2);
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(installs.count(), 2);
    installs.stopAll();
    assert.equal(installs.count(), 0);
    assert.ok([...channels.values()].every((channel) => channel.stopped));
  });
});
