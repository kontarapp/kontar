function lista(v) { const seen = {}; return (Array.isArray(v) ? v : []).map(x => String(x == null ? '' : x).trim()).filter(x => x && !seen[x] && (seen[x] = 1)); }
function validarNovoBalanco(c) {
  c = c || {};
  const refErp = String(c.refErp == null ? '' : c.refErp).trim(), nome = String(c.nome == null ? '' : c.nome).trim(), loja = String(c.loja == null ? '' : c.loja).trim();
  if (!refErp || !nome || !loja) return { ok: false, mensagem: 'refErp, nome e loja são obrigatórios' };
  const tipo = c.tipo == null ? 'geral' : String(c.tipo);
  if (tipo !== 'geral' && tipo !== 'parcial') return { ok: false, mensagem: 'tipo deve ser geral ou parcial' };
  return { ok: true, dados: { refErp, nome, loja, tipo, sequencial: !!c.sequencial, enderecos: lista(c.enderecos), setores: lista(c.setores) } };
}
function validarPatch(c) {
  c = c || {}; const d = {};
  if (c.enderecos !== undefined) d.enderecos = lista(c.enderecos);
  if (c.setores !== undefined) d.setores = lista(c.setores);
  if (c.sequencial !== undefined) d.sequencial = !!c.sequencial;
  if (c.nome !== undefined) { const n = String(c.nome).trim(); if (n) d.nome = n; }
  if (!Object.keys(d).length) return { ok: false, mensagem: 'Nada para atualizar (enderecos, setores, sequencial, nome)' };
  return { ok: true, dados: d };
}
module.exports = { validarNovoBalanco, validarPatch };
