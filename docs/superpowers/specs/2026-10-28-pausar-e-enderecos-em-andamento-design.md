# Pausar inventário + endereços com o inventário em andamento

**Data:** 2026-10-28
**Status:** aprovado em conversa, aguardando revisão do Tiago
**Build alvo:** 5

## Por quê

Dois problemas vividos no balanço de 22/09/2026:

1. O inventário nasce `aberto` e o coletor já consegue entrar enquanto o admin ainda está montando endereços, catálogo e equipe. Não existe jeito de segurar os coletores sem encerrar.
2. Precisou de cinco endereços a mais no meio do balanço e não havia tela pra isso. Foi feito por script com `arrayUnion`.

Decisões tomadas com o Tiago:

- O inventário continua nascendo `aberto` como hoje. Entra um botão **Pausar / Retomar**.
- Pausar **trava na hora**: quem está bipando vê "Inventário pausado" e não consegue bipar. O que já foi bipado fica salvo, inclusive o que estava offline. Ao retomar, o coletor volta no mesmo endereço.
- Na aba Endereços, com o inventário `aberto` ou `pausado`, dá pra **adicionar** endereços e **remover** só os que estão vazios.

## Fora de escopo

Fase de montagem antes de liberar, regras de bipagem (só produtos carregados, um bipe por código), painel único de progresso, operador sem login, bloqueio por regra do Firestore. Nada disso entra neste build.

## Modelo de dados

`inv_inventarios/{invId}.status` ganha um valor novo:

| status | quem vê | coletor bipa? |
|---|---|---|
| `aberto` | admin e coletor | sim |
| `pausado` | admin (lista de ativos, com chip próprio); coletor vê só a tela de pausa | não |
| `encerrado` | admin (histórico) | não |

Campos novos no documento, só pra rastro:

- `pausadoEm` (timestamp do servidor) e `pausadoPor` (id do usuário) ao pausar.
- `retomadoEm` ao retomar.

`fila`, `atribuicoes`, `enderecos` e bipagens **não são tocados** ao pausar ou retomar. É isso que garante que o coletor volta no mesmo endereço.

Endereços continuam sendo o array `enderecos` (strings). No modo de organização `setores` (só setores), o array `setores` espelha `enderecos` e os dois são atualizados juntos.

## Comportamento

### Pausar / Retomar (admin)

- Botão **Pausar** aparece ao lado de "Encerrar inventário" no detalhe do inventário quando `status === 'aberto'`. Vira **Retomar** quando `status === 'pausado'`. Só admin, gerência e supervisor (mesma regra do Reabrir endereço).
- Pausar pede confirmação curta no próprio padrão de modal do app (sem `confirm()` nativo) e grava `status: 'pausado'`, `pausadoEm`, `pausadoPor`.
- Retomar grava `status: 'aberto'`, `retomadoEm`. Sem confirmação.
- Lista de inventários ativos (`renderInvList`) passa a incluir `pausado`, com chip "Pausado" em âmbar. Histórico continua só `encerrado`.
- Encerrar continua permitido a partir de `pausado`.
- O chip de status no cabeçalho do detalhe mostra "Pausado".
- Os seletores que hoje montam `<option>` com "ativo/encerrado" passam a mostrar "pausado" quando for o caso.

### Coletor durante a pausa

- Enquanto a tela de coleta está aberta, o app mantém um `onSnapshot` no documento do inventário atual (`_coletaInvListener`). Ele é iniciado em `renderColeta` quando há inventário `aberto` ou `pausado` e parado ao sair da tela (mesmo padrão de `_iniciarEnderecosRealtime` / `_pararEnderecosRealtime`).
- Quando o snapshot chega com `status === 'pausado'`: o cache `S.invsCache` é atualizado e a tela de coleta é substituída por um aviso "Inventário pausado pelo responsável. Aguarde." Campo de bip, leitor, câmera e teclado ficam fora. O endereço atual (`_filaEndAtual`) e o ID do coletor em `localStorage` são preservados.
- Quando volta pra `aberto`: `renderColeta()` normal, que já restaura o endereço pela fila.
- Quando vira `encerrado`: comportamento atual (sem inventário aberto).
- Segunda trava: `registrarBipagem` e `registrarBipagemAvulsa` consultam `InvCore.podeBipar(inv)` antes de gravar. Se não puder, mostra toast "Inventário pausado" e não grava. Isso cobre o intervalo entre o pausar e a chegada do snapshot.
- Bipagens gravadas offline **antes** da pausa sobem normalmente quando a rede volta. A trava é só pra bip novo.
- O gate da capa (`_capaEstado`, `precisaInvAberto`) continua considerando só `aberto`, então com tudo pausado a capa mostra "sem inventário" como hoje. Quem já estava na tela de coleta vê o aviso de pausa pelo listener.

### Adicionar endereços (admin)

