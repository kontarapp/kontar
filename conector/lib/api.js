'use strict';
// Cliente da API Kontar (docs/api.md). Só usa fetch (Node 18+).
const LIMITE_UNICA = 5000, TAM_PARTE = 2000;

function criarApi(cfg, opts) {
  const base = String(cfg.url || '').replace(/\/+$/, '');
  const token = cfg.token;
  const fetchFn = (opts && opts.fetch) || globalThis.fetch;
  if (!base || !token) throw new Error('kontar.url e kontar.token são obrigatórios no conector.json');

  const espera = (opts && opts.espera) || (ms => new Promise(r => setTimeout(r, ms)));
  // Falha de rede ou 5xx: tenta de novo até 3 vezes (1 s, 3 s, 9 s). Erros 4xx voltam na hora.
  async function chamar(metodo, rota, corpo) {
    let r, ultimo;
    for (let t = 0; t < 4; t++) {
      if (t) await espera(1000 * Math.pow(3, t - 1));
      try {
        r = await fetchFn(base + rota, {
          method: metodo,
          headers: Object.assign({ Authorization: 'Bearer ' + token }, corpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
          body: corpo !== undefined ? JSON.stringify(corpo) : undefined
        });
        if (r.status < 500) break;
        ultimo = new Error('HTTP ' + r.status);
      } catch (e) { r = null; ultimo = new Error('rede: ' + ((e.cause && (e.cause.code || e.cause.message)) || e.message)); }
    }
    if (!r) throw new Error('API ' + metodo + ' ' + rota + ' → ' + ultimo.message);
    let j = null; try { j = await r.json(); } catch (e) { j = null; }
    if (!r.ok) {
      const err = new Error('API ' + metodo + ' ' + rota + ' → ' + r.status + ' ' + ((j && (j.erro + ': ' + j.mensagem)) || ''));
      err.status = r.status; err.codigo = j && j.erro; throw err;
    }
    return j;
  }

  return {
    eu: () => chamar('GET', '/eu'),
    listarBalancos: (f) => {
      const q = []; if (f && f.loja) q.push('loja=' + encodeURIComponent(f.loja)); if (f && f.status) q.push('status=' + encodeURIComponent(f.status));
      return chamar('GET', '/balancos' + (q.length ? '?' + q.join('&') : '')).then(j => j.balancos || []);
    },
    obterBalanco: (id) => chamar('GET', '/balancos/' + encodeURIComponent(id)),
    criarBalanco: (b) => chamar('POST', '/balancos', b),
    enviarCatalogo: async (id, itens) => {
      const rota = '/balancos/' + encodeURIComponent(id) + '/catalogo';
      if (itens.length <= LIMITE_UNICA) return chamar('PUT', rota, { itens });
      const total = Math.ceil(itens.length / TAM_PARTE); let res = null;
      for (let p = 1; p <= total; p++) res = await chamar('PUT', rota, { parte: p, total, itens: itens.slice((p - 1) * TAM_PARTE, p * TAM_PARTE) });
      return res;
    },
    contagem: (id, porEndereco) => chamar('GET', '/balancos/' + encodeURIComponent(id) + '/contagem' + (porEndereco ? '?porEndereco=1' : '')),
    confirmar: (id) => chamar('POST', '/balancos/' + encodeURIComponent(id) + '/contagem/confirmar'),
    estadoErp: (id, campos) => chamar('PATCH', '/balancos/' + encodeURIComponent(id) + '/erp', campos)
  };
}
module.exports = { criarApi, LIMITE_UNICA, TAM_PARTE };
