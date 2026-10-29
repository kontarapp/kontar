# Pausar inventário + endereços em andamento — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin pausa/retoma o inventário (coletor trava na hora e volta no mesmo endereço) e adiciona/remove endereços com o inventário em andamento.

**Architecture:** Status novo `pausado` em `inv_inventarios`. Lógica pura (pode bipar, preparar endereços novos, pode remover) em `lib/inv-bip-core.js` com testes em `node --test`. UI em `app.js`/`index.html` seguindo os padrões existentes (modais `.modal-bg`, chips `_stx`, listeners `onSnapshot` com start/stop).

**Tech Stack:** JS puro (sem build), Firebase Firestore compat, `node --test`.

Spec: `docs/superpowers/specs/2026-10-28-pausar-e-enderecos-em-andamento-design.md`

## Global Constraints

- Nada de `confirm()`/`alert()` novos em fluxo de admin: usar modal `.modal-bg` como `modal-excluir-inv`.
- `fila`, `atribuicoes` e bipagens não são tocadas ao pausar/retomar.
- `firestore.rules` não muda.
- Publicar = `BUILD='5'` em app.js, `kontar-v5` + `?v=5` em sw.js, `?v=5` em index.html, `version.json` `{"build":"5"}`.
- Commits pequenos, mensagem em português, rodapé `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

### Task 1: Lógica pura + testes

**Files:** Modify `lib/inv-bip-core.js` (antes do `return {`), `test/inv-bip-core.test.js` (fim).

**Produces:** `InvCore.podeBipar(inv)`, `InvCore.prepararNovosEnderecos(existentes, texto, opts)` → `{novos, repetidos}`, `InvCore.podeRemoverEndereco(inv, endereco, bipagens)`.

- [ ] Testes (append):

```js
// ── pausar / endereços em andamento ────────────────────────────────────
test('podeBipar só com status aberto', function () {
  assert.equal(Core.podeBipar({ status: 'aberto' }), true);
  assert.equal(Core.podeBipar({ status: 'pausado' }), false);
  assert.equal(Core.podeBipar({ status: 'encerrado' }), false);
  assert.equal(Core.podeBipar(null), false);
});
test('prepararNovosEnderecos ignora vazios, separa repetidos e não altera existentes', function () {
  var ex = ['1', '2'];
  var r = Core.prepararNovosEnderecos(ex, ' 2 \n\n3\n3\n 4\n');
  assert.deepEqual(r.novos, ['3', '4']);
  assert.deepEqual(r.repetidos, ['2', '3']);
  assert.deepEqual(ex, ['1', '2']);
});
test('prepararNovosEnderecos aplica maiúsculas quando pedido', function () {
  var r = Core.prepararNovosEnderecos(['LOJA'], 'loja\nfreezer', { maiusculas: true });
  assert.deepEqual(r.novos, ['FREEZER']);
  assert.deepEqual(r.repetidos, ['LOJA']);
});
test('podeRemoverEndereco: regras', function () {
  var base = { enderecos: ['1', '2'], fila: {}, atribuicoes: {} };
  assert.equal(Core.podeRemoverEndereco(base, '1'), true);
  assert.equal(Core.podeRemoverEndereco({ enderecos: ['1'], fila: {}, atribuicoes: {} }, '1'), false, 'último');
  assert.equal(Core.podeRemoverEndereco(Object.assign({}, base, { fila: { '1': { coletores: [{ coletorId: 'A' }] } } }), '1'), false, 'fila');
  assert.equal(Core.podeRemoverEndereco(Object.assign({}, base, { fila: { '1': { userId: 'u1' } } }), '1'), false, 'fila legado');
  assert.equal(Core.podeRemoverEndereco(Object.assign({}, base, { atribuicoes: { '1': { userId: 'u1' } } }), '1'), false, 'atribuição');
  assert.equal(Core.podeRemoverEndereco(base, '1', [{ endereco: '1' }]), false, 'bipagem');
  assert.equal(Core.podeRemoverEndereco(base, '1', [{ endereco: '2' }]), true);
});
```

- [ ] Rodar `npm test` → 4 falhas (funções não existem).
- [ ] Implementação em `lib/inv-bip-core.js`:

```js
  function podeBipar(inv) { return !!(inv && inv.status === 'aberto'); }

  function prepararNovosEnderecos(existentes, texto, opts) {
    opts = opts || {};
    var ex = {}; (existentes || []).forEach(function (e) { ex[String(e)] = true; });
    var novos = [], repetidos = [], vistos = {};
    String(texto == null ? '' : texto).split('\n').forEach(function (l) {
      var n = l.trim(); if (!n) return;
      if (opts.maiusculas) n = n.toUpperCase();
      if (ex[n] || vistos[n]) { repetidos.push(n); return; }
      vistos[n] = true; novos.push(n);
    });
    return { novos: novos, repetidos: repetidos };
  }

  function _slotTemColetor(slot) {
    if (!slot) return false;
    if (slot.coletores && slot.coletores.length) return true;
    return !!(slot.userId || slot.coletorId);
  }
  function podeRemoverEndereco(inv, endereco, bipagens) {
    if (!inv || !endereco) return false;
    if ((inv.enderecos || []).length <= 1) return false;
    if (_slotTemColetor((inv.fila || {})[endereco])) return false;
    if (_slotTemColetor((inv.atribuicoes || {})[endereco])) return false;
    if (bipagens && bipagens.some(function (b) { return b.endereco === endereco; })) return false;
    return true;
  }
```
e adicionar os três ao objeto do `return`.
- [ ] `npm test` verde. Commit `feat(core): podeBipar, prepararNovosEnderecos, podeRemoverEndereco`.

### Task 2: Pausar / Retomar (admin)

**Files:** `app.js` (perto de `encerrarInventario`, `renderInvList`, `abrirDetalheInv`), `index.html` (`#inv-end-actions`, modal novo).

- [ ] `index.html`, em `#inv-end-actions`, antes de Encerrar:
```html
<button class="btn btn-s" id="btn-pausar-inv" onclick="pausarInventario(_invAtivo&&_invAtivo.id)">Pausar</button>
<button class="btn btn-p" id="btn-retomar-inv" style="display:none" onclick="retomarInventario(_invAtivo&&_invAtivo.id)">Retomar</button>
```
- [ ] `index.html`, modal após `modal-excluir-inv`:
```html
<div class="modal-bg" id="modal-pausar-inv">
  <div class="modal-box" style="width:420px">
    <div class="modal-title">Pausar inventário</div>
    <div style="font-weight:700;font-size:14px;margin-bottom:6px" id="pausar-inv-nome"></div>
    <p style="font-size:13px;color:var(--t2);margin-bottom:16px">Os coletores param de bipar na hora. O que já foi contado fica salvo e cada um volta no mesmo endereço quando você retomar.</p>
    <div class="btn-row">
      <button class="btn btn-p btn-sm" style="flex:1" onclick="confirmarPausarInv()">Pausar agora</button>
      <button class="btn btn-s" onclick="fecharModalPausarInv()">Cancelar</button>
    </div>
  </div>
</div>
```
- [ ] `app.js`:
```js
var _pausarInvId=null;
function pausarInventario(invId){ if(!invId) return; var inv=(S.invsCache||[]).find(function(i){return i.id===invId;}); _pausarInvId=invId; var n=document.getElementById('pausar-inv-nome'); if(n) n.textContent=inv?inv.nome:invId; document.getElementById('modal-pausar-inv').style.display='flex'; }
function fecharModalPausarInv(){ document.getElementById('modal-pausar-inv').style.display='none'; _pausarInvId=null; }
function confirmarPausarInv(){ var id=_pausarInvId; if(!id) return; fecharModalPausarInv();
  db.collection('inv_inventarios').doc(id).update({status:'pausado',pausadoEm:firebase.firestore.FieldValue.serverTimestamp(),pausadoPor:S.currentUser?S.currentUser.id:''})
  .then(function(){ showToast('Inventário pausado'); _aposMudarStatusInv(id); }).catch(function(e){ showToast('Erro ao pausar: '+(e.message||'')); }); }
function retomarInventario(invId){ if(!invId) return;
  db.collection('inv_inventarios').doc(invId).update({status:'aberto',retomadoEm:firebase.firestore.FieldValue.serverTimestamp()})
  .then(function(){ showToast('Inventário retomado'); _aposMudarStatusInv(invId); }).catch(function(e){ showToast('Erro ao retomar: '+(e.message||'')); }); }
function _aposMudarStatusInv(invId){ loadInventariosFromFirebase(function(){ renderInvList(); if(_invAtivo&&_invAtivo.id===invId){ _invAtivo=(S.invsCache||[]).find(function(i){return i.id===invId;})||_invAtivo; _aplicarStatusDetalhe(); } }); }
function _aplicarStatusDetalhe(){ if(!_invAtivo) return; var st=_invAtivo.status, statusEl=document.getElementById('inv-detalhe-status');
  _setStatusEl(statusEl, st==='aberto'?'Aberto':st==='pausado'?'Pausado':'Encerrado', st==='aberto'?'ok':st==='pausado'?'warn':'mute');
  var ativo=st==='aberto'||st==='pausado'; var actEl=document.getElementById('inv-end-actions'); if(actEl) actEl.style.display=ativo?'flex':'none';
  var bp=document.getElementById('btn-pausar-inv'), br=document.getElementById('btn-retomar-inv'); if(bp) bp.style.display=st==='aberto'?'':'none'; if(br) br.style.display=st==='pausado'?'':'none';
  var corrBtn=document.getElementById('bip-btn-correcao'); if(corrBtn) corrBtn.style.display=ativo?'':'none'; }
```
- [ ] `abrirDetalheInv`: trocar o bloco `statusEl … corrBtn` por `_aplicarStatusDetalhe();`.
- [ ] `renderInvList`: filtro `i.status==='aberto'||i.status==='pausado'`; célula status `inv.status==='pausado'?_stx('Pausado','warn'):_stx('Aberto','ok')`; ações: `Abrir`, depois `inv.status==='pausado'?Retomar:Pausar`, `Encerrar`, `Excluir`.
- [ ] `renderInvComparativo` option label: `inv.status==='aberto'?'ativo':inv.status==='pausado'?'pausado':'encerrado'`.
- [ ] `renderInvEnderecos`: `isAberto` vira `inv.status==='aberto'||inv.status==='pausado'` (Reabrir endereço continua permitido pausado).
- [ ] Teste manual no navegador: pausar/retomar troca chip e botões sem recarregar. Commit `feat: pausar/retomar inventário (admin)`.

### Task 3: Coletor trava na pausa

**Files:** `app.js` (`renderColeta`, `registrarBipagem`, `registrarBipagemAvulsa`, listener novo).

- [ ] Listener:
```js
var _coletaInvUnsub=null, _coletaInvId=null;
function _iniciarColetaRealtime(invId){ if(_coletaInvId===invId&&_coletaInvUnsub) return; _pararColetaRealtime(); _coletaInvId=invId;
  _coletaInvUnsub=db.collection('inv_inventarios').doc(invId).onSnapshot(function(snap){ if(!snap.exists) return; var d=snap.data();
    var idx=(S.invsCache||[]).findIndex(function(i){return i.id===invId;}); var antes=idx>=0?S.invsCache[idx].status:null;
    if(idx>=0){ S.invsCache[idx]=Object.assign({id:invId},d); if(_invColetaAtual&&_invColetaAtual.inv&&_invColetaAtual.inv.id===invId) _invColetaAtual.inv=S.invsCache[idx]; }
    if(antes!==d.status) renderColeta(); }, function(){}); }
function _pararColetaRealtime(){ if(_coletaInvUnsub){ _coletaInvUnsub(); _coletaInvUnsub=null; } _coletaInvId=null; }
function _htmlColetaPausada(nome){ return '<div style="text-align:center;padding:60px 20px;color:var(--t3)"><div style="font-size:48px;margin-bottom:16px">⏸️</div><div style="font-size:16px;font-weight:700;color:var(--t);margin-bottom:8px">Inventário pausado</div><div style="font-size:13px">'+esc(nome||'')+'<br>O responsável pausou a contagem. Aguarde, você volta no mesmo endereço.</div></div>'; }
```
- [ ] `renderColeta`, logo após o `if (!u)`: 
```js
  var _invPausado=(S.invsCache||[]).find(function(i){ return i.status==='pausado'; });
  var _anyAberto=(S.invsCache||[]).find(function(i){ return i.status==='aberto'; });
  var _invAcomp=_anyAberto||_invPausado; if(_invAcomp) _iniciarColetaRealtime(_invAcomp.id); else _pararColetaRealtime();
  if(!_anyAberto&&_invPausado){ wrap.innerHTML=_htmlColetaPausada(_invPausado.nome); return; }
```
(e remover a declaração duplicada de `_anyAberto` que já existe abaixo).
- [ ] `registrarBipagem`: trocar `if (inv.status!=='aberto'){ alert('Inventário encerrado.'); return; }` por `if (!InvCore.podeBipar(inv)){ showToast(inv.status==='pausado'?'Inventário pausado':'Inventário encerrado'); return; }`. Em `registrarBipagemAvulsa`: `if (!inv||!InvCore.podeBipar(inv)){ showToast(inv&&inv.status==='pausado'?'Inventário pausado':'Inventário não está aberto.'); return; }`.
- [ ] Teste manual com dois navegadores. Commit `feat: coletor trava e volta no mesmo endereço ao pausar/retomar`.

### Task 4: Adicionar endereços em andamento

**Files:** `index.html` (botão + modal), `app.js` (`gerarEnderecosFaixa` parametrizado, `abrirModalAddEnderecos`, `adicionarEnderecos`).

- [ ] `index.html`, na `.bar` da aba Endereços, após o botão de QR:
```html
<button class="btn btn-s" id="btn-add-end" style="display:none" onclick="abrirModalAddEnderecos()">+ Adicionar endereços</button>
```
- [ ] Modal:
```html
<div class="modal-bg" id="modal-add-end">
  <div class="modal-box" style="width:460px">
    <div class="modal-title" id="add-end-title">Adicionar endereços</div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;padding:8px 10px;background:var(--gray);border-radius:8px;flex-wrap:wrap">
      <span style="font-size:12px;font-weight:600;color:var(--t2)">Gerar do</span>
      <input type="number" id="add-end-de" min="0" style="width:64px;padding:5px 8px;border:1.5px solid var(--gray2);border-radius:7px;font-size:13px;font-family:inherit;text-align:center"/>
      <span style="font-size:12px;font-weight:600;color:var(--t2)">ao</span>
      <input type="number" id="add-end-ate" min="0" style="width:64px;padding:5px 8px;border:1.5px solid var(--gray2);border-radius:7px;font-size:13px;font-family:inherit;text-align:center"/>
      <button class="btn btn-p btn-sm" onclick="gerarEnderecosFaixa('add-end')">Gerar</button>
      <button class="btn btn-sm" style="color:var(--r);border-color:var(--r)" onclick="document.getElementById('add-end-lista').value=''">Limpar</button>
    </div>
    <textarea id="add-end-lista" rows="6" placeholder="um por linha" style="width:100%;padding:10px 12px;border:1.5px solid var(--gray2);border-radius:9px;font-size:13px;font-family:monospace;resize:vertical;background:#fff;color:var(--t)"></textarea>
    <div class="modal-err" id="add-end-err"></div>
    <div class="btn-row" style="margin-top:12px">
      <button class="btn btn-p btn-sm" style="flex:1" id="btn-confirmar-add-end" onclick="adicionarEnderecos()">Adicionar</button>
      <button class="btn btn-s" onclick="fecharModalAddEnderecos()">Cancelar</button>
    </div>
  </div>
</div>
```
- [ ] `gerarEnderecosFaixa(prefix)`: `prefix=prefix||'ninv-end'`; ids `prefix+'-de'`, `prefix+'-ate'`; textarea `prefix==='ninv-end'?'ninv-enderecos':prefix+'-lista'`; errEl `prefix==='ninv-end'?'ninv-err':'add-end-err'`.
- [ ] Funções:
```js
function abrirModalAddEnderecos(){ if(!_invAtivo) return; var isSet=_invAtivo.modoOrganizacao==='setores'; var t=document.getElementById('add-end-title'); if(t) t.textContent=isSet?'Adicionar setores':'Adicionar endereços';
  ['add-end-lista','add-end-de','add-end-ate'].forEach(function(id){ var el=document.getElementById(id); if(el) el.value=''; }); var e=document.getElementById('add-end-err'); if(e){e.textContent='';e.style.display='none';}
  document.getElementById('modal-add-end').style.display='flex'; setTimeout(function(){ var ta=document.getElementById('add-end-lista'); if(ta) ta.focus(); },100); }
function fecharModalAddEnderecos(){ document.getElementById('modal-add-end').style.display='none'; }
function adicionarEnderecos(){ if(!_invAtivo) return; var inv=_invAtivo, isSet=inv.modoOrganizacao==='setores'; var errEl=document.getElementById('add-end-err');
  var r=InvCore.prepararNovosEnderecos(inv.enderecos||[], (document.getElementById('add-end-lista')||{}).value||'', {maiusculas:isSet});
  if(!r.novos.length){ if(errEl){ errEl.textContent=r.repetidos.length?'Todos já existem.':'Informe pelo menos um '+(isSet?'setor':'endereço')+'.'; errEl.style.display='block'; } return; }
  var btn=document.getElementById('btn-confirmar-add-end'); if(btn){btn.disabled=true;btn.textContent='Adicionando...';}
  var upd={enderecos:firebase.firestore.FieldValue.arrayUnion.apply(null,r.novos)}; if(isSet) upd.setores=firebase.firestore.FieldValue.arrayUnion.apply(null,r.novos);
  db.collection('inv_inventarios').doc(inv.id).update(upd).then(function(){ fecharModalAddEnderecos(); showToast(r.novos.length+(isSet?' setor(es)':' endereço(s)')+' adicionado(s)'+(r.repetidos.length?' · '+r.repetidos.length+' já existia(m)':'')); })
  .catch(function(e){ if(errEl){errEl.textContent='Erro: '+(e.message||'');errEl.style.display='block';} }).then(function(){ if(btn){btn.disabled=false;btn.textContent='Adicionar';} }); }
```
- [ ] Em `_aplicarStatusDetalhe` (Task 2): `var ba=document.getElementById('btn-add-end'); if(ba) ba.style.display=(ativo&&(S.role==='admin'||S.role==='gerencia'||S.role==='supervisor'))?'':'none';`
- [ ] Teste manual: 3 endereços, 1 repetido; tabela atualiza pelo listener existente. Commit `feat: adicionar endereços com o inventário em andamento`.

### Task 5: Remover endereço vazio

**Files:** `app.js` (`renderInvEnderecos`, `removerEndereco`), `index.html` (modal).

- [ ] Modal:
```html
<div class="modal-bg" id="modal-rem-end">
  <div class="modal-box" style="width:400px">
    <div class="modal-title" style="color:var(--r)">Remover endereço</div>
    <p style="font-size:13px;color:var(--t2);margin-bottom:16px">Remover <strong id="rem-end-nome"></strong>? Ele não tem coletor nem bipagem.</p>
    <div class="btn-row">
      <button class="btn btn-sm" style="background:var(--r);color:#fff;border-color:var(--r);flex:1" onclick="confirmarRemoverEndereco()">Remover</button>
      <button class="btn btn-s" onclick="document.getElementById('modal-rem-end').style.display='none'">Cancelar</button>
    </div>
  </div>
</div>
```
- [ ] `renderInvEnderecos`: nos dois ramos (fila e atribuição), ao montar o botão da última coluna: `var remBtn=(isAberto&&isAdmin&&InvCore.podeRemoverEndereco(inv,end))?'<button class="lk lk-d" onclick="removerEndereco(\''+invId+'\',\''+safeEnd+'\')">Remover</button>':'';` e concatenar após `reabrirBtn`.
- [ ] Funções:
```js
var _remEnd=null;
function removerEndereco(invId, endereco){ var inv=(S.invsCache||[]).find(function(i){return i.id===invId;}); if(!inv) return;
  loadBipagensByInv(invId,function(bips){ if(!InvCore.podeRemoverEndereco(inv,endereco,bips)){ showToast('Este endereço já tem bipagens ou coletor.'); return; }
    _remEnd={invId:invId,endereco:endereco}; var n=document.getElementById('rem-end-nome'); if(n) n.textContent=endereco; document.getElementById('modal-rem-end').style.display='flex'; }); }
function confirmarRemoverEndereco(){ var c=_remEnd; if(!c) return; _remEnd=null; document.getElementById('modal-rem-end').style.display='none';
  var inv=(S.invsCache||[]).find(function(i){return i.id===c.invId;}); var upd={enderecos:firebase.firestore.FieldValue.arrayRemove(c.endereco)}; if(inv&&inv.modoOrganizacao==='setores') upd.setores=firebase.firestore.FieldValue.arrayRemove(c.endereco);
  db.collection('inv_inventarios').doc(c.invId).update(upd).then(function(){ showToast('Endereço removido'); }).catch(function(e){ showToast('Erro: '+(e.message||'')); }); }
```
- [ ] Teste manual. Commit `feat: remover endereço vazio com o inventário em andamento`.

### Task 6: BUILD 5

- [ ] `app.js` `BUILD='5'`; `sw.js` `kontar-v5` e todos `?v=4`→`?v=5`; `index.html` `?v=4`→`?v=5`; `version.json` `{"build":"5"}`.
- [ ] `npm test` verde. Commit `BUILD 5: pausar inventário + endereços em andamento`. Push na main (GitHub Pages publica). Conferir `https://kontarapp.github.io/kontar/version.json`.
