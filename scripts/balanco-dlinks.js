#!/usr/bin/env node
// Kontar — cria um inventário (balanço) a partir do TXT de produtos do Dlinks
// e, opcionalmente, apaga os inventários ABERTOS de teste do mesmo cliente.
//
// Só usa REST do Firebase (Identity Toolkit + Firestore). Sem dependências.
// Faz login com o MESMO e-mail/senha do app (usuário admin do Kontar).
//
// Uso:
//   node scripts/balanco-dlinks.js --arquivo "C:\Users\tiago\Downloads\cgprodutos_1.txt" \
//        --nome "Balanço Loja" --enderecos 1-30 --apagar-ativos
//   Credenciais: --email x --senha y  ou  KONTAR_EMAIL / KONTAR_SENHA no ambiente.
//   --dry-run  = só lê o arquivo e mostra o plano, não toca no Firestore.
//
// Formato Dlinks (cgprodutos): codigo|descricao|0|0,01|preco_venda|0|flag|0 (sem cabeçalho).
// Também aceita arquivo com cabeçalho (codigo;ean;descricao;custo;venda).

'use strict';
const fs = require('fs');
const path = require('path');
const InvCore = require(path.join(__dirname, '..', 'lib', 'inv-bip-core.js'));

// ── config do projeto (mesma do app) ───────────────────────────────────────
const cfgTxt = fs.readFileSync(path.join(__dirname, '..', 'firebase-config.js'), 'utf8');
const API_KEY = (cfgTxt.match(/apiKey:\s*"([^"]+)"/) || [])[1];
const PROJECT = (cfgTxt.match(/projectId:\s*"([^"]+)"/) || [])[1];
if (!API_KEY || !PROJECT) { console.error('firebase-config.js sem apiKey/projectId'); process.exit(1); }
const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

// ── args ───────────────────────────────────────────────────────────────────
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) { const k = a.slice(2); const v = process.argv[i + 1]; if (v && !v.startsWith('--')) { args[k] = v; i++; } else args[k] = true; }
}
const ARQ = args.arquivo || path.join(process.env.USERPROFILE || process.env.HOME || '.', 'Downloads', 'cgprodutos_1.txt');
const NOME = args.nome || ('Balanço ' + new Date().toLocaleDateString('pt-BR'));
const SETORES = String(args.setores || 'ESTOQUE,LOJA').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
const META = parseInt(args.meta || '98', 10) || 0;
const DRY = !!args['dry-run'];
const APAGAR = !!args['apagar-ativos'];
const EMAIL = args.email || process.env.KONTAR_EMAIL;
const SENHA = args.senha || process.env.KONTAR_SENHA;

function expandirEnderecos(spec) {
  const out = [];
  String(spec || '1-30').split(',').map(s => s.trim()).filter(Boolean).forEach(p => {
    const m = p.match(/^(\d+)-(\d+)$/);
    if (m) { for (let i = +m[1]; i <= +m[2]; i++) out.push(String(i)); } else out.push(p);
  });
  return out;
}
const ENDERECOS = expandirEnderecos(args.enderecos);

// ── leitura do catálogo ────────────────────────────────────────────────────
function lerCatalogo(arquivo) {
  const raw = fs.readFileSync(arquivo);
  let texto = raw.toString('latin1');
  if (texto.indexOf('\uFFFD') >= 0 || /[\u00c3][\u0080-\u00bf]/.test(texto)) texto = raw.toString('utf8');
  const parsed = InvCore.parseCatalogoTexto(texto);
  if (!parsed.linhas.length) throw new Error('Arquivo vazio: ' + arquivo);
  const map = InvCore.mapearColunas(parsed.linhas[0], parsed.linhas.slice(1, 6));
  let itens;
  if (map.temHeader) {
    const L = parsed.linhas.slice(1);
    const g = (l, i) => (i >= 0 ? (l[i] || '') : '');
    const num = (s) => { const n = parseFloat(String(s).replace(',', '.')); return isNaN(n) ? null : n; };
    itens = L.map(l => ({ c: g(l, map.codigo), e: g(l, map.ean).replace(/\s/g, ''), d: g(l, map.desc), u: g(l, map.un).toUpperCase(),
      q: map.estoque >= 0 ? (num(g(l, map.estoque)) || 0) : null, k: map.custo >= 0 ? num(g(l, map.custo)) : null, v: map.venda >= 0 ? num(g(l, map.venda)) : null }));
    return { itens: itens.filter(it => it.c || it.e), formato: 'cabeçalho ' + parsed.delim };
  }
  // Dlinks: codigo|descricao|0|0,01|venda|0|flag|0
  if (parsed.delim !== '|' || parsed.linhas[0].length < 5) throw new Error('Formato não reconhecido (esperado Dlinks com | e 8 colunas, ou arquivo com cabeçalho).');
  itens = parsed.linhas.map(l => {
    const cod = (l[0] || '').trim();
    const ehEan = /^\d{8}$|^\d{12,14}$/.test(cod);
    const venda = parseFloat(String(l[4] || '').replace(',', '.'));
    return { c: cod, e: ehEan ? cod : '', d: (l[1] || '').replace(/\uFFFD/g, '?'), u: l[6] === '1' ? 'KG' : 'UN', q: null, k: null, v: isNaN(venda) ? null : venda };
  }).filter(it => it.c);
  return { itens, formato: 'Dlinks |' };
}

