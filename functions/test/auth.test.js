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
test('token bem formado mas desconhecido → 401', async () => {
  const r = await chamar(criarApp({ repo: repoFake() }), 'GET', '/v1/eu', null, { authorization: 'Bearer desconhecido' });
  assert.equal(r.status, 401); assert.equal(r.body.erro, 'nao_autorizado');
});
test('GET /v1/ping é público (sem Authorization → 200)', async () => {
  const r = await chamar(criarApp({ repo: repoFake() }), 'GET', '/v1/ping');
  assert.equal(r.status, 200);
});
test('falha na busca do token → 500 JSON interno', async () => {
  const repo = repoFake();
  repo.clientePorTokenHash = async () => { throw new Error('firestore fora'); };
  const orig = console.error; console.error = () => {};
  try {
    const r = await chamar(criarApp({ repo }), 'GET', '/v1/eu', null, { authorization: 'Bearer x' });
    assert.equal(r.status, 500); assert.equal(r.body.erro, 'interno');
  } finally { console.error = orig; }
});
