# Moderador IA — um app de exemplo para o Gamerfy

Um app de terceiros, como qualquer outro, feito só com a [API pública](https://api.gamerfy.gg): o streamer **instala**
na live dele autorizando o app, e a partir daí o app lê o chat, pede a um modelo de IA para julgar cada mensagem
contra as regras de [`rules.md`](rules.md), **apaga** a que foge delas e **avisa no chat** quem escreveu.

Serve de ponto de partida para o seu: um bot de comandos, um sorteio, um painel — a autorização, o canal de eventos e
as duas rotas de chat são as mesmas.

```
chat da live ──(canal de eventos, chat:read)──▶ Moderador IA ──▶ modelo de IA (Vercel AI Gateway)
                                                     │  "sai, regra 1"
              ◀──(DELETE /v1/chat/messages, chat:moderate)──┤
              ◀──(POST /v1/chat/messages, chat:write)───────┘  "@fulano, sua mensagem foi removida: …"
```

Sem dependências: Node 22 ou mais novo já traz o `fetch` e o `WebSocket`.

## Instalar

### 1. Cadastre o app no Gamerfy (uma vez)

No Gamerfy, em **Configurações → Desenvolvedor**:

1. **Criar app**, com o nome que vai aparecer no chat (por exemplo, "Moderador IA").
2. No cartão do app, **Autorização** → em "Endereços de volta", adicione `http://localhost:8787/callback`; e em
   "Página do app", salve `http://localhost:8787`. É por ela que o streamer volta ao app: em Configurações →
   Conexões, um clique na linha do app abre essa página.
3. No cartão do app, **Bot** → **Ligar bot**. É essa conta que escreve no chat, com o nome do app e o selo BOT.
   (O token de bot que aparece não é usado aqui: pode fechar.)
4. Copie o **Client ID** do app.

### 2. Configure

```bash
cd examples/ai-moderator
cp .env.example .env
```

No `.env`:

- `GAMERFY_CLIENT_ID=` o Client ID do passo 1;
- `AI_GATEWAY_API_KEY=` a sua chave do [Vercel AI Gateway](https://vercel.com/ai-gateway);
- num ambiente de desenvolvimento local, também `GAMERFY_API=http://localhost:4500/api/public` e
  `GAMERFY_SITE=http://localhost:4521`. Sem essas duas linhas o app fala com o Gamerfy de verdade.

### 3. Rode e instale na live

```bash
npm start
```

Abra **http://localhost:8787** e clique em **Instalar na minha live**. O Gamerfy mostra o que o app vai poder — ler o
chat, escrever no chat com o nome do app, apagar mensagens do chat — e, autorizado, a página passa a dizer
"Moderando o chat de …". Pronto: escreva no chat da live (com outra conta) e veja cada decisão aparecer na página.

O app guarda a autorização em `tokens.json` e a renova sozinho: da próxima vez, `npm start` já conecta.

**Para tirar o app da live:** Configurações → Conexões → Tirar acesso. O app para na hora.

## Ajustar

- **As regras** são o arquivo [`rules.md`](rules.md): cada linha numerada é uma regra. Edite e reinicie o app.
- **`npm run battery`**: julga umas quarenta frases de teste (elogio, zoeira, xingamento, ódio, spam, disfarces…) com
  as regras e o modelo de agora, sem tocar em chat nenhum, e diz onde o app faria diferente de um moderador humano.
  `npm run battery -- --times 3` pergunta cada uma três vezes e mostra o que variou. É o jeito de experimentar uma
  regra nova ou outro modelo.
- **`DRY_RUN=true`** no `.env`: o app julga e mostra na página, mas não apaga nem escreve nada. É o jeito de calibrar
  as regras numa live de verdade antes de soltar.
- **`WARN_IN_CHAT=false`**: apaga sem avisar no chat.
- **`AI_MODEL=`** outro modelo do gateway (veja "O modelo").

## Como ele decide

- Só julga mensagem de **gente**: nunca a do próprio streamer, a de um bot (inclusive as dele mesmo), as linhas do
  sistema (presente, "começou a assistir") nem um `/comando`.
- Uma mensagem **editada** é julgada de novo: escrever limpo e editar depois não é um jeito de passar.
- **Na dúvida, fica.** O que o modelo responde só vira remoção se for um `{"action":"delete"}` claro, com uma regra
  que existe. Modelo fora do ar, lento ou respondendo qualquer outra coisa = nada é apagado.
- A mensagem vai ao modelo como **dado**, cercada, e as instruções dizem isso: "ignore as regras acima" escrito no
  chat é só mais uma mensagem a julgar.
- Mensagem **disfarçada** vai junto com a sua leitura sem disfarce: letras espaçadas (`s e u  l i x o`), letras
  trocadas por números (`l1x0`) e abreviação de chat (`fdp`, `vsf`, `pfv`). Um modelo pequeno lê a forma limpa com
  muito mais segurança. Número de verdade — telefone, preço, placar, `ps5` — fica como está.
- O modelo **pensa antes de responder**, e às vezes o pensamento come o espaço da resposta, que chega cortada ou
  vazia. Por isso a decisão vem primeiro na resposta (uma resposta cortada ainda diz o que foi decidido) e uma
  resposta vazia é perguntada de novo, uma vez.
- O aviso no chat sai **uma vez por minuto por pessoa**, por mais mensagens que tenham saído.
- Até 4 mensagens são julgadas ao mesmo tempo; numa enxurrada, as mais antigas da fila passam sem julgamento em vez de
  serem apagadas com um minuto de atraso.

## O modelo

O padrão é `inclusionai/ling-3.0-flash`: em 02/10/2026 era o modelo de linguagem mais barato do Vercel AI Gateway
(US$ 0,021 por milhão de tokens de entrada, US$ 0,063 de saída). Na bateria deste app (`npm run battery -- --times 3`)
ele decidiu as 32 frases claras como um moderador humano decidiria, igual nas três passadas, em cerca de 1,5 s cada;
nas três discutíveis, deixou a zoeira com o streamer e tirou a autopromoção. Uma mensagem custa uns 700 tokens:
**mil mensagens julgadas saem por cerca de um centavo de dólar.** Os três seguintes na lista de preço erraram uma ou
duas de doze (tiraram uma zoeira leve do chat).

Numa live de verdade, com 39 mensagens escritas por contas de teste, ele apagou o que devia em 1,5 s (a pior, 2,6 s)
e não tirou nenhuma mensagem boa.

Um modelo maior erra menos em caso difícil e custa mais; troque em `AI_MODEL` e rode com `DRY_RUN=true` para comparar.

## Os arquivos

| Arquivo | O que faz |
|---|---|
| `src/index.mjs` | Liga tudo e serve a página do app (`/`, `/install`, `/callback`). |
| `src/gamerfy.mjs` | A conversa com o Gamerfy: a autorização (OAuth 2 com PKCE), a renovação das chaves, o canal de eventos (com retomada) e as duas rotas de chat. |
| `src/judge.mjs` | O juiz: monta o pedido ao modelo e lê o veredito. |
| `src/moderator.mjs` | O que acontece com cada mensagem: julgar, apagar, avisar. |
| `src/page.mjs` | A página que mostra as decisões ao vivo. |
| `rules.md` | As regras do chat. |
| `battery/` | As frases de teste (`lines.mjs`) e o `npm run battery` (`run.mjs`). |
| `test/` | Os testes das partes que decidem alguma coisa: `npm test`. |

## O que este exemplo não é

Um moderador de produção. Ele roda na sua máquina, modera **uma** live (a de quem autorizou por último) e não guarda
histórico. Um modelo de linguagem erra: deixa passar o que não devia e, às vezes, tira o que podia ficar — comece com
`DRY_RUN=true` e leia o que ele decidiria. E ele só apaga mensagem: não silencia nem bloqueia ninguém (a API pública
ainda não tem isso).
