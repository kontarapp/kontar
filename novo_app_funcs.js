// ── Pausar / Retomar inventário (spec 2026-10-28-pausar-e-enderecos-em-andamento) ──
var _pausarInvId=null;
function pausarInventario(invId){
  if(!invId) return;
  var inv=(S.invsCache||[]).find(function(i){ return i.id===invId; });
  _pausarInvId=invId;
  var n=document.getElementById('pausar-inv-nome'); if(n) n.textContent=inv?inv.nome:invId;
  document.getElementById('modal-pausar-inv').style.display='flex';
}
function fecharModalPausarInv(){ document.getElementById('modal-pausar-inv').style.display='none'; _pausarInvId=null; }
function confirmarPausarInv(){
  var id=_pausarInvId; if(!id) return; fecharModalPausarInv();
  db.collection('inv_inventarios').doc(id).update({status:'pausado',pausadoEm:firebase.firestore.FieldValue.serverTimestamp(),pausadoPor:S.currentUser?S.currentUser.id:''})
    .then(function(){ showToast('Inventário pausado'); _aposMudarStatusInv(id); })
    .catch(function(e){ showToast('Erro ao pausar: '+(e.message||'')); });
}
function retomarInventario(invId){
  if(!invId) return;
  db.collection('inv_inventarios').doc(invId).update({status:'aberto',retomadoEm:firebase.firestore.FieldValue.serverTimestamp()})
    .then(function(){ showToast('Inventário retomado'); _aposMudarStatusInv(invId); })
    .catch(function(e){ showToast('Erro ao retomar: '+(e.message||'')); });
}
function _aposMudarStatusInv(invId){
  loadInventariosFromFirebase(function(){
    renderInvList();
    if(_invAtivo&&_invAtivo.id===invId){
      _invAtivo=(S.invsCache||[]).find(function(i){ return i.id===invId; })||_invAtivo;
      _aplicarStatusDetalhe();
      renderInvEnderecos();
    }
  });
}
// Chip de status + botões do detalhe conforme aberto/pausado/encerrado.
function _aplicarStatusDetalhe(){
  if(!_invAtivo) return;
  var st=_invAtivo.status, statusEl=document.getElementById('inv-detalhe-status');
  _setStatusEl(statusEl, st==='aberto'?'Aberto':st==='pausado'?'Pausado':'Encerrado', st==='aberto'?'ok':st==='pausado'?'warn':'mute');
  var ativo=st==='aberto'||st==='pausado';
  var actEl=document.getElementById('inv-end-actions'); if(actEl) actEl.style.display=ativo?'flex':'none';
  var bp=document.getElementById('btn-pausar-inv'), br=document.getElementById('btn-retomar-inv');
  if(bp) bp.style.display=st==='aberto'?'':'none';
  if(br) br.style.display=st==='pausado'?'':'none';
  var corrBtn=document.getElementById('bip-btn-correcao'); if(corrBtn) corrBtn.style.display=ativo?'':'none';
  var isAdmin=S.role==='admin'||S.role==='gerencia'||S.role==='supervisor';
  var ba=document.getElementById('btn-add-end'); if(ba) ba.style.display=(ativo&&isAdmin)?'':'none';
}

// ── Coletor: acompanha o doc do inventário (pausa/retomada em tempo real) ──
var _coletaInvUnsub=null, _coletaInvId=null;
function _iniciarColetaRealtime(invId){
  if(_coletaInvId===invId&&_coletaInvUnsub) return;
  _pararColetaRealtime(); _coletaInvId=invId;
  _coletaInvUnsub=db.collection('inv_inventarios').doc(invId).onSnapshot(function(snap){
    if(!snap.exists) return;
    var d=snap.data();
    var idx=(S.invsCache||[]).findIndex(function(i){ return i.id===invId; });
    var antes=idx>=0?S.invsCache[idx].status:null;
    if(idx>=0){
      S.invsCache[idx]=Object.assign({id:invId},d);
      if(_invColetaAtual&&_invColetaAtual.inv&&_invColetaAtual.inv.id===invId) _invColetaAtual.inv=S.invsCache[idx];
    }
    if(antes!==d.status) renderColeta();
  }, function(){ /* erro silencioso: a trava em registrarBipagem continua valendo */ });
}
function _pararColetaRealtime(){ if(_coletaInvUnsub){ _coletaInvUnsub(); _coletaInvUnsub=null; } _coletaInvId=null; }
function _htmlColetaPausada(nome){
  return '<div style="text-align:center;padding:60px 20px;color:var(--t3)">'+
    '<div style="font-size:48px;margin-bottom:16px">⏸️</div>'+
    '<div style="font-size:16px;font-weight:700;color:var(--t);margin-bottom:8px">Inventário pausado</div>'+
    '<div style="font-size:13px">'+esc(nome||'')+'<br>O responsável pausou a contagem. Aguarde, você volta no mesmo endereço.</div>'+
  '</div>';
}

