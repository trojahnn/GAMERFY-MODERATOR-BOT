/**
 * The app's two pages.
 *
 *   • the front page, for anybody: what the app does and "Instalar na minha
 *     live". It says nothing of any chat;
 *   • the panel, for the streamer who is logged in, and for her alone: whether
 *     the app is connected to her live, and what the moderator did with each
 *     line of HER chat — arriving as it happens (server-sent events: the page
 *     never asks on a clock).
 *
 * Every text of a viewer is escaped before it reaches the page: the panel
 * shows, by design, the worst lines of a chat.
 */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ESCAPES[char]);

const CSS = `
:root{color-scheme:dark;--bg:#0e0e10;--card:#18181b;--line:#2a2a30;--fg:#f4f4f5;--soft:#a1a1aa;--p:#9147ff;--ok:#00f593;--bad:#ff5c7a}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,'Segoe UI',sans-serif}
main{max-width:920px;margin:0 auto;padding:28px 16px 60px}
h1{margin:0 0 4px;font-size:22px}
h2{margin:0 0 8px;font-size:16px}
p{margin:0 0 14px;color:var(--soft)}
ul{margin:0 0 14px;padding-left:20px;color:var(--soft)}
li{margin:4px 0}
li b{color:var(--fg)}
.card{margin:0 0 16px;padding:16px;border:1px solid var(--line);border-radius:12px;background:var(--card)}
.state{display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px}
.dot{width:10px;height:10px;border-radius:50%;background:var(--soft)}
.dot.on{background:var(--ok)}
.state b{font-size:16px}
.state span{color:var(--soft)}
.actions{display:flex;flex-wrap:wrap;gap:8px;margin-left:auto}
a.button{display:inline-block;padding:9px 16px;border-radius:8px;background:var(--p);color:#fff;font-weight:700;text-decoration:none}
a.button.quiet{background:#2f2f36}
.numbers{display:flex;flex-wrap:wrap;gap:8px 24px;margin:12px 0 0;color:var(--soft)}
.numbers b{color:var(--fg)}
.note{margin:10px 0 0;color:var(--bad)}
.fine{margin:14px 0 0;font-size:13px}
.fine a{color:var(--fg)}
table{width:100%;border-collapse:collapse}
th{padding:6px 8px;border-bottom:1px solid var(--line);color:var(--soft);font-size:12px;text-align:left;text-transform:uppercase;letter-spacing:.06em}
td{padding:8px;border-bottom:1px solid var(--line);vertical-align:top;overflow-wrap:anywhere}
td.when{color:var(--soft);white-space:nowrap}
tr.out td.what{color:var(--bad)}
td small{display:block;color:var(--soft)}
.empty{padding:18px 8px;color:var(--soft)}
`;

const shell = (title, word, body, script = '') => `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>${CSS}</style>
</head>
<body data-word="${escapeHtml(word)}">
<main>
${body}
</main>${script === '' ? '' : `\n<script>${script}</script>`}
</body>
</html>`;

/* --------------------------------------------------------- the front page */

/**
 * For anybody. `rules` is what the moderator removes, as the app was set up; `notice` is what went wrong with an
 * authorization that did not finish.
 */
