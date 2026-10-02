#!/usr/bin/env node
/**
 * `npm run battery` — what the judge decides for each line of the battery
 * (lines.mjs), with the rules of rules.md and the model of `.env`, as they are
 * NOW. Nothing is written anywhere: no chat, no Gamerfy — only the model is
 * asked. It is how a change of the rules, or of the model, is tried before it
 * meets a real chat. `--times 3` asks each line three times: a model does not
 * always answer the same.
 *
 * Costs what the lines cost: some forty calls a pass, a fraction of a cent.
 */
import { readConfig } from '../src/config.mjs';
import { createJudge, readRules } from '../src/judge.mjs';
import { BATTERY, EDIT_AFTER, FLOOD } from './lines.mjs';

const { config } = readConfig();
if (config.gatewayKey === '') {
  console.error('Falta AI_GATEWAY_API_KEY no arquivo .env.');
  process.exit(1);
}
const at = process.argv.indexOf('--times');
const times = at === -1 ? 1 : Math.max(1, Number(process.argv[at + 1]) || 1);
const judge = createJudge({ key: config.gatewayKey, model: config.model, rules: readRules() });
const lines = [...BATTERY, ['go', FLOOD, 'propaganda repetida'], ['go', EDIT_AFTER, 'o que uma edição vira']];

const tally = { right: 0, wrong: 0, either: 0, unsteady: 0 };
let ms = 0;
let tokens = 0;
let asked = 0;
for (const [expected, text, what] of lines) {
  const verdicts = [];
  for (let pass = 0; pass < times; pass += 1) verdicts.push(await judge('tiago_ftw', text));
  for (const verdict of verdicts) {
    ms += verdict.ms;
    tokens += verdict.tokens;
    asked += 1;
  }
  const removals = verdicts.filter((verdict) => verdict.action === 'delete').length;
  const gone = removals * 2 > times;
  const steady = removals === 0 || removals === times;
  if (!steady) tally.unsteady += 1;
  const verdict = expected === 'either' ? 'either' : (expected === 'go') === gone ? 'right' : 'wrong';
  tally[verdict] += 1;
  const first = verdicts.find((each) => each.action === 'delete');
  const failed = verdicts.find((each) => each.error !== undefined);
  console.log(
    `${verdict === 'wrong' ? '✗' : verdict === 'either' ? '~' : '✓'} ${gone ? 'sai ' : 'fica'}${times > 1 ? ` (${String(removals)}/${String(times)})` : ''}  [${what}] ${text.slice(0, 70)}${
      gone && first !== undefined ? `  → regra ${String(first.rule)}: ${first.reason}` : ''
    }${failed === undefined ? '' : `  (o modelo falhou: ${failed.error})`}`,
  );
}
console.log(
  `\n${config.model}: ${String(tally.right)} como um moderador humano faria, ${String(tally.wrong)} diferente, ${String(tally.either)} em casos discutíveis${
    times > 1 ? `, ${String(tally.unsteady)} com resposta que variou entre as ${String(times)} passadas` : ''
  }`,
);
console.log(`${String(Math.round(ms / asked))} ms e ${String(Math.round(tokens / asked))} tokens por mensagem, em média`);
process.exit(tally.wrong > 0 ? 1 : 0);
