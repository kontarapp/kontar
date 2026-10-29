const test = require('node:test');
const assert = require('node:assert/strict');
const { gerarToken, hashToken } = require('../lib/token');

test('gerarToken devolve 48 hex e nunca repete', () => {
  const a = gerarToken(), b = gerarToken();
  assert.match(a, /^[0-9a-f]{48}$/);
  assert.notEqual(a, b);
});
test('hashToken é sha256 hex determinístico', () => {
  assert.equal(hashToken('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
