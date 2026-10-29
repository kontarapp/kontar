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
