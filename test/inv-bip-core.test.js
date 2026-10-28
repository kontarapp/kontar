// Testes do núcleo puro do inventário (lib/inv-bip-core.js).
// Rodar: npm test   (node --test, sem dependências)
var test = require('node:test');
var assert = require('node:assert/strict');
var Core = require('../lib/inv-bip-core.js');

// ── normEan ──────────────────────────────────────────────────────────────
test('normEan tira zeros à esquerda (UPC-A lido como EAN-13 sem o zero)', function () {
  assert.equal(Core.normEan('0012345678905'), '12345678905');
});
test('normEan mantém EAN-8 que não começa com zero', function () {
  assert.equal(Core.normEan('78912345'), '78912345');
});
test('normEan de só zeros vira "0"', function () {
  assert.equal(Core.normEan('0000'), '0');
});
test('normEan tolera null, número e espaços', function () {
  assert.equal(Core.normEan(null), '0');
  assert.equal(Core.normEan(7891000100103), '7891000100103');
  assert.equal(Core.normEan('  7891000100103  '), '7891000100103');
});

// ── criarCatalogo ────────────────────────────────────────────────────────
var ITENS = [
  { c: '1001', e: '7891000100103', d: 'LEITE INTEGRAL 1L', u: 'UN', q: 48, k: 4.1, v: 5.99 },
  { c: '1009', e: '', d: 'PAO FRANCES KG', u: 'KG', q: 12, k: 8, v: 14.9 },       // só código interno
  { c: '', e: '78912345', d: 'BALA EAN-8', u: 'UN', q: 5, k: 0.5, v: 1 },           // só EAN-8
  { c: '2001', e: '7899999999991', d: 'REFRI LATA UNID', u: 'UN', q: 100, k: 2, v: 3 },
  { c: '2002', e: '7899999999991', d: 'REFRI LATA FARDO 12', u: 'FD', q: 10, k: 24, v: 30 }, // mesmo EAN
  { c: '', e: '', d: 'LINHA INVÁLIDA SEM CÓDIGO' }
];

test('criarCatalogo ignora item sem código e sem EAN', function () {
  var cat = Core.criarCatalogo(ITENS);
  assert.equal(cat.total, 5);
});
test('criarCatalogo indexa por código interno e por EAN normalizado', function () {
  var cat = Core.criarCatalogo(ITENS);
  assert.equal(cat.porCodigo['1001'].d, 'LEITE INTEGRAL 1L');
  assert.equal(cat.porEan['7891000100103'].length, 1);
});
test('criarCatalogo agrupa dois produtos com o mesmo EAN', function () {
  var cat = Core.criarCatalogo(ITENS);
  assert.equal(cat.porEan['7899999999991'].length, 2);
});
test('criarCatalogo converte estoque/custo/venda para número e preserva null', function () {
  var cat = Core.criarCatalogo([{ c: '1', e: '', d: 'X', q: '7', k: '1.5' }]);
  assert.equal(cat.porCodigo['1'].q, 7);
  assert.equal(cat.porCodigo['1'].k, 1.5);
  assert.equal(cat.porCodigo['1'].v, null);
});
test('criarCatalogo: código duplicado mantém o primeiro', function () {
  var cat = Core.criarCatalogo([{ c: '9', e: '', d: 'PRIMEIRO' }, { c: '9', e: '', d: 'SEGUNDO' }]);
  assert.equal(cat.porCodigo['9'].d, 'PRIMEIRO');
});

