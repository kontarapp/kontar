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