export function frontHtml({ rules, config, notice = '' }) {
  return shell(
    'Moderador IA',
    'front',
    `<h1>Moderador IA</h1>
<p>Um moderador com inteligência artificial para o chat da sua live no Gamerfy: lê cada mensagem, tira a que foge das regras e avisa quem escreveu.</p>
<div class="card">
  <div class="state">
    <b>Coloque na sua live em um clique</b>
    <span class="actions"><a class="button" href="/install">Instalar na minha live</a></span>
  </div>
  ${notice === '' ? '' : `<p class="note">${escapeHtml(notice)}</p>`}
  <p class="fine">O Gamerfy mostra o que o app vai poder — ler o chat, escrever no chat com o nome do app e apagar mensagens — e você autoriza. Já instalou? O mesmo botão abre o seu painel.</p>
</div>
<div class="card">
  <h2>O que sai do chat</h2>
  <ul>${rules.map((rule) => `<li>${escapeHtml(rule.text)}</li>`).join('')}</ul>
  <p>Todo o resto fica: gíria, palavrão solto, zoeira leve, reclamar do jogo. Na dúvida, a mensagem fica.</p>
  <h2>O que ele nunca faz</h2>
  <ul>
    <li>Não julga as mensagens do streamer, nem as de outros bots.</li>
    <li>Não silencia nem bloqueia ninguém: só apaga a mensagem.</li>
    <li>Não vê senha, pagamento nem a chave de transmissão: o Gamerfy não entrega isso a nenhum app.</li>
  </ul>
  <p class="fine">Para tirar o app da sua live: no Gamerfy, em Configurações → Conexões → Tirar acesso. Ele para na hora.${config.dryRun ? ' <b>Este servidor está em modo de teste: nada é apagado.</b>' : ''}</p>
</div>`,
  );
}

/* --------------------------------------------------------------- the panel */

/** The hour of a decision as the streamer's clock says it — the app's own may be anywhere (a container runs in UTC). */
export const hourOf = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour12: false });

function row(decision) {
  const out = decision.action === 'delete';
  return `<tr class="${out ? 'out' : ''}"><td class="when">${escapeHtml(hourOf(decision.at))}</td><td><b>${escapeHtml(decision.who)}</b></td><td class="what">${escapeHtml(decision.text)}${
    out ? `<small>regra ${escapeHtml(decision.rule)} · ${escapeHtml(decision.reason)}</small>` : ''
  }</td><td>${escapeHtml(decision.did)}<small>${escapeHtml(decision.ms)} ms</small></td></tr>`;
}

/**
 * What the panel was drawn with, in one word: the feed says the word of NOW when a page connects and each time it
 * changes, and a page drawn with another one loads again. (A panel can be drawn a moment before the app connects —
 * right after the streamer comes back from authorizing — and would otherwise say "conectando…" for ever.)
 */
export const stateWord = (state, notice) => [state.connected ? `on:${state.broadcaster.login}` : 'off', state.installed ? 'installed' : 'gone', state.reason ?? '', notice].join('|');

const PANEL_SCRIPT = `
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
`;

/**
 * The panel of ONE streamer: `view` is `{ streamer, state, totals, decisions, config, notice }`, where `state` says
 * whether the app is connected to her live and `state.installed` whether she still has it installed.
 */
export function panelHtml(view) {
  const { streamer, state, totals, decisions, config, notice } = view;
  const name = state.connected ? state.broadcaster.name : streamer.name;
  const login = state.connected ? state.broadcaster.login : streamer.login;
  const who = !state.installed
    ? 'O app não está mais instalado na sua live'
    : state.connected
      ? `Moderando o chat de ${escapeHtml(name)} (@${escapeHtml(login)})`
      : `Instalado na live de @${escapeHtml(login)}, conectando…`;
  return shell(
    'Moderador IA · painel',
    stateWord(state, notice),
    `<h1>Moderador IA</h1>
<p>O que o moderador fez com cada mensagem do chat da sua live. Só você vê esta página.</p>
<div class="card">
  <div class="state">
    <i class="dot${state.connected ? ' on' : ''}"></i>
    <b>${who}</b>
    ${state.connected || state.reason === undefined ? '' : `<span>${escapeHtml(state.reason)}</span>`}
    <span class="actions">${state.installed ? '' : '<a class="button" href="/install">Instalar de novo</a>'}<a class="button quiet" href="/logout">Sair</a></span>
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
</div>`,
    PANEL_SCRIPT,
  );
}

/** One decision, as the panel receives it while open: the row already drawn (and escaped) on the server. */
export const decisionFrame = (decision, totals) => `event: decision\ndata: ${JSON.stringify({ html: row(decision), totals })}\n\n`;
export const stateFrame = (word) => `event: state\ndata: ${JSON.stringify({ word })}\n\n`;
