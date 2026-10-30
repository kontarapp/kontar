#!/usr/bin/env node
'use strict';
// Conector Kontar ↔ ERP.
//   node index.js                 roda em laço (a cada intervaloSeg)
//   node index.js --uma-vez       roda um ciclo e sai
//   node index.js --testar        só testa a API (token) e o banco do ERP, sem gravar nada
//   node index.js --maior-niven   mostra o maior nº de inventário do ERP (usado pelo instalador)
//   --config <arquivo>            outro conector.json (padrão: ao lado deste arquivo)
const fs = require('fs');
// Rede de loja costuma não ter IPv6: sem isso o Node tenta IPv6 e IPv4 juntos com 250 ms de prazo e
// o IPv4 dá ETIMEDOUT ("fetch failed") de vez em quando. IPv4 primeiro e prazo de 2 s resolvem.
require('dns').setDefaultResultOrder('ipv4first');
try { require('net').setDefaultAutoSelectFamilyAttemptTimeout(2000); } catch (e) {}
const path = require('path');
const { criarApi } = require('./lib/api');
const { rodarCiclo } = require('./lib/ciclo');
const { criarLog } = require('./lib/log');

const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf(n); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : null; };
const arqCfg = path.resolve(opt('--config') || path.join(__dirname, 'conector.json'));
if (!fs.existsSync(arqCfg)) { console.error('Configuração não encontrada: ' + arqCfg + ' (copie conector.exemplo.json para conector.json e preencha)'); process.exit(1); }
const cfg = JSON.parse(fs.readFileSync(arqCfg, 'utf8').replace(/^﻿/, ''));
const log = criarLog(path.join(path.dirname(arqCfg), 'logs'));

function criarErp() {
  if ((cfg.erp || 'dlinks') !== 'dlinks') throw new Error('ERP não suportado: ' + cfg.erp);
  const mysql = require('mysql2/promise');
  const m = cfg.mysql || {};
  const pool = mysql.createPool({ host: m.host, port: m.port || 3306, user: m.user, password: m.password, database: m.database || 'central',
    connectionLimit: 3, dateStrings: true, charset: m.charset || 'latin1_swedish_ci', connectTimeout: 20000 });
  const { criarDlinks } = require('./erps/dlinks');
  return { erp: criarDlinks(pool, cfg.dlinks || {}), pool };
}

async function main() {
  const api = criarApi(cfg.kontar || {});
  const { erp, pool } = criarErp();
  if (opt('--maior-niven')) { // usado pelo instalador: só inventários abertos DEPOIS da instalação vão pro Kontar
    const [r] = await pool.query('SELECT COALESCE(MAX(nIven), 0) n FROM inventario'); console.log(String(r[0].n)); await pool.end(); return;
  }
  if (opt('--testar')) {
    const eu = await api.eu(); log.info('API ok: cliente ' + eu.clienteId + ' (' + eu.nome + ')');
    const t = await erp.testar(); log.info('ERP ok: ' + t.inventarios + ' inventário(s) na tabela');
    const ab = await erp.listarAbertos((cfg.lojas || []).map(Number));
    log.info('inventários abertos que o conector vai levar pro Kontar: ' + (ab.map(i => i.nIven + ' (loja ' + i.nLoja + ', ' + i.Tipo + ')').join(', ') || 'nenhum'));
    await pool.end(); return;
  }
  const umaVez = !!opt('--uma-vez');
  const intervalo = Math.max(15, Number(cfg.intervaloSeg || 60)) * 1000;
  log.info('conector iniciado (' + (umaVez ? 'um ciclo' : 'a cada ' + intervalo / 1000 + ' s') + ')');
  let parar = false;
  process.on('SIGINT', () => { parar = true; }); process.on('SIGTERM', () => { parar = true; });
  do {
    try {
      const r = await rodarCiclo({ api, erp, cfg, log });
      if (r.criados || r.catalogos || r.contagens || r.erros || umaVez) log.info('ciclo: ' + JSON.stringify(r));
    } catch (e) { log.erro('ciclo falhou: ' + e.message); }
    if (umaVez || parar) break;
    await new Promise(r => setTimeout(r, intervalo));
  } while (!parar);
  await pool.end();
}

main().catch(e => { log.erro(e.stack || e.message); process.exit(1); });
