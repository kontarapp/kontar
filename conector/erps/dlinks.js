'use strict';
// Adaptador Dlinks (MySQL "central"). Só LÊ itens/estoque/inventário e só INSERE linhas em
// inventariodigitador + inventariocontagem — tabelas que o próprio Dlinks usa no inventário.
// Nunca cria tabela/coluna, nunca DROP/TRUNCATE, nunca UPDATE/DELETE.
//
// Tabelas do Dlinks usadas:
//   inventario          nIven, Data, Tipo (GERAL/PARCIAL), Status (2 = fechado), nLoja, Nome,
//                       filtros do parcial: CodGrupo, CodSubGrupo, CodSetor, CodMarca, CodFornec
//   itens               CodigoBarra (código do produto), Descricao, Unid, custo, P{loja} (venda), CodDesativado
//   estoquen{loja}      CodigoBarra, Qtd (texto c/ vírgula), CustoMedio
//   inventariodigitador nReg, nLoja, nIven, Nome, Senha, Backup
//   inventariocontagem  nLoja, nIven, CodigoBarra, Qtd decimal(10,3), CodDigitador, DataHora 'dd/mm/aaaa hh:mm:ss',
//                       App, Lote, Backup, End, CodGrupo, seq, emissornfe

const NOME_DIGITADOR = 'KONTAR';

function num(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const s = String(v).trim(); if (!s) return null;
  const n = Number(s.indexOf(',') >= 0 ? s.replace(/\./g, '').replace(',', '.') : s);
  return isFinite(n) ? n : null;
}
const r3 = n => Math.round(n * 1000) / 1000;
function dataHoraBR(d) {
  const p = x => String(x).padStart(2, '0');
  return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}
function lojaValida(l) { const n = Number(l); if (!Number.isInteger(n) || n < 0 || n > 999) throw new Error('loja inválida: ' + l); return n; }

// Filtros do inventário parcial → colunas de itens. Só entram os que vierem preenchidos (> 0).
const FILTROS_PARCIAL = [['CodGrupo', 'CodGrupo'], ['CodSubGrupo', 'CodGrupoSub'], ['CodSetor', 'codsetor'], ['CodMarca', 'CodMarca'], ['CodFornec', 'CodFornecedor']];
function filtrosParcial(inv) {
  if (String(inv.Tipo || '').toUpperCase() !== 'PARCIAL') return [];
  return FILTROS_PARCIAL.filter(([h]) => Number(inv[h]) > 0).map(([h, col]) => ({ col, val: Number(inv[h]) }));
}

// Linha de itens + estoque da loja → item do catálogo da API Kontar.
function itemCatalogo(row, est) {
  const cod = String(row.CodigoBarra || '').trim();
  const custoMedio = est ? num(est.CustoMedio) : null;
  const custo = custoMedio != null && custoMedio > 0 ? custoMedio : num(row.custo);
  return {
    codigo: cod,
    ean: /^\d{8,14}$/.test(cod) ? cod : '',
    descricao: String(row.Descricao || '').trim(),
    un: String(row.Unid || '').trim().toUpperCase(),
    estoque: est ? num(est.Qtd) : null,
    custo: custo != null ? custo : null,
    venda: num(row.venda)
  };
}

// Contagem da API → linhas de inventariocontagem (sem nReg, que é auto_increment).
//  porEndereco=false: 1 linha por produto com a quantidade oficial (End = '0', como o Dlinks grava sem local).
//  porEndereco=true : 1 linha por produto×endereço; se a auditoria corrigiu o total, a diferença vai
//                     numa linha extra com End = 'KONTAR' pra soma bater com a quantidade oficial.
// Só vai o que foi CONTADO (quantidade > 0): o Dlinks cuida dos zeros (geral zera o resto da loja ao fechar;
// parcial já nasce com uma linha 0 pra cada item da lista).
// Fica de fora (em `ignorados`, com motivo): não cadastrado no ERP, ou fora da lista do parcial (ctx.lista).
function linhasContagem(contagem, ctx) {
  const grupos = ctx.grupos || {};
  const base = cod => ({ nLoja: ctx.nLoja, nIven: ctx.nIven, CodigoBarra: cod, CodDigitador: ctx.codDigitador, DataHora: ctx.dataHora,
    App: ctx.app || 0, Lote: 0, Backup: 0, CodGrupo: grupos[cod] || 0, seq: 0, emissornfe: 0 });
  const ignorados = [], linhas = [];
  const oficiais = new Map(); // Map mantém a ordem da contagem (objeto reordenaria códigos numéricos)
  const lista = ctx.lista ? new Set(ctx.lista.map(String)) : null;
  (contagem.itens || []).forEach(it => {
    const cod = String(it.codigo || it.ean || '').trim();
    const q = r3(Number(it.quantidade || 0));
    if (!(q > 0)) return; // não contado: nada a gravar
    if (!cod || it.naoCadastrado || !Object.prototype.hasOwnProperty.call(grupos, cod)) { ignorados.push({ codigo: cod, quantidade: q, motivo: 'nao_cadastrado' }); return; }
    if (lista && !lista.has(cod)) { ignorados.push({ codigo: cod, quantidade: q, motivo: 'fora_da_lista' }); return; }
    oficiais.set(cod, r3((oficiais.get(cod) || 0) + q));
  });
  if (!ctx.porEndereco || !contagem.porEndereco) {
    oficiais.forEach((q, cod) => linhas.push(Object.assign(base(cod), { Qtd: q, End: '0' })));
    return { linhas, ignorados };
  }
  const somaEnd = {};
  contagem.porEndereco.forEach(e => (e.itens || []).forEach(it => {
    const cod = String(it.codigo || it.ean || '').trim();
    if (!oficiais.has(cod)) return;
    const q = r3(Number(it.quantidade || 0)); if (!q) return;
    somaEnd[cod] = r3((somaEnd[cod] || 0) + q);
    linhas.push(Object.assign(base(cod), { Qtd: q, End: String(e.endereco).slice(0, 15) }));
  }));
  oficiais.forEach((q, cod) => {
    const dif = r3(q - (somaEnd[cod] || 0));
    if (dif !== 0) linhas.push(Object.assign(base(cod), { Qtd: dif, End: 'KONTAR' }));
  });
  return { linhas, ignorados };
}