// ── resolverCodigo ───────────────────────────────────────────────────────
test('resolverCodigo acha por código interno exato', function () {
  var r = Core.resolverCodigo(Core.criarCatalogo(ITENS), '1009');
  assert.equal(r.desc, 'PAO FRANCES KG');
  assert.equal(r.estoque, 12);
});
test('resolverCodigo acha por EAN-13', function () {
  var r = Core.resolverCodigo(Core.criarCatalogo(ITENS), '7891000100103');
  assert.equal(r.codigo, '1001');
});
test('resolverCodigo acha EAN-8', function () {
  var r = Core.resolverCodigo(Core.criarCatalogo(ITENS), '78912345');
  assert.equal(r.desc, 'BALA EAN-8');
});
test('resolverCodigo: UPC-A de 12 dígitos acha EAN-13 cadastrado com 0 na frente', function () {
  var cat = Core.criarCatalogo([{ c: '5', e: '0123456789012', d: 'IMPORTADO' }]);
  var r = Core.resolverCodigo(cat, '123456789012');
  assert.equal(r.desc, 'IMPORTADO');
});
test('resolverCodigo: EAN cadastrado sem zero é achado quando o leitor manda com zero', function () {
  var cat = Core.criarCatalogo([{ c: '6', e: '123456789012', d: 'SEM ZERO' }]);
  assert.equal(Core.resolverCodigo(cat, '0123456789012').desc, 'SEM ZERO');
});
test('resolverCodigo devolve {multiplos} quando o EAN é de vários produtos', function () {
  var r = Core.resolverCodigo(Core.criarCatalogo(ITENS), '7899999999991');
  assert.equal(r.multiplos.length, 2);
  assert.deepEqual(r.multiplos.map(function (m) { return m.codigo; }), ['2001', '2002']);
});
test('resolverCodigo devolve null para código desconhecido, vazio ou catálogo nulo', function () {
  var cat = Core.criarCatalogo(ITENS);
  assert.equal(Core.resolverCodigo(cat, '0000000000000'), null);
  assert.equal(Core.resolverCodigo(cat, ''), null);
  assert.equal(Core.resolverCodigo(null, '1001'), null);
});
test('resolverCodigo: código interno tem prioridade sobre EAN igual', function () {
  var cat = Core.criarCatalogo([{ c: '777', e: '', d: 'POR CODIGO' }, { c: '8', e: '777', d: 'POR EAN' }]);
  assert.equal(Core.resolverCodigo(cat, '777').desc, 'POR CODIGO');
});

// ── montarBlocos ─────────────────────────────────────────────────────────
test('montarBlocos quebra em blocos do tamanho pedido', function () {
  var itens = []; for (var i = 0; i < 2500; i++) itens.push({ c: String(i), e: '', d: 'I' + i });
  var b = Core.montarBlocos(itens, 1000);
  assert.deepEqual(b.map(function (x) { return x.length; }), [1000, 1000, 500]);
});
test('montarBlocos trunca descrição em 120 caracteres e preserva null em estoque', function () {
  var longa = new Array(200).join('X');
  var b = Core.montarBlocos([{ c: '1', e: '', d: longa }], 10);
  assert.equal(b[0][0].d.length, 120);
  assert.equal(b[0][0].q, null);
});
test('montarBlocos de lista vazia devolve zero blocos', function () {
  assert.deepEqual(Core.montarBlocos([], 10), []);
});

// ── parseCatalogoTexto ───────────────────────────────────────────────────
test('parseCatalogoTexto detecta ; e ignora linhas em branco e CRLF', function () {
  var p = Core.parseCatalogoTexto('a;b;c\r\n1;2;3\r\n\r\n4;5;6\r\n');
  assert.equal(p.delim, ';');
  assert.deepEqual(p.linhas, [['a', 'b', 'c'], ['1', '2', '3'], ['4', '5', '6']]);
});
test('parseCatalogoTexto detecta TAB, | e vírgula como último recurso', function () {
  assert.equal(Core.parseCatalogoTexto('a\tb\n1\t2').delim, '\t');
  assert.equal(Core.parseCatalogoTexto('a|b\n1|2').delim, '|');
  assert.equal(Core.parseCatalogoTexto('a,b\n1,2').delim, ',');
});
test('parseCatalogoTexto apara espaços das células', function () {
  assert.deepEqual(Core.parseCatalogoTexto(' 1 ; LEITE 1L ').linhas[0], ['1', 'LEITE 1L']);
});
test('parseCatalogoTexto de texto vazio devolve zero linhas', function () {
  assert.equal(Core.parseCatalogoTexto('').linhas.length, 0);
});

// ── mapearColunas ────────────────────────────────────────────────────────
test('mapearColunas com cabeçalho mapeia por nome (pt-BR)', function () {
  var m = Core.mapearColunas(['Codigo', 'EAN', 'Descrição', 'Unid', 'Estoque', 'Custo', 'Preço Venda'], []);
  assert.deepEqual(m, { codigo: 0, ean: 1, desc: 2, un: 3, estoque: 4, custo: 5, venda: 6, temHeader: true });
});
test('mapearColunas sem cabeçalho deduz pelo formato das colunas', function () {
  var linhas = [
    ['1001', '7891000100103', 'LEITE INTEGRAL 1L', 'UN'],
    ['1002', '7894900011517', 'REFRIGERANTE 2L', 'UN'],
    ['1003', '7891910000197', 'ACUCAR 1KG', 'UN']
  ];
  var m = Core.mapearColunas(linhas[0], linhas.slice(1));
  assert.equal(m.temHeader, false);
  assert.equal(m.codigo, 0);
  assert.equal(m.ean, 1);
  assert.equal(m.desc, 2);
  assert.equal(m.un, 3);
});
test('mapearColunas: "código" com acento e "gtin" também são reconhecidos', function () {
  var m = Core.mapearColunas(['código', 'gtin', 'produto'], []);
  assert.equal(m.codigo, 0); assert.equal(m.ean, 1); assert.equal(m.desc, 2);
});

