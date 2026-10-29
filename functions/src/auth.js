// functions/src/auth.js
const { hashToken } = require('../lib/token');
function exigirToken(repo) {
  return async (req, res, next) => {
    const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
    if (!m) return res.status(401).json({ erro: 'nao_autorizado', mensagem: 'Envie Authorization: Bearer <token>' });
    let cliente;
    try { cliente = await repo.clientePorTokenHash(hashToken(m[1])); } catch (err) { return next(err); }
    if (!cliente) return res.status(401).json({ erro: 'nao_autorizado', mensagem: 'Token inválido' });
    req.cliente = cliente;
    const t0 = Date.now(), rota = req.method + ' ' + req.baseUrl + req.path;
    const orig = res.json.bind(res);
    res.json = function (body) {
      const status = res.statusCode;
      repo.registrarLog(cliente.id, { rota, status, ms: Date.now() - t0, resumo: res.locals.resumo || '' })
        .catch(function () {}).then(function () { orig(body); });
      return res;
    };
    next();
  };
}
module.exports = { exigirToken };