- Botão **Adicionar endereços** acima da tabela da aba Endereços, visível quando `status` é `aberto` ou `pausado` e o usuário é admin, gerência ou supervisor.
- Abre um modal pequeno com: textarea "um por linha" (mesmo estilo de `ninv-enderecos`), os campos de faixa "de / até" com o mesmo gerador `gerarEnderecosFaixa` reaproveitado por parâmetro de id do textarea, botão Limpar e botão Adicionar.
- No modo `setores`, o label vira "Adicionar setores" e os nomes são normalizados em maiúsculas como na criação.
- Validação pura em `InvCore.prepararNovosEnderecos(existentes, texto)` → `{ novos: [], repetidos: [] }`. Linhas vazias e espaços são descartados; nomes já existentes vão pra `repetidos`.
- Gravação: `update({ enderecos: arrayUnion(...novos) })`, e no modo `setores` também `setores: arrayUnion(...novos)`. Se `novos` estiver vazio, só mostra toast "Todos já existem".
- Toast de resultado: "3 endereços adicionados" e, se houver, "2 já existiam e foram ignorados".
- O slot na fila nasce quando o primeiro coletor entra, como hoje. Etiquetas QR passam a incluir os novos na próxima geração.
- A tabela atualiza sozinha pelo listener `_iniciarEnderecosRealtime` já existente.

### Remover endereço (admin)

- Na tabela, a linha ganha o botão **Remover** só quando `InvCore.podeRemoverEndereco(inv, endereco, bipagens)` for verdadeiro:
  - não existe `fila[endereco]` com coletor, e
  - não existe `atribuicoes[endereco]` com coletor, e
  - nenhuma bipagem do inventário tem `endereco === endereco`.
- Bipagens vêm de `loadBipagensByInv` (cache de 45 s já existente). Pra não travar a tabela, a verificação de bipagem acontece ao clicar: o botão aparece pelas duas primeiras condições, e ao clicar o app carrega as bipagens, reavalia e, se houver bipagem, mostra toast "Este endereço já tem bipagens" sem remover.
- Confirmação no padrão de modal do app. Gravação: `update({ enderecos: arrayRemove(endereco) })` e, no modo `setores`, `setores: arrayRemove(endereco)`.
- Não remove o último endereço: se `enderecos.length === 1`, o botão não aparece.

## Lógica pura (lib/inv-bip-core.js)

Três funções novas, sem Firebase nem DOM, cobertas por teste:

```js
podeBipar(inv)                          // true só se inv && inv.status === 'aberto'
prepararNovosEnderecos(existentes, texto, opts) // opts.maiusculas; retorna { novos, repetidos }
podeRemoverEndereco(inv, endereco, bipagens)    // regras acima; bipagens opcional (undefined = não checa)
```

Testes em `test/inv-bip-core.test.js`:

- `podeBipar`: aberto → true; pausado, encerrado, null → false.
- `prepararNovosEnderecos`: ignora vazios e espaços; separa repetidos (inclusive repetido dentro do próprio texto); aplica maiúsculas quando pedido; não altera o array de existentes.
- `podeRemoverEndereco`: falso com slot na fila; falso com atribuição; falso com bipagem; falso quando é o último; verdadeiro quando vazio.

## Mudanças por arquivo

- `lib/inv-bip-core.js`: as três funções acima.
- `test/inv-bip-core.test.js`: os casos acima.
- `app.js`:
  - `pausarInventario(invId)`, `retomarInventario(invId)`.
  - `_iniciarColetaRealtime(invId)` / `_pararColetaRealtime()` e a tela de pausa em `renderColeta`.
  - Trava em `registrarBipagem` e `registrarBipagemAvulsa`.
  - `abrirModalAddEnderecos()`, `adicionarEnderecos()`, `removerEndereco(invId, endereco)`.
  - `renderInvList`: incluir `pausado` e chip. `renderInvEnderecos`: botão Adicionar e botão Remover por linha.
  - `gerarEnderecosFaixa` recebe o id do textarea alvo (padrão continua `ninv-enderecos`).
  - `BUILD = '5'`.
- `index.html`: botão Pausar/Retomar no cabeçalho do detalhe, botão Adicionar na aba Endereços, modal de adicionar, `?v=5`.
- `sw.js`: `CACHE_NAME` e `?v=5`.
- `version.json`: build 5.
- `firestore.rules`: sem alteração.

## Verificação

1. `npm test` verde com os casos novos.
2. Manual, dois navegadores (admin + coletor em aba anônima):
   - Coletor dentro de um endereço bipando. Admin pausa. Coletor vê a tela de pausa em até 2 s sem recarregar. Admin retoma. Coletor volta no mesmo endereço.
   - Com o inventário pausado, recarregar o app do coletor mostra a capa "sem inventário" e a tela de coleta com o aviso de pausa.
   - Adicionar 3 endereços, um repetido: 2 entram, toast avisa 1 ignorado. Tabela atualiza sem recarregar.
   - Remover só aparece em endereço sem coletor; em endereço com bipagem o clique avisa e não remove.
   - Modo "só setores": adicionar setor novo aparece pro coletor no picker.
3. Publicar BUILD 5 no GitHub Pages e conferir `version.json` na URL pública.