const COLS_CONTAGEM = ['nLoja', 'nIven', 'CodigoBarra', 'Qtd', 'CodDigitador', 'DataHora', 'App', 'Lote', 'Backup', 'End', 'CodGrupo', 'seq', 'emissornfe'];
const COLS_INV = 'nIven, Data, Tipo, Status, nLoja, Nome, CodGrupo, CodSubGrupo, CodSetor, CodMarca, CodFornec';

function criarDlinks(pool, cfgDl) {
  cfgDl = cfgDl || {};
  const fechados = (cfgDl.statusFechados || [2, 3]).map(Number);
  const desde = Number(cfgDl.desdeNIven || 0);
  const q = async (sql, args) => { const [rows] = await pool.query(sql, args || []); return rows; };

  async function listarAbertos(lojas) {
    const args = [fechados, desde];
    let sql = 'SELECT ' + COLS_INV + ' FROM inventario WHERE Status NOT IN (?) AND nIven >= ?';
    if (lojas && lojas.length) { sql += ' AND nLoja IN (?)'; args.push(lojas.map(lojaValida)); }
    return q(sql + ' ORDER BY nIven', args);
  }
  async function inventario(nIven) {
    const r = await q('SELECT ' + COLS_INV + ' FROM inventario WHERE nIven = ?', [Number(nIven)]);
    return r[0] || null;
  }
  function estaFechado(inv) { return fechados.indexOf(Number(inv.Status)) >= 0; }

  // Lista do parcial: ao abrir um parcial o Dlinks grava uma linha Qtd 0, sem digitador e sem coletor
  // (CodDigitador 0, App 0), pra cada item da lista. Geral não tem essas linhas.
  async function listaParcial(inv) {
    if (String(inv.Tipo || '').toUpperCase() !== 'PARCIAL') return null;
    const r = await q('SELECT DISTINCT CodigoBarra FROM inventariocontagem WHERE nIven = ? AND CodDigitador = 0 AND App = 0 AND Qtd = 0', [Number(inv.nIven)]);
    const l = r.map(x => String(x.CodigoBarra).trim()).filter(Boolean);
    return l.length ? l : null;
  }

  async function catalogo(inv) {
    const loja = lojaValida(inv.nLoja);
    const cols = (await q('SHOW COLUMNS FROM itens')).map(c => c.Field);
    const colVenda = cols.indexOf('P' + loja) >= 0 ? 'P' + loja : null;
    const sel = 'SELECT CodigoBarra, Descricao, Unid, custo' + (colVenda ? ', ' + colVenda + ' venda' : '') + ' FROM itens WHERE ';
    let itens;
    const lista = await listaParcial(inv);
    if (lista) {
      // parcial: só os itens da lista do inventário (mesmo os desativados, se estiverem na lista)
      itens = [];
      for (let i = 0; i < lista.length; i += 1000) itens = itens.concat(await q(sel + 'CodigoBarra IN (?)', [lista.slice(i, i + 1000)]));
    } else {
      const f = filtrosParcial(inv);
      const where = ['CodDesativado = 0'].concat(f.map(x => x.col + ' = ?'));
      itens = await q(sel + where.join(' AND '), f.map(x => x.val));
    }
    const est = {};
    // estoquen pode ter mais de uma linha por produto: vale a de maior nReg.
    for (const r of await q('SELECT CodigoBarra, Qtd, CustoMedio FROM estoquen' + loja + ' ORDER BY nReg')) est[String(r.CodigoBarra).trim()] = r;
    return itens.map(r => itemCatalogo(r, est[String(r.CodigoBarra).trim()])).filter(i => i.codigo);
  }

  // Grava a contagem final. Idempotente: se o digitador KONTAR deste inventário já tem linhas, não grava de novo.
  async function gravarContagem(inv, contagem, opts) {
    opts = opts || {};
    const nIven = Number(inv.nIven), nLoja = lojaValida(inv.nLoja);
    const atual = await inventario(nIven);
    if (!atual) throw new Error('Inventário ' + nIven + ' não existe mais no Dlinks');
    if (estaFechado(atual)) throw new Error('Inventário ' + nIven + ' já está fechado no Dlinks (Status ' + atual.Status + '); contagem não gravada');
    const c = await pool.getConnection();
    try {
      await c.beginTransaction();
      const [dig] = await c.query('SELECT nReg FROM inventariodigitador WHERE nIven = ? AND Nome = ? ORDER BY nReg LIMIT 1', [nIven, NOME_DIGITADOR]);
      let codDig = dig[0] && dig[0].nReg;
      if (codDig) {
        const [[ja]] = await c.query('SELECT COUNT(*) n FROM inventariocontagem WHERE nIven = ? AND CodDigitador = ?', [nIven, codDig]);
        if (Number(ja.n) > 0) { await c.commit(); return { jaGravado: true, linhas: Number(ja.n), ignorados: [], codDigitador: codDig }; }
      } else {
        const [ins] = await c.query('INSERT INTO inventariodigitador (nLoja, nIven, Nome, Senha, Backup) VALUES (?, ?, ?, ?, 0)', [0, nIven, NOME_DIGITADOR, '']);
        codDig = ins.insertId;
      }
      const cods = [...new Set((contagem.itens || []).map(i => String(i.codigo || i.ean || '').trim()).filter(Boolean))];
      const grupos = {};
      for (let i = 0; i < cods.length; i += 1000) {
        const [rows] = await c.query('SELECT CodigoBarra, CodGrupo FROM itens WHERE CodigoBarra IN (?)', [cods.slice(i, i + 1000)]);
        rows.forEach(r => { grupos[String(r.CodigoBarra).trim()] = Number(r.CodGrupo) || 0; });
      }
      const lista = await listaParcial(atual);
      const { linhas, ignorados } = linhasContagem(contagem, { nLoja, nIven, codDigitador: codDig, dataHora: dataHoraBR(opts.agora || new Date()),
        app: opts.app || 0, porEndereco: !!opts.porEndereco, grupos, lista });
      for (let i = 0; i < linhas.length; i += 500) {
        const lote = linhas.slice(i, i + 500);
        await c.query('INSERT INTO inventariocontagem (' + COLS_CONTAGEM.join(', ') + ') VALUES ?', [lote.map(l => COLS_CONTAGEM.map(k => l[k]))]);
      }
      await c.commit();
      return { jaGravado: false, linhas: linhas.length, ignorados, codDigitador: codDig };
    } catch (e) { try { await c.rollback(); } catch (_) {} throw e; } finally { c.release(); }
  }

  // Lojas = tabelas estoquen{n} com produto; nome da tabela `loja` do Dlinks quando existir (senão "Loja n").
  async function listarLojas() {
    const tabs = (await q("SHOW TABLES LIKE 'estoquen%'")).map(r => String(Object.values(r)[0])).filter(t => /^estoquen\d+$/i.test(t));
    const nomes = {};
    try { (await q('SELECT CodLoja, Nome FROM loja')).forEach(r => { nomes[Number(r.CodLoja)] = String(r.Nome || '').trim(); }); } catch (e) {}
    const out = [];
    for (const t of tabs) {
      const n = Number(t.replace(/\D/g, ''));
      const r = await q('SELECT COUNT(*) n FROM ' + t);
      const itens = Number(r[0].n);
      if (itens > 0) out.push({ n, nome: nomes[n] || ('Loja ' + n), itens });
    }
    return out.sort((a, b) => a.n - b.n);
  }
  async function maiorInventario() { const r = await q('SELECT COALESCE(MAX(nIven), 0) n FROM inventario'); return Number(r[0].n); }

  async function testar() { const r = await q('SELECT COUNT(*) n FROM inventario'); return { inventarios: Number(r[0].n) }; }

  return { listarAbertos, inventario, estaFechado, catalogo, gravarContagem, testar, listarLojas, maiorInventario, listaParcial };
}

module.exports = { criarDlinks, itemCatalogo, linhasContagem, filtrosParcial, dataHoraBR, num, NOME_DIGITADOR, COLS_CONTAGEM };
