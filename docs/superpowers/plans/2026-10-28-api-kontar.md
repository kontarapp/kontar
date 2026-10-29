# API Kontar (Cloud Functions) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publicar a API HTTP do Kontar no Firebase (projeto `kontar-e2650`) com token por cliente, rotas de balanço, catálogo e contagem, e log de chamadas, conforme a spec `docs/superpowers/specs/2026-10-28-integracao-erp-api-conector-design.md` (seção 3).

**Architecture:** Uma Cloud Function HTTP (`api`, 2ª geração, Node 20, região `southamerica-east1`) com Express. Módulos puros (token, validação de catálogo, hash, contagem) ficam em `functions/lib/` e são testados com `node --test` sem Firebase. O acesso ao Firestore fica em `functions/src/repo.js`, único lugar que fala com o banco. O cálculo da contagem reaproveita `lib/inv-bip-core.js` do app (copiado para `functions/lib/` no `prebuild`, nunca editado lá).

**Tech Stack:** firebase-functions v5 (2nd gen), firebase-admin v12, express 4, Node 20, `node --test`, Firebase CLI (já logada como tiago.freire.silva@gmail.com).

## Global Constraints

- Projeto Firebase: `kontar-e2650`, plano Blaze ativo (28/10/26). Região das funções: `southamerica-east1`.
- Coleções existentes e seus campos NÃO mudam de formato: `inv_inventarios`, `inv_catalogo_blocos` (`{invId, clienteId, n, itens:[{c,e,d,u,q,k,v}]}` com 1000 itens por bloco), `inv_bipagens`, `clientes`, `usuarios`.
- Campos novos permitidos no doc do balanço: `origem`, `erp: { refErp, catalogoEm, catalogoItens, catalogoHash, contagemEnviadaEm, contagemRecebidaEm, erro, erroEm, pedirCatalogo }`.
- Única coleção nova: subcoleção `clientes/{clienteId}/integracao_log`.
- Token: SHA-256 hex do token em `clientes/{clienteId}.integracao.tokenHash`; um token ativo por cliente.
- Erros sempre em JSON `{ erro, mensagem }`, status 400/401/404/409/500.
- Limite de 5.000 itens por chamada em `PUT catalogo`; chamadas com `parte`/`total` para catálogos maiores.
- ES5 não é exigido no backend (Node 20), mas o app continua ES5; nada deste plano toca `app.js` além da Task 9.
- Cada task termina com `npm test` verde em `functions/` e commit.

---

### Task 1: Scaffold de `functions/` e deploy de um `GET /v1/ping`

**Files:**
- Create: `functions/package.json`, `functions/index.js`, `functions/src/app.js`, `functions/.gitignore`
- Create: `firebase.json`, `.firebaserc`
- Modify: `.gitignore` (raiz) — adicionar `functions/node_modules`
- Test: `functions/test/app.test.js`

**Interfaces:**
- Produces: `criarApp()` em `functions/src/app.js` devolve um `express()` com as rotas montadas em `/v1`. `index.js` exporta `api = onRequest(criarApp())`.

- [ ] **Step 1: Criar `functions/package.json`**

```json
{
  "name": "kontar-api",
  "private": true,
  "engines": { "node": "20" },
  "main": "index.js",
  "scripts": {
    "prebuild": "node scripts/copiar-core.js",
    "test": "npm run prebuild && node --test",
    "deploy": "npm run prebuild && firebase deploy --only functions --project kontar-e2650"
  },
  "dependencies": {
    "express": "^4.19.2",
    "firebase-admin": "^12.4.0",
    "firebase-functions": "^5.1.0"
  }
}
```

- [ ] **Step 2: Criar `functions/scripts/copiar-core.js`** (copia o núcleo do app, nunca edita)

```js
// Copia lib/inv-bip-core.js do app para functions/lib/ (deploy só empacota functions/).
const fs = require('fs'); const path = require('path');
const origem = path.join(__dirname, '..', '..', 'lib', 'inv-bip-core.js');
const destino = path.join(__dirname, '..', 'lib', 'inv-bip-core.js');
fs.mkdirSync(path.dirname(destino), { recursive: true });
fs.copyFileSync(origem, destino);
console.log('inv-bip-core.js copiado');
```

- [ ] **Step 3: Escrever o teste que falha** em `functions/test/app.test.js`

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { criarApp } = require('../src/app');

function chamar(app, metodo, caminho, corpo, headers) {
  return new Promise((resolve, reject) => {
    const srv = http.createServer(app).listen(0, () => {
      const porta = srv.address().port;
      const dados = corpo ? JSON.stringify(corpo) : null;
      const req = http.request({ port: porta, method: metodo, path: caminho,
        headers: Object.assign({ 'content-type': 'application/json' }, headers || {}) }, (res) => {
        let b = ''; res.on('data', (c) => b += c);
        res.on('end', () => { srv.close(); resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null }); });
      });
      req.on('error', (e) => { srv.close(); reject(e); });
      if (dados) req.write(dados); req.end();
    });
  });
}
module.exports.chamar = chamar;

test('GET /v1/ping responde ok sem token', async () => {
  const r = await chamar(criarApp({ repo: {} }), 'GET', '/v1/ping');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
});
```

- [ ] **Step 4: Rodar e ver falhar**

Run: `cd functions && npm install && npm test`
Expected: FAIL com "Cannot find module '../src/app'".

- [ ] **Step 5: Criar `functions/src/app.js` e `functions/index.js`**

```js
// functions/src/app.js
const express = require('express');

// deps: { repo } — injetado para testes sem Firestore.
function criarApp(deps) {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.get('/v1/ping', (req, res) => res.json({ ok: true, em: new Date().toISOString() }));
  app.use((req, res) => res.status(404).json({ erro: 'nao_encontrado', mensagem: 'Rota inexistente' }));
  app.use((err, req, res, next) => {
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ erro: 'json_invalido', mensagem: 'Corpo não é JSON válido' });
    console.error(err);
    res.status(500).json({ erro: 'interno', mensagem: 'Erro interno' });
  });
  return app;
}
module.exports = { criarApp };
```

```js
// functions/index.js
const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
admin.initializeApp();
const { criarApp } = require('./src/app');
const { criarRepo } = require('./src/repo');
exports.api = onRequest({ region: 'southamerica-east1', memory: '512MiB', timeoutSeconds: 120 },
  criarApp({ repo: criarRepo(admin.firestore()) }));
```

```js
// functions/src/repo.js (esqueleto; cresce nas tasks seguintes)
function criarRepo(db) { return { db }; }
module.exports = { criarRepo };
```

- [ ] **Step 6: Criar `firebase.json`, `.firebaserc`, gitignores**

```json
// firebase.json
{
  "firestore": { "rules": "firestore.rules", "indexes": "firestore.indexes.json" },
  "functions": [{ "source": "functions", "codebase": "api", "runtime": "nodejs20",
    "predeploy": ["npm --prefix functions run prebuild"] }]
}
```

```json
// .firebaserc
{ "projects": { "default": "kontar-e2650" } }
```

`functions/.gitignore`: `node_modules\nlib/inv-bip-core.js\n` (a cópia é gerada). Raiz `.gitignore`: acrescentar `functions/node_modules`.

- [ ] **Step 7: Rodar teste e ver passar**

Run: `cd functions && npm test`
Expected: `pass 1`.

- [ ] **Step 8: Deploy e smoke**

Run: `cd functions && npm run deploy`
Expected: termina com a URL `https://southamerica-east1-kontar-e2650.cloudfunctions.net/api`.
Run: `curl https://southamerica-east1-kontar-e2650.cloudfunctions.net/api/v1/ping`
Expected: `{"ok":true,...}`.

- [ ] **Step 9: Commit**

```bash
git add firebase.json .firebaserc .gitignore functions
git commit -m "API Kontar: scaffold Cloud Functions + GET /v1/ping"
```

---

### Task 2: Token por cliente (módulo puro + middleware)

**Files:**
- Create: `functions/lib/token.js`, `functions/src/auth.js`
- Modify: `functions/src/repo.js`, `functions/src/app.js`
- Test: `functions/test/token.test.js`, `functions/test/auth.test.js`

