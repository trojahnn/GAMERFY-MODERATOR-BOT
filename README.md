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

Um processo só atende **todos os streamers que instalaram**: cada um tem as suas chaves, a sua conexão com a própria
live e o seu painel, que abre só para ele. Autorizar o app no Gamerfy é o login — não existe senha do app.

## Rodar no seu computador

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
chat, escrever no chat com o nome do app, apagar mensagens do chat — e, autorizado, você volta já no seu painel, que
passa a dizer "Moderando o chat de …". Pronto: escreva no chat da live (com outra conta) e veja cada decisão aparecer.

O app guarda quem instalou em `installs.json` e renova as chaves sozinho: da próxima vez, `npm start` já conecta
todo mundo.

**Para tirar o app da live:** Configurações → Conexões → Tirar acesso. O app para na hora, só para aquela live.

## Hospedar

Para o app ficar no ar para qualquer streamer, ele roda num container. O `Dockerfile` monta a imagem (Node 22 e o
código, nada mais) e o `.github/workflows/publish.yml` a publica no GitHub Container Registry a cada push:
`ghcr.io/<dono>/<repositório>:latest`, e `:sha-<commit>` para saber qual build é qual.

O que o container precisa, em qualquer hospedagem:

| | |
|---|---|
| **Porta** | `80` (a imagem já sobe nela). `/health` responde `ok` com o processo no ar. |
| **Uma pasta que não se perde** | Um volume montado em `/data`. É lá que fica o `installs.json`; sem volume, cada reinício esquece quem instalou e todo mundo tem de autorizar de novo. |
| **Uma instância só** | Cada instância abre a sua conexão com cada live: duas instâncias julgariam e avisariam em dobro. |
| **Variáveis de ambiente** | `GAMERFY_CLIENT_ID`, `AI_GATEWAY_API_KEY` e `PUBLIC_URL` (o endereço público, com `https://`). As outras do `.env.example` são opcionais. |

No cadastro do app (Configurações → Desenvolvedor), o endereço de volta passa a ser `<PUBLIC_URL>/callback` e a
"Página do app", o próprio `PUBLIC_URL`.

O `installs.json` tem as chaves de cada streamer e o segredo que assina o login do painel: o volume é tão sensível
quanto um `.env`.

Um app ainda **não revisado** pelo Gamerfy pode ser autorizado por até 10 streamers; acima disso, peça a revisão.

### Na Bunny (Magic Containers)

É onde este app roda. O que foi escolhido lá, e por quê:

- **Imagem** `ghcr.io/trojahnn/gamerfy-moderator-bot`, tag `latest`.
- **Endpoint** do tipo CDN apontando para a porta `80` do container, com "Force SSL" ligado no endereço: o login
  viaja num cookie que só anda por `https`. O endereço `mc-….bunny.run` que a Bunny dá é o `PUBLIC_URL`.
- **Volume** de 1 GB montado em `/data`. Ele mora num servidor só e não tem cópia de segurança: se a Bunny trocar o
  disco, o app esquece quem instalou e cada streamer autoriza de novo (um clique). Nada mais se perde.
- **Autoscaling 1 / 1**: uma instância, sempre.
- O painel recebe as decisões ao vivo por um fluxo de eventos; a borda da Bunny o entrega sem configuração, desde
  que ele não fique mudo — o app manda um sinal a cada 25 segundos.

**Atualizar o app:** o container guarda a imagem exata com que subiu, não a tag — uma `latest` nova no registro não
muda nada lá. Depois do push, diga ao container qual tag pegar: no painel da Bunny (o container → imagem → a tag
`sha-<commit>`), ou deixe o próprio push fazer isso salvando no repositório do GitHub o segredo `BUNNYNET_API_KEY`
(a chave da conta na Bunny) e a variável `BUNNY_APP_ID` (o id do app): o último passo do `publish.yml` só roda com
os dois.

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
| `src/index.mjs` | Liga tudo e serve as páginas: a de entrada (`/`), a autorização (`/install`, `/callback`), o painel de quem está logado (`/painel`, `/feed`), `/logout` e `/health`. |
| `src/config.mjs` | A configuração: o `.env` e as variáveis de ambiente. |
| `src/gamerfy.mjs` | A conversa com o Gamerfy: a autorização (OAuth 2 com PKCE), a renovação das chaves, o canal de eventos (com retomada) e as duas rotas de chat. |
| `src/installs.mjs` | Quem instalou: para cada streamer, as chaves, a conexão com a live dele e o seu moderador. |
| `src/store.mjs` | O `installs.json`: o que o app lembra de um reinício para o outro. |
| `src/session.mjs` | O login do painel: um cookie assinado que diz de quem é aquele navegador. |
| `src/judge.mjs` | O juiz: monta o pedido ao modelo e lê o veredito. |
| `src/moderator.mjs` | O que acontece com cada mensagem: julgar, apagar, avisar. |
| `src/page.mjs` | As duas páginas: a de entrada e o painel, que mostra as decisões ao vivo. |
| `rules.md` | As regras do chat. |
| `battery/` | As frases de teste (`lines.mjs`) e o `npm run battery` (`run.mjs`). |
| `test/` | Os testes das partes que decidem alguma coisa: `npm test`. |
| `Dockerfile`, `.github/` | A imagem do container e a sua publicação. |

## O que este exemplo não é

Um moderador de produção. As regras são as mesmas para toda live (o `rules.md`), o painel só lembra as últimas
decisões enquanto o processo está no ar, e tudo cabe num processo só e num arquivo — o bastante para algumas dezenas
de lives, não para milhares. Um modelo de linguagem erra: deixa passar o que não devia e, às vezes, tira o que podia
ficar — comece com `DRY_RUN=true` e leia o que ele decidiria. E ele só apaga mensagem: não silencia nem bloqueia
ninguém (a API pública ainda não tem isso).
