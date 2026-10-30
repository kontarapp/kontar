'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { rodarCiclo, expandirEnderecos } = require('../lib/ciclo');
const { criarApi } = require('../lib/api');

const logMudo = { info() {}, erro() {} };

function apiFalsa(balancos) {
  const chamadas = [];
  let seq = 0;
  return {
    chamadas,
    listarBalancos: async () => balancos.map(b => JSON.parse(JSON.stringify(b))),
    criarBalanco: async (b) => { chamadas.push(['criar', b]); const nb = { id: 'k' + (++seq), status: 'aberto', origem: 'erp', loja: b.loja, erp: { refErp: b.refErp, catalogoEm: null } }; balancos.push(nb); return nb; },
    enviarCatalogo: async (id, itens) => { chamadas.push(['catalogo', id, itens.length]); return { itens: itens.length }; },
    contagem: async (id, porEnd) => { chamadas.push(['contagem', id, porEnd]); return { itens: [{ codigo: '18', quantidade: 2 }] }; },
    estadoErp: async (id, c) => { chamadas.push(['estado', id, c]); return { ok: true }; },
    confirmar: async (id) => { chamadas.push(['confirmar', id]); return { ok: true }; }
  };
}
function erpFalso(abertos, opts) {
  const chamadas = [];
  return {
    chamadas,
    listarAbertos: async (lojas) => { chamadas.push(['abertos', lojas]); return abertos; },
    catalogo: async (inv) => { chamadas.push(['catalogo', inv.nIven]); return (opts && opts.vazio) ? [] : [{ codigo: '18' }, { codigo: '1465' }]; },
    inventario: async (n) => (opts && opts.semInv) ? null : { nIven: Number(n), nLoja: 5, Status: 0 },
    gravarContagem: async (inv, c, o) => { chamadas.push(['gravar', inv.nIven, o]); if (opts && opts.falhaGravar) throw new Error('banco fora'); return { jaGravado: false, linhas: 1, ignorados: (opts && opts.ignorados) || [] }; }
  };
}

test('expandirEnderecos: faixa, lista e array', () => {
  assert.deepStrictEqual(expandirEnderecos('1-3'), ['1', '2', '3']);
  assert.deepStrictEqual(expandirEnderecos('C01, C02,1-2'), ['C01', 'C02', '1', '2']);
  assert.deepStrictEqual(expandirEnderecos(['A', ' B ', '']), ['A', 'B']);
  assert.throws(() => expandirEnderecos('1-99999'));
});

test('inventário aberto novo: cria balanço de origem ERP e envia catálogo', async () => {
  const api = apiFalsa([]), erp = erpFalso([{ nIven: 778, nLoja: 5, Tipo: 'PARCIAL', Nome: 'TESTE KONTAR' }]);
  const r = await rodarCiclo({ api, erp, cfg: { lojas: [5], enderecosPadrao: '1-3' }, log: logMudo });
  assert.deepStrictEqual(r, { criados: 1, catalogos: 1, contagens: 0, erros: 0 });
  const criar = api.chamadas.find(c => c[0] === 'criar')[1];
  assert.deepStrictEqual(criar, { refErp: '778', nome: 'TESTE KONTAR · ERP 778', loja: '5', tipo: 'parcial', sequencial: false, enderecos: ['1', '2', '3'] });
  assert.deepStrictEqual(api.chamadas.find(c => c[0] === 'catalogo'), ['catalogo', 'k1', 2]);
  assert.deepStrictEqual(erp.chamadas[0], ['abertos', [5]]);
});

test('balanço já existente com catálogo: não recria nem reenvia', async () => {
  const api = apiFalsa([{ id: 'x', status: 'aberto', origem: 'erp', loja: '5', erp: { refErp: '778', catalogoEm: '2026-10-30T10:00:00Z' } }]);
  const erp = erpFalso([{ nIven: 778, nLoja: 5, Tipo: 'GERAL', Nome: 'G' }]);
  const r = await rodarCiclo({ api, erp, cfg: {}, log: logMudo });
  assert.deepStrictEqual(r, { criados: 0, catalogos: 0, contagens: 0, erros: 0 });
  assert.strictEqual(api.chamadas.length, 0);
});

test('catálogo vazio no ERP vira erro no balanço', async () => {
  const api = apiFalsa([]), erp = erpFalso([{ nIven: 778, nLoja: 5, Tipo: 'GERAL', Nome: 'G' }], { vazio: true });
  const r = await rodarCiclo({ api, erp, cfg: {}, log: logMudo });
  assert.strictEqual(r.erros, 1);
  const est = api.chamadas.find(c => c[0] === 'estado');
  assert.match(est[2].erro, /Catálogo vazio/);
});

test('balanço encerrado: grava contagem no ERP, marca enviada e confirma', async () => {
  const api = apiFalsa([{ id: 'x', status: 'encerrado', origem: 'erp', loja: '5', erp: { refErp: '778', catalogoEm: 'a', contagemEnviadaEm: null } }]);
  const erp = erpFalso([]);
  const r = await rodarCiclo({ api, erp, cfg: { porEndereco: true, app: 0 }, log: logMudo });
  assert.strictEqual(r.contagens, 1);
  assert.deepStrictEqual(erp.chamadas.find(c => c[0] === 'gravar'), ['gravar', 778, { app: 0, porEndereco: true }]);
  assert.deepStrictEqual(api.chamadas.filter(c => c[0] !== 'contagem').map(c => c.slice(0, 3)), [['estado', 'x', { contagemEnviadaEm: true, erro: null }], ['confirmar', 'x']]);
});

