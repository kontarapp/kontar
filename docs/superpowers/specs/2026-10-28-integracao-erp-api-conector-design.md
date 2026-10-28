# Kontar — Integração com ERP via API + conector (parceiro inicial: Dlinks)

Data: 2026-10-28. Status: aprovado em conversa, aguardando revisão do Tiago neste arquivo.

## 1. Objetivo

Permitir que um balanço do Kontar receba o catálogo do ERP e devolva a contagem sem arquivo, com o Kontar como centro da integração. O parceiro inicial é o ERP **Dlinks** (MySQL central por cliente, sem API própria). O **TXT continua sendo a entrada e saída oficial** para os ~90% de clientes sem integração; nada muda para eles.

Decisões já tomadas:

- O Kontar expõe uma **API** no próprio Firebase (Cloud Functions, projeto `kontar-e2650`). Exige plano Blaze (cartão). Custo estimado: R$2 a R$3 por balanço grande, zero nos meses sem balanço. Alerta de orçamento de R$20/mês.
- Nós construímos o **conector** que roda na central de cada cliente Dlinks (o Tiago instala). O conector é só um cliente da API; se um dia o Dlinks desenvolver o lado dele, ele chama as mesmas URLs e o conector é desligado.
- Cada balanço tem **uma origem** (ERP ou Kontar). Não existe sincronia nos dois sentidos de configuração.
- Endereços, setores, modo fila, coletores, bipagens, correções, recontagem e auditoria são do Kontar. O ERP recebe só a contagem final por produto (e, se o layout dele tiver campo de local, também por endereço).

## 2. Arquitetura

```
┌──────────────┐  HTTPS + token   ┌──────────────────────────┐
│ Conector     │ ───────────────► │ API Kontar               │
│ (na central  │ ◄─────────────── │ Cloud Functions (Node)   │
│  do cliente) │  webhook/eventos │ projeto kontar-e2650     │
└──────┬───────┘                  └────────────┬─────────────┘
       │ MySQL (leitura; escrita só            │ Admin SDK
       │ na tabela de contagem)                ▼
┌──────▼───────┐                  ┌──────────────────────────┐
│ Dlinks       │                  │ Firestore (mesmas        │
│ banco central│                  │ coleções inv_* de hoje)  │
└──────────────┘                  └──────────────────────────┘
```

Componentes:

| Componente | Onde roda | Responsabilidade |
|---|---|---|
| API Kontar | Cloud Functions | contrato público: balanços, catálogo, contagem, eventos; autenticação por token; log |
| Conector | servidor central do cliente (Windows, Node, serviço) | adaptador Dlinks: lê tabelas do ERP, chama a API, grava contagem no ERP |
| App Kontar | GitHub Pages | aba **Integrações** (token, webhook, log), etiquetas de origem/estado do ERP no balanço, botões "Buscar catálogo do ERP" e "Reenviar contagem" |

## 3. API Kontar

Base: `https://<regiao>-kontar-e2650.cloudfunctions.net/api/v1`. Todas as chamadas levam `Authorization: Bearer <token do cliente>`. O token identifica o `clienteId`; a loja vai no corpo ou na query.

| Método e rota | Função |
|---|---|
| `GET /balancos?loja=&status=` | lista balanços do cliente (filtro por loja e status) |
| `POST /balancos` | cria balanço com origem `erp`: `{ refErp, nome, loja, tipo: geral/parcial, sequencial, enderecos[], setores[] }` |
| `PATCH /balancos/{id}` | atualiza configuração de balanço de origem `erp` ainda aberto (endereços, sequencial) |
| `GET /balancos/{id}` | status, origem, totais (bipagens, endereços concluídos), estado da integração |
| `PUT /balancos/{id}/catalogo` | substitui o catálogo: `{ itens: [{ codigo, ean, descricao, un, estoque, custo, venda }] }`; grava em `inv_catalogo_blocos` exatamente como a importação do TXT. Idempotente (mesmo conteúdo = mesmo resultado). Limite por chamada: 5.000 itens; chamadas com `parte`/`total` para catálogos maiores |
| `GET /balancos/{id}/contagem?porEndereco=0|1` | contagem consolidada por produto (`codigo, ean, descricao, un, quantidade, estoque, diferenca`), opcionalmente por endereço. Só para balanço `encerrado`; senão 409 |
| `POST /balancos/{id}/contagem/confirmar` | o ERP avisa que importou: grava `erp.contagemRecebidaEm` |
| `GET /eventos?desde=` | fila de eventos do cliente (alternativa ao webhook) |

Eventos (webhook `POST` na URL cadastrada em Integrações, ou via `GET /eventos`): `balanco.aberto`, `catalogo.recebido`, `balanco.encerrado`, `contagem.disponivel`, `contagem.confirmada`. Corpo: `{ evento, balancoId, loja, refErp, em }`. Reentrega até 5 vezes com espera crescente se a URL responder erro.

Regras:

