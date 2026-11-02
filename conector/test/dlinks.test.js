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

// Banco falso só com o que sincronizarContagem usa: inventario, inventariodigitador, inventariocontagem, itens.
function poolFalso(opts) {
  opts = opts || {};
  const db = { contagem: (opts.contagem || []).slice(), digitadores: (opts.digitadores || []).slice(), status: opts.status || 0 };
  let seq = 100;
  const exec = async (sql, p) => {
    if (/FROM inventario WHERE nIven/.test(sql)) return [[{ nIven: p[0], nLoja: 5, Tipo: opts.tipo || 'GERAL', Status: db.status }]];
    if (/SELECT nReg FROM inventariodigitador/.test(sql)) return [db.digitadores.filter(d => d.nIven === p[0] && d.Nome === p[1])];
    if (/INSERT INTO inventariodigitador/.test(sql)) { const d = { nReg: ++seq, nIven: p[1], Nome: p[2] }; db.digitadores.push(d); return [{ insertId: d.nReg }]; }
    if (/SUM\(Qtd\)/.test(sql)) {
      const m = {}; db.contagem.filter(r => r.nIven === p[0] && r.CodDigitador === p[1]).forEach(r => { const k = r.CodigoBarra + '|' + r.End; m[k] = (m[k] || 0) + Number(r.Qtd); });
      return [Object.keys(m).map(k => ({ CodigoBarra: k.split('|')[0], End: k.split('|')[1], q: m[k].toFixed(3) }))];
    }
    if (/FROM itens WHERE CodigoBarra IN/.test(sql)) return [p[0].filter(c => c !== 'NC').map(c => ({ CodigoBarra: c, CodGrupo: 7 }))];
    if (/SELECT DISTINCT CodigoBarra FROM inventariocontagem/.test(sql)) return [[]];
    if (/INSERT INTO inventariocontagem/.test(sql)) {
      const cols = sql.match(/\(([^)]+)\)/)[1].split(',').map(s => s.trim());
      p[0].forEach(v => { const r = {}; cols.forEach((c, i) => { r[c] = v[i]; }); if (opts.corromper) r.Qtd = Number(r.Qtd) + 1; db.contagem.push(r); });
      return [{ affectedRows: p[0].length }];
    }
    throw new Error('SQL não previsto no teste: ' + sql);
  };
  let pendente = null;
  const conn = { beginTransaction: async () => { pendente = db.contagem.length; }, commit: async () => { pendente = null; },
    rollback: async () => { if (pendente != null) db.contagem.length = pendente; }, release() {}, query: exec };
  return { db, query: exec, getConnection: async () => conn };
}
const { criarDlinks } = require('../erps/dlinks');
const somaDe = (db, cod) => db.contagem.filter(r => r.CodigoBarra === cod).reduce((s, r) => s + Number(r.Qtd), 0);
const cont = itens => ({ itens: itens.map(([codigo, quantidade]) => ({ codigo, quantidade })) });

test('sincronizarContagem: grava, depois só a diferença (negativa quando diminuiu) e nada quando não mudou', async () => {
  const pool = poolFalso(), dl = criarDlinks(pool, {}), inv = { nIven: 900, nLoja: 5 };
  let r = await dl.sincronizarContagem(inv, cont([['A', 10], ['B', 4]]));
  assert.deepStrictEqual([r.linhas, r.positivas, r.negativas, r.produtos], [2, 2, 0, 2]);
  assert.strictEqual(pool.db.digitadores.length, 1);
  r = await dl.sincronizarContagem(inv, cont([['A', 7], ['B', 4], ['C', 2]]));
  assert.deepStrictEqual([r.linhas, r.positivas, r.negativas], [2, 1, 1]);
  assert.deepStrictEqual(pool.db.contagem.filter(x => x.CodigoBarra === 'A').map(x => x.Qtd), [10, -3]);
  r = await dl.sincronizarContagem(inv, cont([['A', 7], ['C', 2]])); // B excluído no Kontar
  assert.deepStrictEqual([r.linhas, r.negativas], [1, 1]);
  assert.deepStrictEqual([somaDe(pool.db, 'A'), somaDe(pool.db, 'B'), somaDe(pool.db, 'C')], [7, 0, 2]);
  r = await dl.sincronizarContagem(inv, cont([['A', 7], ['C', 2]]));
  assert.strictEqual(r.linhas, 0);
  assert.strictEqual(pool.db.digitadores.length, 1);
  assert.ok(pool.db.contagem.every(x => x.CodDigitador === 101 && x.End === '0' && x.CodGrupo === 7 && x.nIven === 900));
});

test('sincronizarContagem: contagem antiga gravada pela versão anterior vira base (não duplica)', async () => {
  const pool = poolFalso({ digitadores: [{ nReg: 55, nIven: 900, Nome: 'KONTAR' }],
    contagem: [{ nIven: 900, CodDigitador: 55, CodigoBarra: 'A', End: '0', Qtd: 10 }] });
  const r = await criarDlinks(pool, {}).sincronizarContagem({ nIven: 900, nLoja: 5 }, cont([['A', 10]]));
  assert.strictEqual(r.linhas, 0);
  assert.strictEqual(somaDe(pool.db, 'A'), 10);
});

test('sincronizarContagem: inventário fechado não grava; conferência que não bate desfaz tudo', async () => {
  await assert.rejects(criarDlinks(poolFalso({ status: 2 }), {}).sincronizarContagem({ nIven: 900, nLoja: 5 }, cont([['A', 1]])), /fechado/);
  const ruim = poolFalso({ corromper: true });
  await assert.rejects(criarDlinks(ruim, {}).sincronizarContagem({ nIven: 900, nLoja: 5 }, cont([['A', 1]])), /não bateu/);
  assert.strictEqual(ruim.db.contagem.length, 0);
});

test('sincronizarContagem: não cadastrado no ERP fica de fora e não entra na conferência', async () => {
  const pool = poolFalso();
  const r = await criarDlinks(pool, {}).sincronizarContagem({ nIven: 900, nLoja: 5 }, cont([['A', 2], ['NC', 5]]));
  assert.strictEqual(r.linhas, 1);
  assert.deepStrictEqual(r.ignorados.map(i => i.codigo), ['NC']);
});
