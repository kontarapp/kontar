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
