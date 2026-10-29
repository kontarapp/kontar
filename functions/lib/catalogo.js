const crypto = require('crypto');
const InvCore = require('./inv-bip-core.js');
const LIMITE = 5000;
function num(v) { if (v == null || v === '') return null; const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? null : n; }
function validarItens(itens) {
  if (!Array.isArray(itens) || !itens.length) return { ok: false, mensagem: 'itens deve ser uma lista com ao menos 1 item' };
  if (itens.length > LIMITE) return { ok: false, mensagem: 'Máximo de ' + LIMITE + ' itens por chamada; use parte/total' };
  const out = [];
  for (let i = 0; i < itens.length; i++) {
    const it = itens[i] || {};
    const c = String(it.codigo == null ? '' : it.codigo).trim(), e = String(it.ean == null ? '' : it.ean).replace(/\s/g, '');
    if (!c && !e) return { ok: false, mensagem: 'Item ' + (i + 1) + ' sem codigo e sem ean' };
    out.push({ c, e, d: String(it.descricao == null ? '' : it.descricao).slice(0, 120), u: String(it.un == null ? '' : it.un).trim().toUpperCase(),
      q: num(it.estoque), k: num(it.custo), v: num(it.venda) });
  }
  return { ok: true, itens: out };
}
function hashItens(itens) {
  const h = crypto.createHash('sha256');
  itens.forEach(it => h.update([it.c, it.e, it.d, it.u, it.q, it.k, it.v].map(x => x == null ? '' : String(x)).join('\u001f') + '\n'));
  return h.digest('hex');
}
function paraBlocos(itens) { return InvCore.montarBlocos(itens, 1000); }
module.exports = { validarItens, hashItens, paraBlocos, LIMITE };
