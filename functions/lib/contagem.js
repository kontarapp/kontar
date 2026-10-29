const InvCore = require('./inv-bip-core.js');
function montarContagem(cat, bips, resolucoes, opts) {
  const r = InvCore.calcularResultado(cat, bips || [], resolucoes || {});
  const itens = r.linhas.map(l => ({ codigo: l.codigo || '', ean: l.ean || '', descricao: l.nc ? '' : l.desc, un: l.un || '',
    quantidade: l.contado, estoque: l.sistema, diferenca: l.dif, naoCadastrado: !!l.nc }));
  const out = { itens, totais: { itens: itens.length, unidades: itens.reduce((s, i) => s + i.quantidade, 0), naoCadastrados: itens.filter(i => i.naoCadastrado).length } };
  if (opts && opts.porEndereco) {
    const byKey = {}; r.linhas.forEach(l => { byKey[l.key] = l; });
    out.porEndereco = Object.keys(r.porEnd).sort((a, b) => String(a).localeCompare(String(b), 'pt-BR', { numeric: true })).map(e => ({ endereco: e,
      itens: Object.keys(r.porEnd[e]).map(k => ({ codigo: (byKey[k] && byKey[k].codigo) || '', ean: (byKey[k] && byKey[k].ean) || '', quantidade: r.porEnd[e][k] })) }));
  }
  return out;
}
module.exports = { montarContagem };
