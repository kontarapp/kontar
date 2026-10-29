// functions/src/app.js
const express = require('express');
const { exigirToken } = require('./auth');

// deps: { repo } — injetado para testes sem Firestore.
function criarApp(deps) {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.get('/v1/ping', (req, res) => res.json({ ok: true, em: new Date().toISOString() }));
  const v1 = express.Router();
  v1.use(exigirToken(deps.repo));
  v1.get('/eu', (req, res) => res.json({ clienteId: req.cliente.id, nome: req.cliente.nome }));
  app.use('/v1', v1);
  app.use((req, res) => res.status(404).json({ erro: 'nao_encontrado', mensagem: 'Rota inexistente' }));
  app.use((err, req, res, next) => {
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ erro: 'json_invalido', mensagem: 'Corpo não é JSON válido' });
    console.error(err);
    res.status(500).json({ erro: 'interno', mensagem: 'Erro interno' });
  });
  return app;
}
module.exports = { criarApp };
