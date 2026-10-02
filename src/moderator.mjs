/**
 * The moderator itself: what happens to each line of the chat.
 *
 *   a line arrives → is it one to judge? → the judge → "fica": nothing.
 *                                                    → "sai": the line is
 *     deleted for everybody, and the chat is told why, by the app's bot.
 *
 * Never judged: the streamer's own lines, the lines of bots (this app's
 * included — it must not answer itself), the server's own lines (a gift, "
 * começou a assistir") and `/commands`. An edit is judged again: writing a
 * clean line and then editing it must not be a way around.
 */

/** How many lines are with the judge at once; the rest wait their turn. */
const AT_ONCE = 4;
/** Past this many waiting, the oldest are let through unjudged: a flood must not become an hour of late removals. */
const WAITING_MAX = 200;
/** The same person is told why at most once in this long, however many lines were removed. */
const WARN_EVERY_MS = 60_000;
/** How many decisions the page shows. */
const SHOWN = 50;
/** Whose line an edit is of: the last lines seen, by id. */
const REMEMBERED = 500;

export function warningOf(login, reason) {
  const why = reason === '' ? 'ela foge das regras do chat' : reason.replace(/[.!\s]+$/, '');
  return `@${login}, sua mensagem foi removida: ${why}.`.slice(0, 500);
}

/** Whether a `channel.chat.message` is a line a person wrote, to be judged. */
export function toJudge(data, broadcasterId) {
  return data.kind === 'default' && data.is_command !== true && data.user_id !== broadcasterId && !(Array.isArray(data.badges) && data.badges.includes('bot'));
}

export function createModerator({ judge, gamerfy, config, onDecision = () => undefined, log = console.log, now = () => Date.now() }) {
  let broadcaster = null;
  const waiting = [];
  let busy = 0;
  const warned = new Map();
  const authors = new Map();
  const decisions = [];
  const totals = { judged: 0, removed: 0, failed: 0, tokens: 0 };

  function record(decision) {
    decisions.unshift(decision);
    if (decisions.length > SHOWN) decisions.length = SHOWN;
    onDecision(decision);
  }

  async function handle(line) {
    const verdict = await judge(line.name, line.text);
    totals.judged += 1;
    totals.tokens += verdict.tokens;
    const decision = { at: new Date(now()).toISOString(), id: line.id, who: line.name, text: line.text, action: verdict.action, rule: verdict.rule, reason: verdict.reason, ms: verdict.ms, did: 'ficou' };
    if (verdict.error !== undefined) {
      totals.failed += 1;
      decision.did = `ficou (o modelo não respondeu: ${verdict.error})`;
    } else if (verdict.action === 'delete' && config.dryRun) {
      decision.did = 'sairia (modo de teste: nada foi apagado)';
    } else if (verdict.action === 'delete') {
      try {
        const removed = await gamerfy.deleteLine(broadcaster.id, line.id);
        decision.did = removed ? 'apagada' : 'já tinha saído';
        if (removed) totals.removed += 1;
        const last = warned.get(line.userId) ?? 0;
        if (removed && config.warnInChat && now() - last >= WARN_EVERY_MS) {
          warned.set(line.userId, now());
          await gamerfy.say(broadcaster.id, warningOf(line.login, verdict.reason)).catch((error) => {
            // The line is gone, which is what matters; the warning is a courtesy (an app with no bot cannot give it).
            decision.did = `apagada (sem aviso no chat: ${error.message})`;
          });
        }
      } catch (error) {
        totals.failed += 1;
        decision.did = `não deu para apagar: ${error.message}`;
      }
    }
    record(decision);
    log(`${decision.action === 'delete' ? 'SAI ' : 'fica'}  ${line.name}: ${line.text.slice(0, 80)}${decision.action === 'delete' ? `  → regra ${String(decision.rule)}: ${decision.reason} [${decision.did}]` : ''}`);
  }

  function pump() {
    while (busy < AT_ONCE && waiting.length > 0) {
      const line = waiting.shift();
      busy += 1;
      handle(line)
        .catch((error) => log(`erro ao moderar: ${error.message}`))
        .finally(() => {
          busy -= 1;
          pump();
        });
    }
  }

  function enqueue(line) {
    if (waiting.length >= WAITING_MAX) waiting.shift();
    waiting.push(line);
    pump();
  }

  return {
    decisions,
    totals,
    setBroadcaster(next) {
      broadcaster = next;
    },
    /** One event of the live's channel. */
    onEvent(type, data) {
      if (broadcaster === null) return;
      if (type === 'channel.chat.message') {
        if (!toJudge(data, broadcaster.id)) return;
        const line = { id: data.message_id, userId: data.user_id, login: data.user_login, name: data.user_name || data.user_login, text: data.text };
        authors.set(line.id, line);
        if (authors.size > REMEMBERED) authors.delete(authors.keys().next().value);
        enqueue(line);
        return;
      }
      if (type === 'channel.chat.message_update') {
        // An edit carries the text alone: whose line it is was kept when it arrived.
        const first = authors.get(data.message_id);
        if (first !== undefined) enqueue({ ...first, text: data.text });
        return;
      }
      if (type === 'channel.chat.message_delete') authors.delete(data.message_id);
    },
  };
}
