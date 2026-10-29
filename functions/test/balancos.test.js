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