// ── criarDetectorRajada ──────────────────────────────────────────────────
test('detector de rajada dispara com leitor rápido e não dispara com digitação humana', function () {
  var d = Core.criarDetectorRajada(100, 4);
  var out = null;
  '78910'.split('').forEach(function (ch, i) { out = d.tecla(ch, 1000 + i * 5); });
  assert.equal(out, '78910');
  var h = Core.criarDetectorRajada(100, 4);
  var out2 = null;
  '78910'.split('').forEach(function (ch, i) { out2 = h.tecla(ch, 1000 + i * 300); });
  assert.equal(out2, null);
});
test('detector de rajada zera o buffer após pausa', function () {
  var d = Core.criarDetectorRajada(100, 4);
  d.tecla('1', 0); d.tecla('2', 10);
  d.tecla('3', 500); d.tecla('4', 510); d.tecla('5', 520); d.tecla('6', 530);
  assert.equal(d.tecla('7', 540), '34567');
});

// ── calcularResultado ────────────────────────────────────────────────────
function catBase() {
  return Core.criarCatalogo([
    { c: '1', e: '7891000000011', d: 'A', u: 'UN', q: 10, k: 2, v: 3 },
    { c: '2', e: '7891000000028', d: 'B', u: 'UN', q: 5, k: 4, v: 6 },
    { c: '3', e: '7891000000035', d: 'C', u: 'UN', q: 8, k: 1, v: 2 }
  ]);
}
function linha(res, codigo) { return res.linhas.find(function (l) { return l.codigo === codigo; }); }

