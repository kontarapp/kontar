const test = require('node:test');
const assert = require('node:assert/strict');
const { validarNovoBalanco, validarPatch } = require('../lib/validar-balanco');

test('validarNovoBalanco exige refErp, nome, loja; normaliza endereços', () => {
  assert.equal(validarNovoBalanco({ nome: 'X', loja: '1' }).ok, false);
  const r = validarNovoBalanco({ refErp: 77, nome: ' Balanço Out ', loja: 1, tipo: 'parcial', sequencial: 1, enderecos: [' 1 ', '2', '2', ''], setores: ['A'] });
  assert.deepEqual(r.dados, { refErp: '77', nome: 'Balanço Out', loja: '1', tipo: 'parcial', sequencial: true, enderecos: ['1', '2'], setores: ['A'] });
  assert.equal(validarNovoBalanco({ refErp: '1', nome: 'X', loja: '1', tipo: 'outro' }).ok, false);
});
test('validarPatch aceita só campos permitidos e rejeita vazio', () => {
  assert.equal(validarPatch({ loja: '9' }).ok, false);
  assert.deepEqual(validarPatch({ enderecos: ['3'], sequencial: false, loja: '9' }).dados, { enderecos: ['3'], sequencial: false });
});
