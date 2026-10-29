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
  r.guardarParteCatalogo = async (invId, parte, total, itens) => { r.partes[parte] = { parte, total, itens }; };
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

const URL = '/v1/balancos/a/catalogo';
test('PUT catalogo em partes: limpa as partes após gravar', async () => {
  const repo = repoCat(bal()); const app = criarApp({ repo });
  await chamar(app, 'PUT', URL, { parte: 1, total: 2, itens: [{ codigo: '1' }] }, H);
  const p2 = await chamar(app, 'PUT', URL, { parte: 2, total: 2, itens: [{ codigo: '2' }] }, H);
  assert.equal(p2.status, 200); assert.deepEqual(repo.partes, {});
});
test('PUT catalogo: última parte sem a parte 1 → 409 partes_incompletas, nada gravado', async () => {
  const repo = repoCat(bal());
  const r = await chamar(criarApp({ repo }), 'PUT', URL, { parte: 2, total: 2, itens: [{ codigo: '2' }] }, H);
  assert.equal(r.status, 409); assert.equal(r.body.erro, 'partes_incompletas'); assert.equal(repo.gravacoes.length, 0);
});
test('PUT catalogo: totais divergentes (1/2 depois 2/3) → 409', async () => {
  const repo = repoCat(bal()); const app = criarApp({ repo });
  await chamar(app, 'PUT', URL, { parte: 1, total: 2, itens: [{ codigo: '1' }] }, H);
  await chamar(app, 'PUT', URL, { parte: 2, total: 3, itens: [{ codigo: '2' }] }, H);
  const r = await chamar(app, 'PUT', URL, { parte: 3, total: 3, itens: [{ codigo: '3' }] }, H);
  assert.equal(r.status, 409); assert.equal(r.body.erro, 'partes_incompletas'); assert.equal(repo.gravacoes.length, 0);
});
test('PUT catalogo: parte/total estritos → 400 parte_invalida', async () => {
  const it = [{ codigo: '1' }];
  for (const c of [{ parte: 1 }, { total: 2 }, { parte: '1abc', total: 2 }, { parte: 0, total: 0 }, { parte: 1, total: 101 }, { parte: 3, total: 2 }, { parte: 1.5, total: 2 }]) {
    const repo = repoCat(bal());
    const r = await chamar(criarApp({ repo }), 'PUT', URL, Object.assign({ itens: it }, c), H);
    assert.equal(r.status, 400, JSON.stringify(c)); assert.equal(r.body.erro, 'parte_invalida');
    assert.equal(repo.gravacoes.length, 0);
  }
});
test('PUT catalogo: balanço de outro cliente → 404', async () => {
  const b = bal(); b.clienteId = 'outro';
  const r = await chamar(criarApp({ repo: repoCat(b) }), 'PUT', URL, { itens: [{ codigo: '1' }] }, H);
  assert.equal(r.status, 404);
});
test('PUT catalogo: parte 1 descarta sobras de envio anterior', async () => {
  const repo = repoCat(bal()); const app = criarApp({ repo });
  repo.partes[3] = { parte: 3, total: 3, itens: [{ c: 'velho' }] };
  const p1 = await chamar(app, 'PUT', '/v1/balancos/a/catalogo', { parte: 1, total: 2, itens: [{ codigo: '1' }] }, H);
  assert.equal(p1.status, 202);
  const p2 = await chamar(app, 'PUT', '/v1/balancos/a/catalogo', { parte: 2, total: 2, itens: [{ codigo: '2' }] }, H);
  assert.equal(p2.status, 200); assert.equal(p2.body.itens, 2); assert.deepEqual(repo.partes, {});
});
test('PUT catalogo: parte com mais de 2000 itens → 400', async () => {
  const repo = repoCat(bal());
  const itens = Array.from({ length: 2001 }, (_, i) => ({ codigo: String(i + 1) }));
  const r = await chamar(criarApp({ repo }), 'PUT', '/v1/balancos/a/catalogo', { parte: 1, total: 2, itens }, H);
  assert.equal(r.status, 400); assert.equal(r.body.erro, 'catalogo_invalido');
});
