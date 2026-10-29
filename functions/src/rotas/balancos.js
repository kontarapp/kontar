const express = require('express');
const { formatarBalanco, iso } = require('../../lib/formatar');
const { montarContagem } = require('../../lib/contagem');
const { validarItens, hashItens, paraBlocos, TAM_BLOCO } = require('../../lib/catalogo');
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
    const bp = req.body.parte, bt = req.body.total;
    let parte = 0, total = 0;
    const emPartes = bp !== undefined || bt !== undefined;
    if (emPartes) {
      const inteiro = x => x !== undefined && /^\d+$/.test(String(x)) && Number.isInteger(Number(x));
      parte = Number(bp); total = Number(bt);
      if (!(inteiro(bp) && inteiro(bt) && parte >= 1 && total >= 1 && parte <= total && total <= 100))
        return res.status(400).json({ erro: 'parte_invalida', mensagem: 'parte e total devem ser inteiros entre 1 e 100, com parte <= total' });
      await repo.guardarParteCatalogo(b.id, parte, total, itens);
      if (parte < total) { res.locals.resumo = 'parte ' + parte + '/' + total; return res.status(202).json({ parte, total, aguardando: true }); }
      const partes = await repo.lerPartesCatalogo(b.id);
      const nums = partes.map(p => p.parte).sort((x, y) => x - y);
      const completas = partes.length === total && partes.every(p => p.total === total) && nums.every((n, i) => n === i + 1);
      if (!completas) return res.status(409).json({ erro: 'partes_incompletas', mensagem: 'Faltam partes ou total divergente; reenvie todas as partes' });
      itens = [].concat.apply([], partes.slice().sort((x, y) => x.parte - y.parte).map(p => p.itens));
    }
    const hash = hashItens(itens);
    if (b.erp && b.erp.catalogoHash === hash) {
      if (emPartes) await repo.limparPartesCatalogo(b.id);
      res.locals.resumo = 'inalterado'; return res.json({ itens: itens.length, blocos: Math.ceil(itens.length / TAM_BLOCO), hash, inalterado: true });
    }
    const blocos = paraBlocos(itens);
    await repo.substituirCatalogo(b.id, req.cliente.id, blocos, { catalogoEm: new Date(), catalogoItens: itens.length, catalogoHash: hash, erro: null, erroEm: null });
    if (emPartes) await repo.limparPartesCatalogo(b.id);
    res.locals.resumo = itens.length + ' itens';
    res.json({ itens: itens.length, blocos: blocos.length, hash, inalterado: false });
  } catch (e) { next(e); } });
  r.get('/:id/contagem', async (req, res, next) => { try {
    const b = await repo.obterBalanco(req.cliente.id, req.params.id);
    if (!b) return res.status(404).json({ erro: 'nao_encontrado', mensagem: 'Balanço não encontrado' });
    if (b.status !== 'encerrado') return res.status(409).json({ erro: 'balanco_aberto', mensagem: 'Contagem só disponível para balanço encerrado' });
    const [cat, bips] = await Promise.all([repo.lerCatalogo(b.id), repo.lerBipagens(b.id)]);
    const out = montarContagem(cat, bips, b.resolucoes || {}, { porEndereco: req.query.porEndereco === '1' });
    out.balancoId = b.id; out.loja = b.loja || ''; out.encerradoEm = iso(b.encerradoEm);
    res.locals.resumo = out.totais.itens + ' itens';
    res.json(out);
  } catch (e) { next(e); } });
  return r;
}
module.exports = { rotasBalancos };
