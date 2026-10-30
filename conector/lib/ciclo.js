'use strict';
// Um ciclo do conector (roda a cada intervaloSeg):
//  1. Inventário aberto no ERP sem balanço no Kontar → cria o balanço (origem ERP, refErp = nº do inventário).
//  2. Balanço do ERP ainda sem catálogo → monta o catálogo da loja no ERP e envia.
//  3. Balanço encerrado no Kontar sem contagemEnviadaEm → busca a contagem, grava no ERP, marca enviada e confirma.
// Qualquer erro num balanço vai pro bloco "erp.erro" dele (aparece no Kontar) e é tentado de novo no próximo ciclo.

function expandirEnderecos(v) {
  if (Array.isArray(v)) return v.map(String).map(s => s.trim()).filter(Boolean);
  const s = String(v || '').trim(); if (!s) return [];
  const out = [];
  s.split(',').map(x => x.trim()).filter(Boolean).forEach(p => {
    const m = p.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) { const a = +m[1], b = +m[2]; if (b - a > 2000) throw new Error('faixa de endereços grande demais: ' + p); for (let i = a; i <= b; i++) out.push(String(i)); }
    else out.push(p);
  });
  return [...new Set(out)];
}

function tipoKontar(tipoErp) { return String(tipoErp || '').toUpperCase() === 'PARCIAL' ? 'parcial' : 'geral'; }
function nomeBalanco(inv) { return (String(inv.Nome || '').trim() || 'Inventário') + ' · ERP ' + inv.nIven; }
function resumoIgnorados(ign) {
  if (!ign || !ign.length) return null;
  const lista = ign.slice(0, 15).map(i => i.codigo || '(sem código)').join(', ');
  return 'Gravado no ERP, mas ' + ign.length + ' código(s) não cadastrado(s) ficaram de fora: ' + lista + (ign.length > 15 ? '…' : '');
}

async function rodarCiclo(deps) {
  const { api, erp, cfg, log } = deps;
  const lojas = (cfg.lojas || []).map(Number);
  const enderecos = expandirEnderecos(cfg.enderecosPadrao || '1-10');
  const res = { criados: 0, catalogos: 0, contagens: 0, erros: 0 };

  const marcarErro = async (b, e) => {
    res.erros++;
    log.erro('balanço ' + (b && b.id) + ': ' + e.message);
    if (b && b.id) { try { await api.estadoErp(b.id, { erro: String(e.message).slice(0, 500) }); } catch (e2) { log.erro('não consegui gravar o erro no balanço: ' + e2.message); } }
  };

  const doKontar = await api.listarBalancos({});
  const porRef = {};
  doKontar.forEach(b => { if (b.origem === 'erp' && b.erp && b.erp.refErp) porRef[String(b.erp.refErp)] = b; });

  // 1 e 2 — inventários abertos no ERP
  for (const inv of await erp.listarAbertos(lojas)) {
    let b = porRef[String(inv.nIven)];
    try {
      if (!b) {
        b = await api.criarBalanco({ refErp: String(inv.nIven), nome: nomeBalanco(inv), loja: String(inv.nLoja), tipo: tipoKontar(inv.Tipo), sequencial: false, enderecos });
        porRef[String(inv.nIven)] = b; res.criados++;
        log.info('balanço criado no Kontar: ' + b.id + ' ← inventário ' + inv.nIven + ' loja ' + inv.nLoja);
      }
      if (b.status !== 'encerrado' && !(b.erp && b.erp.catalogoEm)) {
        const itens = await erp.catalogo(inv);
        if (!itens.length) throw new Error('Catálogo vazio no ERP para o inventário ' + inv.nIven + ' (confira loja e filtros do parcial)');
        const r = await api.enviarCatalogo(b.id, itens);
        res.catalogos++;
        log.info('catálogo enviado: ' + b.id + ' (' + itens.length + ' itens' + (r && r.inalterado ? ', inalterado' : '') + ')');
        if (b.erp && b.erp.erro) await api.estadoErp(b.id, { erro: null });
      }
    } catch (e) { await marcarErro(b, e); }
  }

  // 3 — balanços encerrados no Kontar com contagem a devolver
  for (const b of doKontar) {
    if (b.origem !== 'erp' || !b.erp || !b.erp.refErp || b.status !== 'encerrado' || b.erp.contagemEnviadaEm) continue;
    if (!/^\d+$/.test(String(b.erp.refErp))) continue;
    if (lojas.length && lojas.indexOf(Number(b.loja)) < 0) continue;
    try {
      const inv = await erp.inventario(b.erp.refErp);
      if (!inv) throw new Error('Inventário ' + b.erp.refErp + ' não encontrado no ERP');
      const contagem = await api.contagem(b.id, !!cfg.porEndereco);
      const r = await erp.gravarContagem(inv, contagem, { app: cfg.app || 0, porEndereco: !!cfg.porEndereco });
      await api.estadoErp(b.id, { contagemEnviadaEm: true, erro: resumoIgnorados(r.ignorados) });
      await api.confirmar(b.id);
      res.contagens++;
      log.info('contagem ' + (r.jaGravado ? 'já estava' : 'gravada') + ' no ERP: inventário ' + inv.nIven + ', ' + r.linhas + ' linha(s)' +
        (r.ignorados.length ? ', ' + r.ignorados.length + ' ignorado(s)' : ''));
    } catch (e) { await marcarErro(b, e); }
  }
  return res;
}

module.exports = { rodarCiclo, expandirEnderecos, tipoKontar, nomeBalanco, resumoIgnorados };
