const test = require('node:test');
const assert = require('node:assert/strict');
const { validarItens, hashItens, paraBlocos } = require('../lib/catalogo');

test('validarItens converte campos públicos para o formato dos blocos', () => {
  const r = validarItens([{ codigo: '1001', ean: ' 7891000100103 ', descricao: 'LEITE', un: 'un', estoque: '48', custo: '4,10', venda: 5.99 }]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.itens[0], { c: '1001', e: '7891000100103', d: 'LEITE', u: 'UN', q: 48, k: 4.1, v: 5.99 });
});
test('validarItens rejeita item sem código e sem EAN, lista vazia e mais de 5000', () => {
  assert.equal(validarItens([{ descricao: 'X' }]).ok, false);
  assert.equal(validarItens([]).ok, false);
  const muitos = []; for (let i = 0; i < 5001; i++) muitos.push({ codigo: String(i) });
  assert.match(validarItens(muitos).mensagem, /5000/);
});
test('validarItens: estoque/custo/venda ausentes viram null, descrição corta em 120', () => {
  const r = validarItens([{ codigo: '1', descricao: 'X'.repeat(200) }]);
  assert.equal(r.itens[0].q, null); assert.equal(r.itens[0].k, null); assert.equal(r.itens[0].d.length, 120);
});
test('hashItens é estável e muda com o conteúdo', () => {
  const a = hashItens([{ c: '1', e: '', d: 'A', u: '', q: 1, k: null, v: null }]);
  const b = hashItens([{ c: '1', e: '', d: 'A', u: '', q: 1, k: null, v: null }]);
  const c = hashItens([{ c: '1', e: '', d: 'B', u: '', q: 1, k: null, v: null }]);
  assert.equal(a, b); assert.notEqual(a, c); assert.match(a, /^[0-9a-f]{64}$/);
});
test('paraBlocos quebra em 1000', () => {
  const itens = []; for (let i = 0; i < 2500; i++) itens.push({ c: String(i), e: '', d: 'I', u: '', q: null, k: null, v: null });
  assert.deepEqual(paraBlocos(itens).map(b => b.length), [1000, 1000, 500]);
});
