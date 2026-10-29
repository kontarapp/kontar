const express = require('express');
const { formatarBalanco } = require('../../lib/formatar');
function rotasBalancos(repo) {
  const r = express.Router();
  r.get('/', async (req, res, next) => { try {
    const lista = await repo.listarBalancos(req.cliente.id, { loja: req.query.loja || '', status: req.query.status || '' });
    res.json({ balancos: lista.map(b => formatarBalanco(b)) });
  } catch (e) { next(e); } });
  r.get('/:id', async (req, res, next) => { try {
    const b = await repo.obterBalanco(req.cliente.id, req.params.id);
    if (!b) return res.status(404).json({ erro: 'nao_encontrado', mensagem: 'Balanço não encontrado' });
    const bipagens = await repo.contarBipagens(b.id);
    res.json(formatarBalanco(b, { bipagens }));
  } catch (e) { next(e); } });
  return r;
}
module.exports = { rotasBalancos };
