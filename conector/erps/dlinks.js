'use strict';
// Adaptador Dlinks (MySQL "central"). Só LÊ itens/estoque/inventário; INSERE linhas em
// inventariodigitador + inventariocontagem e mantém a lista da tela em inventarioprodutos como o coletor do
// Dlinks faz (INSERT do produto novo; UPDATE só de Qtd/TotalCusto/TotalVenda, só no inventário aberto).
// Nunca cria tabela/coluna, nunca DROP/TRUNCATE, nunca DELETE.
//
// Tabelas do Dlinks usadas:
//   inventario          nIven, Data, Tipo (GERAL/PARCIAL), Status (2 = fechado), nLoja, Nome,
//                       filtros do parcial: CodGrupo, CodSubGrupo, CodSetor, CodMarca, CodFornec
//   itens               CodigoBarra (código do produto), Descricao, Unid, custo, P{loja} (venda), CodDesativado
//   estoquen{loja}      CodigoBarra, Qtd (texto c/ vírgula), CustoMedio
//   inventariodigitador nReg, nLoja, nIven, Nome, Senha, Backup
//   inventariocontagem  nLoja, nIven, CodigoBarra, Qtd decimal(10,3), CodDigitador, DataHora 'dd/mm/aaaa hh:mm:ss',
//                       App, Lote, Backup, End, CodGrupo, seq, emissornfe
//   inventarioprodutos  nLoja, nIven, CodigoBarra, Descricao, Und, Qtd, QtdAnt, TotalCusto, TotalVenda, End, CodGrupo,
//                       CustoUnitario, Status (0 = aberto) — a lista da tela "Inventário de Estoque"

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
    const cl = await custosLoja(loja, itens.map(r => String(r.CodigoBarra || '').trim()).filter(Boolean));
    return itens.map(r => { const k = String(r.CodigoBarra).trim(); const it = itemCatalogo(r, est[k]); if (cl[k] != null) it.custo = cl[k]; return it; }).filter(i => i.codigo);
  }

  // Lista da tela "Inventário de Estoque" (inventarioprodutos), do jeito que o coletor do Dlinks faz com o
  // inventário aberto: uma linha por produto (End '0', Status 0, loja do inventário) com Qtd = soma da contagem
  // de TODOS os digitadores/coletores, QtdAnt = estoque da loja, custo e venda atuais. Produto que já está na
  // lista só tem Qtd/TotalCusto/TotalVenda atualizados quando mudam (QtdAnt fica como o Dlinks gravou). Só os produtos que o
  // KONTAR contou ou mexeu; só com o inventário aberto (Status 0). Roda dentro da transação da contagem.
  // Custo da loja como o Dlinks usa no inventário: custoloja{loja}.Custo (texto com vírgula, 1 linha por produto).
  // Conferido: TotalCusto/Qtd dos inventários fechados bate com ele. Sem a tabela/linha, cai no custo médio/cadastro.
  async function custosLoja(nLoja, cods, conn) {
    const out = {};
    try {
      for (let i = 0; i < cods.length; i += 1000) {
        const [r] = await (conn || pool).query('SELECT CodigoBarra, Custo FROM custoloja' + lojaValida(nLoja) + ' WHERE CodigoBarra IN (?) ORDER BY nReg', [cods.slice(i, i + 1000)]);
        r.forEach(x => { const v = num(x.Custo); if (v != null && v > 0) out[String(x.CodigoBarra).trim()] = v; });
      }
    } catch (e) { /* loja sem custoloja{n} */ }
    return out;
  }

  async function atualizarProdutos(c, nIven, nLoja, cods) {
    if (!cods.length) return { criados: 0, atualizados: 0 };
    const colVenda = (await q('SHOW COLUMNS FROM itens')).some(x => x.Field === 'P' + nLoja) ? 'P' + nLoja : null;
    const tot = {}, lista = {}, item = {}, est = {};
    for (let i = 0; i < cods.length; i += 1000) {
      const parte = cods.slice(i, i + 1000);
      const [t] = await c.query('SELECT CodigoBarra, SUM(Qtd) q FROM inventariocontagem WHERE nIven = ? AND CodigoBarra IN (?) GROUP BY CodigoBarra', [nIven, parte]);
      t.forEach(r => { tot[String(r.CodigoBarra).trim()] = r3(num(r.q) || 0); });
      const [p] = await c.query('SELECT nReg, CodigoBarra, Qtd, TotalCusto, TotalVenda FROM inventarioprodutos WHERE nIven = ? AND CodigoBarra IN (?) ORDER BY nReg', [nIven, parte]);
      p.forEach(r => { const k = String(r.CodigoBarra).trim(); if (!lista[k]) lista[k] = r; });
      const [it] = await c.query('SELECT CodigoBarra, Descricao, Unid, custo, CodGrupo' + (colVenda ? ', ' + colVenda + ' venda' : '') + ' FROM itens WHERE CodigoBarra IN (?)', [parte]);
      it.forEach(r => { item[String(r.CodigoBarra).trim()] = r; });
      const [e] = await c.query('SELECT CodigoBarra, Qtd, CustoMedio FROM estoquen' + nLoja + ' WHERE CodigoBarra IN (?) ORDER BY nReg', [parte]);
      e.forEach(r => { est[String(r.CodigoBarra).trim()] = r; }); // vale a de maior nReg
    }
    const custoLoja = await custosLoja(nLoja, cods, c);
    let criados = 0, atualizados = 0;
    for (const cod of cods) {
      const it = item[cod]; if (!it) continue;
      const qtd = tot[cod] || 0, e = est[cod];
      const cm = e ? num(e.CustoMedio) : null;
      const custo = custoLoja[cod] != null ? custoLoja[cod] : ((cm != null && cm > 0) ? cm : (num(it.custo) || 0)), venda = num(it.venda) || 0;
      const totCusto = Math.round(qtd * custo * 100) / 100, totVenda = r3(qtd * venda);
      const ja = lista[cod];
      if (ja) {
        if (r3(num(ja.Qtd) || 0) === qtd && Math.round((num(ja.TotalCusto) || 0) * 100) === Math.round(totCusto * 100) && r3(num(ja.TotalVenda) || 0) === totVenda) continue;
        await c.query('UPDATE inventarioprodutos SET Qtd = ?, TotalCusto = ?, TotalVenda = ? WHERE nReg = ? AND nIven = ? AND Status = 0', [qtd, totCusto, totVenda, ja.nReg, nIven]);
        atualizados++;
      } else if (qtd !== 0) {
        await c.query('INSERT INTO inventarioprodutos (nLoja, nIven, CodigoBarra, Descricao, Und, Qtd, QtdAnt, TotalCusto, TotalVenda, emitido_em_nota, Lote, Backup, End, CodGrupo, CustoUnitario, Status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, 0)',
          [nLoja, nIven, cod, String(it.Descricao || '').trim().slice(0, 45), String(it.Unid || '').trim().slice(0, 45), qtd, r3(e ? (num(e.Qtd) || 0) : 0), totCusto, totVenda, '0', Number(it.CodGrupo) || 0, custo]);
        criados++;
      }
    }
    return { criados, atualizados };
  }

  // Deixa o digitador KONTAR do inventário igual à contagem atual do Kontar. Só INSERE: compara, por produto e
  // endereço, a soma do que o KONTAR já gravou com o que deveria estar e grava a diferença (negativa quando
  // excluíram/zeraram/corrigiram no Kontar — o Dlinks soma as linhas, igual a um "-3" lançado na tela).
  // Serve durante a contagem (envio periódico) e no encerramento; rodar de novo sem mudança não grava nada.
  // Confere no fim, dentro da transação, que a soma gravada bate com a contagem; se não bater, desfaz.
  async function sincronizarContagem(inv, contagem, opts) {
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
      if (!codDig) {
        const [ins] = await c.query('INSERT INTO inventariodigitador (nLoja, nIven, Nome, Senha, Backup) VALUES (?, ?, ?, ?, 0)', [0, nIven, NOME_DIGITADOR, '']);
        codDig = ins.insertId;
      }
      const somaGravada = async () => {
        const [rows] = await c.query('SELECT CodigoBarra, End, SUM(Qtd) q FROM inventariocontagem WHERE nIven = ? AND CodDigitador = ? GROUP BY CodigoBarra, End', [nIven, codDig]);
        const m = {}; rows.forEach(r => { const q = r3(num(r.q) || 0); if (q) m[String(r.CodigoBarra).trim() + '\u0001' + String(r.End)] = q; });
        return m;
      };
      const jaTem = await somaGravada();
      const cods = [...new Set((contagem.itens || []).map(i => String(i.codigo || i.ean || '').trim()).filter(Boolean)
        .concat(Object.keys(jaTem).map(k => k.split('\u0001')[0])))];
      const grupos = {};
      for (let i = 0; i < cods.length; i += 1000) {
        const [rows] = await c.query('SELECT CodigoBarra, CodGrupo FROM itens WHERE CodigoBarra IN (?)', [cods.slice(i, i + 1000)]);
        rows.forEach(r => { grupos[String(r.CodigoBarra).trim()] = Number(r.CodGrupo) || 0; });
      }
      const lista = await listaParcial(atual);
      const ctx = { nLoja, nIven, codDigitador: codDig, dataHora: dataHoraBR(opts.agora || new Date()), app: opts.app || 0, porEndereco: !!opts.porEndereco, grupos, lista };
      const { linhas: alvo, ignorados } = linhasContagem(contagem, ctx);
      const deveria = {};
      alvo.forEach(l => { const k = l.CodigoBarra + '\u0001' + l.End; deveria[k] = r3((deveria[k] || 0) + l.Qtd); });
      const modelo = {}; alvo.forEach(l => { modelo[l.CodigoBarra] = l; });
      const linhas = [];
      new Set(Object.keys(deveria).concat(Object.keys(jaTem))).forEach(k => {
        const dif = r3((deveria[k] || 0) - (jaTem[k] || 0));
        if (!dif) return;
        const [cod, end] = k.split('\u0001');
        linhas.push(Object.assign({}, modelo[cod] || { nLoja, nIven, CodigoBarra: cod, CodDigitador: codDig, DataHora: ctx.dataHora,
          App: ctx.app, Lote: 0, Backup: 0, CodGrupo: grupos[cod] || 0, seq: 0, emissornfe: 0 }, { Qtd: dif, End: end }));
      });
      for (let i = 0; i < linhas.length; i += 500) {
        const lote = linhas.slice(i, i + 500);
        await c.query('INSERT INTO inventariocontagem (' + COLS_CONTAGEM.join(', ') + ') VALUES ?', [lote.map(l => COLS_CONTAGEM.map(k => l[k]))]);
      }
      if (linhas.length) {
        const depois = await somaGravada();
        const chaves = new Set(Object.keys(deveria).concat(Object.keys(depois)));
        const errados = [...chaves].filter(k => r3((deveria[k] || 0) - (depois[k] || 0)) !== 0);
        if (errados.length) throw new Error('Conferência no Dlinks não bateu em ' + errados.length + ' produto(s) (ex.: ' + errados[0].replace('\u0001', ' end ') + '); nada gravado');
      }
      const tocados = [...new Set(Object.keys(deveria).concat(Object.keys(jaTem)).map(k => k.split('\u0001')[0]))];
      const prod = (opts.atualizarProdutos === false || Number(atual.Status) !== 0) ? { criados: 0, atualizados: 0 }
        : await atualizarProdutos(c, nIven, nLoja, tocados);
      await c.commit();
      const pos = linhas.filter(l => l.Qtd > 0).length;
      return { linhas: linhas.length, positivas: pos, negativas: linhas.length - pos, ignorados, codDigitador: codDig,
        produtos: new Set(Object.keys(deveria).map(k => k.split('\u0001')[0])).size, produtosCriados: prod.criados, produtosAtualizados: prod.atualizados };
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

  return { listarAbertos, inventario, estaFechado, catalogo, sincronizarContagem, gravarContagem: sincronizarContagem, testar, listarLojas, maiorInventario, listaParcial };
}

module.exports = { criarDlinks, itemCatalogo, linhasContagem, filtrosParcial, dataHoraBR, num, NOME_DIGITADOR, COLS_CONTAGEM };
