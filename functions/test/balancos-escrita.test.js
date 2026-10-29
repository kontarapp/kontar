const test = require('node:test');
const assert = require('node:assert/strict');
const { criarApp } = require('../src/app');
const { chamar } = require('./app.test');
const { repoFake } = require('./balancos.test');
const H = { authorization: 'Bearer tok-ok' };
function repoEsc(lista) {
  const r = repoFake(lista);
  r.balancoPorRefErp = async (cid, ref) => r.balancos.find(b => b.clienteId === cid && b.erp && b.erp.refErp === ref) || null;
  r.chamadasCriar = 0; r.chamadasAtualizar = 0;
  r.criarBalanco = async (cid, d) => { r.chamadasCriar++; const b = Object.assign({ id: 'novo' + r.balancos.length, clienteId: cid, status: 'aberto', origem: 'erp', erp: { refErp: d.refErp } }, d); r.balancos.push(b); return { balanco: b, criado: true }; };
  r.atualizarBalanco = async (id, campos) => { r.chamadasAtualizar++; Object.assign(r.balancos.find(b => b.id === id), campos); };
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
const erpAberto = (extra) => Object.assign({ id: 'e', clienteId: 'loja-teste', status: 'aberto', origem: 'erp', enderecos: ['1', '2', '3'], setores: ['A'], fila: {}, atribuicoes: {}, erp: { refErp: '1' } }, extra);
test('PATCH 404 para balanço de outro cliente', async () => {
  const repo = repoEsc([erpAberto({ clienteId: 'outro' })]);
  const r = await chamar(criarApp({ repo }), 'PATCH', '/v1/balancos/e', { nome: 'x' }, H);
  assert.equal(r.status, 404);
});
test('PATCH 409 quando erp mas não aberto', async () => {
  const repo = repoEsc([erpAberto({ status: 'pausado' })]);
  const r = await chamar(criarApp({ repo }), 'PATCH', '/v1/balancos/e', { nome: 'x' }, H);
  assert.equal(r.status, 409); assert.equal(repo.chamadasAtualizar, 0);
});
test('PATCH não remove endereço com coletor na fila (409)', async () => {
  const repo = repoEsc([erpAberto({ fila: { '2': { userId: 'c1' } } })]); repo.lerBipagens = async () => [];
  const r = await chamar(criarApp({ repo }), 'PATCH', '/v1/balancos/e', { enderecos: ['1', '3'] }, H);
  assert.equal(r.status, 409); assert.equal(r.body.erro, 'endereco_em_uso'); assert.match(r.body.mensagem, /2/); assert.equal(repo.chamadasAtualizar, 0);
});
test('PATCH não remove endereço com bipagem (409)', async () => {
  const repo = repoEsc([erpAberto()]); repo.lerBipagens = async () => [{ endereco: '3' }];
  const r = await chamar(criarApp({ repo }), 'PATCH', '/v1/balancos/e', { enderecos: ['1', '2'] }, H);
  assert.equal(r.status, 409); assert.equal(r.body.erro, 'endereco_em_uso'); assert.equal(repo.chamadasAtualizar, 0);
});
test('PATCH remove endereço livre e adiciona endereços (200)', async () => {
  const repo = repoEsc([erpAberto()]); repo.lerBipagens = async () => [];
  const rem = await chamar(criarApp({ repo }), 'PATCH', '/v1/balancos/e', { enderecos: ['1', '2'] }, H);
  assert.equal(rem.status, 200); assert.deepEqual(rem.body.enderecos, ['1', '2']);
  const add = await chamar(criarApp({ repo }), 'PATCH', '/v1/balancos/e', { enderecos: ['1', '2', '8', '9'] }, H);
  assert.equal(add.status, 200); assert.deepEqual(add.body.enderecos, ['1', '2', '8', '9']);
});
test('PATCH setores: remover é 409 setor_em_uso; adicionar recalcula modoOrganizacao', async () => {
  const repo = repoEsc([erpAberto()]);
  const rem = await chamar(criarApp({ repo }), 'PATCH', '/v1/balancos/e', { setores: [] }, H);
  assert.equal(rem.status, 409); assert.equal(rem.body.erro, 'setor_em_uso'); assert.equal(repo.chamadasAtualizar, 0);
  const add = await chamar(criarApp({ repo }), 'PATCH', '/v1/balancos/e', { setores: ['A', 'B'] }, H);
  assert.equal(add.status, 200); assert.equal(repo.balancos[0].modoOrganizacao, 'setores_end');
});
test('PATCH setores de vazio para preenchido e modoOrganizacao enderecos quando vazio', async () => {
  const repo = repoEsc([erpAberto({ setores: [] })]);
  const a = await chamar(criarApp({ repo }), 'PATCH', '/v1/balancos/e', { setores: ['Z'] }, H);
  assert.equal(a.status, 200); assert.equal(repo.balancos[0].modoOrganizacao, 'setores_end');
  const repo2 = repoEsc([erpAberto({ setores: [] })]);
  const b = await chamar(criarApp({ repo: repo2 }), 'PATCH', '/v1/balancos/e', { setores: [] }, H);
  assert.equal(b.status, 200); assert.equal(repo2.balancos[0].modoOrganizacao, 'enderecos');
});
test('POST: pré-checagem nula mas criarBalanco reporta criado:false (corrida) => 200', async () => {
  const repo = repoEsc([]);
  const existente = { id: 'erp_loja-teste_9', clienteId: 'loja-teste', status: 'aberto', origem: 'erp', erp: { refErp: '9' } };
  repo.criarBalanco = async () => ({ balanco: existente, criado: false });
  const r = await chamar(criarApp({ repo }), 'POST', '/v1/balancos', { refErp: '9', nome: 'N', loja: '1' }, H);
  assert.equal(r.status, 200); assert.equal(r.body.id, 'erp_loja-teste_9');
});
test('POST mesma refErp para outro cliente cria novo (201)', async () => {
  const repo = repoEsc([{ id: 'o', clienteId: 'outro', status: 'aberto', origem: 'erp', erp: { refErp: '77' } }]);
  const r = await chamar(criarApp({ repo }), 'POST', '/v1/balancos', { refErp: '77', nome: 'N', loja: '1' }, H);
  assert.equal(r.status, 201); assert.notEqual(r.body.id, 'o'); assert.equal(repo.chamadasCriar, 1);
});
