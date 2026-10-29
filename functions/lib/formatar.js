function iso(v) { if (!v) return null; if (v.toDate) return v.toDate().toISOString(); if (v instanceof Date) return v.toISOString(); return null; }
function formatarBalanco(d, extras) {
  const erp = d.erp || {};
  return {
    id: d.id, nome: d.nome || '', loja: d.loja || '', status: d.status || 'aberto', origem: d.origem || 'kontar',
    tipo: d.tipo || 'geral', sequencial: !!d.sequencial, enderecos: d.enderecos || [], setores: d.setores || [],
    criadoEm: iso(d.criadoEm), encerradoEm: iso(d.encerradoEm),
    erp: { refErp: erp.refErp || null, catalogoEm: iso(erp.catalogoEm), catalogoItens: erp.catalogoItens == null ? null : erp.catalogoItens,
      contagemEnviadaEm: iso(erp.contagemEnviadaEm), contagemRecebidaEm: iso(erp.contagemRecebidaEm), erro: erp.erro || null },
    totais: { bipagens: (extras && extras.bipagens) || 0, enderecos: (d.enderecos || []).length }
  };
}
module.exports = { formatarBalanco, iso };
