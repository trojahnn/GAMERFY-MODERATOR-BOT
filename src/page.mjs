/**
 * The app's own little page, at http://localhost:<port>: "Instalar na minha
 * live", whether it is connected, and what the moderator did with each line —
 * arriving as it happens (server-sent events: the page never asks on a clock).
 *
 * Every text of a viewer is escaped before it reaches the page: this screen
 * shows, by design, the worst lines of the chat.
 */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ESCAPES[char]);

const CSS = `
:root{color-scheme:dark;--bg:#0e0e10;--card:#18181b;--line:#2a2a30;--fg:#f4f4f5;--soft:#a1a1aa;--p:#9147ff;--ok:#00f593;--bad:#ff5c7a}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,'Segoe UI',sans-serif}
main{max-width:920px;margin:0 auto;padding:28px 16px 60px}
h1{margin:0 0 4px;font-size:22px}
p{margin:0 0 14px;color:var(--soft)}
.card{margin:0 0 16px;padding:16px;border:1px solid var(--line);border-radius:12px;background:var(--card)}
.state{display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px}
.dot{width:10px;height:10px;border-radius:50%;background:var(--soft)}
.dot.on{background:var(--ok)}
.state b{font-size:16px}
.state span{color:var(--soft)}
a.button,button{display:inline-block;margin-left:auto;padding:9px 16px;border:0;border-radius:8px;background:var(--p);color:#fff;font:inherit;font-weight:700;text-decoration:none;cursor:pointer}
button.quiet{margin-left:0;background:#2f2f36}
.numbers{display:flex;flex-wrap:wrap;gap:8px 24px;margin:12px 0 0;color:var(--soft)}
.numbers b{color:var(--fg)}
.note{margin:10px 0 0;color:var(--bad)}
table{width:100%;border-collapse:collapse}
th{padding:6px 8px;border-bottom:1px solid var(--line);color:var(--soft);font-size:12px;text-align:left;text-transform:uppercase;letter-spacing:.06em}
td{padding:8px;border-bottom:1px solid var(--line);vertical-align:top;overflow-wrap:anywhere}
td.when{color:var(--soft);white-space:nowrap}
tr.out td.what{color:var(--bad)}
td small{display:block;color:var(--soft)}
.empty{padding:18px 8px;color:var(--soft)}
`;

function row(decision) {
  const out = decision.action === 'delete';
  return `<tr class="${out ? 'out' : ''}"><td class="when">${escapeHtml(decision.at.slice(11, 19))}</td><td><b>${escapeHtml(decision.who)}</b></td><td class="what">${escapeHtml(decision.text)}${
    out ? `<small>regra ${escapeHtml(decision.rule)} · ${escapeHtml(decision.reason)}</small>` : ''
  }</td><td>${escapeHtml(decision.did)}<small>${escapeHtml(decision.ms)} ms</small></td></tr>`;
}

/**
 * What the page was drawn with, in one word: the feed says the word of NOW when a page connects and each time it
 * changes, and a page drawn with another one loads again. (A page can be drawn a moment before the app connects —
 * right after the streamer comes back from authorizing — and would otherwise say "conectando…" for ever.)
 */
export const stateWord = (state, notice) => [state.connected ? `on:${state.broadcaster.login}` : 'off', state.authorized ? 'authorized' : 'new', state.reason ?? '', notice].join('|');

/** The whole page, drawn on the server: `view` is `{ state, totals, decisions, config, notice }`. */
export function pageHtml(view) {
  const { state, totals, decisions, config, notice } = view;
  const who = state.connected ? `Moderando o chat de ${escapeHtml(state.broadcaster.name)} (@${escapeHtml(state.broadcaster.login)})` : state.authorized ? 'Autorizado, conectando…' : 'Ainda não instalado em nenhuma live';
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Moderador IA</title>
<style>${CSS}</style>
</head>
<body data-word="${escapeHtml(stateWord(state, notice))}">
<main>
<h1>Moderador IA</h1>
<p>Um app de exemplo do Gamerfy: lê o chat da live, tira o que foge das regras e avisa quem escreveu.</p>
<div class="card">
  <div class="state">
    <i class="dot${state.connected ? ' on' : ''}"></i>
    <b>${who}</b>
    ${state.connected || state.reason === undefined ? '' : `<span>${escapeHtml(state.reason)}</span>`}
    <a class="button" href="/install">${state.authorized ? 'Autorizar de novo' : 'Instalar na minha live'}</a>
  </div>
  <div class="numbers">
    <span>julgadas <b id="judged">${escapeHtml(totals.judged)}</b></span>
    <span>apagadas <b id="removed">${escapeHtml(totals.removed)}</b></span>
    <span>falhas <b id="failed">${escapeHtml(totals.failed)}</b></span>
    <span>modelo <b>${escapeHtml(config.model)}</b></span>
    ${config.dryRun ? '<span><b>modo de teste: nada é apagado</b></span>' : ''}
  </div>
  ${notice === '' ? '' : `<p class="note">${escapeHtml(notice)}</p>`}
</div>
<div class="card">
  <table>
    <thead><tr><th>Hora</th><th>Quem</th><th>Mensagem</th><th>O que foi feito</th></tr></thead>
    <tbody id="rows">${decisions.length === 0 ? '<tr id="empty"><td class="empty" colspan="4">Nenhuma mensagem julgada ainda. Escreva no chat da live para ver.</td></tr>' : decisions.map(row).join('')}</tbody>
  </table>
</div>
</main>
<script>
const rows = document.getElementById('rows');
const feed = new EventSource('/feed');
feed.addEventListener('decision', (event) => {
  const { html, totals } = JSON.parse(event.data);
  document.getElementById('empty')?.remove();
  rows.insertAdjacentHTML('afterbegin', html);
  while (rows.children.length > 50) rows.lastElementChild.remove();
  for (const name of ['judged', 'removed', 'failed']) document.getElementById(name).textContent = totals[name];
});
feed.addEventListener('state', (event) => {
  if (JSON.parse(event.data).word !== document.body.dataset.word) location.reload();
});
</script>
</body>
</html>`;
}

/** One decision, as the page receives it while open: the row already drawn (and escaped) on the server. */
export const decisionFrame = (decision, totals) => `event: decision\ndata: ${JSON.stringify({ html: row(decision), totals })}\n\n`;
export const stateFrame = (word) => `event: state\ndata: ${JSON.stringify({ word })}\n\n`;
