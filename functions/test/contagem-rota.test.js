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

test('GET contagem ?aberto=1: contagem do momento com o balanço aberto; PATCH erp grava o envio', async () => {
  const b = { id: 'a', clienteId: 'loja-teste', loja: '1', status: 'aberto', nome: 'A', erp: { refErp: '9' } };
  const repo = repoFake([b]);
  repo.lerCatalogo = async () => InvCore.criarCatalogo([{ c: '1', e: '', d: 'A', u: 'UN', q: 10 }]);
  repo.lerBipagens = async () => [{ codigo: '1', qty: 4, endereco: 'C01' }];
  const r = await chamar(criarApp({ repo }), 'GET', '/v1/balancos/a/contagem?aberto=1', null, H);
  assert.equal(r.status, 200); assert.equal(r.body.status, 'aberto'); assert.equal(r.body.itens[0].quantidade, 4);
  let upd = null; repo.atualizarBalanco = async (id, u) => { upd = u; };
  const p = await chamar(criarApp({ repo }), 'PATCH', '/v1/balancos/a/erp', { envio: { linhas: 3, produtos: 2 } }, H);
  assert.equal(p.status, 200);
  assert.equal(upd['erp.envioProdutos'], 2); assert.equal(upd['erp.envioLinhas'], 3); assert.ok(upd['erp.envioEm'] instanceof Date);
});
