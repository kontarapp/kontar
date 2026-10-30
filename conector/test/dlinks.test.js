'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { itemCatalogo, linhasContagem, filtrosParcial, dataHoraBR, num } = require('../erps/dlinks');

test('num: texto com vírgula do Dlinks, ponto decimal e vazio', () => {
  assert.strictEqual(num('12,500'), 12.5);
  assert.strictEqual(num('1.234,56'), 1234.56);
  assert.strictEqual(num('20.000'), 20);
  assert.strictEqual(num(''), null);
  assert.strictEqual(num(null), null);
  assert.strictEqual(num('abc'), null);
});

test('itemCatalogo: EAN só quando o código tem 8 a 14 dígitos; custo médio da loja tem prioridade', () => {
  const a = itemCatalogo({ CodigoBarra: '7891000100103 ', Descricao: ' ARROZ 5KG ', Unid: 'un', custo: '20,10', venda: '27,90' }, { Qtd: '15,000', CustoMedio: '21.50' });
  assert.deepStrictEqual(a, { codigo: '7891000100103', ean: '7891000100103', descricao: 'ARROZ 5KG', un: 'UN', estoque: 15, custo: 21.5, venda: 27.9 });
  const b = itemCatalogo({ CodigoBarra: '1465', Descricao: 'QUEIJO PRATO KG', Unid: 'KG', custo: '35,9', venda: null }, { Qtd: '36,039', CustoMedio: '0.00' });
  assert.strictEqual(b.ean, ''); assert.strictEqual(b.custo, 35.9); assert.strictEqual(b.estoque, 36.039); assert.strictEqual(b.venda, null);
  const c = itemCatalogo({ CodigoBarra: '18', Descricao: 'X', Unid: 'UN', custo: '' }, undefined);
  assert.strictEqual(c.estoque, null); assert.strictEqual(c.custo, null);
});

test('filtrosParcial: só no PARCIAL e só filtros preenchidos', () => {
  assert.deepStrictEqual(filtrosParcial({ Tipo: 'GERAL', CodGrupo: 45 }), []);
  assert.deepStrictEqual(filtrosParcial({ Tipo: 'PARCIAL', CodGrupo: 45, CodSubGrupo: 0, CodSetor: 3, CodMarca: 0, CodFornec: 0 }),
    [{ col: 'CodGrupo', val: 45 }, { col: 'codsetor', val: 3 }]);
});

test('dataHoraBR no formato do Dlinks', () => {
  assert.strictEqual(dataHoraBR(new Date(2026, 8, 6, 9, 5, 3)), '06/09/2026 09:05:03');
});

const ctx = { nLoja: 5, nIven: 778, codDigitador: 500, dataHora: '30/10/2026 10:00:00', grupos: { '1465': 43, '18': 45, '7891000100103': 12 } };
const contagem = {
  itens: [
    { codigo: '1465', quantidade: 1.25, naoCadastrado: false },
    { codigo: '18', quantidade: 20, naoCadastrado: false },
    { codigo: '999', quantidade: 3, naoCadastrado: true },
    { codigo: '555', quantidade: 2, naoCadastrado: false }
  ],
  porEndereco: [
    { endereco: '1', itens: [{ codigo: '1465', quantidade: 1 }, { codigo: '18', quantidade: 12 }, { codigo: '999', quantidade: 3 }] },
    { endereco: '2', itens: [{ codigo: '18', quantidade: 10 }] }
  ]
};

test('linhasContagem por produto: quantidade oficial com 3 casas, End 0, não cadastrados de fora', () => {
  const { linhas, ignorados } = linhasContagem(contagem, ctx);
  assert.deepStrictEqual(linhas.map(l => [l.CodigoBarra, l.Qtd, l.End, l.CodGrupo]), [['1465', 1.25, '0', 43], ['18', 20, '0', 45]]);
  assert.deepStrictEqual(ignorados.map(i => i.codigo), ['999', '555']);
  const l = linhas[0];
  assert.strictEqual(l.nLoja, 5); assert.strictEqual(l.nIven, 778); assert.strictEqual(l.CodDigitador, 500);
  assert.strictEqual(l.DataHora, '30/10/2026 10:00:00'); assert.strictEqual(l.App, 0); assert.strictEqual(l.seq, 0);
});

test('linhasContagem por endereço: soma bate com a oficial (correção da auditoria vira linha End KONTAR)', () => {
  const { linhas } = linhasContagem(contagem, Object.assign({}, ctx, { porEndereco: true }));
  assert.deepStrictEqual(linhas.map(l => [l.CodigoBarra, l.Qtd, l.End]), [['1465', 1, '1'], ['18', 12, '1'], ['18', 10, '2'], ['1465', 0.25, 'KONTAR'], ['18', -2, 'KONTAR']]);
  const soma = cod => linhas.filter(l => l.CodigoBarra === cod).reduce((s, l) => s + l.Qtd, 0);
  assert.strictEqual(Math.round(soma('1465') * 1000) / 1000, 1.25);
  assert.strictEqual(soma('18'), 20);
});

test('linhasContagem: produto não contado (0) não vai pro ERP — o Dlinks cuida dos zeros', () => {
  const c = { itens: [{ codigo: '1465', quantidade: 0 }, { codigo: '18', quantidade: 2 }] };
  const { linhas, ignorados } = linhasContagem(c, ctx);
  assert.deepStrictEqual(linhas.map(l => [l.CodigoBarra, l.Qtd]), [['18', 2]]);
  assert.deepStrictEqual(ignorados, []);
});

test('linhasContagem parcial: só itens da lista; bipado fora da lista fica de fora com motivo', () => {
  const c = { itens: [{ codigo: '1465', quantidade: 1.5 }, { codigo: '18', quantidade: 4 }, { codigo: '999', quantidade: 1, naoCadastrado: true }] };
  const { linhas, ignorados } = linhasContagem(c, Object.assign({}, ctx, { lista: ['1465', '7891000100103'] }));
  assert.deepStrictEqual(linhas.map(l => [l.CodigoBarra, l.Qtd]), [['1465', 1.5]]);
  assert.deepStrictEqual(ignorados.map(i => [i.codigo, i.motivo]), [['18', 'fora_da_lista'], ['999', 'nao_cadastrado']]);
});