// ── Endereços com o inventário em andamento ───────────────────────────────
function abrirModalAddEnderecos(){
  if(!_invAtivo) return;
  var isSet=_invAtivo.modoOrganizacao==='setores';
  var t=document.getElementById('add-end-title'); if(t) t.textContent=isSet?'Adicionar setores':'Adicionar endereços';
  ['add-end-lista','add-end-de','add-end-ate'].forEach(function(id){ var el=document.getElementById(id); if(el) el.value=''; });
  var e=document.getElementById('add-end-err'); if(e){ e.textContent=''; e.style.display='none'; }
  document.getElementById('modal-add-end').style.display='flex';
  setTimeout(function(){ var ta=document.getElementById('add-end-lista'); if(ta) ta.focus(); },100);
}
function fecharModalAddEnderecos(){ document.getElementById('modal-add-end').style.display='none'; }
function adicionarEnderecos(){
  if(!_invAtivo) return;
  var inv=_invAtivo, isSet=inv.modoOrganizacao==='setores';
  var errEl=document.getElementById('add-end-err');
  var r=InvCore.prepararNovosEnderecos(inv.enderecos||[], (document.getElementById('add-end-lista')||{}).value||'', {maiusculas:isSet});
  if(!r.novos.length){
    if(errEl){ errEl.textContent=r.repetidos.length?'Todos já existem.':'Informe pelo menos um '+(isSet?'setor':'endereço')+'.'; errEl.style.display='block'; }
    return;
  }
  var btn=document.getElementById('btn-confirmar-add-end'); if(btn){ btn.disabled=true; btn.textContent='Adicionando...'; }
  var AU=firebase.firestore.FieldValue.arrayUnion;
  var upd={enderecos:AU.apply(null,r.novos)}; if(isSet) upd.setores=AU.apply(null,r.novos);
  db.collection('inv_inventarios').doc(inv.id).update(upd).then(function(){
    fecharModalAddEnderecos();
    showToast(r.novos.length+(isSet?' setor(es)':' endereço(s)')+' adicionado(s)'+(r.repetidos.length?' · '+r.repetidos.length+' já existia(m)':''));
  }).catch(function(e){
    if(errEl){ errEl.textContent='Erro: '+(e.message||''); errEl.style.display='block'; }
  }).then(function(){ if(btn){ btn.disabled=false; btn.textContent='Adicionar'; } });
}
var _remEnd=null;
function removerEndereco(invId, endereco){
  var inv=(S.invsCache||[]).find(function(i){ return i.id===invId; }); if(!inv) return;
  loadBipagensByInv(invId,function(bips){
    if(!InvCore.podeRemoverEndereco(inv,endereco,bips)){ showToast('Este endereço já tem bipagens ou coletor.'); return; }
    _remEnd={invId:invId,endereco:endereco};
    var n=document.getElementById('rem-end-nome'); if(n) n.textContent=endereco;
    document.getElementById('modal-rem-end').style.display='flex';
  });
}
function confirmarRemoverEndereco(){
  var c=_remEnd; if(!c) return; _remEnd=null;
  document.getElementById('modal-rem-end').style.display='none';
  var inv=(S.invsCache||[]).find(function(i){ return i.id===c.invId; });
  var AR=firebase.firestore.FieldValue.arrayRemove;
  var upd={enderecos:AR(c.endereco)}; if(inv&&inv.modoOrganizacao==='setores') upd.setores=AR(c.endereco);
  db.collection('inv_inventarios').doc(c.invId).update(upd)
    .then(function(){ showToast('Endereço removido'); })
    .catch(function(e){ showToast('Erro: '+(e.message||'')); });
}
