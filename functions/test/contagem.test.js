const test = require('node:test');
const assert = require('node:assert/strict');
const InvCore = require('../lib/inv-bip-core.js');
const { montarContagem } = require('../lib/contagem');
const cat = () => InvCore.criarCatalogo([{ c: '1', e: '7891000000011', d: 'A', u: 'UN', q: 10 }, { c: '2', e: '7891000000028', d: 'B', u: 'UN', q: 5 }]);

test('montarContagem soma por produto e inclui não coletados com quantidade 0', () => {
  const out = montarContagem(cat(), [{ codigo: '1', qty: 6, endereco: 'C01' }, { codigo: '1', qty: 4, endereco: 'C02' }], {}, {});
  const a = out.itens.find(i => i.codigo === '1'), b = out.itens.find(i => i.codigo === '2');
  assert.deepEqual(a, { codigo: '1', ean: '7891000000011', descricao: 'A', un: 'UN', quantidade: 10, estoque: 10, diferenca: 0, naoCadastrado: false });
  assert.equal(b.quantidade, 0); assert.equal(b.diferenca, -5);
  assert.deepEqual(out.totais, { itens: 2, unidades: 10, naoCadastrados: 0 });
});
test('montarContagem porEndereco devolve quantidade por endereço', () => {
  const out = montarContagem(cat(), [{ codigo: '1', qty: 6, endereco: 'C01' }, { codigo: '1', qty: 4, endereco: 'C02' }], {}, { porEndereco: true });
  assert.deepEqual(out.porEndereco, [{ endereco: 'C01', itens: [{ codigo: '1', ean: '7891000000011', quantidade: 6 }] },
    { endereco: 'C02', itens: [{ codigo: '1', ean: '7891000000011', quantidade: 4 }] }]);
});
test('montarContagem marca não cadastrado', () => {
  const out = montarContagem(cat(), [{ codigo: '', ean: '7896036093481', qty: 3, endereco: 'C01' }], {}, {});
  const nc = out.itens.find(i => i.naoCadastrado);
  assert.equal(nc.ean, '7896036093481'); assert.equal(nc.quantidade, 3); assert.equal(out.totais.naoCadastrados, 1);
});
