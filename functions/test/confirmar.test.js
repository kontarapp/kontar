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