- Token: gerado na aba Integrações (admin), guardado em `clientes/{clienteId}.integracao.tokenHash` (SHA-256). Um token ativo por cliente; regenerar invalida o anterior.
- Toda chamada grava uma linha em `clientes/{clienteId}/integracao_log/{auto}` (`em, rota, status, ms, resumo`). Retenção 90 dias.
- Idempotência: `PUT catalogo` compara hash do conteúdo com `erp.catalogoHash`; `POST balancos` com `refErp` já existente devolve o balanço existente (200) em vez de criar outro.
- Erros em JSON: `{ erro: "codigo", mensagem }` com 400/401/404/409/500.
- Campos no doc do balanço (`inv_inventarios`): `origem: 'erp'|'kontar'`, `erp: { refErp, catalogoEm, catalogoItens, catalogoHash, contagemEnviadaEm, contagemRecebidaEm, erro, erroEm }`. Nenhuma coleção nova fora de `integracao_log`.

## 4. Conector (adaptador Dlinks)

Programa Node único, instalado como serviço Windows na central do cliente, com um módulo por ERP (`erps/dlinks.js`; outros ERPs no futuro são outro arquivo). Configuração em `conector.json`:

```json
{
  "kontar": { "url": "https://.../api/v1", "token": "..." },
  "erp": "dlinks",
  "mysql": { "host": "192.168.x.x", "user": "kontar_ro", "password": "...", "database": "central" },
  "lojas": { "1": "Loja 1 Centro", "2": "Loja 2 Bairro" },
  "intervaloSeg": 60
}
```

Ciclo (a cada `intervaloSeg`):

1. **Balanços novos no Dlinks** (origem ERP): lê a tabela de balanços abertos do Dlinks; para cada um sem par no Kontar, `POST /balancos` com `refErp` = número do balanço no Dlinks, loja, tipo, sequencial, endereços; depois `PUT catalogo` com os itens (no parcial, só o recorte do balanço) e estoque da loja.
2. **Configuração alterada no Dlinks** (endereços, sequencial) em balanço ainda aberto: `PATCH`.
3. **Pedidos do Kontar** (origem Kontar): balanço com `erp.pedirCatalogo = true` → monta o catálogo da loja e faz `PUT catalogo`; limpa a flag.
4. **Balanços encerrados** sem `erp.contagemEnviadaEm`: `GET contagem` e grava na tabela de importação do Dlinks no layout deles; marca enviada; `POST confirmar` quando o Dlinks acusar a leitura (se o layout tiver status) ou imediatamente após gravar (se não tiver).
5. Qualquer falha: grava `erp.erro`/`erroEm` no balanço via API (`PATCH`), aparece em vermelho no Kontar, e tenta de novo no próximo ciclo. Log local em arquivo com rotação.

Regras de segurança no MySQL do cliente: usuário próprio, somente leitura, com `INSERT`/`UPDATE` apenas na tabela de importação de contagem. Nunca `DROP`/`TRUNCATE`. No Econômico, primeiro contra o MySQL de teste do .254; produção só depois do piloto.

## 5. App Kontar

- **Aba Integrações** (admin): gerar/regenerar token, URL do webhook, lista das últimas 100 chamadas com status, botão "Reenviar contagem" por balanço.
- **Balanço**: etiqueta de origem (`ERP` ou `Kontar`); bloco "ERP" com catálogo recebido (hora, itens), contagem enviada, contagem recebida, erro. Em origem ERP, os campos de configuração ficam travados com aviso "configurado no ERP".
- **Botão "Buscar catálogo do ERP"** em balanço de origem Kontar (só aparece se o cliente tiver integração ativa): seta `erp.pedirCatalogo`.
- Nada muda na importação TXT, exportação, coleta, dashboard, auditoria.

## 6. O que o Dlinks precisa informar

1. Tabela onde fica o balanço aberto (número, loja, data, status, tipo geral/parcial, sequencial) e, se existir, a tabela de endereços do balanço e o recorte de itens do parcial.
2. Tabela e layout que eles leem como contagem de inventário (nome, colunas obrigatórias, campo de status/lido, se aceita local/endereço).
3. Coluna de estoque por loja na tabela de itens, e colunas de custo e venda por loja.
4. Usuário MySQL com as permissões do item 4.

Se o item 1 não existir no Dlinks, a origem ERP não é possível e todo balanço nasce no Kontar com "Buscar catálogo do ERP". O restante do desenho não muda.

## 7. Fora do escopo

API pública para terceiros sem contrato, portal de parceiro, outros ERPs, sincronia de endereços nos dois sentidos, cobrança.

## 8. Testes

- Unitários (node --test): mapeamento linha Dlinks → item do catálogo; contagem → linha da tabela do Dlinks; hash/idempotência do catálogo; cálculo da contagem reaproveita `lib/inv-bip-core.js` (já coberto).
- API: testes contra o emulador do Firebase (auth por token, 409 em contagem de balanço aberto, idempotência de `POST balancos` e `PUT catalogo`).
- Integração: conector contra o MySQL de teste do .254 com um balanço fictício; depois piloto real com uma loja do Econômico, balanço pequeno, antes de instalar na CAHU.

## 9. Ordem de entrega

1. Plano Blaze + alerta de orçamento (Tiago). Perguntas enviadas ao Dlinks (doc `docs/api.md` + lista da seção 6).
2. API: token, `GET/POST/PATCH balancos`, `PUT catalogo`, `GET contagem`, log. Aba Integrações mínima (token + log).
3. Conector com origem Kontar (botão "Buscar catálogo") e envio de contagem para o MySQL de teste.
4. Origem ERP (balanço aberto no Dlinks aparece no Kontar) quando o Dlinks responder o item 1.
5. Webhook/eventos e "Reenviar contagem".
6. Piloto Econômico → instalação CAHU.
