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
