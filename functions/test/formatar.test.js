const test = require('node:test');
const assert = require('node:assert/strict');
const { formatarBalanco } = require('../lib/formatar');

test('formatarBalanco expõe só campos públicos e normaliza datas', () => {
  const em = { toDate: () => new Date('2026-10-28T12:00:00Z') };
  const out = formatarBalanco({ id: 'x', nome: 'Inv', loja: '1', status: 'aberto', enderecos: ['1', '2'], setores: ['A'],
    criadoEm: em, atribuicoes: { segredo: 1 }, fila: {}, erp: { refErp: '77', catalogoEm: em } }, { bipagens: 3 });
  assert.deepEqual(out, { id: 'x', nome: 'Inv', loja: '1', status: 'aberto', origem: 'kontar', tipo: 'geral', sequencial: false,
    enderecos: ['1', '2'], setores: ['A'], criadoEm: '2026-10-28T12:00:00.000Z', encerradoEm: null,
    erp: { refErp: '77', catalogoEm: '2026-10-28T12:00:00.000Z', catalogoItens: null, contagemEnviadaEm: null, contagemRecebidaEm: null, erro: null },
    totais: { bipagens: 3, enderecos: 2 } });
});