test('encerrado já enviado, de outra loja ou de origem Kontar: não mexe', async () => {
  const api = apiFalsa([
    { id: 'a', status: 'encerrado', origem: 'erp', loja: '5', erp: { refErp: '778', contagemEnviadaEm: '2026-10-30T10:00:00Z' } },
    { id: 'b', status: 'encerrado', origem: 'erp', loja: '6', erp: { refErp: '779' } },
    { id: 'c', status: 'encerrado', origem: 'kontar', loja: '5', erp: {} }
  ]);
  const erp = erpFalso([]);
  const r = await rodarCiclo({ api, erp, cfg: { lojas: [5] }, log: logMudo });
  assert.strictEqual(r.contagens, 0);
  assert.strictEqual(erp.chamadas.filter(c => c[0] === 'gravar').length, 0);
});

test('falha ao gravar no ERP: erro no balanço, não marca enviada', async () => {
  const api = apiFalsa([{ id: 'x', status: 'encerrado', origem: 'erp', loja: '5', erp: { refErp: '778' } }]);
  const erp = erpFalso([], { falhaGravar: true });
  const r = await rodarCiclo({ api, erp, cfg: {}, log: logMudo });
  assert.strictEqual(r.erros, 1);
  assert.deepStrictEqual(api.chamadas.filter(c => c[0] === 'estado').map(c => c[2]), [{ erro: 'banco fora' }]);
  assert.strictEqual(api.chamadas.filter(c => c[0] === 'confirmar').length, 0);
});

test('não cadastrados ficam de fora e aparecem como aviso no balanço', async () => {
  const api = apiFalsa([{ id: 'x', status: 'encerrado', origem: 'erp', loja: '5', erp: { refErp: '778' } }]);
  const erp = erpFalso([], { ignorados: [{ codigo: '999', quantidade: 1 }] });
  await rodarCiclo({ api, erp, cfg: {}, log: logMudo });
  const est = api.chamadas.find(c => c[0] === 'estado')[2];
  assert.strictEqual(est.contagemEnviadaEm, true);
  assert.match(est.erro, /1 não cadastrado\(s\) no ERP \(999\)/);
});

test('api: catálogo acima de 5.000 itens vai em partes de 2.000', async () => {
  const corpos = [];
  const api = criarApi({ url: 'https://x/api/v1/', token: 't' }, { fetch: async (url, o) => { corpos.push([o.method, url, JSON.parse(o.body)]); return { ok: true, status: 200, json: async () => ({}) }; } });
  await api.enviarCatalogo('b1', Array.from({ length: 5001 }, (_, i) => ({ codigo: String(i) })));
  assert.deepStrictEqual(corpos.map(c => [c[0], c[1], c[2].parte, c[2].total, c[2].itens.length]),
    [['PUT', 'https://x/api/v1/balancos/b1/catalogo', 1, 3, 2000], ['PUT', 'https://x/api/v1/balancos/b1/catalogo', 2, 3, 2000], ['PUT', 'https://x/api/v1/balancos/b1/catalogo', 3, 3, 1001]]);
});

test('api: erro HTTP vira exceção com código da API', async () => {
  const api = criarApi({ url: 'https://x/api/v1', token: 't' }, { fetch: async () => ({ ok: false, status: 409, json: async () => ({ erro: 'balanco_aberto', mensagem: 'ainda aberto' }) }) });
  await assert.rejects(api.contagem('b1'), e => e.status === 409 && e.codigo === 'balanco_aberto');
});

test('api: falha de rede tenta de novo e segue; 4xx não repete', async () => {
  let n = 0;
  const api = criarApi({ url: 'https://x/api/v1', token: 't' }, { espera: async () => {}, fetch: async () => { n++; if (n < 3) throw new TypeError('fetch failed'); return { ok: true, status: 200, json: async () => ({ clienteId: 'c' }) }; } });
  assert.deepStrictEqual(await api.eu(), { clienteId: 'c' }); assert.strictEqual(n, 3);
  let m = 0;
  const api2 = criarApi({ url: 'https://x/api/v1', token: 't' }, { espera: async () => {}, fetch: async () => { m++; return { ok: false, status: 401, json: async () => ({ erro: 'nao_autorizado', mensagem: 'x' }) }; } });
  await assert.rejects(api2.eu(), e => e.status === 401); assert.strictEqual(m, 1);
});

test('aviso separa fora da lista do parcial e não cadastrados', () => {
  const { resumoIgnorados } = require('../lib/ciclo');
  assert.strictEqual(resumoIgnorados([]), null);
  assert.strictEqual(resumoIgnorados([{ codigo: '18', motivo: 'fora_da_lista' }, { codigo: '999', motivo: 'nao_cadastrado' }]),
    'Gravado no ERP, mas ficaram de fora: 1 fora da lista do parcial (18); 1 não cadastrado(s) no ERP (999)');
});