// ── Firestore REST helpers ─────────────────────────────────────────────────
let TOKEN = '';
async function api(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN, ...(opts.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || (r.status + ' ' + r.statusText));
  return j;
}
function val(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(val) } };
  if (v && v.__serverTime) return null; // tratado em transform
  return { mapValue: { fields: fields(v) } };
}
function fields(obj) { const f = {}; Object.keys(obj).forEach(k => { const x = val(obj[k]); if (x) f[k] = x; }); return f; }
function dec(f) { // decodifica doc REST → objeto simples (só o que precisamos)
  const out = {};
  Object.keys(f || {}).forEach(k => { const v = f[k]; out[k] = v.stringValue ?? (v.integerValue != null ? +v.integerValue : v.doubleValue ?? v.booleanValue ?? (v.arrayValue ? (v.arrayValue.values || []).map(x => x.stringValue ?? x) : (v.mapValue ? dec(v.mapValue.fields) : null))); });
  return out;
}
async function login(email, senha) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: senha, returnSecureToken: true }) });
  const j = await r.json();
  if (!r.ok) throw new Error('Login falhou: ' + ((j.error && j.error.message) || r.status));
  TOKEN = j.idToken; return j;
}
async function runQuery(collection, where) { // where: [[campo, op, valor], ...]
  const body = { structuredQuery: { from: [{ collectionId: collection }], where: { compositeFilter: { op: 'AND', filters: where.map(([f, op, v]) => ({ fieldFilter: { field: { fieldPath: f }, op, value: val(v) } })) } }, limit: 5000 } };
  const j = await api(FS + ':runQuery', { method: 'POST', body: JSON.stringify(body) });
  return (Array.isArray(j) ? j : []).filter(x => x.document).map(x => ({ name: x.document.name, id: x.document.name.split('/').pop(), data: dec(x.document.fields) }));
}
async function commit(writes) {
  for (let i = 0; i < writes.length; i += 400) await api(FS + ':commit', { method: 'POST', body: JSON.stringify({ writes: writes.slice(i, i + 400) }) });
}
const docName = (col, id) => `projects/${PROJECT}/databases/(default)/documents/${col}/${id}`;

// ── main ───────────────────────────────────────────────────────────────────
(async () => {
  const { itens, formato } = lerCatalogo(ARQ);
  const cat = InvCore.criarCatalogo(itens);
  const comEan = Object.keys(cat.porEan).length;
  const semVenda = itens.filter(it => !it.v).length;
  const blocos = InvCore.montarBlocos(itens, 1000);
  console.log(`Arquivo: ${ARQ} (${formato})`);
  console.log(`Itens: ${itens.length} | com EAN: ${comEan} | só código interno: ${itens.length - comEan} | sem preço de venda: ${semVenda} | blocos: ${blocos.length}`);
  console.log(`Inventário: "${NOME}" | endereços: ${ENDERECOS.length} (${ENDERECOS[0]}…${ENDERECOS[ENDERECOS.length - 1]}) | setores: ${SETORES.join(',')} | meta ${META}% | fila ligada, sequencial desligado, tipo geral`);
  if (DRY) { console.log('[dry-run] nada gravado.'); return; }
  if (!EMAIL || !SENHA) { console.error('Faltam credenciais: --email/--senha ou KONTAR_EMAIL/KONTAR_SENHA.'); process.exit(2); }

  const auth = await login(EMAIL, SENHA);
  const us = await runQuery('usuarios', [['email', 'EQUAL', String(auth.email || EMAIL).toLowerCase()]]);
  if (!us.length) throw new Error('Usuário logado não tem doc em usuarios/.');
  const user = us[0]; const clienteId = user.data.clienteId || ''; const loja = user.data.loja || '';
  console.log(`Logado como ${auth.email} (usuario ${user.id}, cliente "${clienteId}")`);

  if (APAGAR) {
    const abertos = await runQuery('inv_inventarios', [['clienteId', 'EQUAL', clienteId], ['status', 'EQUAL', 'aberto']]);
    console.log(`Inventários abertos a apagar: ${abertos.length}` + (abertos.length ? ' → ' + abertos.map(i => `"${i.data.nome}" (${i.id})`).join(', ') : ''));
    for (const inv of abertos) {
      for (const col of ['inv_bipagens', 'inv_catalogo_blocos', 'inv_catalogo', 'inv_auditlog']) {
        const docs = await runQuery(col, [['invId', 'EQUAL', inv.id]]);
        if (docs.length) { await commit(docs.map(d => ({ delete: d.name }))); console.log(`  ${col}: ${docs.length} docs apagados`); }
      }
      await commit([{ delete: inv.name }]);
      console.log(`  inventário "${inv.data.nome}" apagado`);
    }
  }

  // cria o inventário (mesmos campos de criarInventario() no app.js)
  const invId = 'bal' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const invDoc = { nome: NOME, loja, status: 'aberto', tipo: 'geral', clienteId, criadoPor: user.id, enderecos: ENDERECOS, atribuicoes: {}, modoFila: true, fila: {}, sequencial: false, totalBipagens: 0, setores: SETORES, modoOrganizacao: 'setores_end', meta: META };
  await commit([{ update: { name: docName('inv_inventarios', invId), fields: fields(invDoc) }, updateTransforms: [{ fieldPath: 'criadoEm', setToServerValue: 'REQUEST_TIME' }] }]);
  console.log(`Inventário criado: ${invId}`);

  for (let n = 0; n < blocos.length; n++) {
    await commit([{ update: { name: docName('inv_catalogo_blocos', `${invId}_${n}`), fields: fields({ invId, clienteId, n, itens: blocos[n] }) } }]);
    process.stdout.write(`  catálogo bloco ${n + 1}/${blocos.length}\r`);
  }
  console.log(`\nCatálogo gravado: ${itens.length} itens em ${blocos.length} blocos. Pronto.`);
})().catch(e => { console.error('ERRO:', e.message || e); process.exit(1); });