**Interfaces:**
- Produces: `gerarToken()` → string de 48 hex; `hashToken(token)` → sha256 hex. `repo.clientePorTokenHash(hash)` → `{ id, nome }` ou `null`. Middleware `exigirToken(repo)` põe `req.cliente = { id, nome }` ou responde 401. `repo.registrarLog(clienteId, { rota, status, ms, resumo })`.

- [ ] **Step 1: Teste do módulo puro** `functions/test/token.test.js`

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { gerarToken, hashToken } = require('../lib/token');

test('gerarToken devolve 48 hex e nunca repete', () => {
  const a = gerarToken(), b = gerarToken();
  assert.match(a, /^[0-9a-f]{48}$/);
  assert.notEqual(a, b);
});
test('hashToken é sha256 hex determinístico', () => {
  assert.equal(hashToken('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
```

- [ ] **Step 2: Rodar, ver falhar** — `npm test` → "Cannot find module '../lib/token'".

- [ ] **Step 3: Implementar `functions/lib/token.js`**

```js
const crypto = require('crypto');
function gerarToken() { return crypto.randomBytes(24).toString('hex'); }
function hashToken(t) { return crypto.createHash('sha256').update(String(t)).digest('hex'); }
module.exports = { gerarToken, hashToken };
```

- [ ] **Step 4: Teste do middleware** `functions/test/auth.test.js`

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { criarApp } = require('../src/app');
const { chamar } = require('./app.test');
const { hashToken } = require('../lib/token');

function repoFake() {
  const log = [];
  return {
    log,
    clientePorTokenHash: async (h) => h === hashToken('tok-ok') ? { id: 'loja-teste', nome: 'Loja Teste' } : null,
    registrarLog: async (clienteId, item) => { log.push(Object.assign({ clienteId }, item)); }
  };
}

test('rota protegida sem token → 401', async () => {
  const r = await chamar(criarApp({ repo: repoFake() }), 'GET', '/v1/eu');
  assert.equal(r.status, 401); assert.equal(r.body.erro, 'nao_autorizado');
});
test('token válido → 200 com cliente e grava log', async () => {
  const repo = repoFake();
  const r = await chamar(criarApp({ repo }), 'GET', '/v1/eu', null, { authorization: 'Bearer tok-ok' });
  assert.equal(r.status, 200); assert.equal(r.body.clienteId, 'loja-teste');
  assert.equal(repo.log.length, 1); assert.equal(repo.log[0].rota, 'GET /v1/eu'); assert.equal(repo.log[0].status, 200);
});
```

- [ ] **Step 5: Rodar, ver falhar** — 404 em `/v1/eu`.

- [ ] **Step 6: Implementar `functions/src/auth.js` e ligar no app**

```js
// functions/src/auth.js
const { hashToken } = require('../lib/token');
function exigirToken(repo) {
  return async (req, res, next) => {
    const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
    if (!m) return res.status(401).json({ erro: 'nao_autorizado', mensagem: 'Envie Authorization: Bearer <token>' });
    const cliente = await repo.clientePorTokenHash(hashToken(m[1]));
    if (!cliente) return res.status(401).json({ erro: 'nao_autorizado', mensagem: 'Token inválido' });
    req.cliente = cliente;
    const t0 = Date.now();
    res.on('finish', () => {
      repo.registrarLog(cliente.id, { rota: req.method + ' ' + req.path, status: res.statusCode, ms: Date.now() - t0,
        resumo: res.locals.resumo || '' }).catch(() => {});
    });
    next();
  };
}
module.exports = { exigirToken };
```

Em `app.js`, antes do 404: 
```js
const { exigirToken } = require('./auth');
const v1 = express.Router();
v1.use(exigirToken(deps.repo));
v1.get('/eu', (req, res) => res.json({ clienteId: req.cliente.id, nome: req.cliente.nome }));
app.use('/v1', v1);
```
(O `/v1/ping` fica registrado ANTES do router, sem token.)

- [ ] **Step 7: Implementar no `repo.js`**

```js
const { FieldValue } = require('firebase-admin/firestore');
function criarRepo(db) {
  return {
    db,
    async clientePorTokenHash(hash) {
      const s = await db.collection('clientes').where('integracao.tokenHash', '==', hash).limit(1).get();
      if (s.empty) return null;
      const d = s.docs[0]; return { id: d.id, nome: d.data().nome || d.id };
    },
    async registrarLog(clienteId, item) {
      await db.collection('clientes').doc(clienteId).collection('integracao_log').add(Object.assign({ em: FieldValue.serverTimestamp() }, item));
    }
  };
}
module.exports = { criarRepo };
```

- [ ] **Step 8: Rodar, ver passar** — `npm test` → `pass 5`.

- [ ] **Step 9: Commit** — `git commit -am "API: token por cliente (hash sha256), middleware e log de chamadas"` (com `git add functions`).

---

### Task 3: `GET /v1/balancos` e `GET /v1/balancos/:id`

**Files:**
- Create: `functions/src/rotas/balancos.js`, `functions/lib/formatar.js`
- Modify: `functions/src/repo.js`, `functions/src/app.js`
- Test: `functions/test/balancos.test.js`, `functions/test/formatar.test.js`

**Interfaces:**
- Produces: `repo.listarBalancos(clienteId, { loja, status })` → array de docs `{ id, ...data }`; `repo.obterBalanco(clienteId, id)` → doc ou `null` (null também quando `clienteId` não bate). `formatarBalanco(doc, extras)` → objeto público `{ id, nome, loja, status, origem, tipo, sequencial, enderecos, setores, criadoEm, encerradoEm, erp, totais }`.
- `repo.contarBipagens(invId)` → número (count aggregation).

- [ ] **Step 1: Teste do formatador** `functions/test/formatar.test.js`

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { formatarBalanco } = require('../lib/formatar');

test('formatarBalanco expõe só campos públicos e normaliza datas', () => {
  const em = { toDate: () => new Date('2026-10-28T12:00:00Z') };
  const out = formatarBalanco({ id: 'x', nome: 'Inv', loja: '1', status: 'aberto', enderecos: ['1', '2'], setores: ['A'],
    criadoEm: em, atribuicoes: { segredo: 1 }, fila: {}, erp: { refErp: '77', catalogoEm: em } }, { bipagens: 3 });
  assert.deepEqual(out, { id: 'x', nome: 'Inv', loja: '1', status: 'aberto', origem: 'kontar', tipo: 'geral', sequencial: false,
    enderecos: ['1', '2'], setores: ['A'], criadoEm: '2026-10-28T12:00:00.000Z', encerradoEm: null,
    erp: { refErp: '77', catalogoEm: '2026-10-28T12:00:00.000Z', catalogoItens: null, contagemEnviadaEm: null, contagemRecebidaEm: null, erro: null },
    totais: { bipagens: 3, enderecos: 2 } });
});
```

- [ ] **Step 2: Rodar, ver falhar.** — módulo inexistente.

- [ ] **Step 3: Implementar `functions/lib/formatar.js`**

```js
function iso(v) { if (!v) return null; if (v.toDate) return v.toDate().toISOString(); if (v instanceof Date) return v.toISOString(); return null; }
function formatarBalanco(d, extras) {
  const erp = d.erp || {};
  return {
    id: d.id, nome: d.nome || '', loja: d.loja || '', status: d.status || 'aberto', origem: d.origem || 'kontar',
    tipo: d.tipo || 'geral', sequencial: !!d.sequencial, enderecos: d.enderecos || [], setores: d.setores || [],
    criadoEm: iso(d.criadoEm), encerradoEm: iso(d.encerradoEm),
    erp: { refErp: erp.refErp || null, catalogoEm: iso(erp.catalogoEm), catalogoItens: erp.catalogoItens == null ? null : erp.catalogoItens,
      contagemEnviadaEm: iso(erp.contagemEnviadaEm), contagemRecebidaEm: iso(erp.contagemRecebidaEm), erro: erp.erro || null },
    totais: { bipagens: (extras && extras.bipagens) || 0, enderecos: (d.enderecos || []).length }
  };
}
module.exports = { formatarBalanco, iso };
```

- [ ] **Step 4: Teste das rotas** `functions/test/balancos.test.js` (repo fake em memória)

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { criarApp } = require('../src/app');
const { chamar } = require('./app.test');
const { hashToken } = require('../lib/token');
const H = { authorization: 'Bearer tok-ok' };

function repoFake(balancos) {
  return {
    balancos: balancos || [],
    clientePorTokenHash: async (h) => h === hashToken('tok-ok') ? { id: 'loja-teste', nome: 'Loja Teste' } : null,
    registrarLog: async () => {},
    listarBalancos: async function (clienteId, f) { return this.balancos.filter(b => b.clienteId === clienteId && (!f.loja || b.loja === f.loja) && (!f.status || b.status === f.status)); },
    obterBalanco: async function (clienteId, id) { return this.balancos.find(b => b.id === id && b.clienteId === clienteId) || null; },
    contarBipagens: async () => 7
  };
}
module.exports.repoFake = repoFake;

test('GET /v1/balancos filtra por loja e status do cliente do token', async () => {
  const repo = repoFake([
    { id: 'a', clienteId: 'loja-teste', loja: '1', status: 'aberto', nome: 'A' },
    { id: 'b', clienteId: 'loja-teste', loja: '2', status: 'aberto', nome: 'B' },
    { id: 'c', clienteId: 'outro', loja: '1', status: 'aberto', nome: 'C' }]);
  const r = await chamar(criarApp({ repo }), 'GET', '/v1/balancos?loja=1&status=aberto', null, H);
  assert.equal(r.status, 200); assert.deepEqual(r.body.balancos.map(b => b.id), ['a']);
});
test('GET /v1/balancos/:id devolve totais e 404 para outro cliente', async () => {
  const repo = repoFake([{ id: 'a', clienteId: 'loja-teste', loja: '1', status: 'aberto', nome: 'A', enderecos: ['1'] },
    { id: 'c', clienteId: 'outro', loja: '1', status: 'aberto', nome: 'C' }]);
  const ok = await chamar(criarApp({ repo }), 'GET', '/v1/balancos/a', null, H);
  assert.equal(ok.status, 200); assert.equal(ok.body.totais.bipagens, 7);
  const nf = await chamar(criarApp({ repo }), 'GET', '/v1/balancos/c', null, H);
  assert.equal(nf.status, 404); assert.equal(nf.body.erro, 'nao_encontrado');
});
```

- [ ] **Step 5: Rodar, ver falhar** (404 nas rotas).

- [ ] **Step 6: Implementar `functions/src/rotas/balancos.js` e montar no app**

```js
const express = require('express');
const { formatarBalanco } = require('../../lib/formatar');
function rotasBalancos(repo) {
  const r = express.Router();
  r.get('/', async (req, res, next) => { try {
    const lista = await repo.listarBalancos(req.cliente.id, { loja: req.query.loja || '', status: req.query.status || '' });
    res.json({ balancos: lista.map(b => formatarBalanco(b)) });
  } catch (e) { next(e); } });
  r.get('/:id', async (req, res, next) => { try {
    const b = await repo.obterBalanco(req.cliente.id, req.params.id);
    if (!b) return res.status(404).json({ erro: 'nao_encontrado', mensagem: 'Balanço não encontrado' });
    const bipagens = await repo.contarBipagens(b.id);
    res.json(formatarBalanco(b, { bipagens }));
  } catch (e) { next(e); } });
  return r;
}
module.exports = { rotasBalancos };
```
Em `app.js`: `v1.use('/balancos', rotasBalancos(deps.repo));`

- [ ] **Step 7: Implementar no `repo.js`**

```js
async listarBalancos(clienteId, f) {
  let q = db.collection('inv_inventarios').where('clienteId', '==', clienteId);
  if (f.loja) q = q.where('loja', '==', f.loja);
  if (f.status) q = q.where('status', '==', f.status);
  const s = await q.get(); return s.docs.map(d => Object.assign({ id: d.id }, d.data()));
},
async obterBalanco(clienteId, id) {
  const d = await db.collection('inv_inventarios').doc(id).get();
  if (!d.exists || d.data().clienteId !== clienteId) return null;
  return Object.assign({ id: d.id }, d.data());
},
async contarBipagens(invId) {
  const s = await db.collection('inv_bipagens').where('invId', '==', invId).count().get();
  return s.data().count;
}
```

- [ ] **Step 8: Rodar, ver passar; deploy; smoke com token real.** Para o smoke, gerar um token: `node -e "const t=require('./lib/token');const x=t.gerarToken();console.log(x,t.hashToken(x))"` e gravar o hash em `clientes/loja-teste.integracao.tokenHash` pelo console do Firebase (a aba Integrações da Task 9 passa a fazer isso). `curl -H "Authorization: Bearer <token>" .../api/v1/balancos` → lista.

- [ ] **Step 9: Commit** — `git commit -m "API: GET /v1/balancos e /v1/balancos/:id"`.

---

### Task 4: Validação e hash do catálogo (módulo puro)

**Files:**
- Create: `functions/lib/catalogo.js`
- Test: `functions/test/catalogo.test.js`

**Interfaces:**
- Produces: `validarItens(itens)` → `{ ok: true, itens: [{c,e,d,u,q,k,v}] }` ou `{ ok: false, mensagem }`; `hashItens(itens)` → sha256 hex estável (ordem dos campos fixa); `paraBlocos(itens)` → usa `InvCore.montarBlocos(itens, 1000)`.

- [ ] **Step 1: Teste** `functions/test/catalogo.test.js`

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { validarItens, hashItens, paraBlocos } = require('../lib/catalogo');

test('validarItens converte campos públicos para o formato dos blocos', () => {
  const r = validarItens([{ codigo: '1001', ean: ' 7891000100103 ', descricao: 'LEITE', un: 'un', estoque: '48', custo: '4,10', venda: 5.99 }]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.itens[0], { c: '1001', e: '7891000100103', d: 'LEITE', u: 'UN', q: 48, k: 4.1, v: 5.99 });
});
test('validarItens rejeita item sem código e sem EAN, lista vazia e mais de 5000', () => {
  assert.equal(validarItens([{ descricao: 'X' }]).ok, false);
  assert.equal(validarItens([]).ok, false);
  const muitos = []; for (let i = 0; i < 5001; i++) muitos.push({ codigo: String(i) });
  assert.match(validarItens(muitos).mensagem, /5000/);
});
test('validarItens: estoque/custo/venda ausentes viram null, descrição corta em 120', () => {
  const r = validarItens([{ codigo: '1', descricao: 'X'.repeat(200) }]);
  assert.equal(r.itens[0].q, null); assert.equal(r.itens[0].k, null); assert.equal(r.itens[0].d.length, 120);
});
test('hashItens é estável e muda com o conteúdo', () => {
  const a = hashItens([{ c: '1', e: '', d: 'A', u: '', q: 1, k: null, v: null }]);
  const b = hashItens([{ c: '1', e: '', d: 'A', u: '', q: 1, k: null, v: null }]);
  const c = hashItens([{ c: '1', e: '', d: 'B', u: '', q: 1, k: null, v: null }]);
  assert.equal(a, b); assert.notEqual(a, c); assert.match(a, /^[0-9a-f]{64}$/);
});
test('paraBlocos quebra em 1000', () => {
  const itens = []; for (let i = 0; i < 2500; i++) itens.push({ c: String(i), e: '', d: 'I', u: '', q: null, k: null, v: null });
  assert.deepEqual(paraBlocos(itens).map(b => b.length), [1000, 1000, 500]);
});
```

- [ ] **Step 2: Rodar, ver falhar.**

- [ ] **Step 3: Implementar `functions/lib/catalogo.js`**

```js
const crypto = require('crypto');
const InvCore = require('./inv-bip-core.js');
const LIMITE = 5000;
function num(v) { if (v == null || v === '') return null; const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? null : n; }
function validarItens(itens) {
  if (!Array.isArray(itens) || !itens.length) return { ok: false, mensagem: 'itens deve ser uma lista com ao menos 1 item' };
  if (itens.length > LIMITE) return { ok: false, mensagem: 'Máximo de ' + LIMITE + ' itens por chamada; use parte/total' };
  const out = [];
  for (let i = 0; i < itens.length; i++) {
    const it = itens[i] || {};
    const c = String(it.codigo == null ? '' : it.codigo).trim(), e = String(it.ean == null ? '' : it.ean).replace(/\s/g, '');
    if (!c && !e) return { ok: false, mensagem: 'Item ' + (i + 1) + ' sem codigo e sem ean' };
    out.push({ c, e, d: String(it.descricao == null ? '' : it.descricao).slice(0, 120), u: String(it.un == null ? '' : it.un).trim().toUpperCase(),
      q: num(it.estoque), k: num(it.custo), v: num(it.venda) });
  }
  return { ok: true, itens: out };
}
function hashItens(itens) {
  const h = crypto.createHash('sha256');
  itens.forEach(it => h.update([it.c, it.e, it.d, it.u, it.q, it.k, it.v].map(x => x == null ? '' : String(x)).join('\u001f') + '\n'));
  return h.digest('hex');
}
function paraBlocos(itens) { return InvCore.montarBlocos(itens, 1000); }
module.exports = { validarItens, hashItens, paraBlocos, LIMITE };
```

- [ ] **Step 4: Rodar, ver passar. Commit** — `git commit -m "API: validação, hash e blocos do catálogo (módulo puro)"`.

---

### Task 5: `PUT /v1/balancos/:id/catalogo` (idempotente, com partes)

**Files:**
- Modify: `functions/src/rotas/balancos.js`, `functions/src/repo.js`
- Test: `functions/test/catalogo-rota.test.js`

**Interfaces:**
- Consumes: Task 4.
- Produces: `repo.substituirCatalogo(invId, clienteId, blocos, meta)` apaga blocos antigos e grava novos (`{invId, clienteId, n, itens}`) e atualiza `erp.catalogoEm/catalogoItens/catalogoHash` no balanço; `repo.guardarParteCatalogo(invId, parte, total, itens)` / `repo.lerPartesCatalogo(invId)` / `repo.limparPartesCatalogo(invId)` em `inv_inventarios/{id}/catalogo_partes/{parte}` (subcoleção temporária; some após montar).

Contrato: corpo `{ itens: [...] }` para catálogo de até 5.000; ou `{ parte: n, total: N, itens: [...] }` com partes 1..N, cada uma ≤ 5.000; a última parte dispara a montagem. Resposta 200 `{ itens: total, blocos, hash, inalterado: bool }`. 409 se balanço `encerrado`.

- [ ] **Step 1: Teste** `functions/test/catalogo-rota.test.js`

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { criarApp } = require('../src/app');
const { chamar } = require('./app.test');
const { repoFake } = require('./balancos.test');
const H = { authorization: 'Bearer tok-ok' };

function repoCat(bal) {
  const r = repoFake([bal]);
  r.gravacoes = []; r.partes = {};
  r.substituirCatalogo = async (invId, clienteId, blocos, meta) => { r.gravacoes.push({ invId, blocos: blocos.length, meta }); bal.erp = Object.assign({}, bal.erp, meta); };
  r.guardarParteCatalogo = async (invId, parte, total, itens) => { r.partes[parte] = itens; };
  r.lerPartesCatalogo = async () => Object.keys(r.partes).sort((a, b) => a - b).map(k => r.partes[k]);
  r.limparPartesCatalogo = async () => { r.partes = {}; };
  return r;
}
const bal = () => ({ id: 'a', clienteId: 'loja-teste', loja: '1', status: 'aberto', nome: 'A' });

test('PUT catalogo grava blocos e devolve hash; repetir igual = inalterado', async () => {
  const repo = repoCat(bal());
  const corpo = { itens: [{ codigo: '1', ean: '7891000100103', descricao: 'LEITE', estoque: 10 }] };
  const r1 = await chamar(criarApp({ repo }), 'PUT', '/v1/balancos/a/catalogo', corpo, H);
  assert.equal(r1.status, 200); assert.equal(r1.body.itens, 1); assert.equal(r1.body.inalterado, false);
  const r2 = await chamar(criarApp({ repo }), 'PUT', '/v1/balancos/a/catalogo', corpo, H);
  assert.equal(r2.status, 200); assert.equal(r2.body.inalterado, true); assert.equal(repo.gravacoes.length, 1);
});
test('PUT catalogo em balanço encerrado → 409; item inválido → 400', async () => {
  const b = bal(); b.status = 'encerrado';
  const r = await chamar(criarApp({ repo: repoCat(b) }), 'PUT', '/v1/balancos/a/catalogo', { itens: [{ codigo: '1' }] }, H);
  assert.equal(r.status, 409);
  const r2 = await chamar(criarApp({ repo: repoCat(bal()) }), 'PUT', '/v1/balancos/a/catalogo', { itens: [{ descricao: 'x' }] }, H);
  assert.equal(r2.status, 400); assert.equal(r2.body.erro, 'catalogo_invalido');
});
test('PUT catalogo em partes monta na última', async () => {
  const repo = repoCat(bal()); const app = criarApp({ repo });
  const p1 = await chamar(app, 'PUT', '/v1/balancos/a/catalogo', { parte: 1, total: 2, itens: [{ codigo: '1' }] }, H);
  assert.equal(p1.status, 202); assert.equal(repo.gravacoes.length, 0);
  const p2 = await chamar(app, 'PUT', '/v1/balancos/a/catalogo', { parte: 2, total: 2, itens: [{ codigo: '2' }] }, H);
  assert.equal(p2.status, 200); assert.equal(p2.body.itens, 2); assert.equal(repo.gravacoes.length, 1);
});
```

- [ ] **Step 2: Rodar, ver falhar.**

- [ ] **Step 3: Implementar a rota** (em `rotasBalancos`)

```js
const { validarItens, hashItens, paraBlocos } = require('../../lib/catalogo');
r.put('/:id/catalogo', async (req, res, next) => { try {
  const b = await repo.obterBalanco(req.cliente.id, req.params.id);
  if (!b) return res.status(404).json({ erro: 'nao_encontrado', mensagem: 'Balanço não encontrado' });
  if (b.status === 'encerrado') return res.status(409).json({ erro: 'balanco_encerrado', mensagem: 'Balanço encerrado não aceita catálogo' });
  const v = validarItens(req.body && req.body.itens);
  if (!v.ok) return res.status(400).json({ erro: 'catalogo_invalido', mensagem: v.mensagem });
  let itens = v.itens;
  const parte = parseInt(req.body.parte), total = parseInt(req.body.total);
  if (parte || total) {
    if (!(parte >= 1 && total >= 1 && parte <= total)) return res.status(400).json({ erro: 'parte_invalida', mensagem: 'parte deve estar entre 1 e total' });
    await repo.guardarParteCatalogo(b.id, parte, total, itens);
    if (parte < total) { res.locals.resumo = 'parte ' + parte + '/' + total; return res.status(202).json({ parte, total, aguardando: true }); }
    itens = [].concat.apply([], await repo.lerPartesCatalogo(b.id));
    await repo.limparPartesCatalogo(b.id);
  }
  const hash = hashItens(itens);
  if (b.erp && b.erp.catalogoHash === hash) { res.locals.resumo = 'inalterado'; return res.json({ itens: itens.length, blocos: Math.ceil(itens.length / 1000), hash, inalterado: true }); }
  const blocos = paraBlocos(itens);
  await repo.substituirCatalogo(b.id, req.cliente.id, blocos, { catalogoEm: new Date(), catalogoItens: itens.length, catalogoHash: hash, erro: null, erroEm: null });
  res.locals.resumo = itens.length + ' itens';
  res.json({ itens: itens.length, blocos: blocos.length, hash, inalterado: false });
} catch (e) { next(e); } });
```

- [ ] **Step 4: Implementar no `repo.js`**

```js
async substituirCatalogo(invId, clienteId, blocos, meta) {
  const col = db.collection('inv_catalogo_blocos');
  const antigos = await col.where('invId', '==', invId).get();
  let b = db.batch(), n = 0;
  const flush = async () => { if (n) { await b.commit(); b = db.batch(); n = 0; } };
  for (const d of antigos.docs) { b.delete(d.ref); if (++n >= 400) await flush(); }
  await flush();
  for (let i = 0; i < blocos.length; i++) { b.set(col.doc(invId + '_' + i), { invId, clienteId, n: i, itens: blocos[i] }); if (++n >= 20) await flush(); }
  await flush();
  const upd = {}; Object.keys(meta).forEach(k => { upd['erp.' + k] = meta[k]; });
  await db.collection('inv_inventarios').doc(invId).update(upd);
},
async guardarParteCatalogo(invId, parte, total, itens) {
  await db.collection('inv_inventarios').doc(invId).collection('catalogo_partes').doc(String(parte)).set({ parte, total, itens, em: FieldValue.serverTimestamp() });
},
async lerPartesCatalogo(invId) {
  const s = await db.collection('inv_inventarios').doc(invId).collection('catalogo_partes').orderBy('parte').get();
  return s.docs.map(d => d.data().itens);
},
async limparPartesCatalogo(invId) {
  const s = await db.collection('inv_inventarios').doc(invId).collection('catalogo_partes').get();
  const b = db.batch(); s.docs.forEach(d => b.delete(d.ref)); await b.commit();
}
```

(Blocos de 1000 itens ≈ 150 KB; 20 por batch fica abaixo do limite de 10 MB por commit.)

- [ ] **Step 5: Rodar, ver passar. Deploy. Smoke:** `PUT` com 3 itens no balanço "inv teste" e conferir no app que o catálogo aparece ("Catálogo: 3 produtos"). Repetir e ver `inalterado: true`.

- [ ] **Step 6: Commit** — `git commit -m "API: PUT /v1/balancos/:id/catalogo (idempotente, partes)"`.

---

### Task 6: `GET /v1/balancos/:id/contagem`

**Files:**
- Create: `functions/lib/contagem.js`
- Modify: `functions/src/rotas/balancos.js`, `functions/src/repo.js`
- Test: `functions/test/contagem.test.js`, `functions/test/contagem-rota.test.js`

**Interfaces:**
- Produces: `montarContagem(cat, bips, resolucoes, { porEndereco })` → `{ itens: [{ codigo, ean, descricao, un, quantidade, estoque, diferenca, naoCadastrado }], porEndereco?: [{ endereco, itens: [{ codigo, ean, quantidade }] }], totais: { itens, unidades, naoCadastrados } }`. `repo.lerCatalogo(invId)` → `InvCore.criarCatalogo(itens)`; `repo.lerBipagens(invId)` → array de docs.

- [ ] **Step 1: Teste puro** `functions/test/contagem.test.js`

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const InvCore = require('../lib/inv-bip-core.js');
const { montarContagem } = require('../lib/contagem');
const cat = () => InvCore.criarCatalogo([{ c: '1', e: '7891000000011', d: 'A', u: 'UN', q: 10 }, { c: '2', e: '7891000000028', d: 'B', u: 'UN', q: 5 }]);

test('montarContagem soma por produto e inclui não coletados com quantidade 0', () => {
  const out = montarContagem(cat(), [{ codigo: '1', qty: 6, endereco: 'C01' }, { codigo: '1', qty: 4, endereco: 'C02' }], {}, {});
  const a = out.itens.find(i => i.codigo === '1'), b = out.itens.find(i => i.codigo === '2');
  assert.deepEqual(a, { codigo: '1', ean: '7891000000011', descricao: 'A', un: 'UN', quantidade: 10, estoque: 10, diferenca: 0, naoCadastrado: false });
  assert.equal(b.quantidade, 0); assert.equal(b.diferenca, -5);
  assert.deepEqual(out.totais, { itens: 2, unidades: 10, naoCadastrados: 0 });
});
test('montarContagem porEndereco devolve quantidade por endereço', () => {
  const out = montarContagem(cat(), [{ codigo: '1', qty: 6, endereco: 'C01' }, { codigo: '1', qty: 4, endereco: 'C02' }], {}, { porEndereco: true });
  assert.deepEqual(out.porEndereco, [{ endereco: 'C01', itens: [{ codigo: '1', ean: '7891000000011', quantidade: 6 }] },
    { endereco: 'C02', itens: [{ codigo: '1', ean: '7891000000011', quantidade: 4 }] }]);
});
test('montarContagem marca não cadastrado', () => {
  const out = montarContagem(cat(), [{ codigo: '', ean: '7896036093481', qty: 3, endereco: 'C01' }], {}, {});
  const nc = out.itens.find(i => i.naoCadastrado);
  assert.equal(nc.ean, '7896036093481'); assert.equal(nc.quantidade, 3); assert.equal(out.totais.naoCadastrados, 1);
});
```

- [ ] **Step 2: Rodar, ver falhar.**

- [ ] **Step 3: Implementar `functions/lib/contagem.js`**

```js
const InvCore = require('./inv-bip-core.js');
function montarContagem(cat, bips, resolucoes, opts) {
  const r = InvCore.calcularResultado(cat, bips || [], resolucoes || {});
  const itens = r.linhas.map(l => ({ codigo: l.codigo || '', ean: l.ean || '', descricao: l.nc ? '' : l.desc, un: l.un || '',
    quantidade: l.contado, estoque: l.sistema, diferenca: l.dif, naoCadastrado: !!l.nc }));
  const out = { itens, totais: { itens: itens.length, unidades: itens.reduce((s, i) => s + i.quantidade, 0), naoCadastrados: itens.filter(i => i.naoCadastrado).length } };
  if (opts && opts.porEndereco) {
    const byKey = {}; r.linhas.forEach(l => { byKey[l.key] = l; });
    out.porEndereco = Object.keys(r.porEnd).sort((a, b) => String(a).localeCompare(String(b), 'pt-BR', { numeric: true })).map(e => ({ endereco: e,
      itens: Object.keys(r.porEnd[e]).map(k => ({ codigo: (byKey[k] && byKey[k].codigo) || '', ean: (byKey[k] && byKey[k].ean) || '', quantidade: r.porEnd[e][k] })) }));
  }
  return out;
}
module.exports = { montarContagem };
```

- [ ] **Step 4: Teste da rota** `functions/test/contagem-rota.test.js`

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const InvCore = require('../lib/inv-bip-core.js');
const { criarApp } = require('../src/app');
const { chamar } = require('./app.test');
const { repoFake } = require('./balancos.test');
const H = { authorization: 'Bearer tok-ok' };

test('GET contagem: 409 se aberto, 200 com itens se encerrado', async () => {
  const b = { id: 'a', clienteId: 'loja-teste', loja: '1', status: 'aberto', nome: 'A' };
  const repo = repoFake([b]);
  repo.lerCatalogo = async () => InvCore.criarCatalogo([{ c: '1', e: '', d: 'A', u: 'UN', q: 10 }]);
  repo.lerBipagens = async () => [{ codigo: '1', qty: 10, endereco: 'C01' }];
  const r1 = await chamar(criarApp({ repo }), 'GET', '/v1/balancos/a/contagem', null, H);
  assert.equal(r1.status, 409);
  b.status = 'encerrado';
  const r2 = await chamar(criarApp({ repo }), 'GET', '/v1/balancos/a/contagem?porEndereco=1', null, H);
  assert.equal(r2.status, 200); assert.equal(r2.body.itens[0].quantidade, 10); assert.equal(r2.body.porEndereco.length, 1);
});
```

- [ ] **Step 5: Implementar rota e repo**

```js
const { montarContagem } = require('../../lib/contagem');
r.get('/:id/contagem', async (req, res, next) => { try {
  const b = await repo.obterBalanco(req.cliente.id, req.params.id);
  if (!b) return res.status(404).json({ erro: 'nao_encontrado', mensagem: 'Balanço não encontrado' });
  if (b.status !== 'encerrado') return res.status(409).json({ erro: 'balanco_aberto', mensagem: 'Contagem só disponível para balanço encerrado' });
  const [cat, bips] = await Promise.all([repo.lerCatalogo(b.id), repo.lerBipagens(b.id)]);
  const out = montarContagem(cat, bips, b.resolucoes || {}, { porEndereco: req.query.porEndereco === '1' });
  out.balancoId = b.id; out.loja = b.loja || ''; out.encerradoEm = require('../../lib/formatar').iso(b.encerradoEm);
  res.locals.resumo = out.totais.itens + ' itens';
  res.json(out);
} catch (e) { next(e); } });
```

```js
// repo.js
async lerCatalogo(invId) {
  const s = await db.collection('inv_catalogo_blocos').where('invId', '==', invId).get();
  let itens = []; s.docs.sort((a, b) => (a.data().n || 0) - (b.data().n || 0)).forEach(d => { itens = itens.concat(d.data().itens || []); });
  return InvCore.criarCatalogo(itens);
},
async lerBipagens(invId) {
  const s = await db.collection('inv_bipagens').where('invId', '==', invId).get();
  return s.docs.map(d => d.data());
}
```
(`const InvCore = require('../lib/inv-bip-core.js');` no topo do repo.)

- [ ] **Step 6: Rodar, ver passar. Deploy. Smoke** com o "inv teste" encerrado: `GET .../contagem?porEndereco=1` deve devolver os 3 produtos com descrição (BUILD 3 corrigiu o NC).

- [ ] **Step 7: Commit** — `git commit -m "API: GET /v1/balancos/:id/contagem"`.

---

### Task 7: `POST /v1/balancos` e `PATCH /v1/balancos/:id` (origem ERP)

**Files:**
- Modify: `functions/src/rotas/balancos.js`, `functions/src/repo.js`
- Create: `functions/lib/validar-balanco.js`
- Test: `functions/test/validar-balanco.test.js`, `functions/test/balancos-escrita.test.js`

**Interfaces:**
- Produces: `validarNovoBalanco(corpo)` → `{ ok, dados: { refErp, nome, loja, tipo, sequencial, enderecos, setores } }` ou `{ ok:false, mensagem }`; `validarPatch(corpo)` → `{ ok, dados }` só com `enderecos`, `setores`, `sequencial`, `nome`. `repo.balancoPorRefErp(clienteId, refErp)`; `repo.criarBalanco(clienteId, dados)` → doc; `repo.atualizarBalanco(invId, campos)`.

Regras: `POST` com `refErp` já existente no cliente devolve 200 com o balanço existente (idempotente); novo → 201. `PATCH` só em balanço `origem: 'erp'` e `status: 'aberto'`, senão 409. O doc criado segue o formato do app: `{ nome, loja, status:'aberto', tipo, sequencial, clienteId, enderecos, setores, atribuicoes:{}, modoFila:true, fila:{}, totalBipagens:0, modoOrganizacao: setores.length ? 'setores_end' : 'enderecos', criadoEm, criadoPor:'api', origem:'erp', erp:{ refErp } }`.

- [ ] **Step 1: Teste da validação** `functions/test/validar-balanco.test.js`

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { validarNovoBalanco, validarPatch } = require('../lib/validar-balanco');

test('validarNovoBalanco exige refErp, nome, loja; normaliza endereços', () => {
  assert.equal(validarNovoBalanco({ nome: 'X', loja: '1' }).ok, false);
  const r = validarNovoBalanco({ refErp: 77, nome: ' Balanço Out ', loja: 1, tipo: 'parcial', sequencial: 1, enderecos: [' 1 ', '2', '2', ''], setores: ['A'] });
  assert.deepEqual(r.dados, { refErp: '77', nome: 'Balanço Out', loja: '1', tipo: 'parcial', sequencial: true, enderecos: ['1', '2'], setores: ['A'] });
  assert.equal(validarNovoBalanco({ refErp: '1', nome: 'X', loja: '1', tipo: 'outro' }).ok, false);
});
test('validarPatch aceita só campos permitidos e rejeita vazio', () => {
  assert.equal(validarPatch({ loja: '9' }).ok, false);
  assert.deepEqual(validarPatch({ enderecos: ['3'], sequencial: false, loja: '9' }).dados, { enderecos: ['3'], sequencial: false });
});
```

- [ ] **Step 2: Rodar, ver falhar.**

- [ ] **Step 3: Implementar `functions/lib/validar-balanco.js`**

```js
function lista(v) { const seen = {}; return (Array.isArray(v) ? v : []).map(x => String(x == null ? '' : x).trim()).filter(x => x && !seen[x] && (seen[x] = 1)); }
function validarNovoBalanco(c) {
  c = c || {};
  const refErp = String(c.refErp == null ? '' : c.refErp).trim(), nome = String(c.nome == null ? '' : c.nome).trim(), loja = String(c.loja == null ? '' : c.loja).trim();
  if (!refErp || !nome || !loja) return { ok: false, mensagem: 'refErp, nome e loja são obrigatórios' };
  const tipo = c.tipo == null ? 'geral' : String(c.tipo);
  if (tipo !== 'geral' && tipo !== 'parcial') return { ok: false, mensagem: 'tipo deve ser geral ou parcial' };
  return { ok: true, dados: { refErp, nome, loja, tipo, sequencial: !!c.sequencial, enderecos: lista(c.enderecos), setores: lista(c.setores) } };
}
function validarPatch(c) {
  c = c || {}; const d = {};
  if (c.enderecos !== undefined) d.enderecos = lista(c.enderecos);
  if (c.setores !== undefined) d.setores = lista(c.setores);
  if (c.sequencial !== undefined) d.sequencial = !!c.sequencial;
  if (c.nome !== undefined) { const n = String(c.nome).trim(); if (n) d.nome = n; }
  if (!Object.keys(d).length) return { ok: false, mensagem: 'Nada para atualizar (enderecos, setores, sequencial, nome)' };
  return { ok: true, dados: d };
}
module.exports = { validarNovoBalanco, validarPatch };
```

- [ ] **Step 4: Teste das rotas** `functions/test/balancos-escrita.test.js`

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { criarApp } = require('../src/app');
const { chamar } = require('./app.test');
const { repoFake } = require('./balancos.test');
const H = { authorization: 'Bearer tok-ok' };
function repoEsc(lista) {
  const r = repoFake(lista);
  r.balancoPorRefErp = async (cid, ref) => r.balancos.find(b => b.clienteId === cid && b.erp && b.erp.refErp === ref) || null;
  r.criarBalanco = async (cid, d) => { const b = Object.assign({ id: 'novo' + r.balancos.length, clienteId: cid, status: 'aberto', origem: 'erp', erp: { refErp: d.refErp } }, d); r.balancos.push(b); return b; };
  r.atualizarBalanco = async (id, campos) => { Object.assign(r.balancos.find(b => b.id === id), campos); };
  return r;
}
test('POST balancos cria (201) e repete por refErp (200, mesmo id)', async () => {
  const repo = repoEsc([]); const app = criarApp({ repo });
  const corpo = { refErp: '77', nome: 'Out', loja: '1', enderecos: ['1', '2'] };
  const a = await chamar(app, 'POST', '/v1/balancos', corpo, H); assert.equal(a.status, 201); assert.equal(a.body.origem, 'erp');
  const b = await chamar(app, 'POST', '/v1/balancos', corpo, H); assert.equal(b.status, 200); assert.equal(b.body.id, a.body.id);
  const inv = await chamar(app, 'POST', '/v1/balancos', { nome: 'x' }, H); assert.equal(inv.status, 400);
});
test('PATCH só em origem erp aberto', async () => {
  const repo = repoEsc([{ id: 'k', clienteId: 'loja-teste', status: 'aberto', origem: 'kontar', enderecos: [] },
    { id: 'e', clienteId: 'loja-teste', status: 'aberto', origem: 'erp', enderecos: [], erp: { refErp: '1' } }]);
  const app = criarApp({ repo });
  assert.equal((await chamar(app, 'PATCH', '/v1/balancos/k', { enderecos: ['9'] }, H)).status, 409);
  const ok = await chamar(app, 'PATCH', '/v1/balancos/e', { enderecos: ['9'] }, H);
  assert.equal(ok.status, 200); assert.deepEqual(ok.body.enderecos, ['9']);
});
```

- [ ] **Step 5: Rodar, ver falhar. Implementar rotas**

```js
const { validarNovoBalanco, validarPatch } = require('../../lib/validar-balanco');
r.post('/', async (req, res, next) => { try {
  const v = validarNovoBalanco(req.body);
  if (!v.ok) return res.status(400).json({ erro: 'balanco_invalido', mensagem: v.mensagem });
  const existente = await repo.balancoPorRefErp(req.cliente.id, v.dados.refErp);
  if (existente) { res.locals.resumo = 'já existia ' + v.dados.refErp; return res.status(200).json(formatarBalanco(existente)); }
  const novo = await repo.criarBalanco(req.cliente.id, v.dados);
  res.locals.resumo = 'criado ' + v.dados.refErp;
  res.status(201).json(formatarBalanco(novo));
} catch (e) { next(e); } });
r.patch('/:id', async (req, res, next) => { try {
  const b = await repo.obterBalanco(req.cliente.id, req.params.id);
  if (!b) return res.status(404).json({ erro: 'nao_encontrado', mensagem: 'Balanço não encontrado' });
  if (b.origem !== 'erp' || b.status !== 'aberto') return res.status(409).json({ erro: 'nao_editavel', mensagem: 'Só balanço de origem ERP e aberto pode ser alterado pela API' });
  const v = validarPatch(req.body);
  if (!v.ok) return res.status(400).json({ erro: 'patch_invalido', mensagem: v.mensagem });
  await repo.atualizarBalanco(b.id, v.dados);
  res.json(formatarBalanco(Object.assign({}, b, v.dados)));
} catch (e) { next(e); } });
```

- [ ] **Step 6: Implementar no repo**

```js
async balancoPorRefErp(clienteId, refErp) {
  const s = await db.collection('inv_inventarios').where('clienteId', '==', clienteId).where('erp.refErp', '==', refErp).limit(1).get();
  return s.empty ? null : Object.assign({ id: s.docs[0].id }, s.docs[0].data());
},
async criarBalanco(clienteId, d) {
  const doc = { nome: d.nome, loja: d.loja, status: 'aberto', tipo: d.tipo, sequencial: d.sequencial, clienteId, enderecos: d.enderecos, setores: d.setores,
    atribuicoes: {}, modoFila: true, fila: {}, totalBipagens: 0, modoOrganizacao: d.setores.length ? 'setores_end' : 'enderecos',
    criadoEm: FieldValue.serverTimestamp(), criadoPor: 'api', origem: 'erp', erp: { refErp: d.refErp } };
  const ref = await db.collection('inv_inventarios').add(doc);
  const snap = await ref.get(); return Object.assign({ id: ref.id }, snap.data());
},
async atualizarBalanco(invId, campos) { await db.collection('inv_inventarios').doc(invId).update(campos); }
```

- [ ] **Step 7: Rodar, ver passar. Deploy. Smoke:** `POST` cria "Balanço API 77" na loja-teste; abrir o app e ver o balanço listado como ABERTO; `PATCH` adiciona endereço e aparece na aba Endereços.

- [ ] **Step 8: Commit** — `git commit -m "API: POST /v1/balancos (idempotente por refErp) e PATCH origem erp"`.

---

### Task 8: `POST /v1/balancos/:id/contagem/confirmar` e `PATCH` de erro do conector

**Files:**
- Modify: `functions/src/rotas/balancos.js`
- Test: `functions/test/confirmar.test.js`

**Interfaces:**
- Consumes: `repo.atualizarBalanco`.
- Produces: `POST /:id/contagem/confirmar` grava `erp.contagemRecebidaEm = agora` (409 se não encerrado); `PATCH /:id/erp` com `{ erro: 'texto' }` grava `erp.erro`/`erp.erroEm`, `{ erro: null }` limpa, `{ contagemEnviadaEm: true }` marca `erp.contagemEnviadaEm = agora`.

- [ ] **Step 1: Teste** `functions/test/confirmar.test.js`

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { criarApp } = require('../src/app');
const { chamar } = require('./app.test');
const { repoFake } = require('./balancos.test');
const H = { authorization: 'Bearer tok-ok' };
function repoC(b) { const r = repoFake([b]); r.upd = []; r.atualizarBalanco = async (id, c) => { r.upd.push(c); }; return r; }

test('confirmar: 409 aberto, 200 encerrado grava contagemRecebidaEm', async () => {
  const b = { id: 'a', clienteId: 'loja-teste', status: 'aberto' }; const repo = repoC(b); const app = criarApp({ repo });
  assert.equal((await chamar(app, 'POST', '/v1/balancos/a/contagem/confirmar', {}, H)).status, 409);
  b.status = 'encerrado';
  const r = await chamar(app, 'POST', '/v1/balancos/a/contagem/confirmar', {}, H);
  assert.equal(r.status, 200); assert.ok(repo.upd[0]['erp.contagemRecebidaEm'] instanceof Date);
});
test('PATCH erp grava e limpa erro, marca contagemEnviadaEm', async () => {
  const repo = repoC({ id: 'a', clienteId: 'loja-teste', status: 'encerrado' }); const app = criarApp({ repo });
  await chamar(app, 'PATCH', '/v1/balancos/a/erp', { erro: 'MySQL fora' }, H);
  assert.equal(repo.upd[0]['erp.erro'], 'MySQL fora'); assert.ok(repo.upd[0]['erp.erroEm'] instanceof Date);
  await chamar(app, 'PATCH', '/v1/balancos/a/erp', { erro: null, contagemEnviadaEm: true }, H);
  assert.equal(repo.upd[1]['erp.erro'], null); assert.ok(repo.upd[1]['erp.contagemEnviadaEm'] instanceof Date);
});
```

- [ ] **Step 2: Rodar, ver falhar. Implementar**

```js
r.post('/:id/contagem/confirmar', async (req, res, next) => { try {
  const b = await repo.obterBalanco(req.cliente.id, req.params.id);
  if (!b) return res.status(404).json({ erro: 'nao_encontrado', mensagem: 'Balanço não encontrado' });
  if (b.status !== 'encerrado') return res.status(409).json({ erro: 'balanco_aberto', mensagem: 'Só balanço encerrado tem contagem a confirmar' });
  const agora = new Date();
  await repo.atualizarBalanco(b.id, { 'erp.contagemRecebidaEm': agora });
  res.json({ ok: true, contagemRecebidaEm: agora.toISOString() });
} catch (e) { next(e); } });
r.patch('/:id/erp', async (req, res, next) => { try {
  const b = await repo.obterBalanco(req.cliente.id, req.params.id);
  if (!b) return res.status(404).json({ erro: 'nao_encontrado', mensagem: 'Balanço não encontrado' });
  const c = req.body || {}, upd = {}, agora = new Date();
  if (c.erro !== undefined) { upd['erp.erro'] = c.erro ? String(c.erro).slice(0, 500) : null; upd['erp.erroEm'] = c.erro ? agora : null; }
  if (c.contagemEnviadaEm === true) upd['erp.contagemEnviadaEm'] = agora;
  if (c.pedirCatalogo === false) upd['erp.pedirCatalogo'] = false;
  if (!Object.keys(upd).length) return res.status(400).json({ erro: 'patch_invalido', mensagem: 'Informe erro, contagemEnviadaEm ou pedirCatalogo' });
  await repo.atualizarBalanco(b.id, upd);
  res.locals.resumo = Object.keys(upd).join(',');
  res.json({ ok: true });
} catch (e) { next(e); } });
```

- [ ] **Step 3: Rodar, ver passar. Deploy. Commit** — `git commit -m "API: confirmar contagem e PATCH erp (erro/contagemEnviadaEm/pedirCatalogo)"`.

---

### Task 9: Aba Integrações mínima no app (token + log)

**Files:**
- Modify: `index.html` (painel `panel-integracoes` + item de menu `nav-integracoes`), `app.js` (funções `renderIntegracoes`, `gerarTokenIntegracao`, `setupRole` mostra o menu só para admin), `style.css` (nada novo; usa classes existentes)
- Modify: `firestore.rules` — permitir `get`/`update` em `clientes/{id}` para logado (só campo `integracao`) e `list` em `clientes/{id}/integracao_log`
- Test: manual (app ES5 sem testes de UI) + `npm test` da raiz continua 45/45

Comportamento: aba mostra "Token de integração" com botão **Gerar novo token**; ao gerar, calcula `hashPassword(token)` (já existe em `app.js`, SHA-256 hex) e grava `clientes/{clienteId}.integracao = { tokenHash, geradoEm, geradoPor }` via `set({merge:true})`; mostra o token UMA vez em texto selecionável com aviso "copie agora, não será mostrado de novo". Abaixo, tabela "Últimas chamadas" com as 100 últimas de `integracao_log` ordenadas por `em desc` (rota, status, ms, resumo, hora). Botão "Atualizar".

- [ ] **Step 1: `firestore.rules`** — trocar o bloco de `clientes` por:

```
match /clientes/{clienteId} {
  allow get: if logado();
  // Só o campo integracao pode ser escrito pelo app (token de integração).
  allow update: if logado() && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['integracao']);
  allow create: if logado() && request.resource.data.keys().hasOnly(['integracao']);
  match /integracao_log/{logId} { allow read: if logado(); }
}
```
Run: `firebase deploy --only firestore:rules --project kontar-e2650`.

- [ ] **Step 2: `index.html`** — na sidebar, após o item `nav-users`, adicionar `<a class="nav-item" id="nav-integracoes" onclick="nav('integracoes')">🔗 Integrações</a>`; e um painel:

```html
<div class="panel" id="panel-integracoes">
  <div class="page-title">Integrações</div>
  <div class="card" style="max-width:720px">
    <div style="font-weight:700;margin-bottom:6px">Token de integração (ERP)</div>
    <p style="font-size:13px;color:var(--t2)">O ERP envia este token no cabeçalho <code>Authorization: Bearer</code>. Gerar um novo invalida o anterior.</p>
    <div id="integ-token-info" style="font-size:13px;color:var(--t2);margin-bottom:10px"></div>
    <button class="btn btn-p" onclick="gerarTokenIntegracao()">Gerar novo token</button>
    <div id="integ-token-novo" style="display:none;margin-top:12px;padding:12px;background:#fff8e1;border:1px solid #f0c000;border-radius:10px;font-family:monospace;word-break:break-all"></div>
  </div>
  <div class="card" style="margin-top:16px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><div style="font-weight:700">Últimas chamadas</div><button class="btn btn-sm" onclick="renderIntegracoes()">↻ Atualizar</button></div>
    <table class="tbl"><thead><tr><th>Hora</th><th>Rota</th><th>Status</th><th>ms</th><th>Resumo</th></tr></thead><tbody id="integ-log"></tbody></table>
  </div>
</div>
```

- [ ] **Step 3: `app.js`** — após `renderUsers`:

```js
function renderIntegracoes() {
  var cid = S.currentUser && S.currentUser.clienteId; if (!cid) return;
  var info = document.getElementById('integ-token-info'), tb = document.getElementById('integ-log');
  db.collection('clientes').doc(cid).get().then(function(d){
    var i = (d.exists && d.data().integracao) || null;
    if (info) info.textContent = i && i.tokenHash ? ('Token ativo, gerado em ' + (i.geradoEm && i.geradoEm.toDate ? i.geradoEm.toDate().toLocaleString('pt-BR') : '—') + ' por ' + esc(i.geradoPor || '')) : 'Nenhum token gerado ainda.';
  }).catch(function(){ if (info) info.textContent = 'Não foi possível ler a configuração.'; });
  db.collection('clientes').doc(cid).collection('integracao_log').orderBy('em','desc').limit(100).get().then(function(s){
    if (!tb) return;
    tb.innerHTML = s.empty ? '<tr><td colspan="5" style="color:var(--t3)">Nenhuma chamada ainda.</td></tr>' : s.docs.map(function(x){ var l = x.data(); var em = l.em && l.em.toDate ? l.em.toDate().toLocaleString('pt-BR') : '';
      return '<tr><td>' + esc(em) + '</td><td style="font-family:monospace">' + esc(l.rota) + '</td><td style="color:' + (l.status < 400 ? 'var(--g)' : 'var(--r)') + ';font-weight:700">' + esc(l.status) + '</td><td>' + esc(l.ms) + '</td><td>' + esc(l.resumo || '') + '</td></tr>'; }).join('');
  }).catch(function(e){ if (tb) tb.innerHTML = '<tr><td colspan="5" style="color:var(--r)">Erro ao ler o log: ' + esc(e.message) + '</td></tr>'; });
}
function gerarTokenIntegracao() {
  var cid = S.currentUser && S.currentUser.clienteId; if (!cid) return;
  if (!confirm('Gerar um novo token? O token anterior deixa de funcionar na hora.')) return;
  var bytes = new Uint8Array(24); crypto.getRandomValues(bytes);
  var token = Array.from(bytes).map(function(b){ return b.toString(16).padStart(2,'0'); }).join('');
  hashPassword(token).then(function(hash){
    return db.collection('clientes').doc(cid).set({ integracao: { tokenHash: hash, geradoEm: firebase.firestore.FieldValue.serverTimestamp(), geradoPor: S.currentUser.nome || S.currentUser.id } }, { merge: true });
  }).then(function(){
    var el = document.getElementById('integ-token-novo'); if (el) { el.style.display = 'block'; el.innerHTML = '<div style="font-family:inherit;font-weight:700;margin-bottom:6px">Copie agora. Este token não será mostrado de novo.</div>' + esc(token); }
    renderIntegracoes();
  }).catch(function(e){ showToast('Erro ao gerar token: ' + e.message, 6000); });
}
```
Em `setupRole()`: `show('nav-integracoes', isAdmin && !isColetor);`. Em `nav()`: quando `p === 'integracoes'`, chamar `renderIntegracoes()` (seguir o padrão de como `usuarios` chama `renderUsers`). Capa mobile: não adicionar card (desktop only, como Usuários).

- [ ] **Step 4: Verificar** — `node --check app.js`; `npm test` (raiz) 45/45; subir local, logar como admin, gerar token, copiar; `curl -H "Authorization: Bearer <token>" https://southamerica-east1-kontar-e2650.cloudfunctions.net/api/v1/eu` → `{ clienteId: 'loja-teste' }`; voltar na aba e ver a chamada no log.

- [ ] **Step 5: Bump BUILD 4** (app.js `var BUILD`, sw.js `CACHE_NAME` e `?v=`, index.html `?v=`, version.json). Commit e push — `git commit -m "Integrações: token de integração + log de chamadas da API (BUILD 4)"`.

---

### Task 10: Documentação da API para o parceiro

**Files:**
- Create: `docs/api.md`
- Modify: `README.md` (link para `docs/api.md` e seção "API")

Conteúdo obrigatório de `docs/api.md`: URL base; autenticação (onde o admin gera o token no Kontar; cabeçalho); tabela das rotas da spec seção 3 com exemplo `curl` e resposta JSON real de cada uma (copiar das respostas do smoke); códigos de erro; limites (5.000 itens, partes); seção **"O que o ERP precisa implementar"** com o fluxo mínimo em 4 passos (listar balanços abertos da loja → enviar catálogo → consultar status até `encerrado` → buscar contagem e confirmar); seção **"Perguntas ao Dlinks"** (as 4 da spec seção 6).

- [ ] **Step 1: Escrever `docs/api.md`** com os exemplos reais capturados nos smokes das Tasks 3, 5, 6, 7, 8.
- [ ] **Step 2: README** — adicionar `## API` apontando para `docs/api.md` e para a aba Integrações.
- [ ] **Step 3: Commit e push** — `git commit -m "docs: API Kontar para parceiros (ERP)"`.

---

## Fora deste plano (planos seguintes)

- Plano 2 — Conector Dlinks (serviço Node na central, módulo `erps/dlinks.js`, origem Kontar com "Buscar catálogo do ERP", envio da contagem para o MySQL de teste do .254).
- Plano 3 — Origem ERP ponta a ponta (balanço aberto no Dlinks → Kontar), webhook/eventos, botão "Reenviar contagem", etiquetas de origem e bloco ERP no balanço.
