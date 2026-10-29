const express = require('express');
const { formatarBalanco } = require('../../lib/formatar');
const { validarItens, hashItens, paraBlocos } = require('../../lib/catalogo');
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
  r.put('/:id/catalogo', async (req, res, next) => { try {
    const b = await repo.obterBalanco(req.cliente.id, req.params.id);
    if (!b) return res.status(404).json({ erro: 'nao_encontrado', mensagem: 'Balanço não encontrado' });
    if (b.status === 'encerrado') return res.status(409).json({ erro: 'balanco_encerrado', mensagem: 'Balanço encerrado não aceita catálogo' });
    const v = validarItens(req.body && req.body.itens);
    if (!v.ok) return res.status(400).json({ erro: 'catalogo_invalido', mensagem: v.mensagem });
    let itens = v.itens;
    const parte = parseInt(req.body.parte), total = parseInt(req.body.total);
    if (parte || total) {
      if (!(parte >= 1 && total >= 1 && parte <= total)) return res.status(400).json({ erro: 'parte_invalida', mensagem: 'parte deve estar entre 1 e total' });
      await repo.guardarParteCatalogo(b.id, parte, total, itens);
      if (parte < total) { res.locals.resumo = 'parte ' + parte + '/' + total; return res.status(202).json({ parte, total, aguardando: true }); }
      itens = [].concat.apply([], await repo.lerPartesCatalogo(b.id));
      await repo.limparPartesCatalogo(b.id);
    }
    const hash = hashItens(itens);
    if (b.erp && b.erp.catalogoHash === hash) { res.locals.resumo = 'inalterado'; return res.json({ itens: itens.length, blocos: Math.ceil(itens.length / 1000), hash, inalterado: true }); }
    const blocos = paraBlocos(itens);
    await repo.substituirCatalogo(b.id, req.cliente.id, blocos, { catalogoEm: new Date(), catalogoItens: itens.length, catalogoHash: hash, erro: null, erroEm: null });
    res.locals.resumo = itens.length + ' itens';
    res.json({ itens: itens.length, blocos: blocos.length, hash, inalterado: false });
  } catch (e) { next(e); } });
  return r;
}
module.exports = { rotasBalancos };
