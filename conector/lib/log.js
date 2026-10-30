'use strict';
// Log em arquivo por dia (logs/conector-AAAA-MM-DD.log) + console. Mantém os últimos 30 arquivos.
const fs = require('fs');
const path = require('path');

function criarLog(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
  const dia = () => new Date().toISOString().slice(0, 10);
  let ultimoLimpo = '';
  function limpar() {
    const d = dia(); if (d === ultimoLimpo) return; ultimoLimpo = d;
    try {
      const arqs = fs.readdirSync(dir).filter(f => /^conector-\d{4}-\d{2}-\d{2}\.log$/.test(f)).sort();
      arqs.slice(0, Math.max(0, arqs.length - 30)).forEach(f => { try { fs.unlinkSync(path.join(dir, f)); } catch (e) {} });
    } catch (e) {}
  }
  function escrever(nivel, msg) {
    const linha = new Date().toISOString() + ' ' + nivel + ' ' + msg;
    (nivel === 'ERRO' ? console.error : console.log)(linha);
    limpar();
    try { fs.appendFileSync(path.join(dir, 'conector-' + dia() + '.log'), linha + '\n'); } catch (e) {}
  }
  return { info: m => escrever('INFO', m), erro: m => escrever('ERRO', m) };
}
module.exports = { criarLog };