test('resultado: soma bipagens do mesmo produto em endereços diferentes', function () {
  var res = Core.calcularResultado(catBase(), [
    { codigo: '1', qty: 6, endereco: 'C01' }, { codigo: '1', qty: 4, endereco: 'C02' }
  ]);
  var l = linha(res, '1');
  assert.equal(l.contado, 10); assert.equal(l.dif, 0); assert.equal(l.ends, 2); assert.equal(l.bips, 2);
});
test('resultado: bipagem só com EAN resolve pro código interno', function () {
  var res = Core.calcularResultado(catBase(), [{ ean: '7891000000028', qty: 5, endereco: 'C01' }]);
  assert.equal(linha(res, '2').contado, 5);
});
test('resultado: sobra e falta em unidades e valor (custo)', function () {
  var res = Core.calcularResultado(catBase(), [
    { codigo: '1', qty: 12, endereco: 'C01' },   // +2 x 2.00 = sobra 4
    { codigo: '2', qty: 2, endereco: 'C01' },    // -3 x 4.00 = falta 12
    { codigo: '3', qty: 8, endereco: 'C01' }
  ]);
  assert.equal(res.totais.divergentes, 2);
  assert.equal(res.totais.sobraUn, 2); assert.equal(res.totais.sobraVal, 4);
  assert.equal(res.totais.faltaUn, 3); assert.equal(res.totais.faltaVal, 12);
  assert.equal(res.totais.coletados, 3);
});
test('resultado: produto sem nenhuma bipagem vai pra "não coletados", não pra falta', function () {
  var res = Core.calcularResultado(catBase(), [{ codigo: '1', qty: 10, endereco: 'C01' }]);
  assert.equal(res.totais.naoColetados, 2);
  assert.equal(res.totais.naoColetadosUn, 13);
  assert.equal(res.totais.faltaUn, 0);
  assert.equal(res.totais.divergentes, 0);
});
test('resultado: código não cadastrado entra como linha nc com desc "(não cadastrado)"', function () {
  var res = Core.calcularResultado(catBase(), [{ codigo: '999', qty: 3, endereco: 'C01' }]);
  var l = linha(res, '999');
  assert.equal(l.nc, true); assert.equal(l.desc, '(não cadastrado)'); assert.equal(l.sistema, null);
  assert.equal(res.totais.naoCadastrados, 1);
});
test('resultado: correção em _CORRECAO conta no produto mas não cria endereço', function () {
  var res = Core.calcularResultado(catBase(), [
    { codigo: '1', qty: 8, endereco: 'C01' }, { codigo: '1', qty: 2, endereco: '_CORRECAO', modo: 'correcao' }
  ]);
  assert.equal(linha(res, '1').contado, 10);
  assert.equal(Object.keys(res.porEnd).length, 1);
  assert.equal(res.porEnd.C01['c:1'], 8);
});
test('resultado: com rodada resolvida, só a rodada escolhida do endereço conta', function () {
  var res = Core.calcularResultado(catBase(), [
    { codigo: '1', qty: 7, endereco: 'C01', rodada: 1 },
    { codigo: '1', qty: 10, endereco: 'C01', rodada: 2 }
  ], { C01: { rodada: 2 } });
  assert.equal(linha(res, '1').contado, 10);
});
test('resultado: bipagem sem rodada é tratada como rodada 1', function () {
  var res = Core.calcularResultado(catBase(), [
    { codigo: '1', qty: 7, endereco: 'C01' },
    { codigo: '1', qty: 10, endereco: 'C01', rodada: 2 }
  ], { C01: { rodada: 1 } });
  assert.equal(linha(res, '1').contado, 7);
});
test('resultado: correção ignora a resolução de rodada', function () {
  var res = Core.calcularResultado(catBase(), [
    { codigo: '1', qty: 7, endereco: 'C01', rodada: 1 },
    { codigo: '1', qty: 1, endereco: 'C01', rodada: 2, modo: 'correcao' }
  ], { C01: { rodada: 1 } });
  assert.equal(linha(res, '1').contado, 8);
});
test('resultado: endereços suspeitos ordenados por valor da divergência', function () {
  var res = Core.calcularResultado(catBase(), [
    { codigo: '1', qty: 11, endereco: 'C01' },  // +1 x 2 = 2
    { codigo: '2', qty: 9, endereco: 'C02' }    // +4 x 4 = 16
  ]);
  assert.deepEqual(res.enderecos.map(function (e) { return e.endereco; }), ['C02', 'C01']);
  assert.equal(res.enderecos[0].itensDivergentes, 1);
});
test('resultado: linhas ordenadas pela maior divergência em valor', function () {
  var res = Core.calcularResultado(catBase(), [
    { codigo: '1', qty: 11, endereco: 'C01' }, { codigo: '2', qty: 9, endereco: 'C01' }, { codigo: '3', qty: 8, endereco: 'C01' }
  ]);
  assert.equal(res.linhas[0].codigo, '2');
});
test('resultado: produto sem custo divergente conta em semCusto', function () {
  var cat = Core.criarCatalogo([{ c: '1', e: '', d: 'A', q: 10 }]);
  var res = Core.calcularResultado(cat, [{ codigo: '1', qty: 12, endereco: 'C01' }]);
  assert.equal(res.totais.semCusto, 1); assert.equal(res.totais.sobraUn, 2); assert.equal(res.totais.sobraVal, 0);
});
test('resultado: qty inválida conta como zero', function () {
  var res = Core.calcularResultado(catBase(), [{ codigo: '1', qty: 'abc', endereco: 'C01' }]);
  assert.equal(linha(res, '1').contado, 0);
});
test('resultado: totais de venda contada e sistema', function () {
  var res = Core.calcularResultado(catBase(), [{ codigo: '1', qty: 10, endereco: 'C01' }]);
  assert.equal(linha(res, '1').vendaContada, 30);
  assert.equal(res.totais.sistemaUn, 23);
  assert.equal(res.totais.sistemaVal, 10 * 2 + 5 * 4 + 8 * 1);
  assert.equal(res.totais.contadoVal, 20);
});

// ── Regressão: catálogo reenviado depois das bipagens ────────────────────
// A bipagem guarda `codigo` resolvido na hora do bip. Se o catálogo for reenviado
// com outro mapeamento, esse código pode não existir mais em porCodigo, mas o
// produto continua identificável pelo EAN (ou o próprio código gravado É o EAN).
test('resultado: bip com codigo que virou EAN no catálogo reenviado casa com o produto', function () {
  var cat = Core.criarCatalogo([{ c: '', e: '7891000100103', d: 'ARROZ 5KG', u: 'CX', q: 20, k: 10, v: 15 }]);
  var res = Core.calcularResultado(cat, [{ codigo: '7891000100103', ean: '7891000100103', qty: 20, endereco: '1' }]);
  assert.equal(res.totais.naoCadastrados, 0);
  var l = res.linhas.find(function (x) { return x.desc === 'ARROZ 5KG'; });
  assert.equal(l.contado, 20);
});
test('resultado: bip com codigo interno antigo e EAN válido casa pelo EAN', function () {
  var cat = Core.criarCatalogo([{ c: '', e: '7891095100066', d: 'ACUCAR 5KG', u: 'FD', q: 50, k: 5, v: 8 }]);
  var res = Core.calcularResultado(cat, [{ codigo: '1003', ean: '7891095100066', qty: 50, endereco: '2' }]);
  assert.equal(res.totais.naoCadastrados, 0);
  assert.equal(res.linhas.find(function (x) { return x.desc === 'ACUCAR 5KG'; }).contado, 50);
});
