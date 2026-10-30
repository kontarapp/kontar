// Kontar — Inventário para mercados e farmácias
// Derivado do módulo de inventário do Fluxo360.
// Código plain JS (sem bundler), Firebase compat SDK.

// Verificação de versão — roda antes de tudo
var BUILD = '16';
(function() {
  var vEl = document.getElementById('sb-versao');
  if (vEl) vEl.textContent = 'v' + BUILD;
  var vMenu = document.getElementById('topbar-menu-versao');
  if (vMenu) vMenu.textContent = 'v' + BUILD;
  var vLogin = document.getElementById('login-versao');
  if (vLogin) vLogin.textContent = 'v' + BUILD;
  if (localStorage.getItem('kontar_build') !== BUILD) {
    localStorage.setItem('kontar_build', BUILD);
    // Não limpa eco_last_page aqui: o operador quer continuar na mesma tela
    // depois que o app atualiza sozinho, não voltar pra capa (ver bloco
    // mobile mais abaixo, que agora sempre restaura a última tela).
    if ('caches' in window) {
      caches.keys().then(function(keys) {
        return Promise.all(keys.map(function(k) { return caches.delete(k); }));
      }).then(function() { window.location.reload(true); });
    } else {
      window.location.reload(true);
    }
  }
})();

// Kontar: credenciais do Firebase ficam em firebase-config.js (carregado antes deste arquivo)
if (!window.KONTAR_FIREBASE_CONFIG) {
  console.error('Kontar: window.KONTAR_FIREBASE_CONFIG não definido — verifique firebase-config.js');
}
firebase.initializeApp(window.KONTAR_FIREBASE_CONFIG || {});
var db = firebase.firestore();

// ── PWA: persistência offline do Firestore ──
db.enablePersistence({synchronizeTabs: true}).catch(function(err){
  if (err.code === 'failed-precondition') {
    console.warn('Offline: múltiplas abas abertas — persistência desativada nesta aba.');
  } else if (err.code === 'unimplemented') {
    console.warn('Offline: este navegador não suporta persistência.');
  }
});
// ── Verificação de modo anônimo / privado ─────────────────────────────────
(function(){
  function _mostrarAvisoAnonimo(motivo, ehCotaCheia) {
    var el = document.createElement('div');
    el.id = 'aviso-anonimo';
    el.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;padding:24px';
    var titulo = ehCotaCheia ? 'Armazenamento do aparelho cheio' : 'Modo Privado Detectado';
    var explicacao = ehCotaCheia
      ? 'O espaço de armazenamento do navegador neste aparelho está cheio (não é aba anônima). Bipagens feitas sem internet <strong>podem ser perdidas</strong> até liberar espaço.'
      : 'O app de inventário <strong>não funciona em aba anônima ou privada</strong>. Neste modo o armazenamento local é bloqueado e as bipagens realizadas sem internet <strong>serão perdidas</strong>.';
    var comoResolver = ehCotaCheia
      ? '1. Feche outros apps/abas abertos<br>' +
        '2. No navegador, limpe dados de navegação antigos (Configurações &gt; Privacidade)<br>' +
        '3. Recarregue esta página'
      : '1. Feche esta aba<br>' +
        '2. Abra uma aba normal (não privada)<br>' +
        '3. Acesse o app novamente';
    el.innerHTML =
      '<div style="background:#fff;border-radius:20px;padding:32px 28px;max-width:400px;width:100%;text-align:center;box-shadow:0 8px 40px rgba(0,0,0,.4)">' +
        '<div style="font-size:48px;margin-bottom:12px">🚫</div>' +
        '<div style="font-size:20px;font-weight:800;margin-bottom:8px;color:#c0392b">' + titulo + '</div>' +
        '<div style="font-size:14px;color:#555;line-height:1.6;margin-bottom:20px">' +
          explicacao +
          '<br><br><span style="font-size:12px;color:#888">Motivo técnico: ' + motivo + '</span>' +
        '</div>' +
        '<div style="background:#fff3e0;border-radius:10px;padding:14px;margin-bottom:20px;text-align:left">' +
          '<div style="font-size:13px;font-weight:700;color:#e65100;margin-bottom:6px">Como resolver:</div>' +
          '<div style="font-size:13px;color:#555;line-height:1.6">' + comoResolver + '</div>' +
        '</div>' +
        '<button onclick="document.getElementById(\'aviso-anonimo\').remove()" ' +
          'style="width:100%;padding:13px;background:#c0392b;color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">' +
          'Entendi — continuar mesmo assim' +
        '</button>' +
      '</div>';
    document.body.appendChild(el);
  }

  // Libera espaço de emergência: os backups de foto (eco_foto_bk_*) são só
  // cópia de segurança pra reenvio, não dado principal — podem ser apagados
  // sem perder nada que já tenha sido confirmado no servidor.
  function _liberarEspacoEmergencia() {
    try {
      var chaves = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('eco_foto_bk_') === 0) chaves.push(k);
      }
      chaves.forEach(function(k){ try { localStorage.removeItem(k); } catch(e){} });
      return chaves.length > 0;
    } catch(e) { return false; }
  }

  // Teste 1: localStorage
  try {
    localStorage.setItem('_kontar_chk', '1');
    localStorage.removeItem('_kontar_chk');
  } catch(e) {
    // Cota esgotada (comum quando fotos de backup acumulam no dia) não é modo
    // privado de verdade: tenta liberar espaço e testar de novo antes de alarmar.
    var ehCota = e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014);
    if (ehCota && _liberarEspacoEmergencia()) {
      try {
        localStorage.setItem('_kontar_chk', '1');
        localStorage.removeItem('_kontar_chk');
        return; // liberou espaço e voltou a funcionar — não alarma ninguém
      } catch(e2) { /* continua e mostra aviso abaixo */ }
    }
    setTimeout(function(){ _mostrarAvisoAnonimo(ehCota ? 'armazenamento cheio (QuotaExceededError)' : 'localStorage bloqueado', ehCota); }, 500);
    return;
  }

  // Teste 2: IndexedDB (crítico — Firestore offline depende dele)
  try {
    var _testReq = indexedDB.open('_kontar_chk_' + Date.now(), 1);
    _testReq.onerror = function() {
      setTimeout(function(){ _mostrarAvisoAnonimo('IndexedDB bloqueado'); }, 500);
    };
    _testReq.onsuccess = function() {
      var dbName = _testReq.result.name;
      _testReq.result.close();
      try { indexedDB.deleteDatabase(dbName); } catch(e){}
    };
  } catch(e) {
    setTimeout(function(){ _mostrarAvisoAnonimo('IndexedDB não suportado'); }, 500);
  }
})();
// ── PWA: registrar Service Worker ──
var _swRefreshing = false;
function forcarAtualizacao() {
  if (!confirm('Isso vai limpar o cache do app e recarregar a versão mais recente. Continuar?')) return;
  var limpar = [];
  if ('caches' in window) {
    limpar.push(caches.keys().then(function(keys) {
      return Promise.all(keys.map(function(k) { return caches.delete(k); }));
    }));
  }
  if ('serviceWorker' in navigator) {
    limpar.push(navigator.serviceWorker.getRegistrations().then(function(regs) {
      return Promise.all(regs.map(function(r) { return r.unregister(); }));
    }));
  }
  Promise.all(limpar).then(function() {
    // Não limpa eco_last_page aqui: continua na mesma tela depois de forçar
    // a atualização, não volta pra capa (ver bloco mobile mais abaixo).
    localStorage.removeItem('inv_detalhe_state');
    var base = window.location.href.split('?')[0];
    window.location.replace(base + '?bust=' + Date.now());
  });
}
function _swBanner() {
  if (document.getElementById('sw-banner')) return;
  var b = document.createElement('div');
  b.id = 'sw-banner';
  b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#1a7a4a;color:#fff;text-align:center;padding:11px 16px;font-size:14px;font-weight:700;font-family:"Manrope",sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.2)';
  b.textContent = '🔄 Nova versão disponível — atualizando...';
  document.body.appendChild(b);
}

if ('serviceWorker' in navigator) {
  var _prevController = navigator.serviceWorker.controller;

  function _ativarSwWaiting(reg) {
    if (reg.waiting) {
      reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
  }

  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(function(reg) {
    // Se já tem um SW esperando (update baixado mas não ativado), força agora
    _ativarSwWaiting(reg);

    reg.addEventListener('updatefound', function() {
      var novo = reg.installing;
      if (!novo) return;
      novo.addEventListener('statechange', function() {
        if (novo.state === 'installed') {
          _ativarSwWaiting(reg);
        }
      });
    });

    reg.update();
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'visible') {
        reg.update().then(function() { _ativarSwWaiting(reg); });
      }
    });
  }).catch(function(err) {
    console.warn('SW registro falhou:', err);
  });

  navigator.serviceWorker.addEventListener('controllerchange', function() {
    if (!_prevController) return;
    if (_swRefreshing) return;
    _swRefreshing = true;
    _swBanner();
    setTimeout(function() { window.location.reload(); }, 1500);
  });
}
// ── PWA: monitorar conexão ──
function atualizarStatusConexao() {
  var banner = document.getElementById('offline-banner');
  if (!banner) return;
  banner.style.display = navigator.onLine ? 'none' : 'block';
  // Empurra conteúdo para baixo quando offline
  var app = document.getElementById('app');
  if (app) app.style.paddingTop = navigator.onLine ? '' : '40px';
}
window.addEventListener('online',  atualizarStatusConexao);
window.addEventListener('offline', atualizarStatusConexao);
// Verifica na carga
document.addEventListener('DOMContentLoaded', atualizarStatusConexao);
// ===========================================
// STORAGE
// ===========================================
var UKEY = 'eco_users'; // chave local do cache de usuários (mantida por compatibilidade)

function getLocalDate() {
  var d = new Date();
  return d.getFullYear() + '-'
    + String(d.getMonth() + 1).padStart(2, '0') + '-'
    + String(d.getDate()).padStart(2, '0');
}
function genId() { return 'id_'+Date.now()+'_'+Math.random().toString(36).substr(2,5); }
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
// ===========================================
// SEGURANÇA — Hash de senhas (SHA-256)
// ===========================================
function hashPassword(pwd) {
  var encoder = new TextEncoder();
  var data = encoder.encode(pwd);
  return crypto.subtle.digest('SHA-256', data).then(function(buf) {
    return Array.from(new Uint8Array(buf))
      .map(function(b){ return b.toString(16).padStart(2,'0'); })
      .join('');
  });
}

function isHashed(str) {
  return typeof str === 'string' && /^[0-9a-f]{64}$/.test(str);
}

// Mantido só para compatibilidade de estrutura — sem senha em texto claro
var DEFAULT_USERS = [];

function getUsers() {
  // Returns from cache (loaded from Firebase on login)
  var cached = S.usersCache && S.usersCache.length ? S.usersCache : null;
  if (!cached) {
    try {
      var raw = localStorage.getItem(UKEY);
      cached = raw ? JSON.parse(raw) : [];
    } catch(e) { cached = []; }
  }
  return cached;
}

function saveUsers(list) {
  S.usersCache = list;
  localStorage.setItem(UKEY, JSON.stringify(list));
  // Save all users to Firebase (admin included — sem senha em texto claro)
  list.forEach(function(u){
    db.collection('usuarios').doc(u.id).set(u).catch(function(){});
  });
}

function loadUsersFromFirebase(callback) {
  db.collection('usuarios').get().then(function(snap){
    // 'usuarios' é global entre clientes — filtra pelo tenant logado.
    // Docs de antes do multi-tenant (BUILD 231) não têm clienteId; sempre eram da Economico.
    var myClient = (S.currentUser && S.currentUser.clienteId) || '';
    var list = snap.docs.map(function(d){return d.data();}).filter(function(u){
      return (u.clienteId || '') === myClient;
    });
    S.usersCache = list;
    localStorage.setItem(UKEY, JSON.stringify(list));
    if (callback) callback();
  }).catch(function(){
    try {
      var raw = localStorage.getItem(UKEY);
      S.usersCache = raw ? JSON.parse(raw) : [];
    } catch(e){ S.usersCache = []; }
    if (callback) callback();
  });
}
// ===========================================
// STATE
// ===========================================
var S = {
  role: '',
  currentUser: null,
  clienteConfig: null,
  usersCache: [],
  invsCache: []
};

// ── Feature flags por cliente ─────────────────────────────────────────────
// Kontar: nenhum módulo opt-in; chave ausente em clientes/{id}.modulos = ativo.
var MODULOS_OPT_IN = {};

function _moduloAtivo(nome) {
  if (MODULOS_OPT_IN[nome]) {
    return !!(S.clienteConfig && S.clienteConfig.modulos && S.clienteConfig.modulos[nome] === true);
  }
  if (!S.clienteConfig) return true;
  var m = S.clienteConfig.modulos;
  if (!m) return true;
  return m[nome] !== false;
}

// ── Capa de módulos (tela inicial mobile) ────────────────────────────────
// Kontar: só os cards do inventário. Mesma máquina de estados da origem
// (_capaEstado): bloqueado por papel, cadeado por plano, vivo.
var CAPA_MODULOS = [
  { id:'inventario', label:'Inventários', desenvolvido:true, moduloChave:'inventario',
    roleOk: function(){ return S.role === 'admin'; },
    page: function(){ return 'inv'; },
    icone:'<path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/>' },
  { id:'coleta', label:'Minha Coleta', desenvolvido:true, moduloChave:'inventario', precisaInvAberto:true,
    roleOk: function(){ return true; },
    page: function(){ return 'inv-coleta'; },
    icone:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h1v6H9M13 9l3 3-3 3"/>' },
  { id:'avulsa', label:'Coleta Avulsa', desenvolvido:true, moduloChave:'inventario', precisaInvAberto:true,
    roleOk: function(){ return true; },
    page: function(){ return 'inv-avulsa'; },
    icone:'<path d="M4 7V4h3M17 4h3v3M20 17v3h-3M7 20H4v-3"/><path d="M8 12h8"/>' },
  { id:'usuarios', label:'Usuários', desenvolvido:true, moduloChave:null,
    roleOk: function(){ return S.role === 'admin'; },
    page: function(){ return 'usuarios'; },
    icone:'<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>' }
];

// Estado de um card da capa, nesta ordem de prioridade:
// 1. não desenvolvido → sempre "em_breve" (nunca oculta, é vitrine)
// 2. papel sem acesso → "bloqueado" (cinza, mas continua visível — todo perfil
//    precisa enxergar que o módulo existe, mesmo sem poder abrir; pedido do Tiago)
// 3. desenvolvido + papel ok, mas módulo desligado no plano do cliente → "cadeado"
// 4. caso contrário → "vivo"
function _capaEstado(mod) {
  if (!mod.desenvolvido) return 'em_breve';
  if (!mod.roleOk()) return 'bloqueado';
  if (!_moduloAtivo(mod.moduloChave)) return 'cadeado';
  // Kontar: coleta só faz sentido com um inventário aberto
  if (mod.precisaInvAberto && !(S.invsCache||[]).some(function(i){ return i.status==='aberto'; })) return 'sem_inventario';
  return 'vivo';
}

function _avisoEmBreve(nomeModulo) {
  showToast('🚧 ' + nomeModulo + ' está em desenvolvimento. Em breve na sua loja!');
}

function _avisoSemPermissao(nomeModulo) {
  showToast('🔒 ' + nomeModulo + ' não está disponível para o seu perfil.');
}

function abrirModalUpgrade(nomeModulo) {
  var existing = document.getElementById('modal-upgrade-modulo');
  if (existing) existing.remove();
  var html =
    '<div id="modal-upgrade-modulo" class="modal-bg" style="display:flex" onclick="if(event.target===this)this.remove()">'+
      '<div class="modal-box" style="width:340px;text-align:center">'+
        '<div style="font-size:40px;margin-bottom:10px">🔒</div>'+
        '<div class="modal-title" style="margin-bottom:8px">'+nomeModulo+'</div>'+
        '<div style="font-size:13px;color:var(--t2);margin-bottom:20px;line-height:1.5">Este módulo não está incluído no seu plano atual. Fale com o suporte para ativar.</div>'+
                '<button class="btn btn-s" style="width:100%" onclick="document.getElementById(\'modal-upgrade-modulo\').remove()">Fechar</button>'+
      '</div>'+
    '</div>';
  document.body.insertAdjacentHTML('beforeend', html);
}

function renderCapa() {
  var grid = document.getElementById('capa-grid');
  if (!grid) return;
  var html = CAPA_MODULOS.map(function(mod) {
    var estado = _capaEstado(mod);
    if (estado === 'oculto') return '';
    var cls = 'capa-card' + (estado==='vivo' ? '' : ' capa-card-inativo');
    var pill = estado==='em_breve' ? '<span class="capa-pill">Em breve</span>'
             : estado==='cadeado' ? '<span class="capa-pill capa-pill-cadeado">🔒</span>'
             : estado==='bloqueado' ? '<span class="capa-pill">🔒 Restrito</span>'
             : estado==='sem_inventario' ? '<span class="capa-pill">Nenhum inventário aberto</span>' : '';
    var labelEsc = mod.label.replace(/'/g, "\\'");
    var onclick = estado==='vivo' ? "nav('"+mod.page()+"',this)"
                : estado==='cadeado' ? "abrirModalUpgrade('"+labelEsc+"')"
                : estado==='bloqueado' ? "_avisoSemPermissao('"+labelEsc+"')"
                : estado==='sem_inventario' ? "showToast('Nenhum inventário aberto no momento.')"
                : "_avisoEmBreve('"+labelEsc+"')";
    return '<div class="'+cls+'" onclick="'+onclick+'">'
      + '<div class="capa-card-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">'+mod.icone+'</svg></div>'
      + '<div class="capa-card-label">'+mod.label+'</div>'
      + pill
      + '</div>';
  }).join('');
  html += '<div class="capa-card capa-card-saida" onclick="if(confirm(\'Deseja realmente sair?\'))doLogout()">'
    + '<div class="capa-card-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg></div>'
    + '<div class="capa-card-label">Saída</div>'
    + '</div>';
  grid.innerHTML = html;
  _ajustarAlturaCapa();
}

// Calcula a altura real disponível (topbar + faixa de impersonar, se existir + padding do
// .content) e divide entre as 4 linhas da capa, pra caber sem rolagem em qualquer device —
// em vez de valores fixos em px, que quebravam quando a faixa de superadmin aparecia.
function _ajustarAlturaCapa() {
  var grid = document.getElementById('capa-grid');
  if (!grid || window.innerWidth > 768) { if (grid) grid.style.height = ''; document.body.style.removeProperty('overflow'); return; }
  var topbar = document.querySelector('.topbar');
  var faixa = document.getElementById('impersonar-faixa');
  var usado = (topbar ? topbar.offsetHeight : 52) + (faixa ? faixa.offsetHeight : 0) + 28;
  var h = window.innerHeight - usado;
  grid.style.height = h > 320 ? h + 'px' : '';
  // Trava o scroll do body enquanto a capa cabe inteira — a faixa de impersonar usa
  // position:fixed, e isso faz o browser contar a altura dela 2x no scrollHeight
  // (padding de compensação + o próprio fixed), sobrando ~faixa-h de scroll fantasma
  // mesmo com todos os 12 cards já visíveis. Sem isso, dava pra arrastar um scroll vazio.
  if (h > 320) document.body.style.setProperty('overflow', 'hidden', 'important');
  else document.body.style.removeProperty('overflow');
}
if (!window._capaResizeBound) {
  window._capaResizeBound = true;
  window.addEventListener('resize', function(){ if (document.getElementById('panel-capa') && document.getElementById('panel-capa').classList.contains('active')) _ajustarAlturaCapa(); });
}
function carregarClienteConfig(cb) {
  // KONTAR_CLIENT_ID (firebase-config.js) tem prioridade; fallback para clienteId do usuário.
  // No modo universal (KONTAR_CLIENT_ID === 'universal') não há tenant fixo — o
  // clienteId vem sempre do usuário logado.
  // Kontar: se o doc clientes/{id} não existir, S.clienteConfig fica null e o app
  // segue com todos os módulos ativos (ver _moduloAtivo).
  var deployId = (window.KONTAR_CLIENT_ID && window.KONTAR_CLIENT_ID.trim()) || '';
  var clienteId = (deployId && deployId !== 'universal' ? deployId : '')
    || (S.currentUser && S.currentUser.clienteId)
    || '';
  if (!clienteId) { S.clienteConfig = null; if (cb) cb(); return; }
  db.collection('clientes').doc(clienteId).get().then(function(doc) {
    S.clienteConfig = doc.exists ? Object.assign({}, doc.data(), {id: doc.id}) : null;
    if (cb) cb();
  }).catch(function() { S.clienteConfig = null; if (cb) cb(); });
}
// ===========================================
// LOGIN / LOGOUT
// ===========================================
function doLogin() {
  var email = (document.getElementById('lEmail').value||'').trim().toLowerCase();
  var pass = document.getElementById('lPass').value;
  var err = document.getElementById('lErr');
  err.style.display = 'none';

  if (!email || !pass) {
    err.textContent = 'Preencha e-mail e senha.';
    err.style.color = 'var(--r)';
    err.style.display = 'block';
    return;
  }

  err.textContent = 'Entrando...';
  err.style.color = '#856404';
  err.style.display = 'block';

  firebase.auth().signInWithEmailAndPassword(email, pass)
    .then(function(cred) {
      return db.collection('usuarios').where('email', '==', (cred.user.email||'').toLowerCase()).get();
    })
    .then(function(snap) {
      if (snap.empty) throw { code: 'perfil/nao-encontrado' };
      var found = snap.docs[0].data();
      if (found.ativo === false) throw { code: 'auth/user-disabled' };
      err.style.display = 'none';
      finalizarLogin(found);
    })
    .catch(function(e) {
      console.error('Kontar login error:', e.code, e.message, e);
      var msg = 'E-mail ou senha incorretos.';
      if (e.code === 'auth/too-many-requests') msg = 'Muitas tentativas. Aguarde alguns minutos.';
      if (e.code === 'auth/network-request-failed') msg = 'Sem conexão com a internet.';
      if (e.code === 'auth/user-disabled') msg = 'Usuário inativo. Contate o administrador.';
      if (e.code === 'perfil/nao-encontrado') msg = 'Usuário não encontrado no sistema.';
      err.innerHTML = msg + '<br><span style="font-size:10px;opacity:.55">' + (e.code||'erro desconhecido') + '</span>';
      err.style.color = 'var(--r)';
      err.style.display = 'block';
    });
}

function finalizarLogin(found) {
  // Guarda única: usuário só pode logar no deploy do seu próprio cliente.
  // finalizarLogin é o ponto de convergência tanto do login ativo quanto da
  // restauração de sessão (eco_session), então a validação fica aqui.
  var deployClient = (window.KONTAR_CLIENT_ID || '').trim();
  var userClient = found.clienteId || '';
  // Deploy universal (KONTAR_CLIENT_ID='universal'): não existe tenant fixo pra
  // comparar — é o login que DEFINE o tenant da sessão. O usuário ainda precisa
  // ter um clienteId próprio (sem isso carregarClienteConfig resolve vazio).
  var isDeployUniversal = deployClient === 'universal';
  var semTenantProprio = isDeployUniversal && !userClient;
  var mismatchDeployNormal = !isDeployUniversal && userClient !== deployClient;
  if (semTenantProprio || mismatchDeployNormal) {
    try { sessionStorage.removeItem('eco_session'); } catch(e) {}
    firebase.auth().signOut().catch(function(){});
    var errEl = document.getElementById('lErr');
    if (errEl) {
      errEl.textContent = semTenantProprio
        ? 'Este usuário não está vinculado a nenhum cliente (campo clienteId). Contate o suporte.'
        : 'Este usuário não pertence a este endereço. Acesse a URL correta do seu cliente.';
      errEl.style.color = 'var(--r)';
      errEl.style.display = 'block';
    }
    return;
  }
  document.getElementById('lErr').style.display='none';
  S.role = found.perfil;
  S.currentUser = found;
  try { sessionStorage.setItem('eco_session', JSON.stringify(found)); } catch(e) {}
  // Aplica nova senha pendente definida pelo admin
  if (found._fbNewPass) {
    var unsub = firebase.auth().onAuthStateChanged(function(fbUser) {
      unsub();
      if (!fbUser) return;
      fbUser.updatePassword(found._fbNewPass).then(function(){
        db.collection('usuarios').doc(found.id).update({ _fbNewPass: firebase.firestore.FieldValue.delete() }).catch(function(){});
      }).catch(function(){});
    });
  }
  // Aviso de primeiro acesso: admin deve trocar a senha
  if (found._primeiroAcesso) {
    setTimeout(function(){
      showToast('⚠️ Primeiro acesso! Vá em Usuários e troque a senha do admin agora.', 8000);
    }, 2000);
  }
  document.getElementById('loginScreen').style.display='none';
  document.getElementById('app').style.display='flex';
  // Mobile: troca o painel ativo pra capa JÁ, antes de qualquer carregamento
  // do Firebase, pra não piscar o painel default enquanto os dados chegam.
  if (window.innerWidth <= 768) {
    document.querySelectorAll('.panel').forEach(function(p){ p.classList.remove('active'); });
    var _capaPanelCedo = document.getElementById('panel-capa');
    if (_capaPanelCedo) _capaPanelCedo.classList.add('active');
  }
  setupRole();
  setDate();
  checkMobile();

  // Mostrar tela de carregamento
  document.getElementById('app').style.opacity='0.6';

  function iniciarApp() {
    // Kontar Inventário: carrega e atualiza nav de coleta para usuários atribuídos
    loadInventariosFromFirebase(function(){
      atualizarNavColeta();
      // Se o coletor recarregou na tela inv-coleta, re-renderiza agora que os dados chegaram
      var panelColeta=document.getElementById('panel-inv-coleta');
      if (panelColeta&&panelColeta.classList.contains('active')) renderColeta();
      // Se o usuário está na capa, re-renderiza agora que S.invsCache está populado
      // (os cards de coleta dependem de invsCache para aparecer)
      var panelCapa=document.getElementById('panel-capa');
      if (panelCapa&&panelCapa.classList.contains('active')) renderCapa();
    });
    document.getElementById('app').style.opacity='1';
    // sessionStorage distingue "refresh/atualização" (mesma sessão) de "abrir o
    // app do zero" (sessão nova). Única exceção: eco_forcar_restauracao, setado
    // pelo beforeunload de Inventário pra não perder uma contagem em andamento.
    var lastPage = sessionStorage.getItem('eco_last_page') || localStorage.getItem('eco_forcar_restauracao');
    // O flag é de uso único: consumido aqui em QUALQUER caminho.
    try { localStorage.removeItem('eco_forcar_restauracao'); } catch (e) {}
    // Mobile: restaura a última tela visitada dentro da mesma sessão; abrir o
    // app do zero sempre mostra a capa.
    if (window.innerWidth <= 768) {
      if (lastPage) {
        nav(lastPage, document.querySelector('.sb-item[onclick*="\''+lastPage+'\'"]'));
        return;
      }
      nav('capa', document.getElementById('nav-capa'));
      return;
    }
    var pagesForRole = {
      admin:      ['inv','inv-coleta','inv-avulsa','usuarios'],
      gerencia:   ['inv-coleta','inv-avulsa'],
      supervisor: ['inv-coleta','inv-avulsa'],
      operator:   ['inv-coleta','inv-avulsa'],
      prevencao:  ['inv-coleta','inv-avulsa'],
      coletor:    ['inv-coleta','inv-avulsa']
    };
    var allowed = pagesForRole[S.role] || ['inv-coleta'];
    if (lastPage && allowed.indexOf(lastPage) >= 0) {
      var sbEl = document.querySelector('.sb-item[onclick*="\''+lastPage+'\'"]');
      nav(lastPage, sbEl);
    } else if (S.role==='admin') {
      nav('inv', document.getElementById('nav-inv-gestao'));
    } else {
      nav('inv-coleta', document.getElementById('nav-inv-coleta'));
    }
  }

  // Carregar usuários do Firebase (lista de coletores pra atribuição)
  Promise.all([
    db.collection('usuarios').get().then(function(snap){
      // 'usuarios' é global entre clientes — filtra pelo tenant logado.
      // Kontar: docs sem clienteId não pertencem a nenhum tenant (sempre grave clienteId).
      var myClient = (S.currentUser && S.currentUser.clienteId) || '';
      var list = snap.docs.map(function(d){return d.data();}).filter(function(u){
        return (u.clienteId || '') === myClient;
      });
      S.usersCache = list;
    })
  ]).then(function(){
    carregarClienteConfig(function(){
      setupRole();
      iniciarApp();
    });
  }).catch(function(err){
    console.error('Firebase erro:', err);
    if (!S.usersCache) S.usersCache = [];
    carregarClienteConfig(function(){
      setupRole();
      iniciarApp();
    });
  });
}

function doLogout() {
  firebase.auth().signOut().catch(function(){});
  sessionStorage.removeItem('eco_session');
  sessionStorage.removeItem('eco_last_page');
  localStorage.removeItem('inv_detalhe_state');
  localStorage.removeItem('eco_forcar_restauracao');
  document.getElementById('loginScreen').style.display='flex';
  document.getElementById('app').style.display='none';
  document.querySelectorAll('.sb-item').forEach(function(i){i.classList.remove('active');});
  S = {role:'',currentUser:null,clienteConfig:null,usersCache:[],invsCache:[]};
  document.querySelectorAll('.panel').forEach(function(p){p.classList.remove('active');});
  document.getElementById('panel-capa').classList.add('active');
}

function setupRole() {
  var r = S.role;
  var roleNames = {superadmin:'Super Admin',admin:'Administrador',gerencia:'Gerência de Loja',supervisor:'Supervisor',operator:'Operador',prevencao:'Aux. Prevenção',coletor:'Coletor'};
  var badgeCls = {superadmin:'badge-admin',admin:'badge-admin',gerencia:'badge-admin',supervisor:'badge-sup',operator:'badge-op',prevencao:'badge-prev',coletor:'badge-op'};
  var badgeTxt = {superadmin:'Super Admin',admin:'Administrador',gerencia:'Gerência',supervisor:'Supervisor',operator:'Operador',prevencao:'Prevenção',coletor:'Coletor'};
  document.getElementById('sbName').textContent = S.currentUser ? S.currentUser.nome : '-';
  document.getElementById('sbRole').textContent = roleNames[r]||r;
  var _uNome = S.currentUser ? (S.currentUser.nome||'-') : '-';
  var _uIni = _uNome.trim().split(/\s+/).slice(0,2).map(function(w){return w[0]?w[0].toUpperCase():'';}).join('');
  var _tbUN = document.getElementById('topbar-user-nome');
  var _tbUI = document.getElementById('topbar-user-ini');
  var _tbMR = document.getElementById('topbar-menu-role');
  var _tbMN = document.getElementById('topbar-menu-nome');
  if (_tbUN) _tbUN.textContent = _uNome;
  if (_tbUI) _tbUI.textContent = _uIni||'?';
  var _sbUI = document.getElementById('sb-user-ini');
  if (_sbUI) _sbUI.textContent = _uIni||'?';
  if (_tbMR) _tbMR.textContent = roleNames[r]||r;
  if (_tbMN) _tbMN.textContent = _uNome;
  var _tbMU = document.getElementById('topbar-menu-users');
  var _isAdmRole = (r==='admin');
  if (_tbMU) _tbMU.style.display = _isAdmRole ? 'flex' : 'none';
  var tb = document.getElementById('tbBadge');
  tb.className = 'badge '+(badgeCls[r]||'badge-op');
  tb.textContent = badgeTxt[r]||r;

  var isAdmin = r==='admin';
  var isColetor = r==='coletor';
  show('sb-adm-sec', isAdmin && !isColetor);
  show('nav-users', isAdmin && !isColetor);
  show('nav-integracoes', isAdmin && !isColetor);
  show('sb-inv-sec', _moduloAtivo('inventario'));
  show('nav-inv-gestao', isAdmin && !isColetor && _moduloAtivo('inventario'));
  show('nav-inv-coleta', false);
  show('nav-inv-avulsa', false);
  show('nav-capa', true);
  _atualizarBadgeNotificacoes();
}

// ── Mobile sidebar ──
function toggleUserMenu() {
  var m = document.getElementById('topbar-user-menu');
  if (!m) return;
  // No mobile o menu vira uma folha fixa (ver CSS), mas .topbar tem
  // position:sticky — isso cria um contexto de empilhamento próprio que
  // prende qualquer z-index do menu abaixo da sidebar (.sb, z-index:500),
  // mesmo com !important. Reparentar pra <body> escapa desse contexto.
  // No desktop o menu fica onde está (position:absolute ancorado no topbar).
  if (window.innerWidth <= 768 && m.parentElement !== document.body) {
    document.body.appendChild(m);
  }
  m.style.display = (m.style.display === 'none' || m.style.display === '') ? 'block' : 'none';
}
document.addEventListener('click', function(e) {
  var wrap = document.getElementById('topbar-user-wrap');
  var footer = document.getElementById('sb-user-footer');
  var gear = document.getElementById('btn-config-mobile');
  var m = document.getElementById('topbar-user-menu');
  if (!m) return;
  var dentroDoGatilho = (wrap && wrap.contains(e.target)) || (footer && footer.contains(e.target)) || (gear && gear.contains(e.target));
  var dentroDoMenu = m.contains(e.target);
  if (!dentroDoGatilho && !dentroDoMenu) m.style.display = 'none';
});

function toggleSidebar() {
  var sb = document.querySelector('.sb');
  var overlay = document.getElementById('sb-overlay');
  var isOpen = sb.classList.contains('open');
  if (isOpen) {
    sb.classList.remove('open');
    overlay.classList.remove('show');
    document.body.classList.remove('menu-open');
  } else {
    sb.classList.add('open');
    overlay.classList.add('show');
    document.body.classList.add('menu-open');
  }
}

// Seta de voltar do topbar mobile: some quando a tela atual já é a capa
// (não faz sentido "voltar" pra onde já se está), aparece nas demais telas.
function _atualizarBotaoVoltar() {
  var btn = document.getElementById('btn-hamburger');
  if (!btn) return;
  var paginaAtual = sessionStorage.getItem('eco_last_page');
  btn.style.display = (window.innerWidth <= 768 && paginaAtual !== 'capa') ? 'flex' : 'none';
}

function checkMobile() {
  var isMobile = window.innerWidth <= 768;
  _atualizarBotaoVoltar();
  // On desktop ensure sidebar is visible
  if (!isMobile) {
    var sb = document.querySelector('.sb');
    if (sb) { sb.classList.remove('open'); sb.style.position = ''; }
    var overlay = document.getElementById('sb-overlay');
    if (overlay) overlay.classList.remove('show');
    document.body.classList.remove('menu-open');
  }
}

window.addEventListener('resize', checkMobile);

function show(id, v) {
  var el = document.getElementById(id);
  if (el) el.style.display = v ? '' : 'none';
}

function setDate() {
  var d = new Date();
  document.getElementById('tbDate').textContent = d.toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});
}

// ===========================================
// NAVEGAÇÃO
// ===========================================
var PAGE_TITLES = {
  usuarios:'Cadastro de Usuários',
  integracoes:'Integrações',
  inv:'Inventários','inv-coleta':'Minha Coleta','inv-avulsa':'Coleta Avulsa'
};

function nav(page, el) {
  if (page !== 'capa') document.body.style.removeProperty('overflow');
  _atualizarBadgeNotificacoes();
  sessionStorage.setItem('eco_last_page', page);
  if (page !== 'inv') localStorage.removeItem('inv_detalhe_state');
  // Close sidebar on mobile when navigating
  if (window.innerWidth <= 768) {
    var sb = document.querySelector('.sb');
    var overlay = document.getElementById('sb-overlay');
    if (sb) sb.classList.remove('open');
    if (overlay) overlay.classList.remove('show');
    document.body.classList.remove('menu-open');
  }
  document.querySelectorAll('.panel').forEach(function(p){p.classList.remove('active');});
  document.querySelectorAll('.sb-item').forEach(function(i){i.classList.remove('active');});
  var panel = document.getElementById('panel-'+page);
  if (panel) panel.classList.add('active');
  if (el) el.classList.add('active');
  document.getElementById('pageTitle').textContent = page==='capa'
    ? ((S.clienteConfig && S.clienteConfig.nome) || 'Kontar')
    : (PAGE_TITLES[page]||page);
  _atualizarBotaoVoltar();
  if (page==='capa') {
    renderCapa();
  }
  if (page==='integracoes') {
    renderIntegracoes();
  }
  if (page==='usuarios') {
    loadUsersFromFirebase(function(){ renderUsers(); });
  }
  if (page==='inv') {
    // Captura ANTES do async para não perder o estado em corrida
    var _snapState = localStorage.getItem('inv_detalhe_state');
    loadInventariosFromFirebase(function(){
      if (_snapState) {
        try {
          var _st=JSON.parse(_snapState);
          if (_st&&_st.invId) {
            var _inv=(S.invsCache||[]).find(function(i){ return i.id===_st.invId; });
            if (_inv) {
              abrirDetalheInv(_st.invId, _st.tab||'enderecos');
              return;
            }
          }
        } catch(e){}
      }
      renderInvList();
    });
  }
  if (page==='inv-coleta') {
    loadInventariosFromFirebase(function(){
      renderColeta();
    });
  }
  if (page==='inv-avulsa') {
    loadInventariosFromFirebase(function(){
      renderColetaAvulsa();
    });
  }
}

// ===========================================
// USUÁRIOS
// ===========================================
var editingUserId=null, userFilter='todos';

function abrirModalUser() {
  editingUserId=null;
  document.getElementById('mu-title').textContent='Novo Usuário';
  ['u-nome','u-email','u-senha','u-senha2','u-cargo','u-loja','u-telefone'].forEach(function(id){document.getElementById(id).value='';});
  document.getElementById('u-perfil').value='coletor'; // Kontar: perfil padrão
  document.getElementById('u-setor').value='Geral';
  document.getElementById('mu-err').style.display='none';
  var hint=document.getElementById('senha-hint');
  if (hint) hint.textContent='';
  document.getElementById('modal-user').style.display='flex';
}

function fecharModalUser() {
  document.getElementById('modal-user').style.display='none';
  editingUserId=null;
}

function editarUser(id) {
  var u=getUsers().find(function(x){return x.id===id;});
  if (!u) return;
  editingUserId=id;
  document.getElementById('mu-title').textContent='Editar Usuário';
  document.getElementById('u-nome').value=u.nome;
  document.getElementById('u-email').value=u.email;
  document.getElementById('u-senha').value='';   // nunca exibe hash/senha
  document.getElementById('u-senha2').value='';
  document.getElementById('u-perfil').value=u.perfil;
  document.getElementById('u-setor').value=u.setor||'Geral';
  document.getElementById('u-cargo').value=u.cargo||'';
  document.getElementById('u-loja').value=u.loja||'';
  document.getElementById('u-telefone').value=u.telefone||'';
  document.getElementById('mu-err').style.display='none';
  var hint=document.getElementById('senha-hint');
  if (hint) hint.textContent='(em branco = manter atual)';
  document.getElementById('modal-user').style.display='flex';
}

function salvarUser() {
  var nome=document.getElementById('u-nome').value.trim();
  var email=document.getElementById('u-email').value.trim().toLowerCase();
  var senha=document.getElementById('u-senha').value;
  var senha2=document.getElementById('u-senha2').value;
  var perfil=document.getElementById('u-perfil').value;
  var setor=document.getElementById('u-setor').value;
  var cargo=document.getElementById('u-cargo').value.trim();
  var loja=document.getElementById('u-loja').value.trim();
  var telefone=(document.getElementById('u-telefone').value||'').replace(/\D/g,'');
  var err=document.getElementById('mu-err');
  if (!nome){err.textContent='Informe o nome.';err.style.display='block';return;}
  if (!email||email.indexOf('@')<0){err.textContent='E-mail inválido.';err.style.display='block';return;}
  // Ao editar: senha em branco = manter a existente
  var trocandoSenha = senha.length > 0;
  if (!editingUserId && !trocandoSenha){err.textContent='Informe uma senha.';err.style.display='block';return;}
  if (trocandoSenha && senha.length<6){err.textContent='Senha com mínimo 6 caracteres (exigido pelo Firebase Auth).';err.style.display='block';return;}
  if (trocandoSenha && senha!==senha2){err.textContent='Senhas não coincidem.';err.style.display='block';return;}
  var users=getUsers();
  var dup=users.find(function(u){return u.email.toLowerCase()===email && u.id!==editingUserId;});
  if (dup){err.textContent='E-mail já cadastrado.';err.style.display='block';return;}

  function aplicarSalvar(senhaFinal) {
    if (editingUserId) {
      var existing = users.find(function(u){return u.id===editingUserId;}) || {};
      // Admin nunca perde o perfil 'admin' pelo select (select não tem essa opção)
      var perfilFinal = editingUserId==='admin' ? 'admin' : perfil;
      var updates = {nome:nome, email:email, perfil:perfilFinal, setor:setor, cargo:cargo, loja:loja, telefone:telefone};
      if (senhaFinal) updates.senha = senhaFinal;
      users=users.map(function(u){return u.id===editingUserId?Object.assign({},u,updates):u;});
      // Kontar fix: editando o próprio usuário logado, atualiza S.currentUser e a
      // sessão — senão "Encerrar Inventário" confere a senha contra o hash antigo.
      if (S.currentUser && S.currentUser.id===editingUserId) {
        S.currentUser = Object.assign({}, S.currentUser, updates);
        try { sessionStorage.setItem('eco_session', JSON.stringify(S.currentUser)); } catch(e) {}
      }
    } else {
      // clienteId precisa ser gravado explicitamente: usuarios sem esse campo
      // são tratados como Economico (legado pré multi-tenant) na leitura filtrada.
      var clienteIdNovo = (S.currentUser && S.currentUser.clienteId) || '';
      users.push({id:genId(),nome:nome,email:email,senha:senhaFinal,perfil:perfil,setor:setor,cargo:cargo,loja:loja,telefone:telefone,ativo:true,clienteId:clienteIdNovo});
    }
    saveUsers(users);
    fecharModalUser();
    renderUsers();
  }

  if (!editingUserId) {
    // Usuário novo: antes disso a senha digitada aqui nunca virava um login de
    // verdade (só ia o hash pro Firestore) — o usuário só conseguia entrar
    // depois de rodar a migração em lote, com senha temporária aleatória.
    // Agora cria a conta no Firebase Auth já com a senha que o admin digitou.
    var secondaryAuth = _getSecondaryAuth();
    secondaryAuth.createUserWithEmailAndPassword(email, senha).then(function(){
      secondaryAuth.signOut().catch(function(){});
      hashPassword(senha).then(function(hash){ aplicarSalvar(hash); });
    }).catch(function(e){
      secondaryAuth.signOut().catch(function(){});
      var msg = e.code === 'auth/email-already-in-use' ? 'Este e-mail já tem login no sistema.'
        : e.code === 'auth/weak-password' ? 'Senha muito fraca (mínimo 6 caracteres).'
        : 'Erro ao criar login: '+e.code;
      err.textContent = msg; err.style.color='var(--r)'; err.style.display='block';
    });
  } else if (trocandoSenha) {
    hashPassword(senha).then(function(hash){
      aplicarSalvar(hash);
      var unsub = firebase.auth().onAuthStateChanged(function(fbUser) {
        unsub();
        if (!fbUser) return;
        var isSelf = fbUser.email.toLowerCase() === email.toLowerCase();
        if (isSelf) {
          // Próprio usuário logado — atualiza diretamente
          fbUser.updatePassword(senha).catch(function(e){
            if (e.code === 'auth/requires-recent-login') {
              // Salva pendente no Firestore para aplicar no próximo login
              var uid = editingUserId;
              db.collection('usuarios').doc(uid).update({ _fbNewPass: senha }).catch(function(){});
              showToast('Senha salva. Saia e entre novamente para confirmar.', 6000);
            }
          });
        } else {
          // Outro usuário — salva senha pendente no Firestore
          // No próximo login desse usuário, o app aplica automaticamente
          var uid = editingUserId;
          db.collection('usuarios').doc(uid).update({ _fbNewPass: senha }).catch(function(){});
          showToast('Nova senha salva. O usuário precisará entrar com a senha antiga uma última vez para atualizar.', 7000);
        }
      });
    });
  } else {
    aplicarSalvar(null);
  }
}

function excluirUser(id) {
  if (!confirm('Excluir este usuário?')) return;
  db.collection('usuarios').doc(id).delete().catch(function(){});
  saveUsers(getUsers().filter(function(u){return u.id!==id;}));
  renderUsers();
}

function toggleAtivo(id) {
  saveUsers(getUsers().map(function(u){return u.id===id?Object.assign({},u,{ativo:!u.ativo}):u;}));
  renderUsers();
}

function filtrarUsers(f,btn) {
  userFilter=f;
  document.querySelectorAll('#u-filter-tabs .tab').forEach(function(t){t.classList.remove('on');});
  btn.classList.add('on');
  renderUsers();
}

// Auth secundário: cria contas / valida senha de supervisor sem derrubar a sessão atual.
function _getSecondaryAuth() {
  try { return firebase.app('migracao').auth(); }
  catch(e) { return firebase.initializeApp(window.KONTAR_FIREBASE_CONFIG || {}, 'migracao').auth(); }
}

var UPLABEL={admin:'Administrador',gerencia:'Gerência',supervisor:'Supervisor',operator:'Operador',prevencao:'Prevenção',coletor:'Coletor'};
var UPCLS={admin:'st-info',gerencia:'st-info',supervisor:'st-warn',operator:'st-ok',prevencao:'st-err',coletor:'st-ok'};

function renderUsers() {
  var users=getUsers();
  // Isolamento: gerência vê apenas usuários da sua loja; admin vê todos
  if (S.currentUser && S.currentUser.perfil !== 'admin' && S.currentUser.loja) {
    var myLoja=(S.currentUser.loja||'').trim().toLowerCase();
    users=users.filter(function(u){ return (u.loja||'').trim().toLowerCase()===myLoja; });
  }
  var filtered=userFilter==='todos'?users:users.filter(function(u){return u.perfil===userFilter;});
  var tbody=document.getElementById('u-tbody');
  if (!filtered.length){tbody.innerHTML='<tr class="erow"><td colspan="8">Nenhum usuário neste perfil</td></tr>';return;}
  tbody.innerHTML=filtered.map(function(u){
    var actions = u.id==='admin'
      ? '<button class="btn btn-s btn-sm" onclick="editarUser(\''+u.id+'\')">Editar</button>'
        +'<span style="font-size:11px;color:var(--t3);margin-left:4px">sem exclusão</span>'
      : '<button class="btn btn-s btn-sm" onclick="editarUser(\''+u.id+'\')">Editar</button>'
        +'<button class="btn btn-s btn-sm" onclick="toggleAtivo(\''+u.id+'\')" style="'+(u.ativo?'color:var(--am)':'color:var(--g)')+'">'+(u.ativo?'Inativar':'Ativar')+'</button>'
        +'<button class="btn btn-d btn-sm" onclick="excluirUser(\''+u.id+'\')">Excluir</button>';
    return '<tr><td><strong>'+esc(u.nome)+'</strong></td><td>'+esc(u.email)+'</td>'
      +'<td><span class="st '+(UPCLS[u.perfil]||'st-ok')+'">'+esc(UPLABEL[u.perfil]||u.perfil)+'</span></td>'
      +'<td>'+esc(u.loja||'-')+'</td>'
      +'<td>'+esc(u.setor||'-')+'</td>'
      +'<td style="font-size:12px;color:var(--t3)">'+esc(u.cargo||'-')+'</td>'
      +'<td><span class="st '+(u.ativo?'st-ok':'st-warn')+'">'+(u.ativo?'Ativo':'Inativo')+'</span></td>'
      +'<td style="display:flex;gap:4px;flex-wrap:wrap">'+actions+'</td></tr>';
  }).join('');
  // Kontar: contadores por perfil relevante ao inventário
  var _cnt=function(id,fn){ var e=document.getElementById(id); if(e) e.textContent=users.filter(fn).length; };
  _cnt('u-adm',function(u){return u.perfil==='admin';});
  _cnt('u-sup',function(u){return u.perfil==='supervisor';});
  _cnt('u-col',function(u){return u.perfil==='coletor';});
  _cnt('u-outros',function(u){return ['admin','supervisor','coletor'].indexOf(u.perfil)<0;});
}
function renderIntegracoes() {
  var cid = S.currentUser && S.currentUser.clienteId; if (!cid) return;
  var info = document.getElementById('integ-token-info'), tb = document.getElementById('integ-log');
  db.collection('clientes').doc(cid).get().then(function(d){
    var i = (d.exists && d.data().integracao) || null;
    if (info) info.textContent = i && i.tokenHash ? ('Token ativo, gerado em ' + (i.geradoEm && i.geradoEm.toDate ? i.geradoEm.toDate().toLocaleString('pt-BR') : '—') + ' por ' + (i.geradoPor || '')) : 'Nenhum token gerado ainda.';
  }).catch(function(){ if (info) info.textContent = 'Não foi possível ler a configuração.'; });
  db.collection('clientes').doc(cid).collection('integracao_log').orderBy('em','desc').limit(100).get().then(function(s){
    if (!tb) return;
    tb.innerHTML = s.empty ? '<tr><td colspan="5" style="color:var(--t3)">Nenhuma chamada ainda.</td></tr>' : s.docs.map(function(x){
      var l = x.data(); var em = l.em && l.em.toDate ? l.em.toDate().toLocaleString('pt-BR') : '';
      return '<tr><td>' + esc(em) + '</td><td style="font-family:monospace">' + esc(l.rota) + '</td><td style="color:' + (l.status < 400 ? 'var(--g)' : 'var(--r)') + ';font-weight:700">' + esc(l.status) + '</td><td>' + esc(l.ms) + '</td><td>' + esc(l.resumo || '') + '</td></tr>';
    }).join('');
  }).catch(function(e){ if (tb) tb.innerHTML = '<tr><td colspan="5" style="color:var(--r)">Erro ao ler o log: ' + esc(e.message) + '</td></tr>'; });
}
// Copia texto pro clipboard com feedback no botão (fallback pra navegador sem clipboard API)
function copiarTexto(txt, btn) {
  function ok(){ if (btn) { var t=btn.textContent; btn.textContent='Copiado!'; setTimeout(function(){ btn.textContent=t; },1500); } }
  if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(txt).then(ok).catch(function(){ showToast('Não foi possível copiar', 3000); }); return; }
  try { var ta=document.createElement('textarea'); ta.value=txt; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); ok(); } catch(e) { showToast('Não foi possível copiar', 3000); }
}
function gerarTokenIntegracao() {
  var cid = S.currentUser && S.currentUser.clienteId; if (!cid) return;
  if (!confirm('Gerar um novo token? O token anterior deixa de funcionar na hora.')) return;
  var bytes = new Uint8Array(24); crypto.getRandomValues(bytes);
  var token = Array.from(bytes).map(function(b){ return b.toString(16).padStart(2,'0'); }).join('');
  hashPassword(token).then(function(hash){
    return db.collection('clientes').doc(cid).set({ integracao: { tokenHash: hash, geradoEm: firebase.firestore.FieldValue.serverTimestamp(), geradoPor: S.currentUser.nome || S.currentUser.id } }, { merge: true });
  }).then(function(){
    var el = document.getElementById('integ-token-novo'); if (el) { el.style.display = 'block'; el.innerHTML = '<div style="font-family:inherit;font-weight:700;margin-bottom:8px">Copie agora. Este token não será mostrado de novo.</div>' +
      '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span id="integ-token-valor" style="word-break:break-all;flex:1;min-width:200px">' + esc(token) + '</span>' +
      '<button type="button" id="integ-token-copiar" class="btn btn-p btn-sm" style="font-family:inherit" onclick="_copiarTokenInteg()">&#10697; Copiar token</button></div>'; }
    renderIntegracoes();
  }).catch(function(e){ showToast('Erro ao gerar token: ' + e.message, 6000); });
}
// ===========================================
// UTILS
// ===========================================
function showToast(msg, duration) {
  var t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.style.cssText = 'position:fixed;bottom:28px;left:50%;transform:translateX(-50%);max-width:calc(100vw - 48px);background:#1a7a4a;color:#fff;padding:12px 20px;border-radius:20px;font-size:14px;font-weight:600;box-shadow:0 4px 20px rgba(0,0,0,.2);z-index:999;transition:opacity .3s;white-space:normal;text-align:center;line-height:1.4';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  clearTimeout(t._timer);
  t._timer = setTimeout(function(){ t.style.opacity='0'; }, duration || 3000);
}

function showAlert(id) {
  var el=document.getElementById(id);
  if (!el) return;
  el.style.display='flex';
  setTimeout(function(){el.style.display='none';},3500);
}

// Kontar: o sino de pendências (planos de ação) não existe neste app.
// TODO Kontar: stub — mantido só porque setupRole()/nav() chamam.
function _atualizarBadgeNotificacoes() {}


// =============================================================
// KONTAR INVENTÁRIO — Auditoria: resultado, pendências, folha de conferência
// =============================================================
// ── Auditoria: Resultado do balanço (contado × sistema) ─────────────────────
var _resultadoCache=null;
function _fmtBRL(v){ return (v<0?'-':'')+'R$ '+Math.abs(v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function calcularResultadoBalanco() {
  if (!_invAtivo) return;
  var wrap=document.getElementById('inv-resultado-wrap'); if(!wrap) return;
  wrap.innerHTML='<div style="color:var(--t3);font-size:13px;padding:10px 0">⏳ Calculando...</div>';
  var inv=_invAtivo;
  loadBipagensByInv(inv.id,function(bips){ loadCatalogoByInv(inv.id,function(cat){
    if (!cat.total){ wrap.innerHTML='<div style="font-size:13px;color:var(--t3);padding:10px 0">Importe o catálogo com a coluna de estoque do sistema pra comparar.</div>'; return; }
    var temEstoque=Object.keys(cat.porCodigo).some(function(k){ return cat.porCodigo[k].q!=null; });
    if (!temEstoque){ wrap.innerHTML='<div style="font-size:13px;color:#b38600;padding:10px 0">O catálogo importado não tem a coluna Estoque do sistema. Reenvie o arquivo marcando essa coluna.</div>'; return; }
    var r=InvCore.calcularResultado(cat,bips,inv.resolucoes||{});
    _resultadoCache={r:r,invNome:inv.nome};
    _renderResultadoBalanco();
  }); },true);
}
function _renderResultadoBalanco() {
  var wrap=document.getElementById('inv-resultado-wrap'); if(!wrap||!_resultadoCache) return;
  var r=_resultadoCache.r, t=r.totais;
  var soDiv=!!(document.getElementById('res-so-div')||{}).checked;
  var busca=((document.getElementById('res-busca')||{}).value||'').toLowerCase();
  var lim=window._resLimite||300;
  // Filtro por endereço: mostra só os produtos contados nele. Qtd Contado é a do endereço; Sistema, Divergência e R$ são do produto na loja inteira (o sistema não tem estoque por endereço).
  var endSel=((document.getElementById('res-endereco')||{}).value)||'';
  var endsDisp=Object.keys(r.porEnd||{}).filter(function(e){ return e&&e!=='_CORRECAO'&&e!=='_AVULSO'; }).sort(function(a,b){ return String(a).localeCompare(String(b),'pt-BR',{numeric:true}); });
  var base=r.linhas;
  if (endSel && r.porEnd && r.porEnd[endSel]) {
    var mapa=r.porEnd[endSel];
    base=r.linhas.filter(function(l){ return mapa[l.key]!=null; }).map(function(l){ var q=mapa[l.key]; return Object.assign({}, l, {contado:q, contadoTotal:l.contado, valorContado:(l.custo!=null?q*l.custo:null)}); });
    base.sort(function(a,b){ return (b.valorContado||0)-(a.valorContado||0); });
  }
  // Só divergentes = produto CONTADO cuja contagem difere do sistema (ou NC). Quem ainda não foi
  // bipado não é divergência, é pendência — mora em 'Itens Não Coletados'.
  var linhas=base.filter(function(l){ if(soDiv&&!l.nc&&(!l.dif||!l.contado)) return false; if(busca&&(l.codigo+' '+l.ean+' '+l.desc).toLowerCase().indexOf(busca)<0) return false; return true; });
  var srt=window._resSort;
  if (srt&&srt.col) {
    var txt=(srt.col==='codigo'||srt.col==='ean'||srt.col==='desc');
    linhas=linhas.slice().sort(function(a,b){
      var x=a[srt.col], y=b[srt.col];
      if (txt) return String(x||'').localeCompare(String(y||''),'pt-BR',{numeric:true})*srt.dir;
      if (x==null&&y==null) return 0; if (x==null) return 1; if (y==null) return -1; // vazios sempre no fim
      return (x-y)*srt.dir;
    });
  }
  var th=function(label,col,right){ var on=srt&&srt.col===col; return '<th onclick="_resOrdenar(\''+col+'\')" title="Clique pra ordenar" style="cursor:pointer;user-select:none;white-space:nowrap'+(right?';text-align:right':'')+(on?';color:var(--t)':'')+'">'+label+(on?(srt.dir<0?' ▼':' ▲'):'')+'</th>'; };
  var tile=function(lbl,val,cor){ return '<div style="flex:1;min-width:150px;background:var(--gray);border-radius:10px;padding:10px 12px"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--t3)">'+lbl+'</div><div style="font-size:18px;font-weight:800;color:'+(cor||'var(--t)')+'">'+val+'</div></div>'; };
  var liquido=t.sobraVal-t.faltaVal;
  var difUn=(t.contadoUn||0)-(t.sistemaUn||0), difVal=(t.contadoVal||0)-(t.sistemaVal||0);
  var sub=function(txt){ return '<div style="font-size:10px;font-weight:500;color:var(--t3);margin-top:3px;line-height:1.3">'+txt+'</div>'; };
  var val=function(v){ return '<div style="font-size:13px;font-weight:700;margin-top:2px;white-space:nowrap">'+_fmtBRL(v)+'</div>'; };
  var rows=linhas.slice(0,lim).map(function(l){
    var cor=l.dif>0?'#1a5c34':l.dif<0?'#c0392b':'var(--t3)';
    return '<tr'+(l.nc?' style="background:#fff8f4"':'')+'><td style="font-family:monospace;font-size:12px">'+esc(l.codigo||'—')+'</td><td style="font-family:monospace;font-size:11px">'+esc(l.ean||'')+'</td><td style="font-size:12px">'+esc(l.desc)+(l.nc?' <b style="color:#e65100;font-size:10px">NC</b>':'')+(l.bips>1?' <span title="Produto bipado '+l.bips+' vezes'+(l.ends>1?' em '+l.ends+' endereços':'')+'" style="display:inline-block;padding:1px 7px;border-radius:9px;font-size:10px;font-weight:700;background:#fff8e1;color:#b38600;margin-left:4px;vertical-align:middle">×'+l.bips+' bip'+(l.ends>1?' · '+l.ends+' end.':'')+'</span>':'')+'</td>'+
      '<td style="text-align:right;white-space:nowrap">'+(l.sistema==null?'—':l.sistema)+'</td><td style="text-align:right;font-weight:700;white-space:nowrap">'+l.contado+(l.contadoTotal!=null&&l.contadoTotal!==l.contado?'<div style="font-size:10px;font-weight:600;color:var(--t3)">de '+l.contadoTotal+' no total</div>':'')+'</td><td style="text-align:right;font-weight:800;white-space:nowrap;color:'+cor+'">'+(l.dif==null?'—':(l.dif>0?'+':'')+l.dif)+'</td>'+
      '<td style="text-align:right;white-space:nowrap;color:var(--t2)">'+(l.valorSistema==null?'—':_fmtBRL(l.valorSistema))+'</td><td style="text-align:right;font-weight:700;white-space:nowrap">'+(l.valorContado==null?'—':_fmtBRL(l.valorContado))+'</td><td style="text-align:right;white-space:nowrap;color:'+cor+'">'+(l.valor==null?'—':_fmtBRL(l.valor))+'</td></tr>';
  }).join('');
  window._resPrintCache={linhas:linhas, sub:(_resultadoCache.invNome||'')+(endSel?' · Endereço '+endSel:' · Todos os endereços')+(soDiv?' · só divergentes':'')+(busca?' · busca "'+busca+'"':''), resumo:endSel?[]:[['Custo sistema',_fmtBRL(t.sistemaVal||0)],['Custo contado',_fmtBRL(t.contadoVal||0)],['Diferença',_fmtBRL(difVal)]]};
  var tilesEnd='';
  if (endSel) { var unEnd=base.reduce(function(a,l){ return a+(l.contado||0); },0), valEnd=base.reduce(function(a,l){ return a+(l.valorContado||0); },0);
    var divEnd=base.filter(function(l){ return l.dif; }).length;
    tilesEnd=tile('Endereço',esc(endSel))+tile('Produtos no endereço',base.length.toLocaleString('pt-BR'))+tile('Unidades contadas aqui',(+unEnd.toFixed(3)).toLocaleString('pt-BR'))+tile('Custo contado aqui',_fmtBRL(valEnd),'#1a5c34')+tile('Divergentes (loja)',divEnd.toLocaleString('pt-BR'),'#b38600'); }
  wrap.innerHTML=
    (endSel?'<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">'+tilesEnd+'</div>':'<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">'+
      tile('Custo sistema',_fmtBRL(t.sistemaVal||0)+sub('estoque do sistema × custo'),'var(--t2)')+
      tile('Custo contado',_fmtBRL(t.contadoVal||0)+sub('quantidade contada × custo'),'#1a5c34')+
      tile('Diferença',_fmtBRL(difVal)+sub('contado − sistema'),difVal<0?'#c0392b':'#1a5c34')+
    '</div>')+
    '<div style="font-size:11px;color:var(--t3);margin-bottom:8px">'+(t.coletados||0).toLocaleString('pt-BR')+' de '+t.itens.toLocaleString('pt-BR')+' produtos com bipagem'+(t.naoColetados?' · '+t.naoColetados.toLocaleString('pt-BR')+' com estoque no sistema ainda sem contagem ('+_fmtBRL(t.naoColetadosVal)+')':'')+(t.semCusto?' · '+t.semCusto+' sem custo no catálogo, fora dos R$':'')+'</div>'+
    '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:8px">'+
      '<select id="res-endereco" onchange="window._resLimite=300;_renderResultadoBalanco()" style="padding:7px 10px;border:1.5px solid var(--gray2);border-radius:8px;font-size:12px;font-weight:600;font-family:inherit;background:#fff"><option value="">Todos os endereços</option>'+endsDisp.map(function(e){ return '<option value="'+esc(e)+'"'+(e===endSel?' selected':'')+'>Endereço '+esc(e)+'</option>'; }).join('')+'</select>'+
      '<label style="font-size:12px;font-weight:600;display:flex;align-items:center;gap:4px"><input type="checkbox" id="res-so-div" '+(soDiv?'checked':'')+' onchange="_renderResultadoBalanco()" title="Contados com quantidade diferente do sistema (não coletados ficam de fora)"> Só divergentes</label>'+
      '<input id="res-busca" placeholder="Buscar código ou descrição" value="'+esc(busca)+'" oninput="window._resLimite=300;_renderResultadoBalanco()" style="flex:1;min-width:160px;padding:7px 10px;border:1.5px solid var(--gray2);border-radius:8px;font-size:12px;font-family:inherit">'+
      '<span style="font-size:11px;color:var(--t3)">'+linhas.length.toLocaleString('pt-BR')+' linhas</span>'+
      '<button class="btn btn-s btn-sm" onclick="_imprimirResultadoPdf()">📄 PDF</button>'+
      '<button class="btn btn-s btn-sm" onclick="_exportarResultadoCsv()">⬇ CSV</button>'+
    '</div>'+
    '<div style="overflow-x:auto;max-height:70vh;overflow-y:auto"><table style="min-width:960px"><thead><tr>'+th('Código','codigo')+th('EAN','ean')+th('Descrição','desc')+th('Qtd Sistema','sistema',1)+th('Qtd Contado','contado',1)+th('Divergência','dif',1)+th('Custo Sistema','valorSistema',1)+th('Custo Contado','valorContado',1)+th('Dif. R$','valor',1)+'</tr></thead><tbody>'+
      (rows||'<tr><td colspan="9" style="color:var(--t3)">Nada a mostrar.</td></tr>')+
      (linhas.length>lim?'<tr><td colspan="9" style="text-align:center;padding:10px"><button class="btn btn-s btn-sm" onclick="window._resLimite=(window._resLimite||300)+1000;_renderResultadoBalanco()">Mostrar mais ('+(linhas.length-lim).toLocaleString('pt-BR')+' restantes)</button></td></tr>':'')+
    '</tbody></table></div>'+
    _htmlEnderecosRecontar(r);
}
function _htmlEnderecosRecontar(r) {
  var ends=r.enderecos.filter(function(e){ return e.itensDivergentes>0; }).slice(0,15);
  if (!ends.length) return '<div style="margin-top:14px;font-size:13px;color:#1a5c34;font-weight:700">✓ Nenhum endereço com divergência estimada.</div>';
  var isAberto=_invAtivo&&_invAtivo.status==='aberto';
  var rows=ends.map(function(e){
    var slot=((_invAtivo&&_invAtivo.fila)||{})[e.endereco]||{};
    var safe=e.endereco.replace(/'/g,"\\'");
    var btn=isAberto&&slot.concluido?'<button class="btn btn-s btn-sm" style="color:var(--r);border-color:var(--r)" onclick="reabrirEndereco(\''+_invAtivo.id+'\',\''+safe+'\')">↩ Reabrir pra recontar</button>':(slot.concluido?'':'<span style="font-size:11px;color:var(--t3)">em aberto</span>');
    return '<tr><td style="font-family:monospace;font-weight:700">'+e.endereco+'</td><td style="font-size:12px">'+(_slotNomes(slot,', ')||'—')+'</td><td style="text-align:right">'+e.itensDivergentes+'</td><td style="text-align:right">'+(+e.unidades.toFixed(1)).toLocaleString('pt-BR')+'</td><td style="text-align:right;font-weight:700">'+_fmtBRL(e.score)+'</td><td>'+btn+'</td></tr>';
  }).join('');
  return '<div style="margin-top:18px;font-size:14px;font-weight:700;margin-bottom:4px">Endereços pra recontar (estimativa)</div>'+
    '<div style="font-size:11px;color:var(--t3);margin-bottom:8px">A divergência de cada produto é distribuída entre os endereços onde ele foi bipado, na proporção do que foi contado em cada um. Quanto maior o valor, mais vale recontar.</div>'+
    '<div style="overflow-x:auto"><table><thead><tr><th>Endereço</th><th>Coletor</th><th style="text-align:right">Itens diverg.</th><th style="text-align:right">Unid. estim.</th><th style="text-align:right">Impacto</th><th></th></tr></thead><tbody>'+rows+'</tbody></table></div>';
}
// Impressão A4 isolada (iframe) com logo — usada por Resultado e Monitor. cols=[{t:'Título',r:true}], rows=[[celula,...]] já escapadas.
function _imprimirTabelaA4(titulo, sub, resumo, cols, rows, frameId) {
  var logoUrl=new URL('logo-light.png',location.href).href;
  var agora=new Date(), dh=agora.toLocaleDateString('pt-BR')+' '+String(agora.getHours()).padStart(2,'0')+':'+String(agora.getMinutes()).padStart(2,'0');
  var esc=function(v){ return String(v==null?'':v).replace(/[&<>"]/g,function(ch){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]; }); };
  var thead='<tr>'+cols.map(function(c){ return '<th'+(c.r?' class="r"':'')+'>'+esc(c.t)+'</th>'; }).join('')+'</tr>';
  var tbody=rows.map(function(r){ return '<tr>'+r.map(function(v,i){ return '<td class="'+(cols[i].r?'r ':'')+(cols[i].m?'m':'')+'">'+v+'</td>'; }).join('')+'</tr>'; }).join('');
  var tiles=(resumo||[]).map(function(x){ return '<div class="tile"><div class="lbl">'+esc(x[0])+'</div><div class="val">'+esc(x[1])+'</div></div>'; }).join('');
  var css='@page{size:A4 landscape;margin:10mm}body{font-family:"Manrope",system-ui,sans-serif;color:#111;margin:0;font-size:10px}'+
    'header{display:flex;align-items:center;gap:14px;border-bottom:3px solid #F97316;padding-bottom:8px;margin-bottom:8px}header img{height:40px}header .t{flex:1}.h1{font-size:18px;font-weight:800}.h2{font-size:11px;color:#555}'+
    '.tiles{display:flex;gap:8px;margin-bottom:10px}.tile{flex:1;background:#f5f5f5;border-radius:8px;padding:6px 10px}.tile .lbl{font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:#777}.tile .val{font-size:15px;font-weight:800}'+
    'table{width:100%;border-collapse:collapse}th{background:#ffe7d6;font-size:9px;text-transform:uppercase;letter-spacing:.4px;text-align:left;padding:4px;border-bottom:1.5px solid #f3b184}th.r{text-align:right}'+
    'td{padding:3px 4px;border-bottom:1px solid #ddd;vertical-align:middle}tr:nth-child(even) td{background:#fafafa}td.r{text-align:right;white-space:nowrap}td.m{font-family:monospace;font-size:9.5px;white-space:nowrap}thead{display:table-header-group}tr{page-break-inside:avoid}';
  var html='<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>'+esc(titulo)+'</title>'+
    '<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;800&display=swap" rel="stylesheet"><style>'+css+'</style></head><body>'+
    '<header><img src="'+logoUrl+'" alt=""><div class="t"><div class="h1">'+esc(titulo)+'</div><div class="h2">'+esc(sub)+' · gerado em '+dh+'</div></div></header>'+
    (tiles?'<div class="tiles">'+tiles+'</div>':'')+
    '<table><thead>'+thead+'</thead><tbody>'+tbody+'</tbody></table></body></html>';
  var antigo=document.getElementById(frameId); if(antigo) antigo.parentNode.removeChild(antigo);
  var frame=document.createElement('iframe'); frame.id=frameId; frame.setAttribute('aria-hidden','true');
  frame.style.cssText='position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none';
  document.body.appendChild(frame);
  var doc=frame.contentWindow.document; doc.open(); doc.write(html); doc.close();
  var imprimiu=false;
  var disparar=function(){ if(imprimiu) return; imprimiu=true; try{ frame.contentWindow.focus(); frame.contentWindow.print(); }catch(e){ showToast('Não foi possível abrir a impressão: '+e.message); } };
  var img=doc.querySelector('header img');
  if (img&&!img.complete){ img.onload=img.onerror=function(){ setTimeout(disparar,150); }; } else setTimeout(disparar,150);
  setTimeout(disparar,2500);
}
var _escHtml=function(v){ return String(v==null?'':v).replace(/[&<>"]/g,function(ch){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]; }); };
// PDF do Resultado: mesmas linhas, filtro, endereço e ordenação da tela.
function _imprimirResultadoPdf(){
  var c=window._resPrintCache; if(!c) return;
  var cols=[{t:'Código',m:1},{t:'EAN',m:1},{t:'Descrição'},{t:'Qtd Sistema',r:1},{t:'Qtd Contado',r:1},{t:'Divergência',r:1},{t:'Custo Sistema',r:1},{t:'Custo Contado',r:1},{t:'Dif. R$',r:1}];
  var rows=c.linhas.map(function(l){ return [_escHtml(l.codigo||'—'),_escHtml(l.ean||''),_escHtml(l.desc)+(l.nc?' <b>NC</b>':''),l.sistema==null?'—':l.sistema,l.contado+(l.contadoTotal!=null&&l.contadoTotal!==l.contado?' <small>(de '+l.contadoTotal+')</small>':''),l.dif==null?'—':(l.dif>0?'+':'')+l.dif,l.valorSistema==null?'—':_fmtBRL(l.valorSistema),l.valorContado==null?'—':_fmtBRL(l.valorContado),l.valor==null?'—':_fmtBRL(l.valor)]; });
  _imprimirTabelaA4('Resultado: Contado × Sistema', c.sub, c.resumo, cols, rows, 'res-print-frame');
}
// PDF do Monitor: mesmas linhas, busca e ordenação da tela.
function _imprimirResumoPdf(){
  var c=window._resumoPrintCache; if(!c) return;
  var cols=[{t:'Código',m:1},{t:'EAN',m:1},{t:'Descrição'},{t:'Qtd total',r:1},{t:'Bipagens',r:1},{t:'Endereços (qtd)'},{t:'Coletores'},{t:'Custo unit.',r:1},{t:'Custo contado',r:1},{t:'Preço venda',r:1},{t:'Venda contada',r:1}];
  var rows=c.linhas.map(function(l){ return [_escHtml(l.codigo||'—'),_escHtml(l.ean||''),_escHtml(l.desc)+(l.nc?' <b>NC</b>':'')+(l.corr?' <small>corr. '+(l.corr>0?'+':'')+l.corr+'</small>':''),(+l.qty.toFixed(3)).toLocaleString('pt-BR'),l.bips,_escHtml(l.endsTxt||'—'),_escHtml(l.colsTxt||'—'),l.custo==null?'—':_fmtBRL(l.custo),l.valor==null?'—':_fmtBRL(l.valor),l.venda==null?'—':_fmtBRL(l.venda),l.valorVenda==null?'—':_fmtBRL(l.valorVenda)]; });
  _imprimirTabelaA4('Monitor — itens contados', c.sub, c.resumo, cols, rows, 'resumo-print-frame');
}
// Clique no cabeçalho: 1º clique maior→menor, 2º menor→maior.
function _resOrdenar(col){
  var s=window._resSort;
  window._resSort=(s&&s.col===col)?{col:col,dir:-s.dir}:{col:col,dir:-1};
  window._resLimite=300; _renderResultadoBalanco();
}
function _exportarResultadoCsv() {
  if (!_resultadoCache) return;
  var lines=['CODIGO;EAN;DESCRICAO;UN;QTD_SISTEMA;QTD_CONTADO;DIVERGENCIA;CUSTO_UNIT;CUSTO_SISTEMA;CUSTO_CONTADO;DIF_RS;NAO_CADASTRADO;BIPAGENS;ENDERECOS'];
  var f=function(v){ return v==null?'':String(v).replace('.',','); };
  var endSel=((document.getElementById('res-endereco')||{}).value)||'', mapa=endSel&&_resultadoCache.r.porEnd?_resultadoCache.r.porEnd[endSel]:null;
  var fonte=mapa?_resultadoCache.r.linhas.filter(function(l){ return mapa[l.key]!=null; }).map(function(l){ var q=mapa[l.key]; return Object.assign({}, l, {contado:q, contadoTotal:l.contado, valorContado:(l.custo!=null?q*l.custo:null)}); }):_resultadoCache.r.linhas;
  if (mapa) lines[0]='ENDERECO;'+lines[0].replace('QTD_CONTADO;','QTD_CONTADO_ENDERECO;QTD_CONTADO_TOTAL;');
  fonte.forEach(function(l){ lines.push([(mapa?endSel+';':'')+l.codigo,l.ean,l.desc.replace(/;/g,' '),l.un,f(l.sistema),f(l.contado)+(mapa?';'+f(l.contadoTotal):''),f(l.dif),f(l.custo),f(l.valorSistema==null?null:+l.valorSistema.toFixed(2)),f(l.valorContado==null?null:+l.valorContado.toFixed(2)),f(l.valor==null?null:+l.valor.toFixed(2)),l.nc?'SIM':'',l.bips||0,l.ends||0].join(';')); });
  var blob=new Blob(['\ufeff'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'});
  var url=URL.createObjectURL(blob); var a=document.createElement('a'); a.href=url;
  a.download=(_resultadoCache.invNome||'inventario').replace(/[^a-z0-9]/gi,'_')+'_resultado.csv'; a.click(); setTimeout(function(){ URL.revokeObjectURL(url); },2000);
}

// ── Auditoria: Pendências pra resolver antes de exportar (NC + sem código) ──
function mostrarPendenciasBalanco() {
  if (!_invAtivo) return;
  var wrap=document.getElementById('inv-pendencias-wrap'); if(!wrap) return;
  wrap.innerHTML='<div style="color:var(--t3);font-size:13px;padding:10px 0">⏳ Carregando...</div>';
  loadBipagensByInv(_invAtivo.id,function(bips){
    var nc={}, sem=[];
    bips.forEach(function(b){
      if (b.semEAN){ sem.push(b); return; }
      if (!b.naoCadastrado) return;
      var k=b.ean; if(!nc[k]) nc[k]={ean:k,qty:0,n:0,ends:{},coletores:{}};
      nc[k].qty+=Number(b.qty)||0; nc[k].n++; nc[k].ends[b.endereco]=1; nc[k].coletores[b.coletorId||'?']=1;
    });
    var ncList=Object.values(nc).sort(function(a,b){ return b.qty-a.qty; });
    window._pendenciasCache={nc:ncList,sem:sem,invNome:_invAtivo.nome};
    var ncRows=ncList.map(function(x){ return '<tr><td style="font-family:monospace;font-size:12px">'+esc(x.ean)+'</td><td style="text-align:right;font-weight:700">'+x.qty+'</td><td style="text-align:right">'+x.n+'</td><td style="font-size:11px">'+esc(Object.keys(x.ends).join(', '))+'</td><td style="font-size:11px">'+esc(Object.keys(x.coletores).join(', '))+'</td></tr>'; }).join('');
    var semRows=sem.sort(function(a,b){ return String(a.endereco).localeCompare(String(b.endereco),undefined,{numeric:true})||(a.seq||0)-(b.seq||0); }).map(function(b){ return '<tr><td style="font-family:monospace">'+esc(b.endereco)+'</td><td>'+esc(b.desc||'')+'</td><td style="text-align:right;font-weight:700">'+b.qty+'</td><td style="font-size:11px">'+esc(b.coletorId||'')+'</td></tr>'; }).join('');
    if (!ncList.length&&!sem.length){ wrap.innerHTML='<div style="padding:12px;background:#f0faf5;border-radius:10px;color:#1a5c34;font-weight:700;font-size:13px">✓ Nenhuma pendência: tudo que foi bipado está no catálogo.</div>'; return; }
    wrap.innerHTML=
      '<div style="font-size:12px;color:var(--t2);margin-bottom:10px">Esses itens <b>não entram</b> na importação do ERP até serem cadastrados ou corrigidos.</div>'+
      '<div style="font-weight:700;font-size:13px;margin-bottom:4px">Códigos não cadastrados ('+ncList.length+')</div>'+
      (ncRows?'<div style="overflow-x:auto;max-height:300px;overflow-y:auto;margin-bottom:12px"><table><thead><tr><th>Código lido</th><th style="text-align:right">Qtd</th><th style="text-align:right">Bipagens</th><th>Endereços</th><th>Coletores</th></tr></thead><tbody>'+ncRows+'</tbody></table></div>':'<div style="font-size:12px;color:var(--t3);margin-bottom:12px">Nenhum.</div>')+
      '<div style="font-weight:700;font-size:13px;margin-bottom:4px">Sem código, registrados por descrição ('+sem.length+')</div>'+
      (semRows?'<div style="overflow-x:auto;max-height:300px;overflow-y:auto;margin-bottom:12px"><table><thead><tr><th>Endereço</th><th>Descrição digitada</th><th style="text-align:right">Qtd</th><th>Coletor</th></tr></thead><tbody>'+semRows+'</tbody></table></div>':'<div style="font-size:12px;color:var(--t3);margin-bottom:12px">Nenhum.</div>')+
      '<button class="btn btn-s btn-sm" onclick="_exportarPendenciasCsv()">⬇ CSV das pendências</button>';
  });
}
function _exportarPendenciasCsv() {
  var c=window._pendenciasCache; if(!c) return;
  var lines=['TIPO;CODIGO_LIDO;DESCRICAO;QTD;BIPAGENS;ENDERECOS;COLETORES'];
  c.nc.forEach(function(x){ lines.push(['NAO_CADASTRADO',x.ean,'',x.qty,x.n,Object.keys(x.ends).join(' '),Object.keys(x.coletores).join(' ')].join(';')); });
  c.sem.forEach(function(b){ lines.push(['SEM_CODIGO','',(b.desc||'').replace(/;/g,' '),b.qty,1,b.endereco,b.coletorId||''].join(';')); });
  var blob=new Blob(['\ufeff'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'});
  var url=URL.createObjectURL(blob); var a=document.createElement('a'); a.href=url;
  a.download=(c.invNome||'inventario').replace(/[^a-z0-9]/gi,'_')+'_pendencias.csv'; a.click(); setTimeout(function(){ URL.revokeObjectURL(url); },2000);
}

// ── Folha de conferência por endereço (A4, ordem de bipagem, pra reconferir no papel) ──
// Documento isolado num iframe com CSS próprio e logo, mesmo padrão de imprimirQrLojas.
function _popularSelectFolhaConf() {
  var sel=document.getElementById('folha-conf-end'); if(!sel||!_invAtivo) return;
  var ends=_invAtivo.enderecos||[];
  sel.innerHTML='<option value="">Todos os endereços com bipagem</option>'+ends.map(function(e){ return '<option value="'+esc(e)+'">'+esc(e)+'</option>'; }).join('');
}
function imprimirFolhaConferencia() {
  if (!_invAtivo) return;
  var sel=document.getElementById('folha-conf-end'); var soEnd=sel?sel.value:'';
  var inv=_invAtivo;
  loadBipagensByInv(inv.id,function(bips){ loadCatalogoByInv(inv.id,function(cat){
    var resolucoes=inv.resolucoes||{};
    bips=bips.filter(function(b){ if(b.modo==='correcao'||b.endereco==='_AVULSO'||b.endereco==='_CORRECAO') return false; var r=resolucoes[b.endereco]; return !r||(b.rodada||1)===r.rodada; });
    if (soEnd) bips=bips.filter(function(b){ return b.endereco===soEnd; });
    if (!bips.length){ showToast('Nenhuma bipagem'+(soEnd?' no endereço '+soEnd:'')+'.'); return; }
    var porEnd={}; bips.forEach(function(b){ (porEnd[b.endereco]=porEnd[b.endereco]||[]).push(b); });
    var ends=Object.keys(porEnd).sort(function(a,b){ return a.localeCompare(b,undefined,{numeric:true}); });
    var esc=function(t){ return String(t==null?'':t).replace(/&/g,'&amp;').replace(/</g,'&lt;'); };
    var logoUrl=new URL('logo-light.png',location.href).href;
    var hoje=new Date().toLocaleDateString('pt-BR');
    var folhas=ends.map(function(end){
      var lista=porEnd[end].slice().sort(function(a,b){ return (a.seq||0)-(b.seq||0); });
      var slot=(inv.fila||{})[end]||{};
      var coletores={}; lista.forEach(function(b){ if(b.coletorId) coletores[b.coletorId]=b.coletorNome||b.coletorId; });
      var colStr=Object.keys(coletores).map(function(k){ return k+(coletores[k]&&coletores[k]!==k?' - '+coletores[k]:''); }).join(', ')||'—';
      var totalUn=lista.reduce(function(a,b){ return a+(Number(b.qty)||0); },0);
      var rows=lista.map(function(b){
        var p=_catItemDe(cat,b.codigo||b.ean)||{};
        var hora=b.ts&&b.ts.seconds?new Date(b.ts.seconds*1000).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):'';
        return '<tr><td class="c">'+esc(b.seq)+'</td><td class="m">'+esc(b.codigo||'')+'</td><td class="m">'+esc(p.ean||b.ean)+'</td><td>'+esc(p.desc||b.desc||'')+(b.naoCadastrado?' <b class="nc">NC</b>':'')+'</td><td class="c">'+esc(p.un||'')+'</td><td class="c q">'+esc(b.qty)+'</td><td class="c">'+hora+'</td><td class="box"></td><td class="box ok"></td></tr>';
      }).join('');
      return '<section class="folha">'+
        '<header><img src="'+logoUrl+'" alt=""><div class="t"><div class="h1">Folha de Conferência</div><div class="h2">'+esc(inv.nome)+'</div></div><div class="end"><div class="lbl">Endereço</div><div class="num">'+esc(end)+'</div></div></header>'+
        '<div class="meta"><span><b>Setor:</b> '+esc(slot.setor||'—')+'</span><span><b>Coletor:</b> '+esc(colStr)+'</span><span><b>Itens:</b> '+lista.length+'</span><span><b>Unidades bipadas:</b> '+totalUn+'</span><span><b>Impresso:</b> '+hoje+'</span></div>'+
        '<table><thead><tr><th>Seq</th><th>Código</th><th>Barras</th><th>Descrição</th><th>Un</th><th>Bipado</th><th>Hora</th><th>Conferido</th><th>✓</th></tr></thead><tbody>'+rows+'</tbody></table>'+
        '<footer><div class="ass"><div class="linha"></div>Conferente</div><div class="ass"><div class="linha"></div>Responsável</div><div class="obs"><b>Obs.:</b></div></footer>'+
      '</section>';
    }).join('');
    var css='@page{size:A4;margin:12mm}*{box-sizing:border-box}body{margin:0;font-family:"Manrope",Arial,sans-serif;color:#111;font-size:11px}'+
      '.folha{page-break-after:always}.folha:last-child{page-break-after:auto}'+
      'header{display:flex;align-items:center;gap:14px;border-bottom:3px solid #F97316;padding-bottom:8px;margin-bottom:8px}header img{height:40px}header .t{flex:1}.h1{font-size:18px;font-weight:800}.h2{font-size:12px;color:#555}'+
      '.end{text-align:right}.end .lbl{font-size:10px;text-transform:uppercase;letter-spacing:.6px;color:#777}.end .num{font-size:30px;font-weight:800;font-family:monospace}'+
      '.meta{display:flex;flex-wrap:wrap;gap:6px 18px;margin-bottom:8px;font-size:11px}'+
      'table{width:100%;border-collapse:collapse}th{background:#ffe7d6;font-size:10px;text-transform:uppercase;letter-spacing:.4px;text-align:left;padding:5px 4px;border-bottom:1.5px solid #f3b184}'+
      'td{padding:5px 4px;border-bottom:1px solid #ddd;vertical-align:middle}tr:nth-child(even) td{background:#fafafa}td.c{text-align:center}td.m{font-family:monospace;font-size:10.5px;white-space:nowrap}td.q{font-weight:800;font-size:13px}'+
      'td.box{width:64px;border:1.5px solid #999;height:24px}td.box.ok{width:26px}.nc{color:#e65100;font-size:9px}'+
      'footer{display:flex;gap:24px;margin-top:26px;align-items:flex-end}.ass{width:180px;text-align:center;font-size:10px;color:#555}.ass .linha{border-top:1px solid #333;margin-bottom:4px}.obs{flex:1;border:1px solid #ccc;min-height:40px;padding:4px;font-size:10px}';
    var html='<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Folha de Conferência</title>'+
      '<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;800&display=swap" rel="stylesheet">'+
      '<style>'+css+'</style></head><body>'+folhas+'</body></html>';
    var antigo=document.getElementById('conf-print-frame'); if(antigo) antigo.parentNode.removeChild(antigo);
    var frame=document.createElement('iframe'); frame.id='conf-print-frame'; frame.setAttribute('aria-hidden','true');
    frame.style.cssText='position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none';
    document.body.appendChild(frame);
    var doc=frame.contentWindow.document; doc.open(); doc.write(html); doc.close();
    var imprimiu=false;
    var disparar=function(){ if(imprimiu) return; imprimiu=true; try{ frame.contentWindow.focus(); frame.contentWindow.print(); }catch(e){ showToast('Não foi possível abrir a impressão: '+e.message); } };
    var img=doc.querySelector('header img');
    if (img&&!img.complete){ img.onload=img.onerror=function(){ setTimeout(disparar,150); }; } else setTimeout(disparar,150);
    setTimeout(disparar,2500);
  }); });
}

// Folha A4 por loja pra colar na entrada (recebimento / entrada de
// funcionários). lojas = array de IDs, ou null pra todas as lojas com
// fornecedor cadastrado. Renderiza num iframe oculto com CSS próprio —
// isolado do CSS do app (a versão anterior via @media print no style.css
// imprimia a tela inteira quando o navegador segurava CSS antigo em cache)
// =============================================================
// KONTAR INVENTÁRIO — FASE 1
// =============================================================

var _invAtivo = null;        // inventário em detalhe (admin)
var _invColetaAtual = null;  // inventário e endereço do coletor
var _catCache = {};          // { invId: { ean: {desc,un} } }
var _nextSeq = 1;

// ── Firestore: carregar inventários da loja ──────────────────────
function loadInventariosFromFirebase(cb) {
  var loja = (S.currentUser && S.currentUser.loja) ? S.currentUser.loja.toLowerCase() : '';
  // inv_inventarios é global entre clientes — filtra pelo tenant logado.
  // Docs de antes do multi-tenant (BUILD 231) não têm clienteId; sempre eram da Economico.
  var myClient = (S.currentUser && S.currentUser.clienteId) || '';
  var q = db.collection('inv_inventarios').orderBy('criadoEm','desc');
  q.get().then(function(snap) {
    var list = snap.docs.map(function(d){ return Object.assign({id:d.id}, d.data()); });
    list = list.filter(function(i){ return (i.clienteId || '') === myClient; });
    if (loja) list = list.filter(function(i){ return (i.loja||'').toLowerCase()===loja; });
    S.invsCache = list;
    if (cb) cb();
  }).catch(function(){ S.invsCache=[]; if (cb) cb(); });
}

// Cache de 45 s por inventário: as abas do admin (Bipagens, Auditoria, PDF, Produtividade,
// Folha) chamavam isso a cada clique — com dezenas de milhares de bipagens era um download inteiro por vez.
var _bipsInvCache = {};
function loadBipagensByInv(invId, cb, forcar) {
  var c=_bipsInvCache[invId];
  if (!forcar && c && Date.now()-c.t<45000) { if (cb) cb(c.list.slice()); return; }
  db.collection('inv_bipagens')
    .where('invId','==',invId)
    .get().then(function(snap){
      var list = snap.docs.map(function(d){ return d.data(); });
      list.sort(function(a,b){ return (a.seq||0)-(b.seq||0); });
      _bipsInvCache[invId]={t:Date.now(),list:list};
      if (cb) cb(list.slice());
    }).catch(function(e){ console.error('loadBipagensByInv',e); if (cb) cb([]); });
}

// Normaliza EAN pra comparação: tira zeros a esquerda. Um leitor de codigo
// de barras fisico as vezes le um EAN-13 que comeca com 0 como se fosse o
// UPC-A de 12 digitos correspondente (mesmo codigo, sem o zero) — sem essa
// normalizacao, "0041334001005" no catalogo nunca bate com "41334001005"
// bipado, e o produto aparece como "nao esta na base" mesmo estando cadastrado.
function _normEan(s) {
  s = (s||'').trim();
  var stripped = s.replace(/^0+/, '');
  return stripped || '0';
}

// Item do catálogo por código interno ou EAN (nunca devolve múltiplos: pega o 1º).
function _catItemDe(cat, chave) {
  if(!cat||!cat.total) return null;
  var r=InvCore.resolverCodigo(cat, chave);
  return r ? (r.multiplos ? r.multiplos[0] : r) : null;
}
function _catItem(invId, chave) { return _catItemDe(_catCache[invId], chave); }
// Catálogo em blocos (inv_catalogo_blocos, 1000 itens/doc). Fallback: coleção antiga 1 doc/item.
function loadCatalogoByInv(invId, cb) {
  if (_catCache[invId]) { if (cb) cb(_catCache[invId]); return; }
  db.collection('inv_catalogo_blocos').where('invId','==',invId).get().then(function(snap){
    if (!snap.empty) {
      var itens=[];
      snap.docs.sort(function(a,b){ return (a.data().n||0)-(b.data().n||0); }).forEach(function(d){ itens=itens.concat(d.data().itens||[]); });
      _catCache[invId]=InvCore.criarCatalogo(itens); if(cb) cb(_catCache[invId]); return;
    }
    return db.collection('inv_catalogo').where('invId','==',invId).get().then(function(s2){
      var itens=s2.docs.map(function(d){ var p=d.data(); return {c:'',e:p.ean,d:p.desc,u:p.un,q:null,k:null}; });
      _catCache[invId]=InvCore.criarCatalogo(itens); if(cb) cb(_catCache[invId]);
    });
  }).catch(function(){ _catCache[invId]=InvCore.criarCatalogo([]); if(cb) cb(_catCache[invId]); });
}

// ── Admin: modal novo inventário ─────────────────────────────────
function fecharModalInv() {
  document.getElementById('modal-inv').style.display = 'none';
}

// ── Admin: detalhe ────────────────────────────────────────────────
function abrirDetalheInv(invId, tabInicial) {
  _invAtivo = (S.invsCache||[]).find(function(i){ return i.id===invId; }) || null;
  if (!_invAtivo) return;
  // Salva imediatamente para restaurar em F5 (switchInvTab atualiza a aba)
  localStorage.setItem('inv_detalhe_state', JSON.stringify({invId:invId, tab:tabInicial||'enderecos'}));
  document.getElementById('inv-lista-wrap').style.display = 'none';
  document.getElementById('inv-detalhe-wrap').style.display = 'block';
  document.getElementById('inv-detalhe-nome').textContent = _invAtivo.nome;
  _aplicarStatusDetalhe();
  // Reset bipagens filter
  var filter = document.getElementById('inv-bip-filter');
  if (filter) { filter.innerHTML=''; filter.removeAttribute('data-built'); }
  // Ajusta labels de acordo com modoOrganizacao
  var isModoSet = _invAtivo.modoOrganizacao === 'setores';
  var tabLbl = document.getElementById('inv-tab-lbl-end');
  if (tabLbl) tabLbl.textContent = isModoSet ? 'Setores' : 'Endereços';
  var thEnd = document.getElementById('inv-th-end');
  if (thEnd) thEnd.textContent = isModoSet ? 'Setor' : 'Endereço';
  var tab = tabInicial || 'enderecos';
  var btn = tab === 'enderecos'
    ? document.querySelector('#inv-detalhe-tabs .tab')
    : document.querySelector('#inv-detalhe-tabs .tab[onclick*="\''+tab+'\'"]');
  switchInvTab(tab, btn);
}

// ── Endereços tab ─────────────────────────────────────────────────
function atribuirColetor(invId, endereco, selectEl) {
  var userId = selectEl.value;
  var user = userId ? (S.usersCache||[]).find(function(u){ return u.id===userId; }) : null;
  var update = {};
  if (user) {
    update['atribuicoes.'+endereco] = { userId: user.id, nome: user.nome };
  } else {
    update['atribuicoes.'+endereco] = firebase.firestore.FieldValue.delete();
  }
  db.collection('inv_inventarios').doc(invId).update(update).then(function(){
    if (_invAtivo && _invAtivo.id===invId) {
      if (!_invAtivo.atribuicoes) _invAtivo.atribuicoes = {};
      if (user) { _invAtivo.atribuicoes[endereco] = { userId:user.id, nome:user.nome }; }
      else { delete _invAtivo.atribuicoes[endereco]; }
      // Atualiza cache global
      var idx = (S.invsCache||[]).findIndex(function(i){ return i.id===invId; });
      if (idx>=0) S.invsCache[idx].atribuicoes = Object.assign({}, _invAtivo.atribuicoes);
    }
    atualizarNavColeta();
  }).catch(function(e){ alert('Erro ao atribuir: '+e.message); selectEl.value = ''; });
}

// ── Import catálogo TXT ───────────────────────────────────────────
function _renderImportCatStatus(invId, forceReload) {
  var wrap=document.getElementById('inv-cat-status'); if(!wrap) return;
  var isAberto=_invAtivo&&_invAtivo.status==='aberto';
  if (forceReload) delete _catCache[invId];
  loadCatalogoByInv(invId,function(cat){
    var n=cat.total; var comEan=Object.keys(cat.porEan).length;
    if (n>0) {
      var reenviarBtn=isAberto?'<button class="btn btn-s" onclick="abrirImportCat()">Reenviar catálogo</button>':'';
      wrap.innerHTML=reenviarBtn+'<span class="cnt">Catálogo: <span class="num">'+n.toLocaleString('pt-BR')+'</span> produtos · <span class="num">'+comEan.toLocaleString('pt-BR')+'</span> com EAN</span>';
    } else {
      wrap.innerHTML=isAberto?'<button class="btn btn-p" onclick="abrirImportCat()">Importar catálogo TXT</button>':'<span class="cnt">Sem catálogo</span>';
    }
  });
}

function abrirImportCat() {
  document.getElementById('inv-import-file').click();
}

var _catImport=null;
function importarCatalogo(event) {
  var file=event.target.files[0]; if(!file||!_invAtivo) return;
  var reader=new FileReader();
  reader.onload=function(e){
    var text=e.target.result;
    if(text.indexOf('\uFFFD')>=0){ var r2=new FileReader(); r2.onload=function(ev){ _abrirMapCat(ev.target.result); }; r2.readAsText(file,'UTF-8'); return; }
    _abrirMapCat(text);
  };
  reader.readAsText(file,'ISO-8859-1'); event.target.value='';
}
function _abrirMapCat(text) {
  var parsed=InvCore.parseCatalogoTexto(text); if(!parsed.linhas.length){ alert('Arquivo vazio.'); return; }
  var map=InvCore.mapearColunas(parsed.linhas[0], parsed.linhas.slice(1,6));
  _catImport={linhas:parsed.linhas};
  var opts=function(sel){ return '<option value="-1">—</option>'+parsed.linhas[0].map(function(hh,i){ return '<option value="'+i+'"'+(sel===i?' selected':'')+'>'+(i+1)+': '+String(hh).slice(0,18)+'</option>'; }).join(''); };
  ['codigo','ean','desc','un','estoque','custo','venda'].forEach(function(k){ document.getElementById('cat-map-'+k).innerHTML=opts(map[k]); });
  document.getElementById('cat-map-header').checked=map.temHeader;
  document.getElementById('cat-map-prev').textContent=parsed.linhas.slice(0,3).map(function(l){ return l.join(' | '); }).join('\n');
  document.getElementById('cat-map-err').textContent='';
  document.getElementById('modal-cat-map').style.display='flex';
}
function _confirmarImportCat() {
  var g=function(k){ return parseInt(document.getElementById('cat-map-'+k).value); };
  var m={codigo:g('codigo'),ean:g('ean'),desc:g('desc'),un:g('un'),estoque:g('estoque'),custo:g('custo'),venda:g('venda')};
  var err=document.getElementById('cat-map-err');
  if(m.codigo<0&&m.ean<0){ err.textContent='Escolha ao menos Código interno ou EAN.'; return; }
  var header=document.getElementById('cat-map-header').checked;
  var linhas=_catImport.linhas.slice(header?1:0);
  var itens=linhas.map(function(l){ return {c:m.codigo>=0?(l[m.codigo]||''):'', e:m.ean>=0?(l[m.ean]||'').replace(/\s/g,''):'', d:m.desc>=0?(l[m.desc]||''):'', u:m.un>=0?(l[m.un]||'').toUpperCase():'', q:m.estoque>=0?(parseFloat(String(l[m.estoque]).replace(',','.'))||0):null, k:m.custo>=0?(parseFloat(String(l[m.custo]).replace(',','.'))||0):null, v:m.venda>=0?(parseFloat(String(l[m.venda]).replace(',','.'))||0):null}; })
    .filter(function(it){ return it.c||it.e; });
  document.getElementById('modal-cat-map').style.display='none';
  _gravarBlocosCatalogo(_invAtivo.id, itens);
}
function _gravarBlocosCatalogo(invId, itens) {
  var blocos=InvCore.montarBlocos(itens,1000), statusEl=document.getElementById('inv-cat-status');
  var clienteId=(S.currentUser&&S.currentUser.clienteId)||'';
  function _delay(ms){ return new Promise(function(r){ setTimeout(r,ms); }); }
  db.collection('inv_catalogo_blocos').where('invId','==',invId).get().then(function(snap){
    if (snap.empty) return;
    var b=db.batch(); snap.docs.forEach(function(d){ b.delete(d.ref); }); return b.commit();
  }).then(function(){
    var p=Promise.resolve();
    blocos.forEach(function(itensBloco,n){
      p=p.then(function(){
        if(statusEl) statusEl.innerHTML='<div style="padding:8px 12px;color:#856404">Importando... bloco '+(n+1)+'/'+blocos.length+'</div>';
        var tent=0;
        function tenta(){ return db.collection('inv_catalogo_blocos').doc(invId+'_'+n).set({invId:invId,clienteId:clienteId,n:n,itens:itensBloco}).catch(function(e){ if(++tent>5) throw e; return _delay(800*Math.pow(2,tent)).then(tenta); }); }
        return tenta();
      }).then(function(){ return _delay(150); });
    });
    return p;
  }).then(function(){ delete _catCache[invId]; _renderImportCatStatus(invId,true); })
    .catch(function(e){ alert('Erro ao importar: '+(e.message||e)); });
}

// ── Encerrar inventário ───────────────────────────────────────────
function encerrarInventario(invId) {
  if (!invId) return;
  var inv=(S.invsCache||[]).find(function(i){ return i.id===invId; });
  var nomeInv=inv?inv.nome:'este inventário';
  var enderecos=inv?inv.enderecos||[]:[];
  var filaMap=inv?(inv.fila||{}):{};
  var safeId=invId.replace(/'/g,"\\'");
  // Carrega bipagens para mostrar resumo
  loadBipagensByInv(invId,function(bips){
    var totalBips=bips.length;
    var endsConcl=0,endsSemBip=0;
    enderecos.forEach(function(e){
      if(inv.modoFila){ if(filaMap[e]&&filaMap[e].concluido) endsConcl++; }
      else { var at=_normalizeAtrib((inv.atribuicoes||{})[e]); if(at.coletores.length&&at.coletores.every(function(c){ return c.concluido; })) endsConcl++; }
      if(!bips.some(function(b){ return b.endereco===e; })) endsSemBip++;
    });
    var alertaSemBip=endsSemBip>0?'<div style="background:#fff3e0;border-radius:8px;padding:8px 12px;margin-bottom:8px;font-size:12px;color:#e65100;font-weight:600">⚠ '+endsSemBip+' endereço(s) sem nenhuma bipagem</div>':'';
    var alertaIncompleto=endsConcl<enderecos.length?'<div style="background:#fdecea;border-radius:8px;padding:8px 12px;margin-bottom:12px;font-size:12px;color:#c0392b;font-weight:600">⚠ '+(enderecos.length-endsConcl)+' endereço(s) ainda não concluídos</div>':'<div style="background:#d1f0e0;border-radius:8px;padding:8px 12px;margin-bottom:12px;font-size:12px;color:#1a5c34;font-weight:600">✓ Todos os endereços foram concluídos</div>';
    var html=
      '<div id="modal-encerrar-inv" onclick="if(event.target===this)fecharModalEncerrarInv()" '+
        'style="position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:2000;display:flex;align-items:center;justify-content:center;padding:20px;overflow-y:auto">'+
        '<div style="background:#fff;border-radius:16px;padding:28px 24px 24px;width:100%;max-width:440px;box-shadow:0 8px 40px rgba(0,0,0,.22)">'+
          '<div style="font-size:18px;font-weight:800;margin-bottom:6px;color:#c0392b">⚠ Encerrar Inventário</div>'+
          '<div style="font-size:15px;font-weight:700;margin-bottom:14px;padding:10px 14px;background:#fdecea;border-radius:10px;color:#c0392b">'+nomeInv+'</div>'+
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">'+
            '<div style="background:var(--gray);border-radius:10px;padding:12px;text-align:center"><div style="font-size:22px;font-weight:800">'+enderecos.length+'</div><div style="font-size:11px;color:var(--t3)">Endereços</div></div>'+
            '<div style="background:var(--gray);border-radius:10px;padding:12px;text-align:center"><div style="font-size:22px;font-weight:800">'+endsConcl+'</div><div style="font-size:11px;color:var(--t3)">Concluídos</div></div>'+
            '<div style="background:var(--gray);border-radius:10px;padding:12px;text-align:center"><div style="font-size:22px;font-weight:800">'+totalBips.toLocaleString('pt-BR')+'</div><div style="font-size:11px;color:var(--t3)">Total bipagens</div></div>'+
            '<div style="background:var(--gray);border-radius:10px;padding:12px;text-align:center"><div style="font-size:22px;font-weight:800;color:'+(endsSemBip>0?'#c0392b':'#1a5c34')+'">'+endsSemBip+'</div><div style="font-size:11px;color:var(--t3)">Sem bipagem</div></div>'+
          '</div>'+
          alertaSemBip+alertaIncompleto+
          '<label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--t2);display:block;margin-bottom:8px">Confirme sua senha para encerrar</label>'+
          '<input type="text" style="display:none" aria-hidden="true"/>'+
          '<input type="password" style="display:none" aria-hidden="true"/>'+
          '<input id="encerrar-inv-senha" type="password" placeholder="Digite sua senha" autocomplete="new-password" readonly '+
            'style="width:100%;padding:13px;border:2px solid var(--r);border-radius:10px;font-size:15px;box-sizing:border-box;font-family:inherit;margin-bottom:6px" '+
            'onfocus="this.removeAttribute(\'readonly\')" '+
            'onkeydown="if(event.key===\'Enter\')_confirmarEncerrarInv(\''+safeId+'\')"/>'+
          '<div id="encerrar-inv-err" style="color:var(--r);font-size:12px;font-weight:600;min-height:18px;margin-bottom:14px"></div>'+
          '<div style="display:flex;gap:10px">'+
            '<button onclick="fecharModalEncerrarInv()" style="flex:1;padding:13px;background:#fff;border:1.5px solid var(--gray2);border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;color:var(--t2)">Cancelar</button>'+
            '<button onclick="_confirmarEncerrarInv(\''+safeId+'\')" style="flex:2;padding:13px;background:var(--r);color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit">🔒 Encerrar</button>'+
          '</div>'+
        '</div>'+
      '</div>';
    document.body.insertAdjacentHTML('beforeend', html);
    setTimeout(function(){ var el=document.getElementById('encerrar-inv-senha'); if(el){ el.value=''; el.focus(); } }, 120);
  });
}

function fecharModalEncerrarInv() {
  var m=document.getElementById('modal-encerrar-inv'); if(m) m.remove();
}

function _confirmarEncerrarInv(invId) {
  var senhaEl=document.getElementById('encerrar-inv-senha');
  var errEl=document.getElementById('encerrar-inv-err');
  var senha=(senhaEl?senhaEl.value:'').trim();
  if (!senha) { if(errEl) errEl.textContent='Informe sua senha.'; return; }
  var user=S.currentUser;
  if (!user) { if(errEl) errEl.textContent='Sessão inválida.'; return; }
  hashPassword(senha).then(function(senhaHash) {
    var match=isHashed(user.senha)?(user.senha===senhaHash):(user.senha===senha);
    if (!match) {
      if(errEl) errEl.textContent='Senha incorreta. Tente novamente.';
      if(senhaEl){ senhaEl.value=''; senhaEl.focus(); }
      return;
    }
    fecharModalEncerrarInv();
    db.collection('inv_inventarios').doc(invId).update({
      status:'encerrado',
      encerradoEm:firebase.firestore.FieldValue.serverTimestamp(),
      encerradoPor:user.id
    }).then(function(){
      loadInventariosFromFirebase(function(){
        renderInvList();
        if (_invAtivo && _invAtivo.id===invId) {
          _invAtivo.status='encerrado';
          var statusEl=document.getElementById('inv-detalhe-status');
          _setStatusEl(statusEl, 'Encerrado', 'mute');
          var actEl=document.getElementById('inv-end-actions');
          if(actEl) actEl.style.display='none';
          var corrBtn=document.getElementById('bip-btn-correcao');
          if(corrBtn) corrBtn.style.display='none';
          renderInvEnderecos();
        }
        atualizarNavColeta();
      });
    }).catch(function(e){ alert('Erro: '+e.message); });
  });
}

// ── Bipagens tab ──────────────────────────────────────────────────
function renderInvBipagens(filtroEnd, filtroCol, filtroSetor) {
  if (!_invAtivo) return;
  loadBipagensByInv(_invAtivo.id, function(bips){
    loadCatalogoByInv(_invAtivo.id, function(cat){
      // Filtro de endereços (uma vez)
      var filterSel = document.getElementById('inv-bip-filter');
      if (filterSel && !filterSel.dataset.built) {
        var enderecos = _invAtivo.enderecos || [];
        filterSel.innerHTML = '<option value="">Todos os endereços</option>'+
          enderecos.map(function(e){ return '<option value="'+esc(e)+'">'+esc(e)+'</option>'; }).join('');
        filterSel.dataset.built = '1';
        if (filtroEnd) filterSel.value = filtroEnd;
      }
      // Sincroniza select de setor
      var setorSel = document.getElementById('inv-bip-setor-filter');
      if (setorSel && filtroSetor !== undefined) setorSel.value = filtroSetor || '';
      // Filtro de coletores — rebuilda sempre que o endereço muda
      var colSel = document.getElementById('inv-bip-col-filter');
      if (colSel) {
        if (filtroEnd) {
          var bipsEnd = bips.filter(function(b){ return b.endereco===filtroEnd && b.modo!=='correcao'; });
          var colMap = {};
          bipsEnd.forEach(function(b){
            if (!b.coletorId) return;
            if (!colMap[b.coletorId]) colMap[b.coletorId] = {nome: b.coletorNome||b.coletorId, count: 0};
            colMap[b.coletorId].count++;
          });
          var colIds = Object.keys(colMap);
          if (colIds.length > 1) {
            colSel.innerHTML = '<option value="">Todos os coletores ('+colIds.length+')</option>'+
              colIds.map(function(id){
                var c=colMap[id];
                return '<option value="'+esc(id)+'"'+(filtroCol===id?' selected':'')+'>'+esc(c.nome)+' — '+c.count+' bip</option>';
              }).join('');
            colSel.style.display = '';
          } else {
            colSel.style.display = 'none';
            filtroCol = null;
          }
        } else {
          colSel.style.display = 'none';
          filtroCol = null;
        }
      }
      var ncEl=document.getElementById('inv-bip-nc'); var soNC=!!(ncEl&&ncEl.checked);
      var filtrados = bips.filter(function(b){
        if (soNC && !b.naoCadastrado) return false;
        if (filtroEnd && b.endereco !== filtroEnd) return false;
        if (filtroCol && b.coletorId !== filtroCol) return false;
        if (filtroSetor && (b.setor||'') !== filtroSetor) return false;
        return true;
      });
      var tbody = document.getElementById('inv-bip-tbody');
      if (!tbody) return;
      var cntEl=document.getElementById('inv-bip-count'); if(cntEl) cntEl.textContent=filtrados.length.toLocaleString('pt-BR')+' bipagens';
      if (!filtrados.length) {
        tbody.innerHTML='<tr class="erow"><td colspan="6">Nenhuma bipagem'+(filtroEnd?' neste endereço':filtroSetor?' no setor '+esc(filtroSetor):'')+' ainda.</td></tr>';
        return;
      }
      var _lim=window._bipLimite||300, _rest=filtrados.length-_lim;
      tbody.innerHTML = filtrados.slice(0,_lim).map(function(b){
        var prod = _catItemDe(cat,b.codigo||b.ean)||{};
        var hora = b.ts ? new Date(b.ts.seconds*1000).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) : '--';
        var isCorr=b.modo==='correcao';
        var qtyTxt=isCorr
          ?'<span style="font-weight:700;color:'+(b.qty<0?'var(--r)':'var(--g)')+'">'+( b.qty>0?'+':'')+b.qty+'</span>'
          :''+b.qty+(prod.un?' <small>'+esc(prod.un)+'</small>':'');
        var seqTxt=isCorr
          ?'<span style="font-size:10px;font-weight:700;padding:1px 6px;border-radius:8px;background:#fff3e0;color:#e65100">CORR.</span>'
          :'<span style="font-weight:700;color:var(--t3)">#'+b.seq+'</span>';
        var setorStr=b.setor?' · '+esc(b.setor):'';
        return '<tr style="'+(isCorr?'background:#fff8f4;':'')+'">'+
          '<td>'+seqTxt+'</td>'+
          '<td style="font-family:monospace;font-size:12px">'+(b.codigo?'<b>'+esc(b.codigo)+'</b> · ':'')+esc(b.ean)+(b.naoCadastrado?' <span style="color:#e65100;font-weight:700;font-size:10px">NC</span>':'')+'</td>'+
          '<td style="font-size:12px">'+esc(prod.desc||'—')+'</td>'+
          '<td style="font-weight:700;text-align:center">'+qtyTxt+'</td>'+
          '<td style="font-size:12px">'+esc(b.coletorNome||'—')+'</td>'+
          '<td style="font-size:12px">'+(isCorr?'Correção':''+esc(b.endereco)+setorStr)+' · '+hora+'</td>'+
        '</tr>';
      }).join('')+(_rest>0?'<tr><td colspan="6" style="text-align:center;padding:12px"><button class="btn btn-s btn-sm" onclick="window._bipLimite=(window._bipLimite||300)+1000;renderInvBipagens(document.getElementById(\'inv-bip-filter\').value||null,null,document.getElementById(\'inv-bip-setor-filter\').value||null)">Mostrar mais ('+_rest.toLocaleString('pt-BR')+' restantes)</button></td></tr>':'');
    });
  });
}

// ── Resumo por produto (soma das bipagens) ────────────────────────────────
var _resumoCache=null;
function renderResumoBipagens(recarregar){
  if(!_invAtivo) return;
  var wrap=document.getElementById('inv-resumo-wrap'); if(!wrap) return;
  if (recarregar||!_resumoCache||_resumoCache.invId!==_invAtivo.id){
    wrap.innerHTML='<div style="color:var(--t3);font-size:13px;padding:10px 0">⏳ Somando bipagens...</div>';
    var inv=_invAtivo;
    loadBipagensByInv(inv.id,function(bips){ loadCatalogoByInv(inv.id,function(cat){
      var hasCat=!!(cat&&cat.total), grupos={};
      bips.forEach(function(b){
        var it=null, key;
        if (b.codigo&&hasCat&&cat.porCodigo[b.codigo]){ key='c:'+b.codigo; it=cat.porCodigo[b.codigo]; }
        else {
          // Catálogo reenviado depois do bip: o código gravado pode não existir mais — resolve pelo código e depois pelo EAN (mesma regra do núcleo)
          var r=hasCat?((b.codigo?InvCore.resolverCodigo(cat,b.codigo):null)||InvCore.resolverCodigo(cat,b.ean)):null;
          if(r&&!r.multiplos){ it=r.codigo?(cat.porCodigo[r.codigo]||null):null; if(!it){ var le=cat.porEan[InvCore.normEan(r.ean)]; it=(le&&le.length===1)?le[0]:null; } key=r.codigo?'c:'+r.codigo:'e:'+InvCore.normEan(r.ean); }
          else { key=b.codigo?'c:'+b.codigo:'e:'+InvCore.normEan(b.ean); }
        }
        var g=grupos[key];
        if(!g){ g=grupos[key]={key:key,codigo:it?it.c:(b.codigo||''),ean:it?it.e:(b.codigo?'':b.ean),desc:it?it.d:'(não cadastrado)',un:it?it.u:'',custo:(it&&it.k!=null)?Number(it.k):null,venda:(it&&it.v!=null)?Number(it.v):null,nc:!it&&hasCat,qty:0,bips:0,corr:0,ends:{},endsBips:{},endsCols:{},cols:{}}; }
        var q=Number(b.qty)||0; g.qty+=q;
        var quem=b.coletorNome||b.coletorId||'';
        if (b.modo==='correcao'||b.endereco==='_CORRECAO') { g.corr+=q; if(b.endereco&&b.endereco!=='_CORRECAO') g.ends[b.endereco]=(g.ends[b.endereco]||0)+q; }
        else {
          g.bips++; if(quem) g.cols[quem]=1;
          if(b.endereco){ g.ends[b.endereco]=(g.ends[b.endereco]||0)+q; g.endsBips[b.endereco]=(g.endsBips[b.endereco]||0)+1; if(quem){ g.endsCols[b.endereco]=g.endsCols[b.endereco]||{}; g.endsCols[b.endereco][quem]=1; } }
        }
      });
      var ordEnd=function(a,b){ return String(a).localeCompare(String(b),'pt-BR',{numeric:true}); };
      var todosEnds={};
      var linhas=Object.keys(grupos).map(function(k){ var g=grupos[k]; g.valor=(g.custo!=null)?g.qty*g.custo:null; g.valorVenda=(g.venda!=null)?g.qty*g.venda:null; g.nEnds=Object.keys(g.ends).length; Object.keys(g.ends).forEach(function(e){ todosEnds[e]=1; }); g.endsTxt=Object.keys(g.ends).sort(ordEnd).map(function(e){ return e+' ('+g.ends[e]+')'; }).join(', '); g.colsTxt=Object.keys(g.cols).join(', '); return g; });
      _resumoCache={invId:inv.id,invNome:inv.nome,linhas:linhas,totalBips:bips.length,enderecos:Object.keys(todosEnds).sort(ordEnd)};
      if (window._resumoEnd&&_resumoCache.enderecos.indexOf(window._resumoEnd)<0) window._resumoEnd='';
      _renderResumoTabela();
    }); },!!recarregar);
    return;
  }
  _renderResumoTabela();
}
function _resumoOrdenar(col){ var s=window._resumoSort; window._resumoSort=(s&&s.col===col)?{col:col,dir:-s.dir}:{col:col,dir:-1}; window._resumoLimite=500; _renderResumoTabela(); }
// Linhas da tela: todas, ou recortadas pra um endereço (qtd/bipagens/coletores só daquele endereço;
// correções ficam de fora do recorte porque não têm endereço). Não altera o cache.
function _resumoLinhasFiltradas(){
  var c=_resumoCache; if(!c) return [];
  var busca=(window._resumoBusca||'').toLowerCase(), end=window._resumoEnd||'';
  var linhas=c.linhas;
  if (end) linhas=linhas.filter(function(l){ return l.ends[end]; }).map(function(l){ var q=l.ends[end]; return Object.assign({},l,{qty:q,qtyTotal:l.qty,bips:l.endsBips[end]||0,corr:0,endsTxt:end+' ('+q+')',colsTxt:Object.keys(l.endsCols[end]||{}).join(', '),valor:(l.custo!=null)?q*l.custo:null,valorVenda:(l.venda!=null)?q*l.venda:null}); });
  if (busca) linhas=linhas.filter(function(l){ return (l.codigo+' '+l.ean+' '+l.desc).toLowerCase().indexOf(busca)>=0; });
  // Tag clicada no aviso amarelo: só os sem custo / só os sem preço de venda
  var so=window._resumoSo||'';
  if (so==='semCusto') linhas=linhas.filter(function(l){ return l.valor==null&&l.qty; });
  else if (so==='semVenda') linhas=linhas.filter(function(l){ return l.valorVenda==null&&l.qty; });
  return linhas;
}
function _resumoSoToggle(v){ window._resumoSo=(window._resumoSo===v)?'':v; window._resumoLimite=500; _renderResumoTabela(); }
function _renderResumoTabela(){
  var wrap=document.getElementById('inv-resumo-wrap'), c=_resumoCache; if(!wrap||!c) return;
  var busca=(window._resumoBusca||''), end=window._resumoEnd||'', srt=window._resumoSort||{col:'valor',dir:-1}, lim=window._resumoLimite||500;
  var linhas=_resumoLinhasFiltradas();
  var txt=(srt.col==='codigo'||srt.col==='ean'||srt.col==='desc'||srt.col==='endsTxt'||srt.col==='colsTxt');
  linhas.sort(function(a,b){ var x=a[srt.col], y=b[srt.col]; if(txt) return String(x||'').localeCompare(String(y||''),'pt-BR',{numeric:true})*srt.dir; if(x==null&&y==null) return 0; if(x==null) return 1; if(y==null) return -1; return (x-y)*srt.dir; });
  var totUn=linhas.reduce(function(a,l){ return a+l.qty; },0), totVal=linhas.reduce(function(a,l){ return a+(l.valor||0); },0), totVenda=linhas.reduce(function(a,l){ return a+(l.valorVenda||0); },0);
  var soAtivo=window._resumoSo||'', base=soAtivo?(function(){ var k=window._resumoSo; window._resumoSo=''; var r=_resumoLinhasFiltradas(); window._resumoSo=k; return r; })():linhas;
  var semCusto=base.filter(function(l){ return l.valor==null&&l.qty; }).length, semVenda=base.filter(function(l){ return l.valorVenda==null&&l.qty; }).length;
  var totBips=end?linhas.reduce(function(a,l){ return a+l.bips; },0):c.totalBips;
  var th=function(label,col,right){ var on=srt.col===col; return '<th onclick="_resumoOrdenar(\''+col+'\')" title="Clique pra ordenar" style="cursor:pointer;user-select:none;white-space:nowrap'+(right?';text-align:right':'')+(on?';color:var(--t)':'')+'">'+label+(on?(srt.dir<0?' ▼':' ▲'):'')+'</th>'; };
  var tile=function(lbl,val,cor){ return '<div style="flex:1;min-width:150px;background:var(--gray);border-radius:10px;padding:10px 12px"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--t3)">'+lbl+'</div><div style="font-size:20px;font-weight:800;margin-top:2px;color:'+(cor||'var(--t)')+'">'+val+'</div></div>'; };
  var sub=(c.invNome||'')+(end?' · endereço '+end:'')+(busca?' · busca "'+busca+'"':'');
  window._resumoPrintCache={linhas:linhas, sub:sub, end:end, resumo:[['Produtos',linhas.length.toLocaleString('pt-BR')],['Unidades contadas',(+totUn.toFixed(3)).toLocaleString('pt-BR')],['Custo contado',_fmtBRL(totVal)],['Venda contada',_fmtBRL(totVenda)],['Bipagens',totBips.toLocaleString('pt-BR')]]};
  var rows=linhas.slice(0,lim).map(function(l){
    return '<tr'+(l.nc?' style="background:#fff8f4"':'')+'><td style="font-family:monospace;font-size:12px">'+esc(l.codigo||'—')+'</td><td style="font-family:monospace;font-size:11px">'+esc(l.ean||'')+'</td><td style="font-size:12px">'+esc(l.desc)+(l.nc?' <b style="color:#e65100;font-size:10px">NC</b>':'')+(l.corr?' <span title="inclui correção de '+(l.corr>0?'+':'')+l.corr+'" style="color:#b38600;font-size:10px;font-weight:700">corr.</span>':'')+'</td>'+
      '<td style="text-align:right;font-weight:800;white-space:nowrap">'+(+l.qty.toFixed(3)).toLocaleString('pt-BR')+(l.qtyTotal!=null&&l.qtyTotal!==l.qty?' <small style="color:var(--t3);font-weight:400">de '+(+l.qtyTotal.toFixed(3)).toLocaleString('pt-BR')+'</small>':'')+'</td><td style="text-align:right;white-space:nowrap">'+l.bips+'</td><td style="font-size:11px;color:var(--t2);max-width:170px">'+esc(l.endsTxt||'—')+'</td><td style="font-size:11px;color:var(--t3);max-width:110px">'+esc(l.colsTxt||'—')+'</td>'+
      '<td style="text-align:right;white-space:nowrap;color:var(--t2)">'+(l.custo==null?'—':_fmtBRL(l.custo))+'</td><td style="text-align:right;font-weight:700;white-space:nowrap">'+(l.valor==null?'—':_fmtBRL(l.valor))+'</td>'+
      '<td style="text-align:right;white-space:nowrap;color:var(--t2)">'+(l.venda==null?'—':_fmtBRL(l.venda))+'</td><td style="text-align:right;font-weight:700;white-space:nowrap;color:#1a3c9c">'+(l.valorVenda==null?'—':_fmtBRL(l.valorVenda))+'</td></tr>';
  }).join('');
  var selEnd='<select onchange="window._resumoEnd=this.value;window._resumoLimite=500;_renderResumoTabela()" style="padding:6px 10px;border:1.5px solid var(--gray2);border-radius:8px;font-size:12px;font-family:inherit;background:#fff"><option value="">Todos os endereços</option>'+(c.enderecos||[]).map(function(e){ return '<option value="'+esc(e)+'"'+(e===end?' selected':'')+'>Endereço '+esc(e)+'</option>'; }).join('')+'</select>';
  wrap.innerHTML=
    '<div class="card">'+
    '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">'+tile('Produtos',linhas.length.toLocaleString('pt-BR'))+tile('Unidades contadas',(+totUn.toFixed(3)).toLocaleString('pt-BR'))+tile('Custo contado',_fmtBRL(totVal),'#1a5c34')+tile('Venda contada',_fmtBRL(totVenda),'#1a3c9c')+tile('Bipagens',totBips.toLocaleString('pt-BR'),'var(--t2)')+'</div>'+
    (semCusto||semVenda||soAtivo?'<div style="font-size:11px;color:#b38600;margin-bottom:8px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">'+
      (semCusto?'<button onclick="_resumoSoToggle(\'semCusto\')" title="Mostrar só esses" style="border:1.5px solid #b38600;border-radius:14px;padding:3px 10px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;'+(soAtivo==='semCusto'?'background:#b38600;color:#fff':'background:#fff8e1;color:#b38600')+'">'+semCusto+' sem custo no catálogo'+(soAtivo==='semCusto'?' ✕':'')+'</button>':'')+
      (semVenda?'<button onclick="_resumoSoToggle(\'semVenda\')" title="Mostrar só esses" style="border:1.5px solid #b38600;border-radius:14px;padding:3px 10px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;'+(soAtivo==='semVenda'?'background:#b38600;color:#fff':'background:#fff8e1;color:#b38600')+'">'+semVenda+' sem preço de venda'+(soAtivo==='semVenda'?' ✕':'')+'</button>':'')+
      (soAtivo?'<span>mostrando só esses — clique de novo pra voltar</span>':'<span>fora do R$ — clique pra ver quais são</span>')+'</div>':'')+
    '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:8px">'+
      '<input id="resumo-busca" placeholder="Buscar código, EAN ou descrição" value="'+esc(busca)+'" oninput="window._resumoBusca=this.value;window._resumoLimite=500;_renderResumoTabela();var i=document.getElementById(\'resumo-busca\');if(i){i.focus();i.setSelectionRange(i.value.length,i.value.length);}" style="flex:1;min-width:220px;padding:8px 12px;border:1.5px solid var(--gray2);border-radius:8px;font-size:13px;font-family:inherit"/>'+
      selEnd+
      '<span style="font-size:11px;color:var(--t3)">'+linhas.length.toLocaleString('pt-BR')+' linhas</span>'+
      '<button class="btn btn-s btn-sm" onclick="renderResumoBipagens(true)">↻ Atualizar</button>'+
      '<button class="btn btn-s btn-sm" onclick="_imprimirResumoPdf()">📄 PDF</button>'+
      '<button class="btn btn-s btn-sm" onclick="_exportarResumoXlsx()">⬇ Excel</button>'+
    '</div>'+
    '<div class="tbl-scroll"><table class="tbl-mon"><thead><tr>'+th('Código','codigo')+th('EAN','ean')+th('Descrição','desc')+th('Qtd','qty',1)+th('Bips','bips',1)+th('Endereços (qtd)','endsTxt')+th('Coletores','colsTxt')+th('Custo unit.','custo',1)+th('Custo contado','valor',1)+th('Preço venda','venda',1)+th('Venda contada','valorVenda',1)+'</tr></thead><tbody>'+
      (rows||'<tr><td colspan="11" style="color:var(--t3)">Nenhuma bipagem.</td></tr>')+
      (linhas.length>lim?'<tr><td colspan="11" style="text-align:center;padding:10px"><button class="btn btn-s btn-sm" onclick="window._resumoLimite=(window._resumoLimite||500)+1000;_renderResumoTabela()">Mostrar mais ('+(linhas.length-lim).toLocaleString('pt-BR')+')</button></td></tr>':'')+
    '</tbody></table></div></div>';
}
// Excel de verdade (.xlsx, SheetJS) com 3 abas: resumo por produto (o que está na tela),
// detalhe por endereço e totais por endereço. Sem SheetJS carregado cai no CSV antigo.
function _exportarResumoXlsx(){
  var c=_resumoCache; if(!c) return;
  if (typeof XLSX==='undefined') { _exportarResumoCsv(); return; }
  var linhas=_resumoLinhasFiltradas(), end=window._resumoEnd||'';
  var ordEnd=function(a,b){ return String(a).localeCompare(String(b),'pt-BR',{numeric:true}); };
  var num=function(v){ return v==null?null:+(+v).toFixed(3); }, brl=function(v){ return v==null?null:+(+v).toFixed(2); };
  var wb=XLSX.utils.book_new();
  // Aba 1 — o que está na tela (busca/endereço aplicados)
  var a1=[['Código','EAN','Descrição','UN','Qtd total','Bipagens','Correção','Endereços (qtd)','Coletores','Custo unit.','Custo contado','Preço venda','Venda contada','NC']];
  linhas.slice().sort(function(a,b){ return (b.valorVenda||0)-(a.valorVenda||0); }).forEach(function(l){ a1.push([l.codigo,l.ean,l.desc,l.un,num(l.qty),l.bips,l.corr?num(l.corr):null,l.endsTxt||'',l.colsTxt||'',brl(l.custo),brl(l.valor),brl(l.venda),brl(l.valorVenda),l.nc?'SIM':'']); });
  var totUn=linhas.reduce(function(a,l){ return a+l.qty; },0), totVal=linhas.reduce(function(a,l){ return a+(l.valor||0); },0), totVenda=linhas.reduce(function(a,l){ return a+(l.valorVenda||0); },0);
  a1.push([]); a1.push(['TOTAL','','','',num(totUn),'','','','','',brl(totVal),'',brl(totVenda),'']);
  var ws1=XLSX.utils.aoa_to_sheet(a1); ws1['!cols']=[9,15,48,6,10,9,9,26,22,11,14,11,14,5].map(function(w){ return {wch:w}; }); ws1['!autofilter']={ref:'A1:N'+linhas.length+1};
  XLSX.utils.book_append_sheet(wb,ws1,end?('Endereço '+end).slice(0,31):'Resumo por produto');
  if (!end) {
    // Aba 2 — detalhe por endereço (correções não têm endereço, ficam fora)
    var a2=[['Endereço','Código','EAN','Descrição','UN','Qtd','Bipagens','Coletores','Custo unit.','Custo contado','Preço venda','Venda contada','NC']];
    var tot={};
    (c.enderecos||[]).forEach(function(e){
      var t=tot[e]={prod:0,un:0,bips:0,cols:{},custo:0,venda:0};
      c.linhas.filter(function(l){ return l.ends[e]; }).sort(function(a,b){ return ((b.venda||0)*b.ends[e])-((a.venda||0)*a.ends[e]); }).forEach(function(l){
        var q=l.ends[e], cols=Object.keys(l.endsCols[e]||{});
        a2.push([e,l.codigo,l.ean,l.desc,l.un,num(q),l.endsBips[e]||0,cols.join(', '),brl(l.custo),l.custo==null?null:brl(q*l.custo),brl(l.venda),l.venda==null?null:brl(q*l.venda),l.nc?'SIM':'']);
        t.prod++; t.un+=q; t.bips+=l.endsBips[e]||0; cols.forEach(function(x){ t.cols[x]=1; }); if(l.custo!=null) t.custo+=q*l.custo; if(l.venda!=null) t.venda+=q*l.venda;
      });
    });
    var ws2=XLSX.utils.aoa_to_sheet(a2); ws2['!cols']=[10,9,15,48,6,9,9,22,11,14,11,14,5].map(function(w){ return {wch:w}; }); ws2['!autofilter']={ref:'A1:M'+a2.length};
    XLSX.utils.book_append_sheet(wb,ws2,'Por endereço');
    // Aba 3 — totais por endereço
    var a3=[['Endereço','Produtos','Unidades','Bipagens','Coletores','Custo contado','Venda contada']];
    (c.enderecos||[]).forEach(function(e){ var t=tot[e]; a3.push([e,t.prod,num(t.un),t.bips,Object.keys(t.cols).join(', '),brl(t.custo),brl(t.venda)]); });
    a3.push(['TOTAL',c.linhas.length,num(c.linhas.reduce(function(a,l){ return a+l.qty; },0)),c.totalBips,'',brl(c.linhas.reduce(function(a,l){ return a+(l.valor||0); },0)),brl(c.linhas.reduce(function(a,l){ return a+(l.valorVenda||0); },0))]);
    var ws3=XLSX.utils.aoa_to_sheet(a3); ws3['!cols']=[10,10,12,10,30,16,16].map(function(w){ return {wch:w}; });
    XLSX.utils.book_append_sheet(wb,ws3,'Totais por endereço');
  }
  // Formato de número por cabeçalho (R$ nas colunas de dinheiro, 3 casas nas quantidades)
  var BRL_COLS={'Custo unit.':1,'Custo contado':1,'Preço venda':1,'Venda contada':1}, NUM_COLS={'Qtd total':1,'Qtd':1,'Unidades':1,'Correção':1};
  wb.SheetNames.forEach(function(nome){
    var ws=wb.Sheets[nome], range=XLSX.utils.decode_range(ws['!ref']);
    for (var C=0; C<=range.e.c; C++) {
      var h=ws[XLSX.utils.encode_cell({r:0,c:C})], z=h&&BRL_COLS[h.v]?'"R$" #,##0.00':(h&&NUM_COLS[h.v]?'#,##0.###':null); if(!z) continue;
      for (var R=1; R<=range.e.r; R++) { var cell=ws[XLSX.utils.encode_cell({r:R,c:C})]; if(cell&&typeof cell.v==='number') cell.z=z; }
    }
  });
  XLSX.writeFile(wb,(c.invNome||'inventario').replace(/[^a-z0-9]/gi,'_')+'_resumo_por_produto'+(end?'_end_'+String(end).replace(/[^a-z0-9]/gi,'_'):'')+'.xlsx');
}
function _exportarResumoCsv(){
  var c=_resumoCache; if(!c) return;
  var linhas=_resumoLinhasFiltradas();
  var f=function(v){ return v==null?'':String(v).replace('.',','); };
  var lines=['CODIGO;EAN;DESCRICAO;UN;QTD_TOTAL;BIPAGENS;CORRECAO;ENDERECOS;COLETORES;CUSTO_UNIT;CUSTO_CONTADO;PRECO_VENDA;VENDA_CONTADA;NAO_CADASTRADO'];
  linhas.forEach(function(l){ lines.push([l.codigo,l.ean,(l.desc||'').replace(/;/g,','),l.un,f(l.qty),l.bips,f(l.corr),(l.endsTxt||'').replace(/;/g,','),(l.colsTxt||'').replace(/;/g,','),f(l.custo),f(l.valor==null?null:+l.valor.toFixed(2)),f(l.venda),f(l.valorVenda==null?null:+l.valorVenda.toFixed(2)),l.nc?'SIM':''].join(';')); });
  var blob=new Blob(['﻿'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'});
  var url=URL.createObjectURL(blob); var a=document.createElement('a'); a.href=url;
  a.download=(c.invNome||'inventario').replace(/[^a-z0-9]/gi,'_')+'_resumo_por_produto.csv'; a.click(); setTimeout(function(){ URL.revokeObjectURL(url); },2000);
}
// ── Alternância tabela / correção ─────────────────────────────────────────
function toggleCorrecaoBipagem() {
  var corrWrap=document.getElementById('inv-bip-sub-correcao');
  var tabelaWrap=document.getElementById('inv-bip-tabela-wrap');
  var btn=document.getElementById('bip-btn-correcao');
  var corrAberta=corrWrap&&corrWrap.style.display!=='none';
  if(corrAberta){
    if(corrWrap) corrWrap.style.display='none';
    if(tabelaWrap) tabelaWrap.style.display='';
    if(btn){ btn.style.background='#fff'; btn.style.color='var(--t2)'; btn.style.borderColor='var(--gray2)'; }
  } else {
    if(corrWrap) corrWrap.style.display='';
    if(tabelaWrap) tabelaWrap.style.display='none';
    if(btn){ btn.style.background='var(--y)'; btn.style.color='#111'; btn.style.border='2px solid var(--y)'; }
    renderCorrecaoBipagem();
  }
}

function _fecharCorrecaoView() {
  var corrWrap=document.getElementById('inv-bip-sub-correcao');
  var tabelaWrap=document.getElementById('inv-bip-tabela-wrap');
  var btn=document.getElementById('bip-btn-correcao');
  if(corrWrap) corrWrap.style.display='none';
  if(tabelaWrap) tabelaWrap.style.display='';
  if(btn){ btn.style.background='#fff'; btn.style.color='var(--t2)'; btn.style.borderColor='var(--gray2)'; }
}

// ── Correção de Bipagem ───────────────────────────────────────────────────
var _corrEanCache=null;

function renderCorrecaoBipagem() {
  var wrap=document.getElementById('inv-correcao-wrap'); if(!wrap) return;
  _corrEanCache=null;
  wrap.innerHTML=
    '<div class="card" style="max-width:480px">'+
      '<div style="font-size:15px;font-weight:800;margin-bottom:4px">Correção de Bipagem</div>'+
      '<div style="font-size:13px;color:var(--t2);margin-bottom:18px">Busque um EAN e informe a correção (negativo para reduzir, positivo para adicionar).</div>'+
      '<label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--t2);display:block;margin-bottom:6px">EAN / Código de Barras</label>'+
      '<div style="display:flex;gap:8px;margin-bottom:14px">'+
        '<input id="corr-ean-input" type="text" inputmode="numeric" autocomplete="off" placeholder="Digite ou bipe o EAN..." '+
          'style="flex:1;padding:13px 14px;border:2px solid var(--gray2);border-radius:10px;font-size:15px;font-family:monospace;letter-spacing:1px" '+
          'onkeydown="if(event.key===\'Enter\')buscarEanCorrecao()"/>'+
        '<button onclick="buscarEanCorrecao()" style="padding:13px 16px;background:var(--t);color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">Buscar</button>'+
      '</div>'+
      '<div id="corr-produto-info" style="display:none;padding:12px 14px;background:#f5f5f5;border-radius:10px;margin-bottom:14px">'+
        '<div id="corr-produto-nome" style="font-size:13px;font-weight:700;margin-bottom:4px"></div>'+
        '<div style="display:flex;gap:16px;flex-wrap:wrap">'+
          '<div><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--t3)">Total bipado</div>'+
            '<div id="corr-total-atual" style="font-size:22px;font-weight:800"></div></div>'+
          '<div><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--t3)">Registros</div>'+
            '<div id="corr-total-regs" style="font-size:22px;font-weight:800;color:var(--t2)"></div></div>'+
        '</div>'+
        '<div id="corr-enderecos" style="margin-top:12px"></div>'+
      '</div>'+
      '<div id="corr-form-wrap" style="display:none">'+
        '<label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--t2);display:block;margin-bottom:6px">Valor da Correção</label>'+
        '<div style="display:flex;gap:10px;align-items:center;margin-bottom:10px">'+
          '<input id="corr-valor-input" type="number" placeholder="Ex: -2 ou +5" '+
            'style="width:140px;padding:13px 12px;border:2.5px solid var(--y);border-radius:10px;font-size:20px;font-weight:700;text-align:center;font-family:inherit" '+
            'oninput="_atualizarPreviewCorrecao()" onkeydown="if(event.key===\'Enter\')aplicarCorrecaoBipagem()"/>'+
          '<div style="font-size:14px;color:var(--t3)">=</div>'+
          '<div id="corr-preview" style="font-size:24px;font-weight:800;color:var(--t)">—</div>'+
        '</div>'+
        '<div id="corr-preview-label" style="font-size:12px;color:var(--t2);margin-bottom:14px"></div>'+
        '<div id="corr-alvo-label" style="font-size:12px;font-weight:700;color:#b38600;margin-bottom:10px"></div>'+
        '<button onclick="aplicarCorrecaoBipagem()" style="width:100%;padding:14px;background:var(--g);color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;letter-spacing:.3px">✓ Aplicar Correção</button>'+
      '</div>'+
      '<div id="corr-msg" style="min-height:20px;font-size:13px;font-weight:600;margin-top:10px"></div>'+
    '</div>';
  setTimeout(function(){ var el=document.getElementById('corr-ean-input'); if(el) el.focus(); },100);
}

function buscarEanCorrecao() {
  if (!_invAtivo) return;
  var ei=document.getElementById('corr-ean-input'); if(!ei) return;
  var ean=ei.value.trim();
  if (!ean) return;
  var msgEl=document.getElementById('corr-msg');
  if(msgEl) msgEl.textContent='Buscando...';
  var invId=_invAtivo.id;
  loadCatalogoByInv(invId, function(cat){
    var res=(cat&&cat.total)?InvCore.resolverCodigo(cat,ean):null;
    var codigo=(res&&!res.multiplos)?res.codigo:'';
    var qs=[db.collection('inv_bipagens').where('invId','==',invId).where('ean','==',ean).get()];
    // produto bipado pelo código interno num endereço e pelo EAN em outro: junta os dois
    if (codigo) qs.push(db.collection('inv_bipagens').where('invId','==',invId).where('codigo','==',codigo).get());
    Promise.all(qs).then(function(snaps){
      var vistos={}, bips=[];
      snaps.forEach(function(snap){ snap.docs.forEach(function(d){ if(vistos[d.id]) return; vistos[d.id]=1; bips.push(Object.assign({id:d.id},d.data())); }); });
      var totalQty=bips.reduce(function(s,b){ return s+(Number(b.qty)||0); },0);
      // agrupa por endereço (correções anteriores ficam em '_CORRECAO' ou no endereço alvo)
      var porEnd={};
      bips.forEach(function(b){ var e=b.endereco||'?'; var g=porEnd[e]=porEnd[e]||{endereco:e,qty:0,regs:0,bips:[]}; g.qty+=Number(b.qty)||0; g.regs++; g.bips.push(b); });
      var grupos=Object.keys(porEnd).map(function(e){ return porEnd[e]; }).sort(function(a,b){ if(a.endereco==='_CORRECAO') return 1; if(b.endereco==='_CORRECAO') return -1; return String(a.endereco).localeCompare(String(b.endereco),'pt-BR',{numeric:true}); });
      _corrEanCache={ean:ean, codigo:codigo, total:totalQty, regs:bips.length, grupos:grupos, alvo:''};
      var p=_catItemDe(cat,ean)||(res&&!res.multiplos?{desc:res.desc,un:res.un}:{});
      var piEl=document.getElementById('corr-produto-info');
      var pnEl=document.getElementById('corr-produto-nome');
      var taEl=document.getElementById('corr-total-atual');
      var trEl=document.getElementById('corr-total-regs');
      var fwEl=document.getElementById('corr-form-wrap');
      var viEl=document.getElementById('corr-valor-input');
      if(pnEl) pnEl.innerHTML='<span style="font-family:monospace;font-size:11px;color:var(--t3)">'+esc(ean)+(codigo&&codigo!==ean?' · cód. '+esc(codigo):'')+'</span>'+(p.desc?' &nbsp;·&nbsp; <strong>'+esc(p.desc)+'</strong>':'<em style="color:var(--t3)"> — não está no catálogo</em>')+(p.un?' <small style="color:var(--t3)">'+esc(p.un)+'</small>':'');
      if(taEl) taEl.textContent=totalQty;
      if(trEl) trEl.textContent=bips.length;
      _renderCorrEnderecos();
      if(piEl) piEl.style.display='';
      if(fwEl) fwEl.style.display='';
      if(viEl){ viEl.value=''; viEl.focus(); }
      var prEl=document.getElementById('corr-preview'); if(prEl) prEl.textContent='—';
      var plEl=document.getElementById('corr-preview-label'); if(plEl) plEl.textContent='';
      _atualizarAlvoCorrecao();
      if(msgEl) msgEl.textContent=bips.length?'':'Nenhuma bipagem desse produto neste inventário. A correção entra como registro novo.';
    }).catch(function(e){ if(msgEl) msgEl.textContent='Erro: '+e.message; });
  });
}
// Lista por endereço: quem bipou, quanto, quando — e qual endereço recebe a correção.
function _renderCorrEnderecos() {
  var wrap=document.getElementById('corr-enderecos'); if(!wrap||!_corrEanCache) return;
  var c=_corrEanCache;
  if (!c.grupos.length){ wrap.innerHTML=''; return; }
  function hora(b){ try{ var d=b.ts&&b.ts.toDate?b.ts.toDate():null; return d?d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):''; }catch(e){ return ''; } }
  var linha=function(val,titulo,sub,qty,regs){
    var sel=c.alvo===val;
    return '<label style="display:flex;align-items:center;gap:10px;padding:9px 10px;border:1.5px solid '+(sel?'var(--y)':'var(--gray2)')+';border-radius:10px;margin-bottom:6px;background:'+(sel?'#fffbe6':'#fff')+';cursor:pointer">'+
      '<input type="radio" name="corr-alvo" value="'+esc(val)+'" '+(sel?'checked':'')+' onchange="_corrEanCache.alvo=this.value;_renderCorrEnderecos();_atualizarAlvoCorrecao();_atualizarPreviewCorrecao()" style="accent-color:var(--y);width:16px;height:16px"/>'+
      '<div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:700">'+esc(titulo)+'</div>'+(sub?'<div style="font-size:11px;color:var(--t3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(sub)+'</div>':'')+'</div>'+
      '<div style="text-align:right"><div style="font-size:16px;font-weight:800">'+qty+'</div><div style="font-size:10px;color:var(--t3)">'+regs+' reg.</div></div></label>';
  };
  var html='<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--t3);margin-bottom:6px">Onde foi bipado — escolha o endereço que recebe a correção</div>';
  html+=linha('', 'Inventário inteiro', 'correção sem endereço (como antes)', c.total, c.regs);
  c.grupos.forEach(function(g){
    var det=g.bips.slice().sort(function(a,b){ return (a.seq||0)-(b.seq||0); }).map(function(b){ return (b.coletorNome||b.coletorId||'?')+' '+(Number(b.qty)||0)+(hora(b)?' às '+hora(b):''); }).join(' · ');
    var nome=g.endereco==='_CORRECAO'?'Correções anteriores':(g.endereco==='_AVULSO'?'Coleta avulsa':'Endereço '+g.endereco);
    html+=linha(g.endereco, nome, det, g.qty, g.regs);
  });
  wrap.innerHTML=html;
}
function _atualizarAlvoCorrecao(){
  var el=document.getElementById('corr-alvo-label'); if(!el||!_corrEanCache) return;
  var c=_corrEanCache;
  if(!c.alvo){ el.textContent='Alvo: inventário inteiro (total '+c.total+').'; return; }
  var g=c.grupos.filter(function(x){ return x.endereco===c.alvo; })[0];
  el.textContent='Alvo: endereço '+c.alvo+' (atual '+(g?g.qty:0)+' · total do produto '+c.total+').';
}
function _atualizarPreviewCorrecao() {
  if (!_corrEanCache) return;
  var vi=document.getElementById('corr-valor-input'); if(!vi) return;
  var val=parseFloat(vi.value);
  var prEl=document.getElementById('corr-preview');
  var plEl=document.getElementById('corr-preview-label');
  if(isNaN(val)){ if(prEl) prEl.textContent='—'; if(plEl) plEl.textContent=''; return; }
  var final=_corrEanCache.total+val;
  if(prEl){
    prEl.textContent=final;
    prEl.style.color=val<0?'var(--r)':val>0?'var(--g)':'var(--t)';
  }
  var c=_corrEanCache, g=c.alvo?c.grupos.filter(function(x){ return x.endereco===c.alvo; })[0]:null;
  if(plEl) plEl.textContent=(g?'Endereço '+c.alvo+': '+g.qty+' '+(val>=0?'+ '+val:val)+' = '+(g.qty+val)+' · ':'')+'Total do produto ('+c.total+') '+(val>=0?'+ '+val:val)+' = '+final+' peças';
}

function aplicarCorrecaoBipagem() {
  if (!_invAtivo||!_corrEanCache) return;
  var vi=document.getElementById('corr-valor-input'); if(!vi) return;
  var val=parseFloat(vi.value);
  if(isNaN(val)||val===0){ alert('Informe um valor de correção diferente de zero.'); return; }
  var msgEl=document.getElementById('corr-msg');
  if(msgEl){ msgEl.textContent='Salvando...'; msgEl.style.color='var(--t2)'; }
  var coletorId=_getIdColetor()||S.currentUser&&S.currentUser.id||'sistema';
  var coletorNome=_getNomeColetor()||S.currentUser&&S.currentUser.nome||coletorId;
  var inv=_invAtivo;
  db.collection('inv_bipagens').add({
    invId:inv.id, loja:inv.loja||'', endereco:(_corrEanCache.alvo&&_corrEanCache.alvo!=='_CORRECAO')?_corrEanCache.alvo:'_CORRECAO', ean:_corrEanCache.ean, codigo:_corrEanCache.codigo||'',
    qty:val, rodada:0, modo:'correcao',
    coletorId:coletorId, coletorNome:coletorNome,
    ts:firebase.firestore.FieldValue.serverTimestamp(), seq:Date.now()
  }).then(function(){
    var final=_corrEanCache.total+val;
    // Mostra confirmação brevemente, depois limpa tudo para novo EAN
    if(msgEl){ msgEl.textContent='✓ Correção aplicada'+(_corrEanCache.alvo&&_corrEanCache.alvo!=='_CORRECAO'?' no endereço '+_corrEanCache.alvo:'')+'! '+_corrEanCache.ean+' → total: '+final+' peças.'; msgEl.style.color='var(--g)'; }
    _corrEanCache=null;
    setTimeout(function(){
      var piEl=document.getElementById('corr-produto-info'); if(piEl) piEl.style.display='none';
      var fwEl=document.getElementById('corr-form-wrap'); if(fwEl) fwEl.style.display='none';
      var eiEl=document.getElementById('corr-ean-input'); if(eiEl){ eiEl.value=''; eiEl.focus(); }
      setTimeout(function(){ var m=document.getElementById('corr-msg'); if(m) m.textContent=''; },2000);
    },1200);
  }).catch(function(e){ if(msgEl){ msgEl.textContent='Erro: '+e.message; msgEl.style.color='var(--r)'; } });
}

// ── Tela de coleta ────────────────────────────────────────────────
function _renderUltimasBipagens(bips, invId) {
  loadCatalogoByInv(invId, function(cat){
    var wrap = document.getElementById('inv-ultimas-wrap');
    if (!wrap) return;
    if (!bips.length) {
      wrap.innerHTML='<div style="text-align:center;padding:24px;color:var(--t3);font-size:13px">Nenhuma bipagem ainda. Comece a escanear!</div>';
      return;
    }
    wrap.innerHTML='<table style="width:100%"><thead><tr><th style="width:55px">Seq</th><th>EAN</th><th>Descrição</th><th style="width:55px;text-align:center">Qtd</th><th style="width:40px"></th></tr></thead><tbody>'+
      bips.map(function(b){
        var prod = _catItemDe(cat,b.codigo||b.ean)||{};
        var podeExcluir = b._id && !b._pend && !b._erro && _invColetaAtual && !_invColetaAtual.concluido;
        return '<tr style="'+(b._erro?'background:#fdecea':b._pend?'opacity:.6':'')+'">'+
          '<td><span style="font-weight:700;color:var(--t3)">#'+b.seq+'</span></td>'+
          '<td style="font-family:monospace;font-size:12px">'+(b.codigo?'<b>'+esc(b.codigo)+'</b> · ':'')+esc(b.ean)+'</td>'+
          '<td style="font-size:12px">'+esc(prod.desc||'—')+(b.naoCadastrado?' <span style="font-size:10px;font-weight:700;padding:1px 6px;border-radius:8px;background:#fff3e0;color:#e65100">NC</span>':'')+'</td>'+
          '<td style="font-weight:700;text-align:center">'+b.qty+'</td>'+
          '<td style="text-align:center">'+(podeExcluir?'<button type="button" onclick="_pedirExclusaoBip(\''+b._id+'\')" title="Excluir esta bipagem (senha do supervisor)" style="width:32px;height:32px;border-radius:8px;border:1.5px solid var(--gray2);background:#fff;font-size:15px;cursor:pointer">🗑</button>':'')+'</td>'+
        '</tr>';
      }).join('')+
    '</tbody></table>';
  });
}
// ── Excluir a própria bipagem no celular, com senha de supervisor/admin ─────────────────
// Apaga o doc (some da contagem/exportação) e guarda o registro em inv_inventarios.bipsExcluidas
// (+ inv_auditlog quando permitido), pra ficar o rastro de endereço/coletor/quem autorizou.
var _exclBipCtx=null;
function _pedirExclusaoBip(id){
  var bip=_bipsLocais.filter(function(b){ return b._id===id; })[0]; if(!bip||!_invColetaAtual) return;
  var m=document.getElementById('modal-excl-bip'); if(m) m.remove();
  var cat=_catCache[_invColetaAtual.inv.id]||null, prod=(cat&&_catItemDe(cat,bip.codigo||bip.ean))||{};
  var cid=(S.currentUser&&S.currentUser.clienteId)||window.KONTAR_CLIENT_ID||'';
  var sups=getUsers().filter(function(u){ return u.ativo!==false&&u.email&&u.email.indexOf('@')>0&&['admin','supervisor','gerencia'].indexOf(u.perfil)>=0&&(!u.clienteId||!cid||u.clienteId===cid); });
  var quem = sups.length
    ? '<select id="excl-bip-sup" style="width:100%;padding:12px;border:1.5px solid var(--gray2);border-radius:10px;font-size:15px;font-family:inherit;margin-bottom:8px">'+sups.map(function(u){ return '<option value="'+esc(u.email)+'">'+esc(u.nome||u.email)+'</option>'; }).join('')+'</select>'
    : '<input id="excl-bip-sup" type="email" placeholder="E-mail do supervisor" autocomplete="off" style="width:100%;padding:12px;border:1.5px solid var(--gray2);border-radius:10px;font-size:15px;font-family:inherit;margin-bottom:8px"/>';
  _exclBipCtx={bip:bip, desc:prod.desc||''};
  var html='<div id="modal-excl-bip" style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:2300;display:flex;align-items:flex-end;justify-content:center">'+
    '<div style="background:#fff;border-radius:20px 20px 0 0;padding:20px;width:100%;max-width:480px">'+
    '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--r);margin-bottom:4px">Excluir bipagem #'+bip.seq+'</div>'+
    '<div style="font-size:15px;font-weight:700;margin-bottom:12px"><span style="font-family:monospace">'+esc(bip.codigo||bip.ean)+'</span> · '+esc(prod.desc||'não cadastrado')+' — <b>'+bip.qty+' un</b></div>'+
    '<label style="display:block;font-size:12px;font-weight:700;color:var(--t2);margin-bottom:4px">Supervisor que autoriza</label>'+quem+
    '<input id="excl-bip-senha" type="password" placeholder="Senha do supervisor" autocomplete="current-password" style="width:100%;padding:12px;border:1.5px solid var(--gray2);border-radius:10px;font-size:15px;font-family:inherit;margin-bottom:8px"/>'+
    '<input id="excl-bip-motivo" type="text" placeholder="Motivo (opcional)" autocomplete="off" style="width:100%;padding:12px;border:1.5px solid var(--gray2);border-radius:10px;font-size:14px;font-family:inherit;margin-bottom:12px"/>'+
    '<div id="excl-bip-erro" style="color:var(--r);font-size:13px;font-weight:600;min-height:18px;margin-bottom:8px"></div>'+
    '<div style="display:flex;gap:10px">'+
      '<button type="button" onclick="_fecharExclusaoBip()" style="flex:1;padding:13px;background:#fff;border:1.5px solid var(--gray2);border-radius:10px;font-size:14px;font-weight:700;font-family:inherit">Cancelar</button>'+
      '<button type="button" id="excl-bip-ok" onclick="_confirmarExclusaoBip()" style="flex:2;padding:13px;background:var(--r);color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:700;font-family:inherit">🗑 Excluir</button>'+
    '</div></div></div>';
  document.body.insertAdjacentHTML('beforeend',html);
  setTimeout(function(){ var s=document.getElementById('excl-bip-senha'); if(s) s.focus(); },80);
}
function _fecharExclusaoBip(){ var m=document.getElementById('modal-excl-bip'); if(m) m.remove(); _exclBipCtx=null; }
function _confirmarExclusaoBip(){
  var c=_exclBipCtx; if(!c) return;
  var email=(document.getElementById('excl-bip-sup')||{}).value||'', senha=(document.getElementById('excl-bip-senha')||{}).value||'', motivo=((document.getElementById('excl-bip-motivo')||{}).value||'').trim();
  var erro=document.getElementById('excl-bip-erro'), ok=document.getElementById('excl-bip-ok');
  email=email.trim().toLowerCase();
  if(!email||!senha){ if(erro) erro.textContent='Informe o supervisor e a senha.'; return; }
  if(ok){ ok.disabled=true; ok.textContent='Verificando...'; } if(erro) erro.textContent='';
  // Valida a senha num Auth secundário: não mexe na sessão do coletor.
  var aux=_getSecondaryAuth();
  aux.signInWithEmailAndPassword(email,senha).then(function(){
    aux.signOut().catch(function(){});
    var bip=c.bip, inv=_invColetaAtual.inv;
    var reg={bipId:bip._id, seq:bip.seq||0, ean:bip.ean||'', codigo:bip.codigo||'', desc:c.desc||'', qty:bip.qty||0, endereco:bip.endereco||'', setor:bip.setor||'',
      coletorId:bip.coletorId||'', coletorNome:bip.coletorNome||'', autorizadoPor:email, motivo:motivo, excluidoEm:Date.now()};
    return db.collection('inv_bipagens').doc(bip._id).delete().then(function(){
      db.collection('inv_inventarios').doc(inv.id).update({bipsExcluidas:firebase.firestore.FieldValue.arrayUnion(reg)}).catch(function(e){ console.error('bipsExcluidas',e); });
      db.collection('inv_auditlog').add({invId:inv.id, clienteId:inv.clienteId||'', acao:'bipagem_excluida', userName:(bip.coletorNome||bip.coletorId||'coletor')+' (aut. '+email+')',
        detalhes:'End. '+reg.endereco+' · #'+reg.seq+' · '+(reg.codigo||reg.ean)+' '+reg.desc+' · '+reg.qty+' un'+(motivo?' · '+motivo:''), ts:firebase.firestore.FieldValue.serverTimestamp()}).catch(function(){});
      _bipsLocais=_bipsLocais.filter(function(b){ return b._id!==bip._id; });
      _renderUltimasBipagens(_bipsLocais.slice(0,20), inv.id);
      _fecharExclusaoBip(); _bipSom('alerta');
      showToast('Bipagem #'+reg.seq+' excluída (autorizada por '+email+').',4000);
    });
  }).catch(function(e){
    var code=(e&&e.code)||'';
    if(erro) erro.textContent = /wrong-password|invalid-credential|invalid-login|user-not-found|invalid-email/.test(code) ? 'Senha ou supervisor inválido.' : 'Falha: '+((e&&e.message)||code||e);
    if(ok){ ok.disabled=false; ok.textContent='🗑 Excluir'; }
  });
}

// =============================================================
// KONTAR INVENTÁRIO — FASE 2: Controle Real
// =============================================================

// ── Normalização backward-compat (fase 1 → fase 2) ───────────────
function _normalizeAtrib(atrib) {
  if (!atrib) return { modo:'colaboracao', coletores:[] };
  if (Array.isArray(atrib.coletores)) return atrib;
  // Formato fase 1: { userId, nome }
  if (atrib.userId) return { modo:'colaboracao', coletores:[{ userId:atrib.userId, nome:atrib.nome, rodada:1, concluido:false }] };
  return { modo:'colaboracao', coletores:[] };
}

// ── Trilha de auditoria ───────────────────────────────────────────
function _logAuditoria(invId, acao, detalhes) {
  db.collection('inv_auditlog').add({
    invId:invId, loja:(S.currentUser&&S.currentUser.loja)||'',
    userId:S.currentUser?S.currentUser.id:'', userName:S.currentUser?S.currentUser.nome:'',
    acao:acao, detalhes:detalhes||'',
    ts:firebase.firestore.FieldValue.serverTimestamp()
  }).catch(function(){});
}

function renderTrilhaAuditoria(invId) {
  var tbody=document.getElementById('auditoria-tbody');
  if (!tbody) return;
  tbody.innerHTML='<tr><td colspan="4" style="text-align:center;padding:16px;color:var(--t3)">Carregando...</td></tr>';
  db.collection('inv_auditlog').where('invId','==',invId).limit(200)
    .get().then(function(snap){
      if (snap.empty){ tbody.innerHTML='<tr class="erow"><td colspan="4">Nenhum registro ainda.</td></tr>'; return; }
      var docs=snap.docs.map(function(d){ return d.data(); });
      docs.sort(function(a,b){ return ((b.ts&&b.ts.seconds)||0)-((a.ts&&a.ts.seconds)||0); });
      var labels={
        inventario_criado:'Inventário criado', coletor_adicionado:'Coletor adicionado',
        coletor_removido:'Coletor removido', modo_alterado:'Modo alterado',
        rodada_finalizada:'Rodada finalizada', divergencia_resolvida:'Divergência resolvida',
        inventario_encerrado:'Inventário encerrado', bipagem_excluida:'Bipagem excluída (coletor)'
      };
      tbody.innerHTML=docs.map(function(r){
        var hora=r.ts?new Date(r.ts.seconds*1000).toLocaleString('pt-BR'):'—';
        return '<tr><td style="font-size:12px;white-space:nowrap">'+hora+'</td><td style="font-size:12px">'+esc(r.userName||'—')+'</td><td style="font-size:12px;font-weight:600">'+(labels[r.acao]||r.acao)+'</td><td style="font-size:12px;color:var(--t2)">'+esc(r.detalhes||'')+'</td></tr>';
      }).join('');
    }).catch(function(){ tbody.innerHTML='<tr class="erow"><td colspan="4">Erro ao carregar.</td></tr>'; });
}

// ── Dashboard em tempo real ───────────────────────────────────────
var _invBipListener = null;

function _calcDivergencias(r1Bips,r2Bips) {
  var m1={},m2={};
  r1Bips.forEach(function(b){ m1[b.ean]=(m1[b.ean]||0)+b.qty; });
  r2Bips.forEach(function(b){ m2[b.ean]=(m2[b.ean]||0)+b.qty; });
  var eans=Object.keys(Object.assign({},m1,m2));
  return eans.filter(function(e){ return (m1[e]||0)!==(m2[e]||0); })
    .map(function(e){ return {ean:e,qty1:m1[e]||0,qty2:m2[e]||0,diff:Math.abs((m1[e]||0)-(m2[e]||0))}; })
    .sort(function(a,b){ return b.diff-a.diff; });
}

// ── Modal divergências ────────────────────────────────────────────
var _divEndAtual = null;

function verDivergencias(endereco) {
  if (!_invAtivo) return;
  _divEndAtual=endereco;
  var invId=_invAtivo.id;
  loadBipagensByInv(invId,function(bips){
    loadCatalogoByInv(invId,function(cat){
      var r1=bips.filter(function(b){ return b.endereco===endereco&&(b.rodada||1)===1; });
      var r2=bips.filter(function(b){ return b.endereco===endereco&&(b.rodada||1)===2; });
      var divs=_calcDivergencias(r1,r2);
      var atrib=_normalizeAtrib((_invAtivo.atribuicoes||{})[endereco]);
      var c1=atrib.coletores.find(function(c){ return c.rodada===1; })||{};
      var c2=atrib.coletores.find(function(c){ return c.rodada===2; })||{};
      // Atualizar headers de colunas
      var h1=document.getElementById('diverg-col-r1'),h2=document.getElementById('diverg-col-r2');
      if (h1) h1.textContent='R1: '+(c1.nome||'—'); if (h2) h2.textContent='R2: '+(c2.nome||'—');
      document.getElementById('modal-diverg-titulo').textContent='Divergências — Endereço '+endereco;
      var tbody=document.getElementById('modal-diverg-tbody');
      if (tbody){
        if (!divs.length){ tbody.innerHTML='<tr><td colspan="5" style="text-align:center;color:var(--g);padding:20px">✓ Sem divergências</td></tr>'; }
        else { tbody.innerHTML=divs.map(function(d){
          var p=_catItemDe(cat,d.ean)||{};
          return '<tr><td style="font-family:monospace;font-size:12px">'+esc(d.ean)+'</td><td style="font-size:12px">'+esc(p.desc||'—')+'</td><td style="text-align:center;font-weight:700">'+d.qty1+'</td><td style="text-align:center;font-weight:700">'+d.qty2+'</td><td style="text-align:center;color:var(--r);font-weight:700">'+d.diff+'</td></tr>';
        }).join(''); }
      }
      // Mostrar resolução atual
      var resAtual=(_invAtivo.resolucoes||{})[endereco];
      var resEl=document.getElementById('diverg-resolucao-atual');
      if (resEl) resEl.textContent=resAtual?'Resolução atual: Rodada '+resAtual.rodada+' ('+(resAtual.resolvidoPor||'admin')+')':'';
      // Atualizar botões R1/R2 com nomes
      var b1=document.getElementById('btn-usar-r1'),b2=document.getElementById('btn-usar-r2');
      if (b1) b1.textContent='✓ Usar Rodada 1'+(c1.nome?' ('+c1.nome+')':'');
      if (b2) b2.textContent='✓ Usar Rodada 2'+(c2.nome?' ('+c2.nome+')':'');
      document.getElementById('modal-inv-diverg').style.display='flex';
    });
  });
}

function fecharModalDiverg() { document.getElementById('modal-inv-diverg').style.display='none'; }

function resolverDivergencia(rodada) {
  if (!_invAtivo||!_divEndAtual) return;
  var invId=_invAtivo.id, end=_divEndAtual;
  var atrib=_normalizeAtrib((_invAtivo.atribuicoes||{})[end]);
  var coletor=atrib.coletores.find(function(c){ return c.rodada===rodada; })||{};
  var resObj={ rodada:rodada, resolvidoPor:S.currentUser?S.currentUser.nome:'', resolvidoEm:new Date().toISOString(), coletorNome:coletor.nome||'' };
  var update={}; update['resolucoes.'+end]=resObj;
  db.collection('inv_inventarios').doc(invId).update(update).then(function(){
    if (!_invAtivo.resolucoes) _invAtivo.resolucoes={};
    _invAtivo.resolucoes[end]=resObj;
    var idx=(S.invsCache||[]).findIndex(function(i){ return i.id===invId; });
    if (idx>=0) S.invsCache[idx].resolucoes=Object.assign({},_invAtivo.resolucoes);
    var resEl=document.getElementById('diverg-resolucao-atual');
    if (resEl) resEl.textContent='✓ Resolução salva: Rodada '+rodada+(coletor.nome?' ('+coletor.nome+')':'');
    _logAuditoria(invId,'divergencia_resolvida','Endereço '+end+' → Rodada '+rodada+' escolhida pelo admin');
  }).catch(function(e){ alert('Erro: '+e.message); });
}

// ── Modal gerenciar endereço (multi-coletor) ──────────────────────
var _gerEndAtual=null, _gerInvIdAtual=null;

function abrirModalGerenciarEnd(invId,end) {
  _gerInvIdAtual=invId; _gerEndAtual=end;
  document.getElementById('modal-ger-end-titulo').textContent='Endereço: '+end;
  renderModalGerEnd();
  document.getElementById('modal-inv-gerenciar').style.display='flex';
}
function fecharModalGerenciarEnd() { document.getElementById('modal-inv-gerenciar').style.display='none'; _gerEndAtual=null; _gerInvIdAtual=null; }

function renderModalGerEnd() {
  if (!_invAtivo||!_gerEndAtual) return;
  var invId=_gerInvIdAtual, end=_gerEndAtual;
  var atrib=_normalizeAtrib((_invAtivo.atribuicoes||{})[end]);
  var modo=atrib.modo, cols=atrib.coletores||[];

  var modoEl=document.getElementById('ger-end-modo');
  if (modoEl) modoEl.innerHTML=
    '<button class="btn btn-sm" style="'+(modo==='colaboracao'?'background:#111;color:#fff;border-color:#111':'')+'padding:7px 16px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;border:1.5px solid var(--gray2);" onclick="setModoEndereco(\''+invId+'\',\''+end+'\',\'colaboracao\')">Colaboração</button>'+
    '<button class="btn btn-sm" style="'+(modo==='auditoria'?'background:#5b21b6;color:#fff;border-color:#5b21b6':'')+'padding:7px 16px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;border:1.5px solid var(--gray2);" onclick="setModoEndereco(\''+invId+'\',\''+end+'\',\'auditoria\')">Auditoria</button>';

  var listEl=document.getElementById('ger-end-coletores');
  if (listEl){
    if (!cols.length){ listEl.innerHTML='<div style="color:var(--t3);font-size:13px;padding:6px 0">Nenhum coletor atribuído</div>'; }
    else { listEl.innerHTML=cols.map(function(c){
      var rb=modo==='auditoria'?'<span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px;background:#ede9fe;color:#5b21b6;margin-left:5px">R'+c.rodada+'</span>':'';
      var cb=c.concluido?'<span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px;background:#d1f0e0;color:#1a5c34;margin-left:4px">✓</span>':'';
      return '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:var(--gray);border-radius:8px;margin-bottom:6px">'+
        '<span style="font-size:13px;font-weight:600">'+esc(c.nome)+rb+cb+'</span>'+
        '<button onclick="removerColetorEnd(\''+invId+'\',\''+end+'\',\''+c.userId+'\')" style="background:none;border:none;cursor:pointer;color:var(--r);font-size:18px;padding:0 4px;line-height:1">×</button>'+
      '</div>';
    }).join(''); }
  }

  var addEl=document.getElementById('ger-end-add');
  if (addEl){
    var maxC=modo==='auditoria'?2:6;
    var users=(S.usersCache||[]).filter(function(u){ return u.ativo!==false; });
    var assigned=cols.map(function(c){ return c.userId; });
    var avail=users.filter(function(u){ return assigned.indexOf(u.id)<0; });
    if (cols.length>=maxC){ addEl.innerHTML='<div style="font-size:12px;color:var(--t3);padding:4px 0">'+(modo==='auditoria'?'Auditoria: máx. 2 coletores.':'Limite atingido.')+'</div>'; }
    else { addEl.innerHTML='<div style="display:flex;gap:8px;align-items:center;margin-top:10px"><select id="ger-end-select" style="flex:1;padding:8px 10px;border:1.5px solid var(--gray2);border-radius:8px;font-size:13px;font-family:inherit"><option value="">Selecionar coletor...</option>'+avail.map(function(u){ return '<option value="'+u.id+'">'+esc(u.nome)+'</option>'; }).join('')+'</select><button class="btn btn-p btn-sm" onclick="adicionarColetorEnd(\''+invId+'\',\''+end+'\')">+ Adicionar</button></div>'; }
  }
}

function setModoEndereco(invId,end,modo) {
  var atrib=_normalizeAtrib((_invAtivo&&_invAtivo.atribuicoes&&_invAtivo.atribuicoes[end])||null);
  if (modo==='auditoria'&&atrib.coletores.length>2){ alert('Auditoria suporta no máximo 2 coletores. Remova os excedentes primeiro.'); return; }
  var novos=atrib.coletores.map(function(c,i){ return Object.assign({},c,{rodada:modo==='auditoria'?i+1:1}); });
  var novoAtrib={modo:modo,coletores:novos};
  var update={}; update['atribuicoes.'+end]=novoAtrib;
  db.collection('inv_inventarios').doc(invId).update(update).then(function(){
    if (_invAtivo){ if (!_invAtivo.atribuicoes) _invAtivo.atribuicoes={}; _invAtivo.atribuicoes[end]=novoAtrib; }
    var idx=(S.invsCache||[]).findIndex(function(i){ return i.id===invId; }); if (idx>=0) S.invsCache[idx].atribuicoes=Object.assign({},_invAtivo.atribuicoes);
    renderModalGerEnd(); renderInvEnderecos();
    _logAuditoria(invId,'modo_alterado','Endereço '+end+' → '+modo);
  }).catch(function(e){ alert('Erro: '+e.message); });
}

function adicionarColetorEnd(invId,end) {
  var sel=document.getElementById('ger-end-select'); if (!sel||!sel.value) return;
  var uid=sel.value, user=(S.usersCache||[]).find(function(u){ return u.id===uid; }); if (!user) return;
  var atrib=_normalizeAtrib((_invAtivo&&_invAtivo.atribuicoes&&_invAtivo.atribuicoes[end])||null);
  if (atrib.coletores.find(function(c){ return c.userId===uid; })){ alert('Já atribuído.'); return; }
  var max=atrib.modo==='auditoria'?2:6;
  if (atrib.coletores.length>=max){ alert(atrib.modo==='auditoria'?'Auditoria: máx. 2 coletores.':'Limite atingido.'); return; }
  var novR=atrib.modo==='auditoria'?atrib.coletores.length+1:1;
  var novos=atrib.coletores.concat([{userId:user.id,nome:user.nome,rodada:novR,concluido:false}]);
  var novoAtrib={modo:atrib.modo,coletores:novos};
  var update={}; update['atribuicoes.'+end]=novoAtrib;
  db.collection('inv_inventarios').doc(invId).update(update).then(function(){
    if (_invAtivo){ if (!_invAtivo.atribuicoes) _invAtivo.atribuicoes={}; _invAtivo.atribuicoes[end]=novoAtrib; }
    var idx=(S.invsCache||[]).findIndex(function(i){ return i.id===invId; }); if (idx>=0) S.invsCache[idx].atribuicoes=Object.assign({},_invAtivo.atribuicoes);
    renderModalGerEnd(); renderInvEnderecos(); atualizarNavColeta();
    _logAuditoria(invId,'coletor_adicionado','Endereço '+end+': '+user.nome+' (R'+novR+')');
  }).catch(function(e){ alert('Erro: '+e.message); });
}

function removerColetorEnd(invId,end,userId) {
  if (!confirm('Remover este coletor?')) return;
  var atrib=_normalizeAtrib((_invAtivo&&_invAtivo.atribuicoes&&_invAtivo.atribuicoes[end])||null);
  var novos=atrib.coletores.filter(function(c){ return c.userId!==userId; });
  if (atrib.modo==='auditoria') novos=novos.map(function(c,i){ return Object.assign({},c,{rodada:i+1}); });
  var novoAtrib={modo:atrib.modo,coletores:novos};
  var update={}; update['atribuicoes.'+end]=novoAtrib;
  db.collection('inv_inventarios').doc(invId).update(update).then(function(){
    if (_invAtivo){ if (!_invAtivo.atribuicoes) _invAtivo.atribuicoes={}; _invAtivo.atribuicoes[end]=novoAtrib; }
    var idx=(S.invsCache||[]).findIndex(function(i){ return i.id===invId; }); if (idx>=0) S.invsCache[idx].atribuicoes=Object.assign({},_invAtivo.atribuicoes);
    renderModalGerEnd(); renderInvEnderecos(); atualizarNavColeta();
    _logAuditoria(invId,'coletor_removido','Endereço '+end+': userId '+userId);
  }).catch(function(e){ alert('Erro: '+e.message); });
}

// ── Sobrescrever funções fase 1 (agora com suporte fase 2) ────────

// Campo EAN só abre depois que o sequencial do endereço chegou (evita seq duplicado).
function _liberarCampoEan(){ var ei=document.getElementById('inv-ean-input'); if(ei){ ei.disabled=false; ei.placeholder='Bipe ou digite o código...'; ei.focus(); } }
function _carregarUltimasBipagens(invId,endereco,rodada,modo) {
  db.collection('inv_bipagens').where('invId','==',invId).where('endereco','==',endereco).get().then(function(snap){
    var bips=snap.docs.map(function(d){ var b=d.data(); b._id=d.id; return b; });
    if (modo==='auditoria'&&rodada) bips=bips.filter(function(b){ return (b.rodada||1)===rodada; });
    bips.sort(function(a,b){ return (b.seq||0)-(a.seq||0); });
    _nextSeq=(bips.length?bips[0].seq:0)+1;
    _bipsLocais=bips.slice(0,50);
    var sl=document.getElementById('inv-seq-label'); if(sl) sl.textContent='Próx. seq: '+_nextSeq;
    _renderUltimasBipagens(_bipsLocais.slice(0,20),invId);
    _liberarCampoEan();
  }).catch(function(e){ console.error('_carregarUltimasBipagens',e); _nextSeq=Date.now()%100000000; _bipsLocais=[]; _renderUltimasBipagens([],invId); _liberarCampoEan(); });
}

// ── Exportação ERP com template configurável ──────────────────────────────

var _ERP_CAMPOS = [
  {id:'barra',     label:'Código de barras (EAN ou código interno)'},
  {id:'codigo',    label:'Código interno'},
  {id:'ean',       label:'EAN / Código'},
  {id:'qty',       label:'Quantidade'},
  {id:'endereco',  label:'Endereço/Local'},
  {id:'desc',      label:'Descrição'},
  {id:'un',        label:'Unidade'},
  {id:'setor',     label:'Setor'},
  {id:'coletorId', label:'Coletor ID'},
  {id:'seq',       label:'Sequencial'},
  {id:'rodada',    label:'Rodada'},
  {id:'data',      label:'Data (dd/mm/aaaa)'},
  {id:'hora',      label:'Hora (hh:mm)'}
];

var _ERP_PRESETS = {
  'conferencia': {
    label:'Conferência (ordem de bipagem)',
    campos:['endereco','seq','coletorId','hora','codigo','barra','desc','qty','setor'],
    sep:';', header:true, agrupa:false, dec:'int', enc:'utf8bom'
  },
  'bazar': {
    label:'ERP Bazar — código barra;qtd (3 casas)',
    campos:['barra','qty'],
    sep:';', header:false, agrupa:true, dec:'comma3', enc:'ansi'
  },
  'kontar': {
    label:'Kontar Padrão',
    campos:['endereco','codigo','ean','qty','desc','un','setor','rodada'],
    sep:';', header:true, agrupa:false, dec:'int', enc:'utf8bom'
  },
  'protheus': {
    label:'TOTVS Protheus',
    campos:['ean','qty'],
    sep:';', header:false, agrupa:true, dec:'int', enc:'ansi'
  },
  'winthor': {
    label:'Winthor (CISS/TOTVS)',
    campos:['ean','qty','endereco'],
    sep:';', header:false, agrupa:true, dec:'int', enc:'ansi'
  },
  'microvix': {
    label:'Microvix / Linx',
    campos:['ean','desc','qty','un'],
    sep:';', header:true, agrupa:true, dec:'int', enc:'utf8bom'
  },
  'sapb1': {
    label:'SAP Business One',
    campos:['ean','desc','qty','un','endereco'],
    sep:',', header:true, agrupa:true, dec:'dot', enc:'utf8bom'
  },
  'bling': {
    label:'Bling / Tiny',
    campos:['ean','desc','qty','un'],
    sep:';', header:true, agrupa:true, dec:'int', enc:'utf8bom'
  },
  'pipe': {
    label:'Pipe (|) sem header',
    campos:['ean','qty','endereco'],
    sep:'|', header:false, agrupa:false, dec:'int', enc:'utf8bom'
  },
  'tab': {
    label:'Tabulado (Excel)',
    campos:['endereco','ean','desc','qty','un','setor','data'],
    sep:'\t', header:true, agrupa:false, dec:'comma', enc:'utf8bom'
  },
  'custom': {label:'Personalizado'}
};

var _ERP_PROFILE_KEY = 'kontar_erp_profile';

function exportarTxtErp() {
  if (!_invAtivo) return;
  var saved = {};
  try { saved = JSON.parse(localStorage.getItem(_ERP_PROFILE_KEY)||'{}'); } catch(e){}
  var perfil = Object.assign({}, _ERP_PRESETS['kontar'], saved);
  _abrirModalExportErp(perfil);
}

function _abrirModalExportErp(perfil) {
  // Ordem de clique: começa com a ordem já salva no perfil (ou preset)
  window._erpCampoOrdem = (perfil.campos||[]).slice();
  var presetOpts = Object.keys(_ERP_PRESETS).map(function(k){
    return '<option value="'+k+'"'+(perfil._preset===k?' selected':'')+'>'+_ERP_PRESETS[k].label+'</option>';
  }).join('');

  var camposOpts = _ERP_CAMPOS.map(function(c){
    var on = perfil.campos && perfil.campos.indexOf(c.id) >= 0;
    return '<label style="display:flex;align-items:center;gap:7px;font-size:13px;padding:5px 0;cursor:pointer">'+
      '<input type="checkbox" value="'+c.id+'" class="erp-campo-cb"'+(on?' checked':'')+' style="width:15px;height:15px;accent-color:var(--y);cursor:pointer"/>'+
      '<span class="erp-campo-ord" data-id="'+c.id+'" style="display:inline-block;min-width:16px;font-weight:800;color:var(--y);font-size:11px"></span>'+
      c.label+'</label>';
  }).join('');

  var html =
    '<div id="modal-erp-export" onclick="if(event.target===this)_fecharModalExportErp()" style="position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:3000;display:flex;align-items:center;justify-content:center;padding:16px;overflow-y:auto">'+
    '<div style="background:#fff;border-radius:18px;padding:28px 24px;width:100%;max-width:520px;max-height:90vh;overflow-y:auto;box-shadow:0 8px 40px rgba(0,0,0,.25)">'+
      '<div style="font-size:18px;font-weight:800;margin-bottom:4px">Exportar para ERP</div>'+
      '<div style="font-size:13px;color:var(--t3);margin-bottom:18px">Configure o formato e baixe o arquivo. O perfil é salvo automaticamente.</div>'+

      '<label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--t2);display:block;margin-bottom:6px">Preset de ERP</label>'+
      '<select id="erp-preset" onchange="_erp_aplicarPreset(this.value)" style="width:100%;padding:10px 12px;border:1.5px solid var(--gray2);border-radius:9px;font-size:14px;font-family:inherit;margin-bottom:16px">'+presetOpts+'</select>'+

      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">'+
        '<div>'+
          '<label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--t2);display:block;margin-bottom:6px">Separador</label>'+
          '<select id="erp-sep" style="width:100%;padding:9px 12px;border:1.5px solid var(--gray2);border-radius:9px;font-size:13px;font-family:inherit">'+
            '<option value=";"'+(perfil.sep===';'?' selected':'')+'>Ponto-e-vírgula ( ; )</option>'+
            '<option value=","'+(perfil.sep===','?' selected':'')+'>Vírgula ( , )</option>'+
            '<option value="|"'+(perfil.sep==='|'?' selected':'')+'>Pipe ( | )</option>'+
            '<option value="\t"'+(perfil.sep==='\t'?' selected':'')+'>Tabulação (TAB)</option>'+
          '</select>'+
        '</div>'+
        '<div>'+
          '<label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--t2);display:block;margin-bottom:6px">Quantidade</label>'+
          '<select id="erp-dec" style="width:100%;padding:9px 12px;border:1.5px solid var(--gray2);border-radius:9px;font-size:13px;font-family:inherit">'+
            '<option value="int"'+(perfil.dec==='int'?' selected':'')+'>Inteiro ( 15 )</option>'+
            '<option value="dot"'+(perfil.dec==='dot'?' selected':'')+'>Decimal ponto ( 15.00 )</option>'+
            '<option value="comma"'+(perfil.dec==='comma'?' selected':'')+'>Decimal vírgula ( 15,00 )</option>'+
            '<option value="dot3"'+(perfil.dec==='dot3'?' selected':'')+'>3 casas, ponto ( 15.000 )</option>'+
            '<option value="comma3"'+(perfil.dec==='comma3'?' selected':'')+'>3 casas, vírgula ( 15,000 )</option>'+
          '</select>'+
        '</div>'+
        '<div>'+
          '<label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--t2);display:block;margin-bottom:6px">Encoding</label>'+
          '<select id="erp-enc" style="width:100%;padding:9px 12px;border:1.5px solid var(--gray2);border-radius:9px;font-size:13px;font-family:inherit">'+
            '<option value="utf8bom"'+(perfil.enc==='utf8bom'?' selected':'')+'>UTF-8 com BOM (padrão)</option>'+
            '<option value="utf8"'+(perfil.enc==='utf8'?' selected':'')+'>UTF-8 sem BOM</option>'+
            '<option value="ansi"'+(perfil.enc==='ansi'?' selected':'')+'>ANSI / ISO-8859-1</option>'+
          '</select>'+
        '</div>'+
        '<div>'+
          '<label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--t2);display:block;margin-bottom:6px">Extensão do arquivo</label>'+
          '<select id="erp-ext" style="width:100%;padding:9px 12px;border:1.5px solid var(--gray2);border-radius:9px;font-size:13px;font-family:inherit">'+
            '<option value="txt"'+(perfil.ext==='txt'?' selected':'')+'>TXT</option>'+
            '<option value="csv"'+(perfil.ext==='csv'?' selected':'')+'>CSV</option>'+
          '</select>'+
        '</div>'+
      '</div>'+

      '<div style="display:flex;gap:20px;margin-bottom:16px">'+
        '<label style="display:flex;align-items:center;gap:7px;font-size:13px;cursor:pointer">'+
          '<input type="checkbox" id="erp-header"'+(perfil.header?' checked':'')+' style="width:15px;height:15px;accent-color:var(--y)"/> Linha de cabeçalho'+
        '</label>'+
        '<label style="display:flex;align-items:center;gap:7px;font-size:13px;cursor:pointer">'+
          '<input type="checkbox" id="erp-agrupa"'+(perfil.agrupa?' checked':'')+' style="width:15px;height:15px;accent-color:var(--y)"/> Agrupar por EAN (somar qtd)'+
        '</label>'+
      '</div>'+

      '<label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--t2);display:block;margin-bottom:8px">Colunas incluídas (na ordem)</label>'+
      '<div style="background:var(--gray);border-radius:10px;padding:10px 14px;margin-bottom:6px;display:grid;grid-template-columns:1fr 1fr;gap:2px" id="erp-campos-wrap">'+camposOpts+'</div>'+
      '<div style="font-size:11px;color:var(--t3);margin-bottom:16px">A ordem das colunas no arquivo segue a ordem em que você MARCA os checkboxes (veja o número ao lado de cada um) — desmarcar e marcar de novo manda o campo pro final da ordem.</div>'+

      '<div style="background:#f8f8f8;border-radius:10px;padding:12px 14px;margin-bottom:16px">'+
        '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--t3);margin-bottom:8px">Preview (3 primeiras linhas)</div>'+
        '<pre id="erp-preview" style="font-size:11px;font-family:monospace;overflow-x:auto;white-space:pre;color:var(--t);margin:0">Carregando...</pre>'+
      '</div>'+

      '<div style="display:flex;gap:10px">'+
        '<button onclick="_fecharModalExportErp()" style="flex:1;padding:13px;background:#fff;border:1.5px solid var(--gray2);border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;color:var(--t2)">Cancelar</button>'+
        '<button onclick="_erp_gerarArquivo()" style="flex:2;padding:13px;background:var(--y);color:#111;border:none;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">⬇ Baixar arquivo</button>'+
      '</div>'+
    '</div></div>';

  document.body.insertAdjacentHTML('beforeend', html);
  // Carrega preview
  loadBipagensByInv(_invAtivo.id, function(bips){
    loadCatalogoByInv(_invAtivo.id, function(cat){
      window._erpBipsCache = bips;
      window._erpCatCache  = cat;
      _erp_atualizarPreview();
      _erp_atualizarOrdemBadges();
      // Atualiza preview ao mudar qualquer opção
      ['erp-sep','erp-dec','erp-enc','erp-header','erp-agrupa'].forEach(function(id){
        var el=document.getElementById(id); if(el) el.addEventListener('change', _erp_atualizarPreview);
      });
      document.querySelectorAll('.erp-campo-cb').forEach(function(cb){
        cb.addEventListener('change', function(){
          var idx = window._erpCampoOrdem.indexOf(cb.value);
          if (cb.checked) {
            if (idx===-1) window._erpCampoOrdem.push(cb.value);
          } else if (idx!==-1) {
            window._erpCampoOrdem.splice(idx,1);
          }
          _erp_atualizarOrdemBadges();
          _erp_atualizarPreview();
        });
      });
    });
  });
}

function _erp_atualizarOrdemBadges() {
  var ordem = window._erpCampoOrdem || [];
  var checkedIds = [];
  document.querySelectorAll('.erp-campo-cb:checked').forEach(function(cb){ checkedIds.push(cb.value); });
  // Mesma lógica de _erp_lerPerfil: posição entre os campos MARCADOS, ignorando lixo de campos desmarcados que sobrou em window._erpCampoOrdem
  var ordenados = ordem.filter(function(id){ return checkedIds.indexOf(id)>=0; });
  checkedIds.forEach(function(id){ if (ordenados.indexOf(id)<0) ordenados.push(id); });
  document.querySelectorAll('.erp-campo-ord').forEach(function(span){
    var pos = ordenados.indexOf(span.getAttribute('data-id'));
    span.textContent = pos>=0 ? (pos+1)+'.' : '';
  });
}

function _fecharModalExportErp() {
  var m=document.getElementById('modal-erp-export'); if(m) m.remove();
  window._erpBipsCache=null; window._erpCatCache=null; window._erpCampoOrdem=null;
}

function _erp_aplicarPreset(key) {
  var p = _ERP_PRESETS[key]; if(!p||key==='custom') return;
  var sepEl=document.getElementById('erp-sep'); if(sepEl) sepEl.value=p.sep;
  var decEl=document.getElementById('erp-dec'); if(decEl) decEl.value=p.dec;
  var encEl=document.getElementById('erp-enc'); if(encEl) encEl.value=p.enc;
  var hdEl=document.getElementById('erp-header'); if(hdEl) hdEl.checked=p.header;
  var agEl=document.getElementById('erp-agrupa'); if(agEl) agEl.checked=p.agrupa;
  document.querySelectorAll('.erp-campo-cb').forEach(function(cb){
    cb.checked = p.campos && p.campos.indexOf(cb.value) >= 0;
  });
  window._erpCampoOrdem = (p.campos||[]).slice();
  _erp_atualizarOrdemBadges();
  _erp_atualizarPreview();
}

function _erp_lerPerfil() {
  var sep  = (document.getElementById('erp-sep')||{}).value||';';
  var dec  = (document.getElementById('erp-dec')||{}).value||'int';
  var enc  = (document.getElementById('erp-enc')||{}).value||'utf8bom';
  var ext  = (document.getElementById('erp-ext')||{}).value||'txt';
  var header = !!(document.getElementById('erp-header')||{}).checked;
  var agrupa = !!(document.getElementById('erp-agrupa')||{}).checked;
  var preset = (document.getElementById('erp-preset')||{}).value||'custom';
  var campos = [];
  document.querySelectorAll('.erp-campo-cb:checked').forEach(function(cb){ campos.push(cb.value); });
  // Ordem segue a sequência de cliques do usuário (window._erpCampoOrdem), não a lista fixa
  var ordem = window._erpCampoOrdem || [];
  var camposOrdenados = ordem.filter(function(id){ return campos.indexOf(id)>=0; });
  campos.forEach(function(id){ if (camposOrdenados.indexOf(id)<0) camposOrdenados.push(id); });
  return {sep:sep, dec:dec, enc:enc, ext:ext, header:header, agrupa:agrupa, campos:camposOrdenados, _preset:preset};
}

function _erp_formatarQty(n, dec) {
  if (dec==='dot')   return n.toFixed(2);
  if (dec==='comma') return n.toFixed(2).replace('.',',');
  if (dec==='dot3')  return n.toFixed(3);
  if (dec==='comma3') return n.toFixed(3).replace('.',',');
  return String(n);
}

function _erp_buildLinhas(bips, cat, perfil) {
  var resolucoes = (_invAtivo&&_invAtivo.resolucoes)||{};
  var bipsFilt = bips.filter(function(b){
    var res=resolucoes[b.endereco]; if(!res) return true;
    return (b.rodada||1)===res.rodada;
  });
  // Código de barras pra devolver ao ERP: EAN do catálogo se o item tem, senão o código interno lido.
  function _barra(b){ var p=_catItemDe(cat,b.codigo||b.ean)||{}; return p.ean||b.codigo||b.ean||''; }
  var porBarra = perfil.campos.indexOf('barra')>=0;
  var dados;
  if (perfil.agrupa) {
    var mapa = {};
    bipsFilt.forEach(function(b){
      var k = porBarra ? _barra(b) : (b.codigo||b.ean);
      if (!mapa[k]) mapa[k] = {ean:b.ean, codigo:b.codigo||'', barra:_barra(b), qty:0, endereco:b.endereco, setor:b.setor||'', coletorId:b.coletorId||'', seq:b.seq||0, rodada:b.rodada||1, ts:b.ts};
      mapa[k].qty += (b.qty||1);
    });
    dados = Object.values(mapa);
  } else {
    dados = bipsFilt.slice().sort(function(a,b){ return String(a.endereco).localeCompare(String(b.endereco),undefined,{numeric:true}) || (a.seq||0)-(b.seq||0); });
  }
  var lines = [];
  var labelMap = {};
  _ERP_CAMPOS.forEach(function(c){ labelMap[c.id]=c.label; });
  if (perfil.header && perfil.campos.length) {
    lines.push(perfil.campos.map(function(id){ return labelMap[id]||id; }).join(perfil.sep));
  }
  dados.forEach(function(b){
    var p = _catItemDe(cat,b.codigo||b.ean)||{};
    var ts = b.ts&&b.ts.seconds ? new Date(b.ts.seconds*1000) : null;
    var row = perfil.campos.map(function(id){
      if (id==='barra')     return b.barra!=null?b.barra:_barra(b);
      if (id==='codigo')    return b.codigo||'';
      if (id==='ean')       return b.ean||'';
      if (id==='qty')       return _erp_formatarQty(b.qty||1, perfil.dec);
      if (id==='endereco')  return b.endereco||'';
      if (id==='desc')      return p.desc||b.desc||'';
      if (id==='un')        return p.un||'';
      if (id==='setor')     return b.setor||'';
      if (id==='coletorId') return b.coletorId||'';
      if (id==='seq')       return String(b.seq||'');
      if (id==='rodada')    return String(b.rodada||1);
      if (id==='data')      return ts ? ts.toLocaleDateString('pt-BR') : '';
      if (id==='hora')      return ts ? ts.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) : '';
      return '';
    });
    lines.push(row.join(perfil.sep));
  });
  return lines;
}

function _erp_atualizarPreview() {
  var el = document.getElementById('erp-preview'); if(!el) return;
  var bips = window._erpBipsCache||[];
  var cat  = window._erpCatCache||{};
  if (!bips.length) { el.textContent = '(sem bipagens)'; return; }
  var perfil = _erp_lerPerfil();
  var lines  = _erp_buildLinhas(bips, cat, perfil);
  el.textContent = lines.slice(0, 4).join('\n') + (lines.length > 4 ? '\n... ('+lines.length+' linhas total)' : '');
}

function _erp_gerarArquivo() {
  var bips = window._erpBipsCache||[];
  var cat  = window._erpCatCache||{};
  var perfil = _erp_lerPerfil();
  // Salva perfil
  try { localStorage.setItem(_ERP_PROFILE_KEY, JSON.stringify(perfil)); } catch(e){}
  var lines  = _erp_buildLinhas(bips, cat, perfil);
  var conteudo = lines.join('\r\n');
  var blob;
  if (perfil.enc === 'ansi') {
    // Converte para ISO-8859-1 (melhor esforço — caracteres fora do range viram '?')
    var bytes = [];
    for (var i=0; i<conteudo.length; i++) {
      var c = conteudo.charCodeAt(i);
      bytes.push(c < 256 ? c : 63);
    }
    blob = new Blob([new Uint8Array(bytes)], {type:'text/plain;charset=iso-8859-1'});
  } else {
    var prefix = perfil.enc === 'utf8bom' ? '﻿' : '';
    blob = new Blob([prefix + conteudo], {type:'text/plain;charset=utf-8'});
  }
  var ext = perfil.ext || 'txt';
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a'); a.href=url;
  a.download = ((_invAtivo&&_invAtivo.nome)||'inventario').replace(/[^a-z0-9]/gi,'_')+'_ERP.'+ext;
  a.click(); setTimeout(function(){ URL.revokeObjectURL(url); }, 2000);
  _fecharModalExportErp();
}

// ═══════════════════════════════════════════════════════════════════════════
// KONTAR INVENTÁRIO — FASE 3 — Profissional
// ═══════════════════════════════════════════════════════════════════════════

var _filaEndAtual = null; // { invId, endereco }
var _qrStream = null;
var _qrAnimFrame = null;

// ── Override abrirModalNovoInv — reset modoFila ───────────────────────────
function abrirModalNovoInv() {
  document.getElementById('ninv-nome').value = '';
  document.getElementById('ninv-enderecos').value = '';
  var deEl=document.getElementById('ninv-end-de'); if(deEl) deEl.value='0';
  var ateEl=document.getElementById('ninv-end-ate'); if(ateEl) ateEl.value='';
  var cb = document.getElementById('ninv-modoFila');
  if (cb) cb.checked = true;
  var cbSeq = document.getElementById('ninv-sequencial'); if (cbSeq) cbSeq.checked = false;
  var se = document.getElementById('ninv-setores'); if (se) se.value = 'ESTOQUE,LOJA';
  var me = document.getElementById('ninv-meta'); if (me) me.value = '98';
  // Reset tipo para Geral
  var radioGeral = document.querySelector('input[name="ninv-tipo"][value="geral"]');
  if (radioGeral) { radioGeral.checked = true; _ninvTipoChange(); }
  // Reset modoOrg para Endereços+Setores
  var radioMorg = document.querySelector('input[name="ninv-modoOrg"][value="setores_end"]');
  if (radioMorg) { radioMorg.checked = true; _ninvMorgChange(); }
  var err = document.getElementById('ninv-err');
  if (err) { err.textContent = ''; err.style.display = 'none'; }
  document.getElementById('modal-inv').style.display = 'flex';
  setTimeout(function(){ document.getElementById('ninv-nome').focus(); }, 100);
}

function _ninvTipoChange() {
  var val = (document.querySelector('input[name="ninv-tipo"]:checked')||{}).value||'geral';
  ['geral','parcial','surpresa'].forEach(function(t){
    var lbl=document.getElementById('ninv-tipo-'+t); if(!lbl) return;
    var active=t===val;
    lbl.style.background=active?'var(--y)':'#fff';
    lbl.style.borderColor=active?'var(--y)':'var(--gray2)';
    lbl.style.color=active?'#000':'var(--t2)';
  });
}

function _ninvMorgChange() {
  var val = (document.querySelector('input[name="ninv-modoOrg"]:checked')||{}).value||'setores_end';
  var isSoSet = val === 'setores';
  var endBlock = document.getElementById('ninv-end-block');
  if (endBlock) endBlock.style.display = isSoSet ? 'none' : '';
  var lblEnd = document.getElementById('ninv-morg-end');
  var lblSet = document.getElementById('ninv-morg-set');
  if (lblEnd) { lblEnd.style.background=!isSoSet?'var(--y)':'#fff'; lblEnd.style.borderColor=!isSoSet?'var(--y)':'var(--gray2)'; lblEnd.style.color=!isSoSet?'#000':'var(--t2)'; }
  if (lblSet) { lblSet.style.background=isSoSet?'var(--y)':'#fff'; lblSet.style.borderColor=isSoSet?'var(--y)':'var(--gray2)'; lblSet.style.color=isSoSet?'#000':'var(--t2)'; }
}

function gerarEnderecosFaixa(prefix) {
  prefix=prefix||'ninv-end';
  var de=parseInt(document.getElementById(prefix+'-de').value);
  var ate=parseInt(document.getElementById(prefix+'-ate').value);
  var errEl=document.getElementById(prefix==='ninv-end'?'ninv-err':'add-end-err');
  if (isNaN(de)||isNaN(ate)) { if(errEl){errEl.textContent='Preencha os campos "do" e "ao".';errEl.style.display='block';} return; }
  if (ate<de) { if(errEl){errEl.textContent='O valor final deve ser maior ou igual ao inicial.';errEl.style.display='block';} return; }
  if (ate-de>999) { if(errEl){errEl.textContent='Máximo 1000 endereços por vez.';errEl.style.display='block';} return; }
  if (errEl) errEl.style.display='none';
  var linhas=[];
  for (var i=de; i<=ate; i++) linhas.push(String(i));
  var ta=document.getElementById(prefix==='ninv-end'?'ninv-enderecos':prefix+'-lista');
  var atual=ta.value.trim();
  ta.value=atual?atual+'\n'+linhas.join('\n'):linhas.join('\n');
}

// ── Override criarInventario — tipo + modoFila ────────────────────────────
function criarInventario() {
  var nome = document.getElementById('ninv-nome').value.trim();
  var endStr = document.getElementById('ninv-enderecos').value.trim();
  var cbEl = document.getElementById('ninv-modoFila');
  var modoFila = !!(cbEl && cbEl.checked);
  var seqEl = document.getElementById('ninv-sequencial');
  var sequencial = !!(seqEl && seqEl.checked);
  var tipo = (document.querySelector('input[name="ninv-tipo"]:checked')||{}).value||'geral';
  var modoOrg = (document.querySelector('input[name="ninv-modoOrg"]:checked')||{}).value||'setores_end';
  var setoresRaw = (document.getElementById('ninv-setores')||{}).value||'ESTOQUE,LOJA';
  var setores = setoresRaw.split(',').map(function(s){ return s.trim().toUpperCase(); }).filter(function(s){ return s.length>0; });
  if (!setores.length) setores = ['ESTOQUE','LOJA'];
  var metaEl = document.getElementById('ninv-meta');
  var meta = metaEl ? (parseInt(metaEl.value)||0) : 0;
  var errEl = document.getElementById('ninv-err');
  if (errEl) errEl.style.display = 'none';
  if (!nome) { if(errEl){errEl.textContent='Informe o nome do inventário.';errEl.style.display='block';} return; }
  var enderecos;
  if (modoOrg === 'setores') {
    // Em modo Só Setores, os setores são os "endereços"
    enderecos = setores.slice();
    modoFila = true; // força fila (coletor toca no setor)
  } else {
    if (!endStr) { if(errEl){errEl.textContent='Informe pelo menos um endereço ou use o gerador.';errEl.style.display='block';} return; }
    enderecos = endStr.split('\n').map(function(e){ return e.trim(); }).filter(function(e){ return e.length>0; });
    if (!enderecos.length) { if(errEl){errEl.textContent='Nenhum endereço válido.';errEl.style.display='block';} return; }
  }
  // Bloqueia duplo clique
  var criarBtn = document.getElementById('ninv-criar'); // antes pegava o 1º .btn-p do modal = botão Gerar
  if (criarBtn) { criarBtn.disabled = true; criarBtn.textContent = 'Criando...'; }
  var loja = (S.currentUser && S.currentUser.loja) ? S.currentUser.loja : '';
  db.collection('inv_inventarios').add({
    nome: nome, loja: loja, status: 'aberto', tipo: tipo,
    clienteId: (S.currentUser && S.currentUser.clienteId) || '',
    criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
    criadoPor: S.currentUser ? S.currentUser.id : '',
    enderecos: enderecos, atribuicoes: {},
    modoFila: modoFila, fila: {},
    sequencial: sequencial,
    totalBipagens: 0,
    setores: setores,
    modoOrganizacao: modoOrg,
    meta: meta || 0
  }).then(function(){
    fecharModalInv();
    loadInventariosFromFirebase(function(){ renderInvList(); });
  }).catch(function(e){
    if (criarBtn) { criarBtn.disabled = false; criarBtn.textContent = 'Criar Inventário'; }
    if(errEl){errEl.textContent='Erro: '+(e.message||'Tente novamente.');errEl.style.display='block';}
  });
}

// ── Helper: badge de tipo de inventário ───────────────────────────────────
function _invTipoTag(tipo) {
  if (tipo==='parcial') return _tg('Parcial','am');
  if (tipo==='surpresa') return _tg('Surpresa','au');
  return _tg('Geral');
}

// ── Override renderInvList — só ativos, badge FILA ────────────────────────

// ── UI Ardósia: etiquetas e status (ver docs/superpowers/specs/2026-10-28-kontar-ardosia-design.md) ──
function _tg(txt, cls) { return '<span class="tg'+(cls?' tg-'+cls:'')+'">'+txt+'</span>'; }
function _stx(txt, cls) { return '<span class="st st-'+(cls||'mute')+'">'+txt+'</span>'; }
var _modoTag = { fila:_tg('Fila'), auditoria:_tg('Auditoria','au'), colab:_tg('Colab.','am') };
function _setStatusEl(el, txt, cls) { if(!el) return; el.textContent=txt; el.className='st st-'+cls+(el.id==='inv-detalhe-status'?' st-up':''); el.style.background=''; el.style.color=''; }
var _invBipCount = {};
// Conta bipagens sem baixar os docs. O SDK compat 10.12 não expõe count(), então usa a
// API REST de agregação com o token do próprio usuário (mesmas regras de segurança).
function _contarDocs(colecao, campo, valor) {
  var u=firebase.auth().currentUser; if(!u) return Promise.resolve(null);
  var proj=firebase.app().options.projectId;
  return u.getIdToken().then(function(tok){
    return fetch('https://firestore.googleapis.com/v1/projects/'+proj+'/databases/(default)/documents:runAggregationQuery',{
      method:'POST', headers:{'Authorization':'Bearer '+tok,'Content-Type':'application/json'},
      body:JSON.stringify({structuredAggregationQuery:{aggregations:[{count:{},alias:'n'}],structuredQuery:{from:[{collectionId:colecao}],where:{fieldFilter:{field:{fieldPath:campo},op:'EQUAL',value:{stringValue:valor}}}}}})
    });
  }).then(function(r){ return r.json(); }).then(function(j){
    var n=parseInt((((j[0]||{}).result||{}).aggregateFields||{}).n&&j[0].result.aggregateFields.n.integerValue);
    return isNaN(n)?null:n;
  }).catch(function(){ return null; });
}
function _contarBipagens(invId, cb) {
  var c=_invBipCount[invId];
  if (c && Date.now()-c.t<30000) { cb(c.n); return; }
  _contarDocs('inv_bipagens','invId',invId).then(function(n){
    if (n!=null) _invBipCount[invId]={n:n,t:Date.now()};
    cb(n);
  });
}
function _preencherContagens(){
  document.querySelectorAll('span[id^="invcnt-"]').forEach(function(e){
    var id=e.id.slice(7);
    _contarBipagens(id,function(n){ e.textContent=n==null?'—':n.toLocaleString('pt-BR'); });
  });
}
function renderInvList() {
  var wrap = document.getElementById('inv-lista');
  if (!wrap) return;
  var invs = (S.invsCache||[]).filter(function(i){ return i.status==='aberto'||i.status==='pausado'; });
  if (!invs.length) {
    wrap.innerHTML = '<div class="empty"><b>Nenhum inventário ativo</b>Clique em <strong>+ Novo inventário</strong> para começar.</div>';
    atualizarNavColeta(); return;
  }
  var rows = invs.map(function(inv){
    var endCount=(inv.enderecos||[]).length;
    var dataStr=inv.criadoEm?new Date(inv.criadoEm.seconds*1000).toLocaleDateString('pt-BR'):'--';
    var modoTags=(inv.modoFila?_tg('Fila'):'')+(inv.sequencial?_tg('Sequencial'):'');
    var tipoTag=_invTipoTag(inv.tipo);
    var endLbl=inv.modoOrganizacao==='setores'?'setores':'endereços';
    return '<tr>'+
      '<td><strong>'+esc(inv.nome)+'</strong><div style="font-size:12px;color:var(--t3)">'+tipoTag+'</div></td>'+
      '<td>'+(modoTags||'<span style="color:var(--t4)">—</span>')+'</td>'+
      '<td class="num">'+dataStr+'</td>'+
      '<td class="r num">'+endCount+'<span style="color:var(--t3);font-family:var(--sans)"> '+endLbl+'</span></td>'+
      '<td class="r num" id="invcnt-'+inv.id+'">…</td>'+
      '<td>'+(inv.status==='pausado'?_stx('Pausado','warn'):_stx('Aberto','ok'))+'</td>'+
      '<td class="r" style="white-space:nowrap">'+
        '<button class="lk" onclick="abrirDetalheInv(\''+inv.id+'\')">Abrir</button>&nbsp;&nbsp;&nbsp;'+
        (inv.status==='pausado'
          ?'<button class="lk" onclick="retomarInventario(\''+inv.id+'\')">Retomar</button>&nbsp;&nbsp;&nbsp;'
          :'<button class="lk" onclick="pausarInventario(\''+inv.id+'\')">Pausar</button>&nbsp;&nbsp;&nbsp;')+
        '<button class="lk" onclick="encerrarInventario(\''+inv.id+'\')">Encerrar</button>&nbsp;&nbsp;&nbsp;'+
        '<button class="lk lk-d" onclick="abrirModalExcluirInv(\''+inv.id+'\')">Excluir</button>'+
      '</td>'+
    '</tr>';
  }).join('');
  wrap.innerHTML = '<div class="tbl"><table><thead><tr><th>Nome</th><th>Modo</th><th>Criado</th><th class="r">Endereços</th><th class="r">Bipagens</th><th>Status</th><th class="r">Ações</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
  _preencherContagens();
  atualizarNavColeta();
}

// ── Tabs lista ────────────────────────────────────────────────────────────
function switchInvListTab(tab, btn) {
  ['ativos','historico','comparativo'].forEach(function(t){
    var el=document.getElementById('inv-lista-'+t); if(el) el.style.display=t===tab?'':'none';
  });
  document.querySelectorAll('#inv-lista-tabs .tab').forEach(function(b){ b.classList.remove('on'); });
  if (btn) btn.classList.add('on');
  if (tab==='historico') renderInvHistorico();
  if (tab==='comparativo') renderInvComparativo();
}

// ── Histórico com filtros ─────────────────────────────────────────────────
var _histFiltros={nome:'',tipo:''};

function renderInvHistorico() {
  var el=document.getElementById('inv-lista-historico'); if(!el) return;
  var ss='padding:7px 10px;border:1.5px solid var(--gray2);border-radius:8px;font-size:12px;font-family:inherit;background:#fff';
  el.innerHTML=
    '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:14px;padding:12px;background:var(--gray);border-radius:10px">'+
      '<input id="hist-f-nome" placeholder="Buscar por nome..." style="flex:1;min-width:140px;'+ss+'" value="" oninput="_histFiltrar()"/>'+
      '<select id="hist-f-tipo" style="'+ss+'" onchange="_histFiltrar()">'+
        '<option value="">Todos os tipos</option>'+
        '<option value="geral">Geral</option>'+
        '<option value="parcial">Parcial</option>'+
        '<option value="surpresa">Surpresa</option>'+
      '</select>'+
      '<button class="btn btn-s btn-sm" onclick="_histLimparFiltros()" style="white-space:nowrap">Limpar</button>'+
    '</div>'+
    '<div id="hist-lista-items"></div>';
  _histRenderLista();
}

function _histFiltrar() {
  _histFiltros.nome=(document.getElementById('hist-f-nome')||{}).value||'';
  _histFiltros.tipo=(document.getElementById('hist-f-tipo')||{}).value||'';
  _histRenderLista();
}

function _histLimparFiltros() {
  _histFiltros={nome:'',tipo:''};
  renderInvHistorico();
}

function _histRenderLista() {
  var el=document.getElementById('hist-lista-items'); if(!el) return;
  var invs=(S.invsCache||[]).filter(function(i){ return i.status==='encerrado'; });
  if (_histFiltros.nome) {
    var q=_histFiltros.nome.toLowerCase();
    invs=invs.filter(function(i){ return (i.nome||'').toLowerCase().indexOf(q)>=0; });
  }
  if (_histFiltros.tipo) invs=invs.filter(function(i){ return (i.tipo||'geral')===_histFiltros.tipo; });
  if (!invs.length) {
    el.innerHTML='<div style="text-align:center;padding:50px 20px;color:var(--t3)"><div style="font-size:40px;margin-bottom:12px">📁</div><div style="font-size:15px;font-weight:600;margin-bottom:6px">Nenhum inventário encontrado</div></div>';
    return;
  }
  el.innerHTML=invs.map(function(inv){
    var ends=(inv.enderecos||[]).length;
    var dt=inv.encerradoEm?new Date(inv.encerradoEm.seconds*1000).toLocaleDateString('pt-BR'):'—';
    var tipoTag=_invTipoTag(inv.tipo);
    return '<div class="card" style="margin-bottom:12px">'+
      '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">'+
        '<div>'+
          '<div style="font-size:15px;font-weight:700">'+esc(inv.nome)+'</div>'+
          '<div style="font-size:12px;color:var(--t3);margin-top:3px">'+tipoTag+'Encerrado '+dt+' · '+ends+' endereços · '+'<span id="invcnt-'+inv.id+'">…</span> bipagens</div>'+
        '</div>'+
        '<span style="padding:4px 14px;border-radius:20px;font-size:11px;font-weight:700;background:#f0f0f0;color:#666">ENCERRADO</span>'+
      '</div>'+
      '<div style="margin-top:12px;display:flex;gap:8px">'+
        '<button class="btn btn-p btn-sm" onclick="_abrirHistInv(\''+inv.id+'\')">Ver Detalhes</button>'+
      '</div>'+
    '</div>';
  }).join('');
  _preencherContagens();
}

function _abrirHistInv(invId) {
  loadInventariosFromFirebase(function(){
    var inv=(S.invsCache||[]).find(function(i){ return i.id===invId; });
    if (inv) abrirDetalheInv(invId);
  });
}

// ── Comparativo ───────────────────────────────────────────────────────────
function renderInvComparativo() {
  var el=document.getElementById('inv-lista-comparativo'); if(!el) return;
  var invs=S.invsCache||[];
  if (invs.length<2) { el.innerHTML='<div style="text-align:center;padding:40px;color:var(--t3)">São necessários pelo menos 2 inventários para comparar.</div>'; return; }
  var ss='width:100%;padding:8px 10px;border:1.5px solid var(--gray2);border-radius:8px;font-size:13px;font-family:inherit';
  var opts='<option value="">Selecionar...</option>'+invs.map(function(inv){
    return '<option value="'+inv.id+'">'+esc(inv.nome)+' ('+(inv.status==='aberto'?'ativo':inv.status==='pausado'?'pausado':'encerrado')+')</option>';
  }).join('');
  el.innerHTML='<div class="card" style="margin-bottom:14px">'+
    '<div style="font-size:15px;font-weight:700;margin-bottom:12px">Comparativo por Endereço + EAN</div>'+
    '<div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;margin-bottom:4px">'+
      '<div style="flex:1;min-width:180px"><label style="font-size:11px;font-weight:700;color:var(--t2);display:block;margin-bottom:4px">Inventário A</label><select id="cmp-inv-a" style="'+ss+'">'+opts+'</select></div>'+
      '<div style="flex:1;min-width:180px"><label style="font-size:11px;font-weight:700;color:var(--t2);display:block;margin-bottom:4px">Inventário B</label><select id="cmp-inv-b" style="'+ss+'">'+opts+'</select></div>'+
      '<button class="btn btn-p btn-sm" onclick="executarComparativo()">Comparar</button>'+
    '</div>'+
  '</div>'+
  '<div id="cmp-resultado"></div>';
}

function executarComparativo() {
  var idA=(document.getElementById('cmp-inv-a')||{}).value||'';
  var idB=(document.getElementById('cmp-inv-b')||{}).value||'';
  var resEl=document.getElementById('cmp-resultado'); if(!resEl) return;
  if (!idA||!idB) { resEl.innerHTML='<div style="color:var(--r);font-size:13px;padding:10px">Selecione os dois inventários.</div>'; return; }
  if (idA===idB) { resEl.innerHTML='<div style="color:var(--r);font-size:13px;padding:10px">Selecione inventários diferentes.</div>'; return; }
  resEl.innerHTML='<div style="color:var(--t3);font-size:13px;padding:10px">⏳ Carregando bipagens...</div>';
  var invA=(S.invsCache||[]).find(function(i){ return i.id===idA; });
  var invB=(S.invsCache||[]).find(function(i){ return i.id===idB; });
  Promise.all([
    db.collection('inv_bipagens').where('invId','==',idA).get(),
    db.collection('inv_bipagens').where('invId','==',idB).get()
  ]).then(function(snaps){
    var bipsA=snaps[0].docs.map(function(d){ return d.data(); });
    var bipsB=snaps[1].docs.map(function(d){ return d.data(); });
    _renderResultComparativo(invA,invB,bipsA,bipsB,resEl);
  }).catch(function(e){ resEl.innerHTML='<div style="color:var(--r);padding:10px">Erro: '+e.message+'</div>'; });
}

function _buildBipMap(bips,resolucoes) {
  var m={};
  bips.forEach(function(b){
    var res=resolucoes&&resolucoes[b.endereco];
    if (res&&(b.rodada||1)!==res.rodada) return;
    if (!m[b.endereco]) m[b.endereco]={};
    m[b.endereco][b.ean]=(m[b.endereco][b.ean]||0)+(b.qty||1);
  });
  return m;
}

function _renderResultComparativo(invA,invB,bipsA,bipsB,el) {
  var mapA=_buildBipMap(bipsA,invA&&invA.resolucoes);
  var mapB=_buildBipMap(bipsB,invB&&invB.resolucoes);
  var allEnds=[];
  [mapA,mapB].forEach(function(m){ Object.keys(m).forEach(function(e){ if(allEnds.indexOf(e)<0) allEnds.push(e); }); });
  allEnds.sort();
  var rows=[];
  allEnds.forEach(function(end){
    var eA=mapA[end]||{},eB=mapB[end]||{},allEANs=[];
    [eA,eB].forEach(function(m){ Object.keys(m).forEach(function(ean){ if(allEANs.indexOf(ean)<0) allEANs.push(ean); }); });
    allEANs.sort().forEach(function(ean){
      var qA=eA[ean]||0,qB=eB[ean]||0;
      if (qA!==qB) rows.push({end:end,ean:ean,qA:qA,qB:qB,diff:qB-qA});
    });
  });
  if (!rows.length) { el.innerHTML='<div class="card" style="text-align:center;padding:32px;color:var(--g);font-weight:700">✓ Inventários idênticos — nenhuma diferença encontrada.</div>'; return; }
  var nA=invA?_trunc(invA.nome,22):'Inv A',nB=invB?_trunc(invB.nome,22):'Inv B';
  var tbody=rows.map(function(r){
    var ds=r.diff>0?'color:var(--g)':'color:var(--r)',dp=r.diff>0?'+':'';
    return '<tr><td style="font-family:monospace;font-weight:700">'+esc(r.end)+'</td><td style="font-family:monospace;font-size:12px">'+esc(r.ean)+'</td><td style="text-align:right">'+r.qA+'</td><td style="text-align:right">'+r.qB+'</td><td style="text-align:right;font-weight:700;'+ds+'">'+dp+r.diff+'</td></tr>';
  }).join('');
  el.innerHTML='<div class="card" style="padding:0;overflow:hidden">'+
    '<div style="padding:10px 14px;background:var(--gray);border-bottom:1px solid var(--gray2);display:flex;align-items:center;justify-content:space-between">'+
      '<span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--t2)">'+rows.length+' diferença(s)</span>'+
      '<button class="btn btn-s btn-sm" onclick="exportarComparativoCsv()">⬇ CSV</button>'+
    '</div>'+
    '<div style="overflow-x:auto"><table>'+
    '<thead><tr><th>Endereço</th><th>EAN</th><th>'+esc(nA)+'</th><th>'+esc(nB)+'</th><th>Diferença</th></tr></thead>'+
    '<tbody>'+tbody+'</tbody></table></div></div>';
  window._cmpRowsCache=rows; window._cmpNomesCache=[nA,nB];
}

function _trunc(s,n){ return s&&s.length>n?s.substring(0,n)+'…':(s||''); }

function exportarComparativoCsv() {
  var rows=window._cmpRowsCache||[],nomes=window._cmpNomesCache||['A','B'];
  if (!rows.length) return;
  var lines=['ENDERECO;EAN;'+nomes[0]+';'+nomes[1]+';DIFERENCA'];
  rows.forEach(function(r){ lines.push([r.end,r.ean,r.qA,r.qB,r.diff].join(';')); });
  var blob=new Blob(['﻿'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'});
  var url=URL.createObjectURL(blob);
  var a=document.createElement('a'); a.href=url; a.download='comparativo.csv'; a.click();
  setTimeout(function(){ URL.revokeObjectURL(url); },2000);
}

// ── Fila: seleção de endereço ─────────────────────────────────────────────
function _renderSelecaoEndereco(inv, bipCount) {
  var ends=inv.enderecos||[],filaMap=inv.fila||{};
  // Modo Só Setores: mostra botões de setor diretamente (sem scanner/input)
  if (inv.modoOrganizacao === 'setores') {
    var _scol=['#3b5bdb|#e8f0ff|#1a3c9c','#b38600|#fff8e1|#b38600','#1a7a4a|#e8f5ee|#1a5c34','#c0392b|#fdecea|#c0392b','#5b21b6|#ede9fe|#5b21b6','#666|#f0f0f0|#334'];
    var _sico={'ESTOQUE':'📦','LOJA':'🏪','DEPOSITO':'🏭','FREEZER':'❄️','FARMACIA':'💊','ACOUGUE':'🥩','PADARIA':'🍞','HORTIFRUTI':'🥦','BEBIDAS':'🍺','COZINHA':'🍽️','FRIOS':'🧊'};
    var safeInvId=inv.id.replace(/'/g,"\\'");
    var btns=ends.map(function(s,i){
      var c=(_scol[i%_scol.length]).split('|');
      var icon=_sico[s]||'📁';
      var slot=filaMap[s];
      if(slot&&slot.concluido){
        return '<button disabled style="padding:20px 6px;border:2.5px solid #ccc;border-radius:14px;background:#f0f0f0;color:#999;font-size:14px;font-weight:800;cursor:not-allowed;width:100%;box-sizing:border-box;line-height:1.4;opacity:.65">🔒<br>'+esc(s)+'<br><span style="font-size:10px;font-weight:600">encerrado</span></button>';
      }
      var andamento=slot&&!slot.concluido;
      var border=andamento?'border:2.5px solid #b38600':'border:2.5px solid '+c[0];
      var bg=andamento?'background:#fffbe8':'background:'+c[1];
      var cl=andamento?'color:#b38600':'color:'+c[2];
      var ss=s.replace(/'/g,"\\'");
      return '<button onclick="_confirmarSetorFila(\''+safeInvId+'\',\''+ss+'\',\''+ss+'\')" style="padding:20px 6px;'+border+';border-radius:14px;'+bg+';'+cl+';font-size:14px;font-weight:800;cursor:pointer;width:100%;box-sizing:border-box;word-break:break-word;line-height:1.4">'+icon+'<br>'+esc(s)+(andamento?'<br><span style="font-size:10px;font-weight:600">em andamento</span>':'')+'</button>';
    }).join('');
    return '<div>'+
      '<div style="font-size:16px;font-weight:700;margin-bottom:6px">Selecionar Setor</div>'+
      '<div style="font-size:13px;color:var(--t3);margin-bottom:16px">Toque no setor que você vai coletar.</div>'+
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:12px">'+btns+'</div>'+
    '</div>';
  }
  bipCount=bipCount||{};
  var rows=ends.map(function(e){
    var slot=filaMap[e];
    var cnt=bipCount[e]||{total:0,coletores:{}};
    var coletoresStr=Object.keys(cnt.coletores).map(function(id){ return 'Coletor '+id+': '+cnt.coletores[id]+' bip'; }).join(', ');
    var quem,bg;
    var concl=false;
    if (slot&&!slot.concluido) {
      quem='<span style="font-size:11px;color:#b38600;font-weight:600">👤 '+esc(_slotNomes(slot,', '))+' — em andamento</span>';
      bg='background:#fffbe8;';
    } else if (slot&&slot.concluido) {
      quem='<span style="font-size:11px;color:#1a5c34;font-weight:600">✓ '+esc(_slotNomes(slot,', ',''))+' — finalizado'+(cnt.total?' · '+cnt.total+' bip':'')+'</span>';
      bg='background:#f0faf5;'; concl=true;
    } else if (cnt.total>0) {
      quem='<span style="font-size:11px;color:var(--t2);font-weight:600">disponível · '+cnt.total+' bip já registradas'+(coletoresStr?' ('+esc(coletoresStr)+')':'')+'</span>';
      bg='';
    } else {
      quem='<span style="font-size:11px;color:var(--t3)">disponível</span>';
      bg='';
    }
    var safeE=e.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    if (concl) {
      return '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid var(--gray);cursor:not-allowed;opacity:.7;'+bg+'">'+
        '<span style="font-weight:700;font-family:monospace;font-size:14px;color:#888">🔒 '+esc(e)+'</span>'+quem+'</div>';
    }
    return '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid var(--gray);cursor:pointer;'+bg+'" onclick="selecionarEnderecoFila(\''+inv.id+'\',\''+safeE+'\')">'+
      '<span style="font-weight:700;font-family:monospace;font-size:14px">'+esc(e)+'</span>'+quem+'</div>';
  }).join('');
  return '<div>'+
    '<div style="font-size:16px;font-weight:700;margin-bottom:4px">Selecionar Endereço</div>'+
    '<div style="font-size:13px;color:var(--t3);margin-bottom:14px">Scanner físico: aponte e leia diretamente. Câmera: toque em 📷.</div>'+
    '<div style="display:flex;gap:8px;margin-bottom:10px">'+
      '<input id="fila-end-input" type="text" placeholder="Aguardando scanner..." autocomplete="off" autocorrect="off" autocapitalize="characters" inputmode="text" style="flex:1;padding:10px 14px;border:2px solid var(--y);border-radius:9px;font-size:15px;font-family:monospace;text-transform:uppercase" onkeydown="if(event.key===\'Enter\'||event.key===\'Tab\'){event.preventDefault();selecionarEnderecoFila(\''+inv.id+'\',document.getElementById(\'fila-end-input\').value.trim());}" onblur="setTimeout(function(){var m=document.getElementById(\'modal-setor-picker\');var qs=document.getElementById(\'qr-scan-wrap\');if(!m&&(!qs||qs.style.display===\'none\')){var e=document.getElementById(\'fila-end-input\');if(e)e.focus();}},120)"/>'+
      '<button class="btn btn-s btn-sm" id="btn-qr-scan" onclick="iniciarQRScanEndereco(\''+inv.id+'\')" style="font-size:18px;padding:8px 14px" title="Usar câmera">📷</button>'+
      '<button class="btn btn-p btn-sm" onclick="selecionarEnderecoFila(\''+inv.id+'\',document.getElementById(\'fila-end-input\').value.trim())" style="white-space:nowrap">Ir →</button>'+
    '</div>'+
    '<div id="qr-scan-wrap" style="display:none;margin-bottom:12px">'+
      '<video id="qr-video" style="width:100%;max-height:220px;border-radius:10px;background:#111;display:block" autoplay playsinline muted></video>'+
      '<canvas id="qr-canvas" style="display:none"></canvas>'+
      '<button class="btn btn-s" onclick="pararQRScan()" style="margin-top:8px;width:100%">✕ Cancelar câmera</button>'+
    '</div>'+
    '<div id="fila-err" style="color:var(--r);font-size:12px;font-weight:600;min-height:18px;margin-bottom:8px"></div>'+
    '<div class="card" style="padding:0;overflow:hidden">'+
      '<div style="padding:8px 14px;background:var(--gray);border-bottom:1px solid var(--gray2);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--t3)">'+ends.length+' endereços</div>'+
      (rows||'<div style="padding:12px 14px;color:var(--t3)">Nenhum endereço.</div>')+
    '</div></div>';
}

function selecionarEnderecoFila(invId, endereco) {
  pararQRScan();
  var errEl=document.getElementById('fila-err');
  if (!endereco||!endereco.trim()) { if(errEl) errEl.textContent='Digite ou escaneie um endereço válido.'; return; }
  var inv=(S.invsCache||[]).find(function(i){ return i.id===invId; });
  var ends=(inv&&inv.enderecos)||[];
  var endNorm=endereco.trim().toUpperCase();
  var found=ends.find(function(e){ return e.toUpperCase()===endNorm; });
  if (!found) found=ends.find(function(e){ return e.toUpperCase().indexOf(endNorm)===0; });
  if (!found) { if(errEl) errEl.textContent='Endereço "'+endereco.trim()+'" não encontrado.'; return; }
  var slot=(inv.fila||{})[found];
  if (slot&&slot.concluido) {
    if(errEl) errEl.innerHTML='<span style="font-size:13px">🔒 Endereço <strong>'+esc(found)+'</strong> já está encerrado.<br>Fale com o responsável pelo balanço para reabri-lo.</span>';
    return;
  }
  _mostrarSetorPicker(invId, found);
}

// ── Modo Fila com VÁRIOS coletores por endereço ─────────────────────────────
// slot = { setor, desde, concluido, coletores:{ chave:{userId,coletorId,nome,desde,concluido,concluidoEm} }, + campos antigos (userId/coletorId/nome) do 1º coletor }
// Slot antigo (sem `coletores`) continua funcionando: é lido como lista de 1.
function _slotKey(colId){ return String(colId||'').replace(/[.~*\/\[\]]/g,'_')||'x'; }
function _slotColetores(slot){
  if(!slot) return [];
  if(slot.coletores&&Object.keys(slot.coletores).length) return Object.keys(slot.coletores).map(function(k){ return Object.assign({key:k},slot.coletores[k]); });
  if(slot.coletorId||slot.userId) return [{key:_slotKey(slot.coletorId||slot.userId),coletorId:slot.coletorId,userId:slot.userId,nome:slot.nome,desde:slot.desde,concluido:!!slot.concluido}];
  return [];
}
function _slotAtivos(slot){ return _slotColetores(slot).filter(function(c){ return !c.concluido; }); }
function _slotMeu(slot,colId,uid){ return _slotColetores(slot).find(function(c){ return colId ? String(c.coletorId)===String(colId) : c.userId===uid; })||null; }
function _slotNomes(slot,sep,marca){ return _slotColetores(slot).map(function(c){ return (c.nome||c.coletorId||'?')+(c.concluido?(marca||' ✓'):''); }).join(sep||', '); }
function _mostrarSetorPicker(invId, endereco) {
  // No modo Só Setores, o endereço já é o setor — confirma direto
  var inv2=(S.invsCache||[]).find(function(i){ return i.id===invId; });
  if (inv2 && inv2.modoOrganizacao === 'setores') {
    _confirmarSetorFila(invId, endereco, endereco);
    return;
  }
  var safeInvId=invId.replace(/'/g,"\\'");
  var safeEnd=endereco.replace(/'/g,"\\'");
  var html=
    '<div id="modal-setor-picker" onclick="if(event.target===this)_fecharSetorPicker()" style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:2100;display:flex;align-items:flex-end;justify-content:center;padding:0">'+
      '<div style="background:#fff;border-radius:20px 20px 0 0;padding:24px 20px 36px;width:100%;max-width:480px;box-shadow:0 -4px 32px rgba(0,0,0,.18)">'+
        '<div style="font-size:17px;font-weight:800;margin-bottom:4px">Selecionar Setor</div>'+
        '<div style="font-size:13px;color:var(--t3);margin-bottom:20px">Endereço: <strong style="font-family:monospace">'+esc(endereco)+'</strong></div>'+
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(90px,1fr));gap:10px;margin-bottom:14px" id="setor-picker-btns"></div>'+
        '<button onclick="_fecharSetorPicker()" style="width:100%;padding:11px;border:1.5px solid var(--gray2);border-radius:10px;background:#fff;font-size:14px;font-weight:600;font-family:inherit;cursor:pointer;color:var(--t2)">Cancelar</button>'+
      '</div>'+
    '</div>';
  document.body.insertAdjacentHTML('beforeend', html);
  // Popula botões de setor dinamicamente
  var inv=(S.invsCache||[]).find(function(i){ return i.id===invId; });
  var setores=(inv&&inv.setores&&inv.setores.length)?inv.setores:['ESTOQUE','LOJA'];
  var _setorColors=['#3b5bdb|#e8f0ff|#1a3c9c','#b38600|#fff8e1|#b38600','#1a7a4a|#e8f5ee|#1a5c34','#c0392b|#fdecea|#c0392b','#5b21b6|#ede9fe|#5b21b6','#666|#f0f0f0|#334'];
  var _setorIcons={'ESTOQUE':'📦','LOJA':'🏪','DEPOSITO':'🏭','FREEZER':'❄','FARMACIA':'💊','ACOUGUE':'🥩','PADARIA':'🍞','HORTIFRUTI':'🥦','BEBIDAS':'🍺'};
  var btnsEl=document.getElementById('setor-picker-btns');
  if(btnsEl){
    btnsEl.innerHTML=setores.map(function(s,i){
      var c=(_setorColors[i%_setorColors.length]).split('|');
      var icon=_setorIcons[s]||'📁';
      var ss=s.replace(/'/g,"\\'");
      return '<button onclick="_confirmarSetorFila(\''+safeInvId+'\',\''+safeEnd+'\',\''+ss+'\')" style="padding:14px 6px;border:2.5px solid '+c[0]+';border-radius:12px;background:'+c[1]+';color:'+c[2]+';font-size:13px;font-weight:800;cursor:pointer;width:100%;box-sizing:border-box;word-break:break-word;line-height:1.3">'+icon+'<br>'+esc(s)+'</button>';
    }).join('');
  }
}

function _fecharSetorPicker() {
  var m=document.getElementById('modal-setor-picker'); if(m) m.remove();
}

function _confirmarSetorFila(invId, found, setor) {
  _fecharSetorPicker();
  var u=S.currentUser;
  var coletorId=_getIdColetor(), nomeColetor=_getNomeColetor();
  var displayNome=coletorId+(nomeColetor?' - '+nomeColetor:'');
  var inv=(S.invsCache||[]).find(function(i){ return i.id===invId; });
  var slot=(inv&&inv.fila||{})[found]||null;
  var key=_slotKey(coletorId||(u&&u.id));
  // Já tem outro coletor ativo aqui? Pergunta antes de entrar junto.
  var outros=_slotAtivos(slot).filter(function(c){ return c.key!==key; });
  if (outros.length && !confirm('Já tem '+outros.length+' coletor'+(outros.length>1?'es':'')+' neste endereço ('+outros.map(function(c){ return c.nome||c.coletorId; }).join(', ')+').\nEntrar junto e contar em paralelo?')) return;
  var entrada={userId:u?u.id:'',coletorId:coletorId,nome:displayNome,desde:firebase.firestore.FieldValue.serverTimestamp(),concluido:false};
  var ref=db.collection('inv_inventarios').doc(invId), p;
  if (!slot) {
    var novo={userId:entrada.userId,coletorId:coletorId,nome:displayNome,setor:setor,desde:entrada.desde,concluido:false,coletores:{}}; novo.coletores[key]=entrada;
    p=ref.update(new firebase.firestore.FieldPath('fila',found), novo);
  } else {
    // Slot antigo sem lista: converte o 1º coletor pra lista antes de adicionar o novo
    var lista={}; _slotColetores(slot).forEach(function(c){ lista[c.key]={userId:c.userId||'',coletorId:c.coletorId||'',nome:c.nome||'',desde:c.desde||null,concluido:!!c.concluido}; if(c.concluidoEm) lista[c.key].concluidoEm=c.concluidoEm; });
    lista[key]=entrada;
    p=ref.update(
      new firebase.firestore.FieldPath('fila',found,'coletores'), lista,
      new firebase.firestore.FieldPath('fila',found,'concluido'), false,
      new firebase.firestore.FieldPath('fila',found,'setor'), slot.setor||setor
    );
  }
  p.then(function(){
    _filaEndAtual={invId:invId,endereco:found,setor:(slot&&slot.setor)||setor};
    if (!localStorage.getItem(_COLETOR_INV_KEY)) localStorage.setItem(_COLETOR_INV_KEY, invId);
    loadInventariosFromFirebase(function(){ renderColeta(); });
  }).catch(function(e){ alert('Erro ao entrar no endereço: '+e.message); });
}
function liberarEnderecoFila(invId, endereco) {
  var inv = (S.invsCache||[]).find(function(i){ return i.id===invId; });
  var slot = inv && inv.fila && inv.fila[endereco];
  _filaEndAtual=null;
  if (!slot || slot.concluido) return; // concluído fica registrado pro painel
  var key=_slotKey(_getIdColetor()||(S.currentUser&&S.currentUser.id));
  var restantes=_slotColetores(slot).filter(function(c){ return c.key!==key; });
  var ref=db.collection('inv_inventarios').doc(invId);
  if (!restantes.length) { ref.update(new firebase.firestore.FieldPath('fila',endereco), firebase.firestore.FieldValue.delete()).catch(function(){}); return; }
  var lista={}; restantes.forEach(function(c){ lista[c.key]={userId:c.userId||'',coletorId:c.coletorId||'',nome:c.nome||'',desde:c.desde||null,concluido:!!c.concluido}; if(c.concluidoEm) lista[c.key].concluidoEm=c.concluidoEm; });
  var primeiro=restantes[0];
  ref.update(
    new firebase.firestore.FieldPath('fila',endereco,'coletores'), lista,
    new firebase.firestore.FieldPath('fila',endereco,'userId'), primeiro.userId||'',
    new firebase.firestore.FieldPath('fila',endereco,'coletorId'), primeiro.coletorId||'',
    new firebase.firestore.FieldPath('fila',endereco,'nome'), primeiro.nome||''
  ).catch(function(){});
}
// ── QR Code Scanner ───────────────────────────────────────────────────────
function iniciarQRScanEndereco(invId) {
  var wrap=document.getElementById('qr-scan-wrap'); if(!wrap) return;
  if (_qrStream) { pararQRScan(); return; }
  wrap.style.display='block';
  navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}})
    .then(function(stream){
      _qrStream=stream;
      var video=document.getElementById('qr-video');
      video.srcObject=stream; video.play();
      _qrTickEndereco(invId,video,document.getElementById('qr-canvas'));
    })
    .catch(function(err){
      wrap.style.display='none';
      var errEl=document.getElementById('fila-err');
      if(errEl) errEl.textContent='Câmera indisponível: '+(err.message||err);
    });
}

function _qrTickEndereco(invId,video,canvas) {
  if (!_qrStream) return;
  if (video.readyState===video.HAVE_ENOUGH_DATA) {
    canvas.height=video.videoHeight; canvas.width=video.videoWidth;
    var ctx=canvas.getContext('2d');
    ctx.drawImage(video,0,0,canvas.width,canvas.height);
    var imgData=ctx.getImageData(0,0,canvas.width,canvas.height);
    var code=(typeof jsQR!=='undefined')?jsQR(imgData.data,imgData.width,imgData.height,{inversionAttempts:'dontInvert'}):null;
    if (code&&code.data) {
      var val=code.data.trim(); pararQRScan();
      var inp=document.getElementById('fila-end-input'); if(inp) inp.value=val;
      selecionarEnderecoFila(invId,val); return;
    }
  }
  _qrAnimFrame=requestAnimationFrame(function(){ _qrTickEndereco(invId,video,canvas); });
}

function pararQRScan() {
  if (_qrAnimFrame){ cancelAnimationFrame(_qrAnimFrame); _qrAnimFrame=null; }
  if (_qrStream){ _qrStream.getTracks().forEach(function(t){ t.stop(); }); _qrStream=null; }
  var wrap=document.getElementById('qr-scan-wrap'); if(wrap) wrap.style.display='none';
}

// ── Leitura de EAN/código de barras de produto pela câmera ────────────────
// (diferente do scan de endereço acima, que só lê QR — código de barras de
// produto é 1D. Usa ZXing (decodificação 100% em JS) em vez da BarcodeDetector
// nativa do navegador: no coletor essa API ou não existe, ou existe mas o
// device não tem o módulo de barcode do ML Kit instalado, e o detect() fica
// resolvendo vazio pra sempre sem erro nenhum — a câmera abre mas nunca lê.)
var _eanCodeReader = null;

function iniciarScanEAN(inputId) {
  if (_eanCodeReader) { pararScanEAN(); return; }
  if (typeof ZXing === 'undefined') {
    showToast('Leitor de código de barras não carregou (sem internet?). Use o scanner físico ou digite manualmente.', 5000);
    return;
  }
  var overlay = document.createElement('div');
  overlay.id = 'ean-scan-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:#000;z-index:4000;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px';
  overlay.innerHTML =
    '<video id="ean-scan-video" style="width:100%;max-width:480px;aspect-ratio:5/2;object-fit:cover;border-radius:10px;background:#111" autoplay playsinline muted></video>'+
    '<div style="color:#fff;font-size:13px;margin:14px 0">Aponte para o código de barras do produto</div>'+
    '<button onclick="pararScanEAN()" style="padding:10px 24px;background:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer">✕ Cancelar</button>';
  document.body.appendChild(overlay);

  var hints = new Map();
  hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
    ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.EAN_8,
    ZXing.BarcodeFormat.UPC_A, ZXing.BarcodeFormat.UPC_E, ZXing.BarcodeFormat.CODE_128
  ]);
  var reader = new ZXing.BrowserMultiFormatReader(hints);
  _eanCodeReader = reader;
  reader.decodeFromConstraints({video:{facingMode:'environment'}}, 'ean-scan-video', function(result){
    if (result && _eanCodeReader === reader) {
      _bipSom('leitura');
      var val = result.getText();
      pararScanEAN();
      var inp = document.getElementById(inputId);
      if (inp) {
        inp.value = val;
        inp.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true}));
      }
    }
  }).catch(function(err){
    var ov=document.getElementById('ean-scan-overlay'); if(ov) ov.remove();
    _eanCodeReader = null;
    showToast('Câmera indisponível: '+(err.message||err));
  });
}

function pararScanEAN() {
  if (_eanCodeReader) { try { _eanCodeReader.reset(); } catch(e){} _eanCodeReader = null; }
  var ov = document.getElementById('ean-scan-overlay'); if (ov) ov.remove();
}


// ── Câmera fixa na coleta: fica aberta num quadro acima do campo e lê em sequência ──
// Lê → bip → preenche o campo → pula pra Qtd. A câmera continua ligada pro próximo item.
var _camFixa = null, _camFixaUltimo = {val:'', t:0}, _camFixaCand = {val:'', t:0};
var _CAM_FIXA_KEY = 'kontar_cam_fixa';
function _camFixaLigada(){ return localStorage.getItem(_CAM_FIXA_KEY)==='1'; }
function _toggleCamFixa(){
  if (_camFixa) { localStorage.setItem(_CAM_FIXA_KEY,'0'); _pararCamFixa(); _atualizarBtnCamFixa(); return; }
  localStorage.setItem(_CAM_FIXA_KEY,'1'); _iniciarCamFixa();
}
function _atualizarBtnCamFixa(){
  var b=document.getElementById('inv-cam-btn'); if(!b) return;
  var on=!!_camFixa;
  b.style.background=on?'var(--y)':'#fff'; b.style.borderColor=on?'var(--y)':'var(--gray2)';
  b.title=on?'Câmera ligada — toque pra desligar':'Ligar câmera (fica aberta pra ler em sequência)';
}
function _iniciarCamFixa(){
  if (_camFixa) return;
  var wrap=document.getElementById('inv-cam-fixa'); if(!wrap) return;
  if (typeof ZXing==='undefined'){ showToast('Leitor de código de barras não carregou (sem internet?). Use o leitor físico ou digite.',5000); return; }
  wrap.style.display='block';
  wrap.innerHTML='<div style="position:relative;border-radius:10px;overflow:hidden;background:#111">'+
    '<video id="inv-cam-video" style="width:100%;max-height:170px;aspect-ratio:3/1;object-fit:cover;display:block" autoplay playsinline muted></video>'+
    '<div style="position:absolute;left:8%;right:8%;top:50%;height:2px;background:rgba(249,115,22,.85);box-shadow:0 0 8px rgba(249,115,22,.8)"></div>'+
    '<div id="inv-cam-msg" style="position:absolute;left:8px;bottom:6px;color:#fff;font-size:11px;font-weight:600;text-shadow:0 1px 2px #000">Aponte pro código de barras</div>'+
  '</div>';
  var hints=new Map();
  hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS,[ZXing.BarcodeFormat.EAN_13,ZXing.BarcodeFormat.EAN_8,ZXing.BarcodeFormat.UPC_A,ZXing.BarcodeFormat.UPC_E,ZXing.BarcodeFormat.CODE_128]);
  // 80 ms entre tentativas (padrão da lib é 500 ms — com a dupla leitura exigida abaixo dava >1 s por item)
  var reader=new ZXing.BrowserMultiFormatReader(hints, 80);
  try { reader.timeBetweenDecodingAttempts=80; } catch(e){}
  _camFixa=reader; _atualizarBtnCamFixa();
  var leu=function(val){
    if (_camFixa!==reader||_decisaoAberta()||!val) return;
    var agora=Date.now();
    // Exige a mesma leitura 2x seguidas (em até 1,2 s) antes de aceitar: corta leitura errada da câmera
    if (!(_camFixaCand.val===val&&agora-_camFixaCand.t<1200)) { _camFixaCand={val:val,t:agora}; return; }
    // Mesma etiqueta ainda na frente da câmera: janela deslizante — só aceita de novo depois que o
    // código ficou 1,5 s sem aparecer (tirou a câmera do item), não a cada 2,5 s com ele parado ali.
    if (val===_camFixaUltimo.val&&agora-_camFixaUltimo.t<1500) { _camFixaUltimo.t=agora; return; }
    var ei=document.getElementById('inv-ean-input'), qi=document.getElementById('inv-qty-input');
    if (!ei||ei.disabled) return;
    // Item anterior ainda esperando a Qtd: a câmera NÃO fecha sozinha (registrava sem o Enter quando a
    // etiqueta ficava na frente ou a câmera pegava o código vizinho). Espera o operador confirmar.
    if (ei.value.trim()&&document.activeElement===qi) {
      _camFixaCand={val:'',t:0};
      if (val===ei.value.trim()) _camFixaUltimo={val:val,t:agora};
      var mq=document.getElementById('inv-cam-msg'); if(mq) mq.textContent='Confirme a quantidade (↵) pra ler o próximo';
      return;
    }
    _camFixaUltimo={val:val,t:agora}; _camFixaCand={val:'',t:0};
    _bipSom('leitura');
    ei.value=val; ei.dispatchEvent(new Event('input'));
    var m=document.getElementById('inv-cam-msg'); if(m){ m.textContent='Lido: '+val; setTimeout(function(){ if(m) m.textContent='Aponte pro código de barras'; },1500); }
    _eanEnterKey(true);
  };
  // 720p + foco contínuo: no padrão (640x480, sem pedir foco) o EAN chega borrado e o ZXing fica tentando.
  var constraints={video:{facingMode:'environment',width:{ideal:1280},height:{ideal:720},focusMode:'continuous'}};
  reader.decodeFromConstraints(constraints,'inv-cam-video',function(result){ if(result) leu(result.getText()); })
  .then(function(){ _afinarCamFixa(reader); })
  .catch(function(err){ _pararCamFixa(); localStorage.setItem(_CAM_FIXA_KEY,'0'); showToast('Câmera indisponível: '+(err.message||err)); });
  // Leitor nativo do navegador (ML Kit) em PARALELO, quando existir: lê em ~1 frame. O ZXing continua
  // rodando, então se o nativo não devolver nada (aparelho sem o módulo) nada muda.
  if ('BarcodeDetector' in window) {
    try {
      var det=new BarcodeDetector({formats:['ean_13','ean_8','upc_a','upc_e','code_128']}), ocupado=false;
      _camFixaDetTimer=setInterval(function(){
        var v=document.getElementById('inv-cam-video');
        if (_camFixa!==reader){ clearInterval(_camFixaDetTimer); _camFixaDetTimer=null; return; }
        if (ocupado||!v||v.readyState<2) return;
        ocupado=true;
        det.detect(v).then(function(codes){ ocupado=false; if(codes&&codes.length) leu(codes[0].rawValue); }).catch(function(){ ocupado=false; });
      }, 120);
    } catch(e){}
  }
}
var _camFixaDetTimer=null;
// Depois que o stream abre: liga foco contínuo e um zoom leve (EAN pequeno fica legível de mais longe).
function _afinarCamFixa(reader){
  try {
    var track=reader.stream&&reader.stream.getVideoTracks&&reader.stream.getVideoTracks()[0]; if(!track) return;
    var cap=track.getCapabilities?track.getCapabilities():{}, adv=[];
    if (cap.focusMode&&cap.focusMode.indexOf('continuous')>=0) adv.push({focusMode:'continuous'});
    if (cap.zoom&&cap.zoom.max>=1.5) adv.push({zoom:Math.min(cap.zoom.max, Math.max(cap.zoom.min||1, 1.5))});
    if (adv.length) track.applyConstraints({advanced:adv}).catch(function(){});
  } catch(e){}
}
function _pararCamFixa(){
  if (_camFixaDetTimer){ clearInterval(_camFixaDetTimer); _camFixaDetTimer=null; }
  if (_camFixa){ try{ _camFixa.reset(); }catch(e){} _camFixa=null; }
  var wrap=document.getElementById('inv-cam-fixa'); if(wrap){ wrap.innerHTML=''; wrap.style.display='none'; }
  _atualizarBtnCamFixa();
}

// ── Gerar QR codes dos endereços para impressão ───────────────────────────
function gerarQREnderecos() {
  if (!_invAtivo) return;
  var inv = _invAtivo;
  var enderecos = inv.enderecos || [];
  if (!enderecos.length) { showToast('Nenhum endereço cadastrado.'); return; }
  var logoEl = document.querySelector('.sb-logo img');
  var logoSrc = logoEl ? logoEl.src : '';
  var data = new Date().toLocaleDateString('pt-BR');
  var logoCard = logoSrc
    ? '<img src="'+logoSrc+'" class="card-logo" alt="Logo"/>'
    : '<div class="card-logo-txt">Kontar</div>';
  var cards = enderecos.map(function(end, i) {
    var enc = encodeURIComponent(end);
    var safeId = 'bc'+i;
    return '<div class="qr-card">'
      + logoCard
      + '<img src="https://api.qrserver.com/v1/create-qr-code/?data='+enc+'&size=150x150&margin=4" width="150" height="150" alt="'+esc(end)+'"/>'
      + '<div class="divider"></div>'
      + '<svg id="'+safeId+'" class="barcode"></svg>'
      + '<div class="addr">'+esc(end)+'</div>'
      + '<div class="inv-info">'+esc(inv.loja)+'</div>'
      + '</div>';
  }).join('');
  var barcodeInits = enderecos.map(function(end, i) {
    return 'JsBarcode("#bc'+i+'","'+end.replace(/"/g,'\\"')+'",{format:"CODE128",width:1.6,height:48,displayValue:false,margin:4});';
  }).join('');
  var html = '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">'
    + '<title>Etiquetas — '+esc(inv.loja)+'</title>'
    + '<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"><\/script>'
    + '<style>'
    + '*{box-sizing:border-box;margin:0;padding:0}'
    + '@page{margin:12mm}'
    + 'body{font-family:Arial,sans-serif;background:#fff;color:#111}'
    + '.header{display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid #F97316;padding-bottom:12px;margin-bottom:24px}'
    + '.header img{height:56px;object-fit:contain}'
    + '.header-fb{font-size:20px;font-weight:800}'
    + '.header-info{text-align:right}'
    + '.header-info h1{font-size:15px;font-weight:800}'
    + '.header-info p{font-size:11px;color:#666;margin-top:3px}'
    + '.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}'
    + '.qr-card{border:2px solid #222;border-radius:10px;padding:14px 10px;text-align:center;page-break-inside:avoid}'
    + '.qr-card img{display:block;margin:0 auto}'
    + '.card-logo{height:32px;object-fit:contain;display:block;margin:0 auto 10px}'
    + '.card-logo-txt{font-size:13px;font-weight:800;color:#F97316;letter-spacing:1px;margin-bottom:10px;font-family:Arial,sans-serif}'
    + '.divider{border-top:1px dashed #ccc;margin:10px 0}'
    + '.barcode{width:100%;max-width:180px;display:block;margin:0 auto}'
    + '.addr{font-size:15px;font-weight:800;margin-top:8px;font-family:monospace;letter-spacing:.5px;word-break:break-all}'
    + '.inv-info{font-size:10px;color:#888;margin-top:3px}'
    + '.instr{margin-top:24px;text-align:center;font-size:11px;color:#aaa;border-top:1px solid #eee;padding-top:10px}'
    + '</style></head><body>'
    + '<div class="header">'
    + (logoSrc ? '<img src="'+logoSrc+'" alt="Logo"/>' : '<div class="header-fb">Kontar</div>')
    + '<div class="header-info"><h1>Etiquetas de Endereço — Inventário</h1><p>'+esc(inv.loja)+' &nbsp;|&nbsp; '+data+'</p></div>'
    + '</div>'
    + '<div class="grid">'+cards+'</div>'
    + '<div class="instr">Scanner 2D: escaneie o QR code &nbsp;|&nbsp; Scanner 1D: escaneie o código de barras &nbsp;|&nbsp; Sem scanner: câmera do celular ou digitação</div>'
    + '<script>window.onload=function(){'+barcodeInits+' setTimeout(function(){window.print();},400);};<\/script>'
    + '</body></html>';
  var w = window.open('', '_blank', 'width=900,height=700');
  if (w) { w.document.write(html); w.document.close(); }
  else showToast('Permita pop-ups para gerar as etiquetas.');
}

// ── Override _encontrarAtribuicao — suporte a modoFila ────────────────────
function _encontrarAtribuicao() {
  var uid=S.currentUser?S.currentUser.id:null; if(!uid) return null;
  var invs=S.invsCache||[];
  var filaInv=invs.find(function(i){ return i.status==='aberto'&&i.modoFila; });
  if (filaInv) {
    if (_filaEndAtual&&_filaEndAtual.invId===filaInv.id) {
      var slot=(filaInv.fila||{})[_filaEndAtual.endereco]||{};
      var meu=_slotMeu(slot,_getIdColetor(),uid);
      return {inv:filaInv,endereco:_filaEndAtual.endereco,rodada:1,modo:'colaboracao',concluido:!!(slot.concluido||(meu&&meu.concluido))};
    }
    return {inv:filaInv,endereco:null,rodada:1,modo:'colaboracao',concluido:false};
  }
  for (var i=0;i<invs.length;i++){
    var inv=invs[i]; if(inv.status!=='aberto') continue;
    var atribs=inv.atribuicoes||{},ends=Object.keys(atribs);
    for (var j=0;j<ends.length;j++){
      var end=ends[j],atrib=_normalizeAtrib(atribs[end]);
      var ci=atrib.coletores.find(function(c){ return c.userId===uid; });
      if (ci) return {inv:inv,endereco:end,rodada:ci.rodada||1,modo:atrib.modo,concluido:ci.concluido||false};
    }
  }
  return null;
}

// ── ID de Coletor (localStorage) ──────────────────────────────────────────
var _COLETOR_KEY     = 'kontar_coletor_id';
var _COLETOR_INV_KEY = 'kontar_coletor_inv'; // invId do inventário em que o ID foi registrado
var _PALLET_KEY      = 'kontar_modo_pallet';
// ── Bip sonoro (WebAudio, sem asset). AudioContext nasce no 1º toque (autoplay Android). ──
var _bipCtx = null;
function _bipCtxGet(){ try{ if(!_bipCtx) _bipCtx=new (window.AudioContext||window.webkitAudioContext)(); if(_bipCtx.state==='suspended') _bipCtx.resume(); return _bipCtx; }catch(e){ return null; } }
document.addEventListener('touchstart', function(){ _bipCtxGet(); }, {once:true, passive:true});
document.addEventListener('click', function(){ _bipCtxGet(); }, {once:true});
function _bipSom(tipo) {
  var ctx=_bipCtxGet(); if(!ctx) return;
  // leitura = bipe curto (código entrou); ok = dois tons subindo (bipagem GRAVADA) — soam diferentes de propósito
  var seq = tipo==='erro' ? [[300,250]] : tipo==='alerta' ? [[600,90],[600,90]] : tipo==='leitura' ? [[1200,60]] : [[880,70],[1320,120]];
  var t=ctx.currentTime;
  seq.forEach(function(p){
    var o=ctx.createOscillator(), g=ctx.createGain();
    o.type='square'; o.frequency.value=p[0]; o.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0.25,t); g.gain.exponentialRampToValueAtTime(0.001,t+p[1]/1000);
    o.start(t); o.stop(t+p[1]/1000); t+=p[1]/1000+0.05;
  });
}
function _getModoPallet(){ return localStorage.getItem(_PALLET_KEY)==='1'; }
function _toggleModoPallet(){
  var on=!_getModoPallet();
  localStorage.setItem(_PALLET_KEY,on?'1':'0');
  var fw=document.getElementById('inv-fator-wrap');
  if(fw) fw.style.display=on?'':'none';
  var btn=document.getElementById('inv-pallet-btn');
  if(btn){
    btn.style.background=on?'var(--y)':'#fff';
    btn.style.border='1.5px solid '+(on?'var(--y)':'var(--gray2)');
    btn.style.color=on?'#111':'var(--t2)';
    btn.textContent='🏗 Pallet '+(on?'ON':'—');
  }
  if(on){ var fi=document.getElementById('inv-fator-input'); if(fi){fi.value='1';fi.focus();} }
  else { var qi=document.getElementById('inv-qty-input'); if(qi) qi.focus(); }
}

function _getIdColetor() {
  return (localStorage.getItem(_COLETOR_KEY)||'').trim();
}

// Tira zero à esquerda de IDs numéricos (01 -> 1) pra "01" e "1" nunca virarem
// dois coletores diferentes na mesma lista. Não mexe em IDs alfanuméricos (A01).
function _normColetorId(id) {
  return (id||'').trim().toUpperCase().replace(/^0+(?=\d)/, '');
}

function _setIdColetor(id) {
  localStorage.setItem(_COLETOR_KEY, _normColetorId(id));
}

var _COLETOR_NOME_KEY = 'kontar_coletor_nome';
function _getNomeColetor(){ return (localStorage.getItem(_COLETOR_NOME_KEY)||'').trim(); }
function _setNomeColetor(nome){ localStorage.setItem(_COLETOR_NOME_KEY,(nome||'').trim()); }

function _htmlIdColetorForm() {
  var atual = _getIdColetor();
  var nomeAtual = _getNomeColetor();
  return '<div style="max-width:360px;margin:50px auto;padding:28px 24px;background:#fff;border-radius:16px;border:1px solid var(--gray2);box-shadow:var(--sh)">'+
    '<div style="font-size:19px;font-weight:800;margin-bottom:6px">Identificação</div>'+
    '<div style="font-size:13px;color:var(--t2);margin-bottom:20px">Informe seu ID e nome para começar.</div>'+
    '<label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--t2);display:block;margin-bottom:8px">ID de Coletor</label>'+
    '<input id="coletor-id-novo" type="text" value="'+esc(atual)+'" placeholder="Ex: 01, A1, C3" autocomplete="off" '+
      'style="width:100%;padding:14px;border:2.5px solid var(--y);border-radius:10px;font-size:22px;font-weight:700;font-family:monospace;text-align:center;letter-spacing:3px;margin-bottom:12px;box-sizing:border-box" '+
      'onkeydown="if(event.key===\'Enter\'){document.getElementById(\'coletor-nome-novo\').focus();}"/>'+
    '<label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--t2);display:block;margin-bottom:8px">Seu Nome</label>'+
    '<input id="coletor-nome-novo" type="text" value="'+esc(nomeAtual)+'" placeholder="Ex: João Freire" autocomplete="off" '+
      'style="width:100%;padding:13px;border:1.5px solid var(--gray2);border-radius:10px;font-size:15px;margin-bottom:16px;box-sizing:border-box;font-family:inherit" '+
      'onkeydown="if(event.key===\'Enter\')_confirmarIdColetor()"/>'+
    '<button onclick="_confirmarIdColetor()" style="width:100%;padding:14px;background:var(--y);color:#111;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit">Começar →</button>'+
  '</div>';
}

function _confirmarIdColetor() {
  var val = _normColetorId((document.getElementById('coletor-id-novo')||{}).value);
  var nome = ((document.getElementById('coletor-nome-novo')||{}).value||'').trim();
  if (!val) { alert('Informe seu ID de coletor.'); return; }
  _setIdColetor(val);
  _setNomeColetor(nome);
  var activeInv=(S.invsCache||[]).find(function(i){ return i.status==='aberto'; });
  if(activeInv) {
    localStorage.setItem(_COLETOR_INV_KEY, activeInv.id);
    if(S.currentUser) {
      var regKey='col_'+val; // chave por coletorId — funciona com login compartilhado
      var upd={}; upd['coletoresReg.'+regKey]={coletorId:val,nome:nome||val,userNome:S.currentUser.nome||'',registradoEm:firebase.firestore.FieldValue.serverTimestamp()};
      db.collection('inv_inventarios').doc(activeInv.id).update(upd).catch(function(){});
    }
  }
  renderColeta();
}

function _editarIdColetor() {
  var wrap = document.getElementById('inv-coleta-wrap'); if(!wrap) return;
  wrap.innerHTML = _htmlIdColetorForm();
  setTimeout(function(){ var el=document.getElementById('coletor-id-novo'); if(el){el.focus();el.select();} }, 100);
}

// ── Override renderColeta — ID coletor + modoFila picker ──────────────────
function renderColeta() {
  pararQRScan(); _pararCamFixa(); _descFixa(false);
  var wrap=document.getElementById('inv-coleta-wrap'); if(!wrap) return;
  var u=S.currentUser;
  if (!u) { wrap.innerHTML='<div style="padding:40px;text-align:center;color:var(--t3)">Faça login.</div>'; return; }

  // Pausa: acompanha o doc do inventário em tempo real e trava a tela
  var _invPausado=(S.invsCache||[]).find(function(i){ return i.status==='pausado'; });
  var _anyAberto=(S.invsCache||[]).find(function(i){ return i.status==='aberto'; });
  var _invAcomp=_anyAberto||_invPausado; if(_invAcomp) _iniciarColetaRealtime(_invAcomp.id); else _pararColetaRealtime();
  if(!_anyAberto&&_invPausado){ wrap.innerHTML=_htmlColetaPausada(_invPausado.nome); return; }

  // Novo inventário → limpa ID salvo e exige nova identificação
  if(_anyAberto){
    var _savedInv=localStorage.getItem(_COLETOR_INV_KEY);
    // Só limpa se há um inv salvo E ele é diferente do atual (troca de inventário)
    // Se _savedInv é null, mantém o ID — usuário pode ter registrado antes desta feature
    if(_savedInv && _savedInv!==_anyAberto.id){
      localStorage.removeItem(_COLETOR_KEY);
      localStorage.removeItem(_COLETOR_NOME_KEY);
      localStorage.removeItem(_COLETOR_INV_KEY);
    }
  }

  // Exige ID de coletor antes de qualquer coisa
  if (!_getIdColetor()) {
    wrap.innerHTML = _htmlIdColetorForm();
    setTimeout(function(){ var el=document.getElementById('coletor-id-novo'); if(el) el.focus(); }, 100);
    return;
  }
  var invs=S.invsCache||[];
  var filaInv=invs.find(function(i){ return i.status==='aberto'&&i.modoFila; });
  if (filaInv&&(!_filaEndAtual||_filaEndAtual.invId!==filaInv.id)) {
    // Auto-restaura sessão após F5: se o usuário tem slot ativo na fila, retoma direto
    var filaMap=filaInv.fila||{}, myColId=_getIdColetor();
    var myEnd=Object.keys(filaMap).find(function(e){ var s=filaMap[e]; if(!s||s.concluido) return false; var meu=_slotMeu(s,myColId,u.id); return !!(meu&&!meu.concluido); });
    if (myEnd) { _filaEndAtual={invId:filaInv.id,endereco:myEnd,setor:(filaMap[myEnd]||{}).setor||''}; }
    else {
    db.collection('inv_inventarios').doc(filaInv.id).get().then(function(snap){
      if (!snap.exists) return;
      var fresh=Object.assign({id:snap.id},snap.data());
      // Só o estado do slot (vem no doc do inventário): não baixa as bipagens inteiras.
      wrap.innerHTML='<div>'+
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:20px">'+
          '<div style="font-size:17px;font-weight:700;flex:1">'+esc(fresh.nome)+'</div>'+
          '<span style="padding:4px 14px;border-radius:20px;font-size:11px;font-weight:700;background:#d1f0e0;color:#1a5c34">ABERTO</span>'+
        '</div>'+
        _renderSelecaoEndereco(fresh, {})+'</div>';
      setTimeout(function(){ var el=document.getElementById('fila-end-input'); if(el){ el.focus(); el.select(); } },80);
    });
    return;
    } // end else (sem slot próprio)
  }
  var info=_encontrarAtribuicao();
  if (!info||!info.endereco) {
    wrap.innerHTML='<div style="text-align:center;padding:60px 20px;color:var(--t3)">'+
      '<div style="font-size:48px;margin-bottom:16px">📦</div>'+
      '<div style="font-size:16px;font-weight:600;margin-bottom:8px">Sem coleta atribuída</div>'+
      '<div style="font-size:13px">Aguarde o administrador atribuir um endereço.</div>'+
    '</div>';
    return;
  }
  _invColetaAtual=info;
  var end=info.endereco,inv=info.inv,rodada=info.rodada||1,modo=info.modo||'colaboracao',concluido=info.concluido||false;
  var isModoFila=!!(inv&&inv.modoFila);
  var mb=modo==='auditoria'
    ?'<span style="padding:3px 12px;border-radius:20px;font-size:11px;font-weight:700;background:#ede9fe;color:#5b21b6">Auditoria — Rodada '+rodada+'</span>'
    :'<span style="padding:3px 12px;border-radius:20px;font-size:11px;font-weight:700;background:#e8f5ee;color:#1a5c34">'+(isModoFila?'Fila':'Colaboração')+'</span>';
  // Concluído: só limpa estado local (não apaga o slot — endereço deve continuar marcado como finalizado)
  // Em andamento: libera o slot para outro coletor poder pegar
  var mudarBtn=isModoFila
    ?(concluido
      ?'<button onclick="_filaEndAtual=null;renderColeta()" style="padding:7px 14px;background:#fff;border:1.5px solid var(--gray2);border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;margin-bottom:14px">← Próximo Endereço</button>'
      :'<button onclick="liberarEnderecoFila(\''+inv.id+'\',\''+end.replace(/'/g,"\\'")+'\');renderColeta()" style="padding:7px 14px;background:#fff;border:1.5px solid var(--gray2);border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;margin-bottom:14px">← Mudar Endereço</button>')
    :'';
  var palletOn=_getModoPallet();
  var scanHtml=concluido
    ?'<div style="background:#f9fbe7;border:1.5px solid #c8e6c9;border-radius:12px;padding:20px;text-align:center;margin-top:16px">'+
        '<div style="font-size:24px;margin-bottom:8px">✅</div>'+
        '<div style="font-size:15px;font-weight:700;color:#1a5c34;margin-bottom:4px">Contagem finalizada</div>'+
        '<div style="font-size:13px;color:var(--t2)">'+(isModoFila?'Toque em "← Mudar Endereço" para continuar.':'Aguarde o resultado do administrador.')+'</div>'+
      '</div>'
    :'<div style="margin-top:14px">'+
        '<div style="display:flex;justify-content:flex-end;margin-bottom:8px">'+
          '<button id="inv-pallet-btn" onclick="_toggleModoPallet()" title="Modo Pallet: multiplica Qtd × Qtd Emb" style="padding:5px 12px;border-radius:7px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;border:1.5px solid '+(palletOn?'var(--y)':'var(--gray2)')+';background:'+(palletOn?'var(--y)':'#fff')+';color:'+(palletOn?'#111':'var(--t2)')+'">'+
            '🏗 Pallet '+(palletOn?'ON':'—')+
          '</button>'+
        '</div>'+
        '<div id="inv-cam-fixa" style="display:none;margin-bottom:10px"></div>'+
        '<div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">'+
          '<div style="flex:1;min-width:200px">'+
            '<label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--t2);display:block;margin-bottom:6px">EAN / Código de Barras</label>'+
            '<div id="inv-desc-preview" style="font-size:13px;font-weight:600;margin-bottom:6px;min-height:20px"></div>'+
            '<div style="position:relative">'+
              '<input id="inv-ean-input" type="text" inputmode="numeric" autocomplete="off" disabled placeholder="Carregando endereço..." style="width:100%;padding:13px 84px 13px 14px;border:2px solid var(--gray2);border-radius:10px;font-size:16px;font-family:monospace;letter-spacing:1px" onkeydown="if(event.key===\'Enter\')_eanEnterKey()"/>'+
              '<button type="button" onmousedown="event.preventDefault()" onclick="_teclarEan()" title="Digitar o código pelo teclado do app" style="position:absolute;right:44px;top:50%;transform:translateY(-50%);width:34px;height:32px;border-radius:8px;border:1.5px solid var(--gray2);background:#fff;font-size:16px;line-height:1;color:var(--t2);cursor:pointer">⌨</button>'+
              '<button type="button" onclick="_limparEan()" title="Apagar código lido errado" style="position:absolute;right:6px;top:50%;transform:translateY(-50%);width:32px;height:32px;border-radius:8px;border:1.5px solid var(--gray2);background:#fff;font-size:16px;line-height:1;color:var(--t2);cursor:pointer">✕</button>'+
            '</div>'+
          '</div>'+
          '<button type="button" id="inv-cam-btn" onclick="_toggleCamFixa()" title="Ligar câmera (fica aberta pra ler em sequência)" style="padding:13px 16px;background:#fff;border:2px solid var(--gray2);border-radius:10px;font-size:18px;cursor:pointer">📷</button>'+
          '<div style="width:80px"><label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--t2);display:block;margin-bottom:6px">Qtd</label>'+
            '<input id="inv-qty-input" type="text" inputmode="decimal" autocomplete="off" value="1" style="width:100%;padding:13px 10px;border:2px solid var(--gray2);border-radius:10px;font-size:16px;text-align:center;font-family:inherit" onkeydown="return _qtyKeydown(event)" onfocus="_qtyFocado()" onclick="_qtyToque()" onblur="setTimeout(function(){ var a=document.activeElement; if(_kpAlvo!==\'ean\'&&(!a||(a.id!==\'inv-qty-input\'&&a.id!==\'inv-fator-input\'))) _descFixa(false); },80)"/></div>'+
          '<div id="inv-fator-wrap" style="width:62px;'+(palletOn?'':'display:none')+'">'+
            '<label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--t2);display:block;margin-bottom:6px">Qtd Emb</label>'+
            '<input id="inv-fator-input" type="number" value="1" min="1" style="width:100%;padding:13px 8px;border:2px solid var(--gray2);border-radius:10px;font-size:16px;text-align:center;font-family:inherit" onkeydown="if(event.key===\'Enter\')registrarBipagem()" onfocus="_descFixa(true,false)" onblur="setTimeout(function(){ var a=document.activeElement; if(_kpAlvo!==\'ean\'&&(!a||(a.id!==\'inv-qty-input\'&&a.id!==\'inv-fator-input\'))) _descFixa(false); },80)"/></div>'+
          '<button onclick="registrarBipagem()" style="padding:13px 22px;background:#F97316;color:#111;border:none;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap">Registrar</button>'+
        '</div>'+
        '<div style="margin-top:10px;display:flex;justify-content:space-between;align-items:center;gap:10px">'+
          '<button onclick="_abrirSemEAN()" style="padding:8px 14px;background:#fff;border:1.5px solid var(--gray2);color:var(--t2);border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit">📝 Sem código</button>'+
          '<button onclick="finalizarRodada()" style="padding:8px 18px;background:#fff;border:1.5px solid var(--r);color:var(--r);border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">Finalizar Contagem</button>'+
        '</div>'+
      '</div>';
  var _chipId=_getIdColetor(), _chipNome=_getNomeColetor();
  var coletorChip='<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;padding:9px 14px;background:#fff8e1;border:1.5px solid #f5c518;border-radius:10px">'+
    '<span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:#b38600">Coletor</span>'+
    '<span style="font-size:17px;font-weight:800;font-family:monospace;letter-spacing:2px">'+esc(_chipId)+'</span>'+
    (_chipNome?'<span style="font-size:13px;font-weight:600;color:var(--t2);flex:1">'+esc(_chipNome)+'</span>':'<span style="flex:1"></span>')+
    '<button onclick="_editarIdColetor()" style="padding:4px 10px;background:#fff;border:1.5px solid #ddd;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;color:var(--t2)">✎ Mudar</button>'+
  '</div>';
  wrap.innerHTML=coletorChip+mudarBtn+
    '<div style="background:#fff;border-radius:14px;border:1px solid var(--gray2);padding:20px;box-shadow:var(--sh);margin-bottom:16px">'+
      '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">'+
        '<div><div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--t3)">Endereço</div>'+
          '<div style="font-size:32px;font-weight:800;color:var(--t)">'+esc(end)+'</div>'+
          '<div style="margin-top:4px">'+mb+'</div></div>'+
        '<div style="text-align:right"><div style="font-size:12px;color:var(--t3);max-width:180px">'+esc(inv.nome)+'</div>'+
          '<div id="inv-seq-label" style="font-size:13px;font-weight:700;color:var(--g);margin-top:4px">Seq: —</div></div>'+
      '</div>'+scanHtml+
    '</div>'+
    '<div style="background:#fff;border-radius:14px;border:1px solid var(--gray2);padding:20px;box-shadow:var(--sh)">'+
      '<div style="font-size:14px;font-weight:700;margin-bottom:12px">Minhas bipagens — Endereço '+esc(end)+(modo==='auditoria'?' (Rodada '+rodada+')':'')+'</div>'+
      '<div id="inv-ultimas-wrap"><div style="text-align:center;padding:24px;color:var(--t3);font-size:13px">Carregando...</div></div>'+
    '</div>';
  if (!concluido) {
    loadCatalogoByInv(inv.id,function(cat){
      var ei=document.getElementById('inv-ean-input');
      if (!ei) return;
      var hasCat=!!(cat&&cat.total);
      // Leitor sem sufixo Enter: rajada de teclas + pausa de 250 ms = fim da leitura → mesmo que Enter.
      var _rajadaEan=InvCore.criarDetectorRajada(100,3), _rajadaTimer=null, _ultimaTecla=0, _emRajada=false;
      ei.addEventListener('keydown',function(ev){
        var agora=Date.now();
        if (ev.key==='Enter'){
          if(_rajadaTimer){ clearTimeout(_rajadaTimer); _rajadaTimer=null; }
          // Enter logo depois de uma rajada = Enter do leitor (não da pessoa)
          if (_emRajada&&agora-_ultimaTecla<150){ ev.preventDefault(); ev.stopImmediatePropagation(); _emRajada=false; _eanEnterKey(true); }
          return;
        }
        if (!ev.key||ev.key.length!==1) return;
        _ultimaTecla=agora;
        if (_rajadaEan.tecla(ev.key, agora)) {
          _emRajada=true;
          if(_rajadaTimer) clearTimeout(_rajadaTimer);
          _rajadaTimer=setTimeout(function(){ _rajadaTimer=null; _emRajada=false; if(document.activeElement===ei&&ei.value.trim()) _eanEnterKey(true); },250);
        }
      }, true);
      ei.addEventListener('input',function(){
        var val=this.value.trim();
        var pr=document.getElementById('inv-desc-preview');
        if (!pr) return;
        if (!val||!hasCat){ pr.textContent=''; return; }
        var r=InvCore.resolverCodigo(cat,val);
        var eanCompleto=/^\d{8}$|^\d{12,14}$/.test(val);
        if (r&&r.multiplos) { pr.textContent='⚠ Código de barras em '+r.multiplos.length+' produtos — escolha ao registrar'; pr.style.color='#b38600'; return; }
        if (r) {
          pr.textContent='📦 '+r.codigo+' · '+r.desc+(r.un?' — '+r.un:'');
          pr.style.color='var(--g)';
          // Código interno curto: espera o Enter (leitor manda Enter). EAN completo: pula pra Qtd na hora.
          if (eanCompleto) { var qi=document.getElementById('inv-qty-input'); _focoQtyTeclado(qi); _dupAoLer(val,r); }
        } else if (eanCompleto) {
          pr.textContent='⚠ Não cadastrado — será registrado com marcação'; pr.style.color='var(--r)';
        } else {
          pr.textContent='';
        }
      });
      setTimeout(function(){ ei.focus(); },150);
    });
  }
  _carregarUltimasBipagens(inv.id,end,rodada,modo);
  if (!concluido&&_camFixaLigada()) setTimeout(_iniciarCamFixa,400);
}

// ── Override finalizarRodada — modal de confirmação com resumo ───────────
function finalizarRodada() {
  if (!_invColetaAtual) return;
  var info=_invColetaAtual, inv=info.inv, invId=inv.id, end=info.endereco, rodada=info.rodada||1, modo=info.modo||'colaboracao';
  db.collection('inv_bipagens').where('invId','==',invId).where('endereco','==',end).get().then(function(snap){
    var bips=snap.docs.map(function(d){ return d.data(); });
    if(modo==='auditoria'&&rodada) bips=bips.filter(function(b){ return (b.rodada||1)===rodada; });
    bips.sort(function(a,b){ return (a.seq||0)-(b.seq||0); });
    _exibirModalFinalizar(bips);
  }).catch(function(){ _exibirModalFinalizar([]); });
}

function _exibirModalFinalizar(bips) {
  if (!_invColetaAtual) return;
  var end=_invColetaAtual.endereco, rodada=_invColetaAtual.rodada||1;
  var inv=_invColetaAtual.inv;
  var cat=_catCache[inv.id]||{};
  var totalPecas=bips.reduce(function(s,b){ return s+(b.qty||1); },0);
  var rows=bips.map(function(b){
    var p=_catItemDe(cat,b.codigo||b.ean)||{};
    return '<tr>'+
      '<td style="font-family:monospace;font-size:12px;white-space:nowrap">'+esc(b.ean)+'</td>'+
      '<td style="font-size:12px;color:var(--t2)">'+(p.desc?esc(p.desc):'<span style="color:var(--t3)">—</span>')+'</td>'+
      '<td style="text-align:right;font-weight:700;font-size:13px">'+b.qty+(b.fator>1?'<span style="font-size:10px;color:var(--t3)"> ×'+b.fator+'</span>':'')+'</td>'+
    '</tr>';
  }).join('');
  var html=
    '<div id="modal-finalizar" onclick="if(event.target===this)fecharModalFinalizar()" '+
      'style="position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:flex-end;justify-content:center">'+
      '<div style="background:#fff;border-radius:18px 18px 0 0;padding:24px 20px 28px;width:100%;max-width:520px;max-height:82vh;display:flex;flex-direction:column;box-sizing:border-box">'+
        '<div style="font-size:17px;font-weight:800;margin-bottom:2px">Finalizar Endereço</div>'+
        '<div style="font-size:26px;font-weight:800;font-family:monospace;letter-spacing:2px;color:var(--t);margin-bottom:4px">'+esc(end)+'</div>'+
        (rodada>1?'<div style="font-size:12px;color:#5b21b6;font-weight:700;margin-bottom:8px">Rodada '+rodada+'</div>':'')+
        '<div style="display:flex;gap:10px;margin-bottom:14px">'+
          '<div style="flex:1;padding:12px 8px;background:#f5f5f5;border-radius:12px;text-align:center">'+
            '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--t3)">Itens</div>'+
            '<div style="font-size:26px;font-weight:800;line-height:1.1">'+bips.length+'</div>'+
          '</div>'+
          '<div style="flex:1;padding:12px 8px;background:#fff8e1;border-radius:12px;text-align:center">'+
            '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#b38600">Unidades</div>'+
            '<div style="font-size:26px;font-weight:800;line-height:1.1">'+totalPecas+'</div>'+
          '</div>'+
        '</div>'+
        (rows
          ?'<div style="overflow-y:auto;flex:1;margin-bottom:16px;border:1px solid var(--gray2);border-radius:10px">'+
            '<table style="width:100%"><thead><tr>'+
              '<th style="font-size:11px;position:sticky;top:0;background:#fafafa">EAN</th>'+
              '<th style="font-size:11px;position:sticky;top:0;background:#fafafa">Descrição</th>'+
              '<th style="font-size:11px;text-align:right;position:sticky;top:0;background:#fafafa">Qtd</th>'+
            '</tr></thead><tbody>'+rows+'</tbody></table></div>'
          :'<div style="color:var(--t3);font-size:13px;margin-bottom:16px;padding:14px;background:#f5f5f5;border-radius:10px;text-align:center">Nenhuma bipagem neste endereço ainda.</div>')+
        '<div style="padding:10px 12px;background:#fdecea;border-radius:10px;margin-bottom:12px;font-size:12px;color:#c0392b;font-weight:600;text-align:center">'+
          '⚠ Após finalizar não será mais possível bipar itens neste endereço.'+
        '</div>'+
        '<div style="display:flex;gap:10px">'+
          '<button onclick="fecharModalFinalizar()" style="flex:1;padding:14px;background:#fff;border:1.5px solid var(--gray2);border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;color:var(--t2)">Cancelar</button>'+
          '<button onclick="_confirmarFinalizarRodada()" style="flex:2;padding:14px;background:var(--r);color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit">✓ Confirmar Finalização</button>'+
        '</div>'+
      '</div>'+
    '</div>';
  document.body.insertAdjacentHTML('beforeend', html);
}

function fecharModalFinalizar() {
  var m=document.getElementById('modal-finalizar'); if(m) m.remove();
}

function _confirmarFinalizarRodada() {
  fecharModalFinalizar();
  if (!_invColetaAtual) return;
  var info=_invColetaAtual, inv=info.inv, invId=inv.id, end=info.endereco, rodada=info.rodada||1;
  if (inv.modoFila) {
    var _u=S.currentUser;
    var _colId=_getIdColetor(), _colNome=_getNomeColetor();
    var _dispNome=_colId+(_colNome?' - '+_colNome:'');
    var _existing=(inv.fila||{})[end]||{};
    var _setor=(_filaEndAtual&&_filaEndAtual.setor)||_existing.setor||'';
    var _key=_slotKey(_colId||(_u&&_u.id)), _agora=firebase.firestore.FieldValue.serverTimestamp();
    var _lista={}; _slotColetores(_existing).forEach(function(c){ _lista[c.key]={userId:c.userId||'',coletorId:c.coletorId||'',nome:c.nome||'',desde:c.desde||null,concluido:!!c.concluido}; if(c.concluidoEm) _lista[c.key].concluidoEm=c.concluidoEm; });
    if(!_lista[_key]) _lista[_key]={userId:_u?_u.id:'',coletorId:_colId,nome:_dispNome,desde:_agora,concluido:false};
    _lista[_key].concluido=true; _lista[_key].concluidoEm=_agora;
    var _todos=Object.keys(_lista).every(function(k){ return _lista[k].concluido; });
    var _prim=_lista[Object.keys(_lista)[0]];
    var _fullSlot={
      userId:_existing.userId||_prim.userId||'',
      coletorId:_existing.coletorId||_prim.coletorId||_colId,
      nome:_existing.nome||_prim.nome||_dispNome,
      setor:_setor,
      desde:_existing.desde||_agora,
      coletores:_lista,
      concluido:_todos
    };
    if (_todos) _fullSlot.concluidoEm=_agora;
    db.collection('inv_inventarios').doc(invId).update(
      new firebase.firestore.FieldPath('fila',end), _fullSlot
    ).then(function(){
      info.concluido=true;
      var idx=(S.invsCache||[]).findIndex(function(i){ return i.id===invId; });
      if (idx>=0){
        if(!S.invsCache[idx].fila) S.invsCache[idx].fila={};
        S.invsCache[idx].fila[end]=_fullSlot;
      }
      renderColeta();
    }).catch(function(e){ alert('Erro ao finalizar: '+e.message); });
    return;
  }
  var atrib=_normalizeAtrib((info.inv.atribuicoes||{})[end]);
  var uid=S.currentUser?S.currentUser.id:'';
  var novos=atrib.coletores.map(function(c){ return (c.userId===uid&&c.rodada===rodada)?Object.assign({},c,{concluido:true}):c; });
  var novoAtrib={modo:atrib.modo,coletores:novos};
  var update2={}; update2['atribuicoes.'+end]=novoAtrib;
  db.collection('inv_inventarios').doc(invId).update(update2).then(function(){
    info.inv.atribuicoes[end]=novoAtrib; info.concluido=true;
    var idx=(S.invsCache||[]).findIndex(function(i){ return i.id===invId; });
    if (idx>=0) S.invsCache[idx].atribuicoes=Object.assign({},info.inv.atribuicoes);
    _logAuditoria(invId,'rodada_finalizada','Endereço '+end+', Rodada '+rodada+' — '+(S.currentUser?S.currentUser.nome:''));
    renderColeta();
  }).catch(function(e){ alert('Erro: '+e.message); });
}

// ── ETA ───────────────────────────────────────────────────────────────────
function _calcETA(inv) {
  if (!inv) return '—';
  var ends=inv.enderecos||[],total=ends.length; if(!total) return '—';
  var concluidos=0,filaMap=inv.fila||{};
  ends.forEach(function(e){
    if (inv.modoFila) { if(filaMap[e]&&filaMap[e].concluido) concluidos++; }
    else { var atrib=_normalizeAtrib((inv.atribuicoes||{})[e]); if(atrib.coletores.length>0&&atrib.coletores.every(function(c){ return c.concluido; })) concluidos++; }
  });
  var restantes=total-concluidos;
  if (restantes<=0) return '✓';
  if (!concluidos) return '—';
  var criadoMs=inv.criadoEm&&inv.criadoEm.seconds?inv.criadoEm.seconds*1000:null;
  if (!criadoMs) return '—';
  var minElapsed=(Date.now()-criadoMs)/60000;
  if (minElapsed<1) return '—';
  var etaMin=Math.ceil(restantes/(concluidos/minElapsed));
  if (etaMin>=120) return Math.round(etaMin/60)+'h';
  if (etaMin>=60) return Math.floor(etaMin/60)+'h'+('0'+(etaMin%60)).slice(-2)+'min';
  return etaMin+'min';
}

// ── Override renderDashboardRealtime — ETA + modoFila ─────────────────────
function renderDashboardRealtime(bips) {
  if (!_invAtivo) return;
  var inv=_invAtivo,enderecos=inv.enderecos||[],atribs=inv.atribuicoes||{},filaMap=inv.fila||{},resolucoes=inv.resolucoes||{};
  var isModoFila=!!inv.modoFila;
  var bipMap={}, bipColMap={};
  bips.forEach(function(b){
    if (!bipMap[b.endereco]) bipMap[b.endereco]={1:[],2:[]};
    var r=b.rodada||1; if(!bipMap[b.endereco][r]) bipMap[b.endereco][r]=[];
    bipMap[b.endereco][r].push(b);
    if(b.coletorId){ if(!bipColMap[b.endereco]) bipColMap[b.endereco]={}; bipColMap[b.endereco][b.coletorId]=b.coletorNome||b.coletorId; }
  });
  var totalBips=bips.length,endsConcl=0,endsDiv=0,endsSemCol=0;
  var rows=enderecos.map(function(end){
    var em=bipMap[end]||{},total=(em[1]||[]).length+(em[2]||[]).length;
    var status='pendente',divs=[],resSel=resolucoes[end]||null,modo,colTxt;
    if (isModoFila) {
      modo='colaboracao';
      var slot=filaMap[end];
      colTxt=slot?_slotNomes(slot,', '):'—';
      if (!slot){ status='sem-coletor'; endsSemCol++; }
      else if (slot.concluido){ status='concluido'; endsConcl++; }
      else if (total>0) status='em-andamento';
      else status='aguardando';
    } else {
      var atrib=_normalizeAtrib(atribs[end]); modo=atrib.modo; var cols=atrib.coletores||[];
      var bipCols=bipColMap[end]||{};
      if(Object.keys(bipCols).length){
        colTxt=Object.keys(bipCols).map(function(id){ var n=bipCols[id]; return n&&n!==id?id+' '+n:id; }).join(', ');
      } else {
        colTxt=cols.length?cols.map(function(c){ return c.nome+(modo==='auditoria'?' R'+c.rodada:'')+(c.concluido?' ✓':''); }).join(', '):'—';
      }
      if (!cols.length){ status='sem-coletor'; endsSemCol++; }
      else if (modo==='auditoria'){
        var r1c=cols.find(function(c){ return c.rodada===1; }),r2c=cols.find(function(c){ return c.rodada===2; });
        if (r1c&&r2c){ if(r1c.concluido&&r2c.concluido){ divs=_calcDivergencias(em[1]||[],em[2]||[]); if(divs.length){status=resSel?'resolvido':'divergente';if(!resSel)endsDiv++;else endsConcl++;}else{status='concluido';endsConcl++;} }else if(total>0)status='em-andamento';else status='aguardando'; }
      } else {
        var allDone=cols.length&&cols.every(function(c){ return c.concluido; });
        if(allDone){status='concluido';endsConcl++;}else if(total>0)status='em-andamento';else status='aguardando';
      }
    }
    return {end:end,modo:modo,total:total,status:status,divs:divs,colTxt:colTxt,resSel:resSel};
  });
  // Coletores distintos = IDs únicos que fizeram pelo menos 1 bipagem
  var coletoresIds={};
  bips.forEach(function(b){ if(b.coletorId) coletoresIds[b.coletorId]=true; });
  var totalColetores=Object.keys(coletoresIds).length;
  var upd={'dash-inv-bips':totalBips.toLocaleString('pt-BR'),'dash-inv-concluidos':endsConcl+'/'+enderecos.length,'dash-inv-coletores':totalColetores,'dash-inv-semcol':endsSemCol,'dash-inv-diverg':endsDiv};
  Object.keys(upd).forEach(function(id){ var e=document.getElementById(id); if(e) e.textContent=upd[id]; });
  var etaEl=document.getElementById('dash-inv-eta'); if(etaEl) etaEl.textContent=_calcETA(inv);
  var stEl=document.getElementById('dash-inv-status');
  if(stEl){
    if(inv.status==='encerrado') _setStatusEl(stEl,'Encerrado','mute');
    else _setStatusEl(stEl,'Ao vivo','ok');
  }
  var sbMap={
    'pendente':_stx('Pendente','mute'),
    'sem-coletor':_stx('Sem coletor','warn'),
    'aguardando':_stx('Aguardando','mute'),
    'em-andamento':_stx('Em andamento','run'),
    'concluido':_stx('Concluído','ok'),
    'resolvido':_stx('Resolvido','ok'),
    'divergente':_stx('Divergente','err')
  };
  // Alerta 100% concluído
  if (endsConcl===enderecos.length&&enderecos.length>0&&inv.status==='aberto'&&!_inv100pctAlerted[inv.id]) {
    _inv100pctAlerted[inv.id]=true;
    _alertar100pct();
  }
  // Meta de acurácia
  if (inv.meta&&inv.meta>0) {
    var pct=enderecos.length>0?Math.round((endsConcl/enderecos.length)*100):0;
    var metaEl2=document.getElementById('dash-inv-meta');
    if(metaEl2) metaEl2.innerHTML='<span style="font-weight:700;color:'+(pct>=inv.meta?'#1a5c34':'#c0392b')+'">'+pct+'%</span><span style="color:var(--t3);font-size:11px;margin-left:4px">/ meta '+inv.meta+'%</span>';
  }
  // Timeout por endereço: última bipagem por endereço
  var agora=Date.now(), TIMEOUT_MS=15*60*1000;
  var ultimaBipEnd={};
  bips.forEach(function(b){ var t=b.ts&&b.ts.seconds?b.ts.seconds*1000:0; if(t>(ultimaBipEnd[b.endereco]||0)) ultimaBipEnd[b.endereco]=t; });
  var tbody=document.getElementById('dash-inv-tbody'); if(!tbody) return;
  tbody.innerHTML=rows.map(function(r){
    var mb=r.modo==='auditoria'?_modoTag.auditoria:isModoFila?_modoTag.fila:_modoTag.colab;
    var divCell=r.divs.length
      ?'<button class="lk" onclick="verDivergencias(\''+r.end+'\')">'+r.divs.length+' itens</button>'+(r.resSel?'<span style="font-size:11px;font-weight:500;color:var(--g);margin-left:6px">R'+r.resSel.rodada+' ✓</span>':'')
      :'<span style="color:var(--t4)">—</span>';
    var timeoutWarn='';
    if (r.status==='em-andamento'&&ultimaBipEnd[r.end]&&(agora-ultimaBipEnd[r.end])>TIMEOUT_MS) {
      var mins=Math.floor((agora-ultimaBipEnd[r.end])/60000);
      timeoutWarn=' <span title="Sem bipagem há '+mins+' min" class="tg tg-err">'+mins+' min parado</span>';
    }
    return '<tr><td class="num"><strong>'+esc(r.end)+'</strong>'+timeoutWarn+'</td><td>'+mb+'</td><td style="color:var(--t2)">'+esc(r.colTxt)+'</td><td class="r num">'+r.total+'</td><td>'+(sbMap[r.status]||r.status)+'</td><td class="r">'+divCell+'</td></tr>';
  }).join('');
}

// ── Relatorio PDF (HTML, abre impressao + fica visivel no browser) ─────────
function gerarRelPDF() {
  if (!_invAtivo) return;
  var logoEl=document.querySelector('.sb-logo img');
  var logoSrc=logoEl?logoEl.src:'';
  var inv=_invAtivo, enderecos=inv.enderecos||[], resolucoes=inv.resolucoes||{}, filaMap=inv.fila||{};
  var isModoFila=!!inv.modoFila;
  var now=new Date();
  var dtStr=now.toLocaleDateString('pt-BR')+' '+now.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  loadBipagensByInv(inv.id, function(bips) {
    var bipFiltradas=bips.filter(function(b){ var res=resolucoes[b.endereco]; return !res||(b.rodada||1)===res.rodada; });
    var uniqueEANs=[];
    bipFiltradas.forEach(function(b){ if(uniqueEANs.indexOf(b.ean)<0) uniqueEANs.push(b.ean); });
    var statusBg={'Concluido':'#d1f0e0','Em andamento':'#e8f5ee','Pendente':'#f0f0f0','Resolvido':'#d1f0e0','Auditoria pendente':'#fff3e0'};
    var endRows=enderecos.map(function(e){
      var modo,colTxt,status,endBips=bips.filter(function(b){ return b.endereco===e; }).length;
      if (isModoFila) {
        modo='Fila'; var slot=filaMap[e];
        colTxt=slot?(_slotNomes(slot,', ',' ok')||'-'):'-';
        status=slot?(slot.concluido?'Concluido':'Em andamento'):'Pendente';
      } else {
        var atrib=_normalizeAtrib((inv.atribuicoes||{})[e]);
        modo=atrib.modo==='auditoria'?'Auditoria':'Collab';
        colTxt=atrib.coletores.map(function(c){ return c.nome+(c.concluido?' ok':''); }).join(', ')||'-';
        var allD=atrib.coletores.length>0&&atrib.coletores.every(function(c){ return c.concluido; });
        status=resolucoes[e]?'Resolvido':allD?'Concluido':atrib.coletores.length?'Em andamento':'Pendente';
      }
      var sc=statusBg[status]||'#f0f0f0';
      return '<tr><td style="font-family:monospace;font-weight:700">'+esc(e)+'</td><td>'+modo+'</td><td style="font-size:11px">'+esc(colTxt)+'</td><td style="text-align:center">'+endBips+'</td><td><span style="padding:2px 8px;border-radius:10px;background:'+sc+';font-size:10px;font-weight:700">'+status+'</span></td></tr>';
    }).join('');
    var divSection='';
    if (!isModoFila) {
      var divRows=[];
      enderecos.forEach(function(e){
        var r1=bips.filter(function(b){ return b.endereco===e&&(b.rodada||1)===1; });
        var r2=bips.filter(function(b){ return b.endereco===e&&(b.rodada||1)===2; });
        if (r2.length){ var divs=_calcDivergencias(r1,r2); if(divs.length){ var res=resolucoes[e]; divRows.push('<tr><td style="font-family:monospace;font-weight:700">'+esc(e)+'</td><td style="text-align:center">'+divs.length+'</td><td>'+(res?'R'+res.rodada+' ok':'Pendente')+'</td><td>'+esc(res?res.resolvidoPor||'-':'-')+'</td></tr>'); } }
      });
      if (divRows.length) {
        divSection='<h3 style="margin:16px 0 6px;color:#c0392b">Divergencias de Auditoria</h3>'
          +'<table><thead><tr><th>Endereco</th><th style="text-align:center">Itens divergentes</th><th>Resolucao</th><th>Resolvido por</th></tr></thead>'
          +'<tbody>'+divRows.join('')+'</tbody></table>';
      }
    }
    var css='*{box-sizing:border-box;margin:0;padding:0}'
      +'body{font-family:Arial,sans-serif;font-size:12px;color:#111;padding:20px}'
      +'.ph{display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid #F97316;padding-bottom:14px;margin-bottom:20px}'
      +'.ph img{height:72px;object-fit:contain}'
      +'.ph-fb{font-size:20px;font-weight:800;color:#111}'
      +'.ph-info{text-align:right}'
      +'.ph-info h1{font-size:16px;font-weight:700;color:#111}'
      +'.ph-info p{font-size:11px;color:#666;margin-top:3px}'
      +'.ct{padding:0}'
      +'.stats{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap}'
      +'.sb{flex:1;min-width:90px;background:#f8f8f8;border:1px solid #e0e0e0;border-radius:6px;padding:8px 12px;text-align:center}'
      +'.sb strong{display:block;font-size:20px;color:#111}'
      +'.sb span{font-size:10px;color:#666}'
      +'h3{margin:0 0 6px;font-size:13px;font-weight:700}'
      +'table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:16px}'
      +'th{background:#e8e8e8;padding:5px 8px;text-align:left;border:1px solid #ccc;font-size:10px}'
      +'td{padding:4px 8px;border-bottom:1px solid #eee}'
      +'@media print{@page{margin:12mm}}';
    var html='<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Relatorio - '+esc(inv.nome)+'</title><style>'+css+'</style></head>'
      +'<body><div class="ph">'
      +(logoSrc?'<img src="'+logoSrc+'" alt="Logo"/>':'<div class="ph-fb">Kontar</div>')
      +'<div class="ph-info"><h1>Relatorio de Inventario</h1>'
      +'<p>'+esc(inv.nome)+' &nbsp;|&nbsp; Status: '+inv.status.toUpperCase()+' &nbsp;|&nbsp; Gerado: '+dtStr+'</p></div></div>'
      +'<div class="ct">'
      +'<div class="stats">'
      +'<div class="sb"><strong>'+enderecos.length+'</strong><span>Enderecos</span></div>'
      +'<div class="sb"><strong>'+bips.length+'</strong><span>Total bipagens</span></div>'
      +'<div class="sb"><strong>'+uniqueEANs.length+'</strong><span>EANs unicos</span></div>'
      +'<div class="sb"><strong>'+bipFiltradas.length+'</strong><span>Bipagens validas</span></div>'
      +'</div>'
      +'<h3>Detalhamento por Endereco</h3>'
      +'<table><thead><tr><th>Endereco</th><th>Modo</th><th>Coletores</th><th style="text-align:center">Bipagens</th><th>Status</th></tr></thead>'
      +'<tbody>'+endRows+'</tbody></table>'
      +divSection
      +'</div></body></html>';
    var w=window.open('','_blank','width=900,height=700');
    if(w){ w.document.write(html); w.document.close(); w.onload=function(){ w.print(); }; }
    else showToast('Permita pop-ups para gerar o relatorio.');
  });
}

// ── PDF Bipagens por Endereco — respeita filtros ativos ────────────────────
function gerarPDFBipagens() {
  if (!_invAtivo) return;
  var logoEl=document.querySelector('.sb-logo img');
  var logoSrc=logoEl?logoEl.src:'';
  var inv=_invAtivo;
  var filtroEnd=(document.getElementById('inv-bip-filter')||{}).value||null;
  var filtroCol=(document.getElementById('inv-bip-col-filter')||{}).value||null;
  var filtroSetor=(document.getElementById('inv-bip-setor-filter')||{}).value||null;
  loadBipagensByInv(inv.id, function(bips) {
    var bipsFilt=bips.filter(function(b){
      if(filtroEnd&&b.endereco!==filtroEnd) return false;
      if(filtroCol&&b.coletorId!==filtroCol) return false;
      if(filtroSetor&&(b.setor||'')!==filtroSetor) return false;
      return true;
    });
    if(!bipsFilt.length){ showToast('Nenhuma bipagem com o filtro atual.'); return; }
    loadCatalogoByInv(inv.id, function(cat) {
      var now=new Date();
      var dtStr=now.toLocaleDateString('pt-BR')+' '+now.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
      var filtroDesc=[];
      if(filtroEnd) filtroDesc.push('Endereco: '+filtroEnd);
      if(filtroSetor) filtroDesc.push('Setor: '+filtroSetor);
      if(filtroCol) filtroDesc.push('Coletor: '+filtroCol);
      var filtroStr=filtroDesc.length?filtroDesc.join(' | '):'Todos';
      var endMap={};
      bipsFilt.forEach(function(b){
        var end=b.endereco||'(sem endereco)';
        if(!endMap[end]) endMap[end]={setor:'',eans:{},coletores:{}};
        var slot=endMap[end];
        if(b.setor&&!slot.setor) slot.setor=b.setor;
        slot.eans[b.ean]=(slot.eans[b.ean]||0)+(b.qty||1);
        if(b.coletorId) slot.coletores[b.coletorId]=b.coletorNome||b.coletorId;
      });
      var enderecos=Object.keys(endMap).sort();
      var grandTotal=0;
      var bodyHtml=enderecos.map(function(end){
        var slot=endMap[end];
        var setor=slot.setor;
        var coletores=Object.keys(slot.coletores).map(function(id){ return slot.coletores[id]; }).join(', ')||'-';
        var bg=setor==='ESTOQUE'?'#e8f0ff':setor==='LOJA'?'#fff8e1':'#f0f0f0';
        var bc=setor==='ESTOQUE'?'#1a3c9c':setor==='LOJA'?'#b38600':'#999';
        var eanRows=Object.keys(slot.eans).sort().map(function(ean){
          var qty=slot.eans[ean];
          var desc=((_catItemDe(cat,ean)||{}).desc)||'-';
          return '<tr><td style="font-family:monospace;font-size:10px">'+esc(ean)+'</td><td>'+esc(desc)+'</td><td style="text-align:center;font-weight:700">'+qty+'</td></tr>';
        });
        var sub=Object.keys(slot.eans).reduce(function(s,k){ return s+slot.eans[k]; },0);
        grandTotal+=sub;
        return '<div style="margin-bottom:14px;break-inside:avoid">'
          +'<div style="padding:7px 10px;font-size:12px;font-weight:700;background:'+bg+';border-left:3px solid '+bc+';border-radius:3px">'
          +esc(end)+(setor?' ['+esc(setor)+']':'')
          +'<span style="font-weight:400;font-size:10px;margin-left:10px;color:#555">Coletores: '+esc(coletores)+'</span></div>'
          +'<table style="width:100%;border-collapse:collapse;font-size:11px;margin-top:4px">'
          +'<thead><tr><th style="background:#e8e8e8;padding:4px 8px;text-align:left;border:1px solid #ccc;width:100px">EAN</th>'
          +'<th style="background:#e8e8e8;padding:4px 8px;text-align:left;border:1px solid #ccc">Descricao</th>'
          +'<th style="background:#e8e8e8;padding:4px 8px;text-align:center;border:1px solid #ccc;width:45px">Qtd</th></tr></thead>'
          +'<tbody>'+eanRows.join('')
          +'<tr style="background:#f0f0f0"><td></td><td style="padding:4px 8px;font-weight:700;border-bottom:1px solid #ddd">Subtotal</td><td style="padding:4px 8px;text-align:center;font-weight:700;border-bottom:1px solid #ddd">'+sub+'</td></tr>'
          +'</tbody></table></div>';
      }).join('');
      var html='<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Bipagens - '+esc(inv.nome)+'</title>'
        +'<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:12px;color:#111;padding:20px}'
        +'.ph{display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid #F97316;padding-bottom:14px;margin-bottom:16px}'
        +'.ph img{height:72px;object-fit:contain}.ph-fb{font-size:20px;font-weight:800;color:#111}'
        +'.ph-info{text-align:right}.ph-info h1{font-size:16px;font-weight:700;color:#111}.ph-info p{font-size:11px;color:#666;margin-top:3px}'
        +'.fi{background:#f5f5f5;padding:6px 10px;font-size:11px;color:#555;border-radius:4px;margin-bottom:14px}'
        +'.ct{padding:0}td{padding:4px 8px;border-bottom:1px solid #eee}'
        +'@media print{@page{margin:12mm}}</style></head>'
        +'<body><div class="ph">'
        +(logoSrc?'<img src="'+logoSrc+'" alt="Logo"/>':'<div class="ph-fb">Kontar</div>')
        +'<div class="ph-info"><h1>Bipagens por Endereco</h1>'
        +'<p>'+esc(inv.nome)+' &nbsp;|&nbsp; Gerado: '+dtStr+' &nbsp;|&nbsp; '+bipsFilt.length+' bipagens</p></div></div>'
        +'<div class="fi">Filtro: '+esc(filtroStr)+'</div>'
        +'<div class="ct">'+bodyHtml
        +'<div style="margin-top:16px;padding:10px 14px;background:#111;color:#F97316;font-size:14px;font-weight:700;border-radius:4px">'
        +'TOTAL GERAL: '+grandTotal+' unidades &nbsp;|&nbsp; '+bipsFilt.length+' itens bipados &nbsp;|&nbsp; '+enderecos.length+' endereco(s)</div>'
        +'<div style="margin-top:48px;display:flex;gap:48px">'
        +'<div style="flex:1;border-top:2px solid #222;padding-top:10px;text-align:center;font-size:12px;color:#444">Responsavel pela contagem</div>'
        +'<div style="flex:1;border-top:2px solid #222;padding-top:10px;text-align:center;font-size:12px;color:#444">Responsavel pela bipagem</div>'
        +'</div>'
        +'</div></body></html>';
      var w=window.open('','_blank','width=900,height=700');
      if(w){ w.document.write(html); w.document.close(); w.onload=function(){ w.print(); }; }
      else showToast('Permita pop-ups para gerar o relatorio.');
    });
  });
}

// ── Excluir inventário (com reautenticação por senha) ─────────────────────
var _excluirInvId = null;

function abrirModalExcluirInv(invId) {
  if (!invId) return;
  // Tenta cache; se não achar, abre o modal mesmo assim
  var inv = (S.invsCache||[]).find(function(i){ return i.id===invId; });
  _excluirInvId = invId;
  var nEl = document.getElementById('excluir-inv-nome');
  if (nEl) nEl.textContent = inv ? inv.nome : invId;
  var sEl = document.getElementById('excluir-inv-senha');
  if (sEl) sEl.value = '';
  var errEl = document.getElementById('excluir-inv-err');
  if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }
  var btn = document.getElementById('btn-confirmar-excluir');
  if (btn) { btn.textContent = '🗑 Excluir permanentemente'; btn.disabled = false; }
  document.getElementById('modal-excluir-inv').style.display = 'flex';
  setTimeout(function(){ if(sEl) sEl.focus(); }, 100);
}

function fecharModalExcluirInv() {
  document.getElementById('modal-excluir-inv').style.display = 'none';
  _excluirInvId = null;
}

function confirmarExcluirInv() {
  var invId = _excluirInvId; if (!invId) return;
  var senha = ((document.getElementById('excluir-inv-senha')||{}).value || '').trim();
  var errEl = document.getElementById('excluir-inv-err');
  var btn = document.getElementById('btn-confirmar-excluir');

  function mostrarErro(msg) {
    if (btn) { btn.textContent = '🗑 Excluir permanentemente'; btn.disabled = false; }
    if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
    alert(msg);
  }

  if (!senha) { mostrarErro('Informe sua senha de acesso.'); return; }
  var u = S.currentUser;
  if (!u) { mostrarErro('Sessão inválida. Faça login novamente.'); return; }

  if (btn) { btn.textContent = 'Verificando...'; btn.disabled = true; }
  if (errEl) errEl.style.display = 'none';

  function _doDelete() {
    if (btn) btn.textContent = 'Excluindo...';
    db.collection('inv_inventarios').doc(invId).delete().then(function() {
      fecharModalExcluirInv();
      if (_invAtivo && _invAtivo.id === invId) voltarInvLista();
      loadInventariosFromFirebase(function(){ renderInvList(); renderInvHistorico(); });
      _limparSubcolecoes(invId);
    }).catch(function(err) {
      mostrarErro('Erro ao excluir: ' + (err.message || String(err)));
    });
  }

  // Verifica via Firebase Auth (reauth) — mais confiável que senha local
  var fbUser = firebase.auth().currentUser;
  if (fbUser) {
    var cred = firebase.auth.EmailAuthProvider.credential(fbUser.email, senha);
    fbUser.reauthenticateWithCredential(cred).then(function() {
      _doDelete();
    }).catch(function(reauthErr) {
      // Fallback: compara com senha armazenada localmente
      hashPassword(senha).then(function(senhaHash) {
        var match = isHashed(u.senha) ? (u.senha === senhaHash) : (u.senha === senha);
        if (!match) {
          if (btn) { btn.textContent = '🗑 Excluir permanentemente'; btn.disabled = false; }
          var motivo = (reauthErr && reauthErr.code) ? reauthErr.code : (reauthErr && reauthErr.message) || 'desconhecido';
          if (errEl) { errEl.textContent = 'Senha incorreta. Use sua senha de login. (' + motivo + ')'; errEl.style.display = 'block'; }
          return;
        }
        _doDelete();
      }).catch(function(err) {
        mostrarErro('Erro ao verificar senha: ' + (err.message || String(err)));
      });
    });
  } else {
    hashPassword(senha).then(function(senhaHash) {
      var match = isHashed(u.senha) ? (u.senha === senhaHash) : (u.senha === senha);
      if (!match) {
        if (btn) { btn.textContent = '🗑 Excluir permanentemente'; btn.disabled = false; }
        if (errEl) { errEl.textContent = 'Senha incorreta. Use sua senha de login.'; errEl.style.display = 'block'; }
        return;
      }
      _doDelete();
    }).catch(function(err) {
      mostrarErro('Erro ao verificar senha: ' + (err.message || String(err)));
    });
  }
}

function _limparSubcolecoes(invId) {
  function deletarColecao(nome) {
    function proxLote() {
      return db.collection(nome).where('invId','==',invId).limit(450).get().then(function(snap){
        if (snap.empty) return;
        var batch = db.batch();
        snap.docs.forEach(function(d){ batch.delete(d.ref); });
        return batch.commit().then(function(){
          if (snap.docs.length === 450) return proxLote();
        });
      });
    }
    return proxLote().catch(function(){});
  }
  deletarColecao('inv_bipagens');
  deletarColecao('inv_catalogo');
  deletarColecao('inv_catalogo_blocos');
  deletarColecao('inv_auditlog');
}

// ── Override renderInvEnderecos — suporte a modoFila + status + reabrir ──
var _sbMapEnd={
  'pendente':_stx('Pendente','mute'),
  'sem-coletor':_stx('Sem coletor','warn'),
  'aguardando':_stx('Aguardando','mute'),
  'em-andamento':_stx('Em andamento','run'),
  'concluido':_stx('Concluído','ok')
};
function renderInvEnderecos() {
  if (!_invAtivo) return;
  var fresh=(S.invsCache||[]).find(function(i){ return i.id===_invAtivo.id; });
  if(fresh) _invAtivo=fresh;
  var inv=_invAtivo, invId=inv.id, enderecos=inv.enderecos||[];
  var tbody=document.getElementById('inv-end-tbody'); if(!tbody) return;
  var isAdmin=S.role==='admin'||S.role==='gerencia'||S.role==='supervisor';
  var isAberto=inv.status==='aberto'||inv.status==='pausado';
  var isModoSet=inv.modoOrganizacao==='setores';
  var _reIco={'ESTOQUE':'📦','LOJA':'🏪','DEPOSITO':'🏭','FREEZER':'❄️','FARMACIA':'💊','ACOUGUE':'🥩','PADARIA':'🍞','HORTIFRUTI':'🥦','BEBIDAS':'🍺','COZINHA':'🍽️','FRIOS':'🧊'};
  if (inv.modoFila) {
    var filaMap=inv.fila||{};
    tbody.innerHTML=enderecos.map(function(end){
      var slot=filaMap[end];
      var colTxt=slot&&_slotColetores(slot).length?_slotColetores(slot).map(function(c){ return '<div>'+esc(c.nome||c.coletorId||'?')+(c.concluido?' <span style="color:var(--g)">✓</span>':'')+'</div>'; }).join(''):'<span style="color:var(--t3)">—</span>';
      var status=!slot?'sem-coletor':slot.concluido?'concluido':'aguardando';
      var safeEnd=end.replace(/'/g,"\\'");
      var reabrirBtn=isAberto&&isAdmin&&slot&&slot.concluido?'<button class="lk" onclick="reabrirEndereco(\''+invId+'\',\''+safeEnd+'\')">Reabrir</button>':'';
      var remBtn=(isAberto&&isAdmin&&InvCore.podeRemoverEndereco(inv,end))?'<button class="lk lk-d" onclick="removerEndereco(\''+invId+'\',\''+safeEnd+'\')">Remover</button>':'';
      var endLabel=isModoSet?(_reIco[end]||'📁')+' '+esc(end):'<strong>'+esc(end)+'</strong>';
      var setorBadge=(!isModoSet&&slot&&slot.setor)?' '+_tg(esc(slot.setor),slot.setor==='ESTOQUE'?'info':'am'):'';
      return '<tr>'+
        '<td>'+endLabel+setorBadge+'</td>'+
        '<td>'+_modoTag.fila+'</td>'+
        '<td id="inv-coltxt-'+end.replace(/[^a-z0-9]/gi,'_')+'" style="font-size:12px">'+colTxt+'</td>'+
        '<td class="r num" id="inv-ec-'+end.replace(/[^a-z0-9]/gi,'_')+'">—</td>'+
        '<td>'+(_sbMapEnd[status]||'')+'</td>'+
        '<td class="r">'+reabrirBtn+(reabrirBtn&&remBtn?'&nbsp;&nbsp;':'')+remBtn+'</td>'+
      '</tr>';
    }).join('');
  } else {
    var atribs=inv.atribuicoes||{};
    tbody.innerHTML=enderecos.map(function(end){
      var atrib=_normalizeAtrib(atribs[end]),modo=atrib.modo,cols=atrib.coletores||[];
      var mb=modo==='auditoria'?_modoTag.auditoria:_modoTag.colab;
      var colTxt=cols.length?cols.map(function(c){ return esc(c.nome)+(modo==='auditoria'?' R'+c.rodada:'')+(c.concluido?' ✓':''); }).join(', '):'<span style="color:var(--t3)">—</span>';
      var allDone=cols.length&&cols.every(function(c){ return c.concluido; });
      var status=!cols.length?'sem-coletor':allDone?'concluido':'aguardando';
      var safeEnd=end.replace(/'/g,"\\'");
      var reabrirBtn=isAberto&&isAdmin&&allDone?'<button class="lk" onclick="reabrirEndereco(\''+invId+'\',\''+safeEnd+'\')">Reabrir</button>':'';
      var remBtn=(isAberto&&isAdmin&&InvCore.podeRemoverEndereco(inv,end))?'<button class="lk lk-d" onclick="removerEndereco(\''+invId+'\',\''+safeEnd+'\')">Remover</button>':'';
      return '<tr>'+
        '<td><strong>'+esc(end)+'</strong></td>'+
        '<td>'+mb+'</td>'+
        '<td id="inv-coltxt-'+end.replace(/[^a-z0-9]/gi,'_')+'" style="font-size:12px">'+colTxt+'</td>'+
        '<td class="r num" id="inv-ec-'+end.replace(/[^a-z0-9]/gi,'_')+'">—</td>'+
        '<td id="inv-st-'+end.replace(/[^a-z0-9]/gi,'_')+'">'+(_sbMapEnd[status]||'')+'</td>'+
        '<td class="r" style="white-space:nowrap">'+(isAberto?'<button class="lk" onclick="abrirModalGerenciarEnd(\''+invId+'\',\''+safeEnd+'\')">Gerenciar</button>':'')+(reabrirBtn?'&nbsp;&nbsp;&nbsp;'+reabrirBtn:'')+(remBtn?'&nbsp;&nbsp;&nbsp;'+remBtn:'')+'</td>'+
      '</tr>';
    }).join('');
  }
  loadBipagensByInv(invId,function(bips){
    var cnt={}, colMap={};
    bips.forEach(function(b){
      cnt[b.endereco]=(cnt[b.endereco]||0)+1;
      if(b.coletorId){ if(!colMap[b.endereco]) colMap[b.endereco]={}; colMap[b.endereco][b.coletorId]=b.coletorNome||b.coletorId; }
    });
    enderecos.forEach(function(end){
      var ec=document.getElementById('inv-ec-'+end.replace(/[^a-z0-9]/gi,'_')); if(ec) ec.textContent=cnt[end]||0;
      if(!inv.modoFila){
        var ct=document.getElementById('inv-coltxt-'+end.replace(/[^a-z0-9]/gi,'_'));
        if(ct&&colMap[end]){
          var names=Object.keys(colMap[end]).map(function(id){ var n=colMap[end][id]; return n&&n!==id?id+' '+n:id; });
          if(names.length) ct.textContent=names.join(', ');
        }
        var stEl=document.getElementById('inv-st-'+end.replace(/[^a-z0-9]/gi,'_'));
        if(stEl){
          var atrib=_normalizeAtrib((inv.atribuicoes||{})[end]),cols=atrib.coletores||[];
          var total=cnt[end]||0;
          var allDone=cols.length&&cols.every(function(c){ return c.concluido; });
          var st=!cols.length?'sem-coletor':allDone?'concluido':total>0?'em-andamento':'aguardando';
          stEl.innerHTML=_sbMapEnd[st]||'';
        }
      }
    });
  });
  _renderImportCatStatus(invId);
}

function reabrirEndereco(invId, endereco) {
  if (!confirm('Reabrir "'+endereco+'" para nova coleta?')) return;
  var inv=(S.invsCache||[]).find(function(i){ return i.id===invId; });
  if (!inv) return;
  if (inv.modoFila) {
    var slot=(inv.fila||{})[endereco];
    if (!slot) return;
    var lista={}; _slotColetores(slot).forEach(function(c){ lista[c.key]={userId:c.userId||'',coletorId:c.coletorId||'',nome:c.nome||'',desde:c.desde||null,concluido:false}; });
    db.collection('inv_inventarios').doc(invId).update(
      new firebase.firestore.FieldPath('fila',endereco,'concluido'), false,
      new firebase.firestore.FieldPath('fila',endereco,'coletores'), lista
    ).then(function(){
      loadInventariosFromFirebase(function(){ renderInvEnderecos(); });
    }).catch(function(e){ alert('Erro: '+e.message); });
  } else {
    var atrib=_normalizeAtrib((inv.atribuicoes||{})[endereco]);
    var cols=(atrib.coletores||[]).map(function(c){ return Object.assign({},c,{concluido:false}); });
    var upd2={}; upd2['atribuicoes.'+endereco]=Object.assign({},atrib,{coletores:cols});
    db.collection('inv_inventarios').doc(invId).update(upd2).then(function(){
      loadInventariosFromFirebase(function(){ renderInvEnderecos(); });
    }).catch(function(e){ alert('Erro: '+e.message); });
  }
}

// ── Override _iniciarDashboardRealtime — listener duplo (bips + inv doc) ──
var _invDocListener = null;
var _lastBipsCache = [];

function _iniciarDashboardRealtime(invId) {
  _pararDashboardRealtime();
  var stEl=document.getElementById('dash-inv-status');
  _setStatusEl(stEl,'Conectando...','warn');
  // Listener no doc do inventário: mantém fila/atribuicoes atualizados
  _invDocListener=db.collection('inv_inventarios').doc(invId).onSnapshot(function(snap){
    if (!snap.exists||!_invAtivo) return;
    var d=snap.data();
    _invAtivo.fila=d.fila||{};
    _invAtivo.atribuicoes=d.atribuicoes||{};
    _invAtivo.resolucoes=d.resolucoes||{};
    renderDashboardRealtime(_lastBipsCache);
  });
  // Listener nas bipagens
  _invBipListener=db.collection('inv_bipagens').where('invId','==',invId)
    .onSnapshot(function(snap){
      _lastBipsCache=snap.docs.map(function(d){ return d.data(); });
      renderDashboardRealtime(_lastBipsCache);
    },function(){ _setStatusEl(document.getElementById('dash-inv-status'),'Erro de conexão','err'); });
}

function _pararDashboardRealtime() {
  if(_invBipListener){_invBipListener();_invBipListener=null;}
  if(_invDocListener){_invDocListener();_invDocListener=null;}
  _lastBipsCache=[];
}

// ── Override atualizarNavColeta — coleta visível quando há inv aberto ────────
function atualizarNavColeta() {
  var colItem=document.getElementById('nav-inv-coleta'); if(!colItem) return;
  // sb-inv-sec e nav-inv-gestao são controlados por setupRole() — não mexer aqui
  var temAberto=(S.invsCache||[]).some(function(i){ return i.status==='aberto'; });
  // Kontar: todo perfil logado pode coletar quando há inventário aberto (na origem
  // só admin/coletor; os outros perfis tinham o checklist como tela principal).
  colItem.style.display=temAberto?'flex':'none';
  var avItem=document.getElementById('nav-inv-avulsa');
  if (avItem) avItem.style.display=temAberto?'flex':'none';
}

// ── Realtime listener para aba Endereços ─────────────────────────────────────
var _enderecosListenerUnsub = null;
function _iniciarEnderecosRealtime(invId) {
  _pararEnderecosRealtime();
  _enderecosListenerUnsub = db.collection('inv_inventarios').doc(invId).onSnapshot(function(snap) {
    if (!snap.exists) return;
    var data = snap.data();
    _invAtivo = Object.assign({id: invId}, data);
    var idx = (S.invsCache||[]).findIndex(function(i){ return i.id===invId; });
    if (idx >= 0) S.invsCache[idx] = _invAtivo;
    renderInvEnderecos();
  }, function() { /* erro silencioso */ });
}
function _pararEnderecosRealtime() {
  if (_enderecosListenerUnsub) { _enderecosListenerUnsub(); _enderecosListenerUnsub = null; }
}

// ── Salva estado do detalhe para restaurar no reload ─────────────────────────
function switchInvTab(tab,btn) {
  if (tab==='auditoria') { setTimeout(_popularSelectFolhaConf,0); _resultadoCache=null; var rw=document.getElementById('inv-resultado-wrap'); if(rw) rw.innerHTML=''; var pw=document.getElementById('inv-pendencias-wrap'); if(pw) pw.innerHTML=''; }
  // Salva estado em localStorage (sobrevive ao fechamento do PWA)
  if (_invAtivo) {
    localStorage.setItem('inv_detalhe_state', JSON.stringify({invId:_invAtivo.id,tab:tab}));
  }
  // Lógica original
  document.querySelectorAll('#inv-detalhe-tabs .tab').forEach(function(t){ t.classList.remove('on'); });
  if (btn) btn.classList.add('on');
  ['enderecos','coletores','dashboard','bipagens','monitor','auditoria','exportar'].forEach(function(t){ var el=document.getElementById('inv-tab-'+t); if(el) el.style.display=t===tab?'block':'none'; });
  if (tab!=='dashboard') _pararDashboardRealtime();
  if (tab!=='enderecos') _pararEnderecosRealtime();
  if (tab==='enderecos') _iniciarEnderecosRealtime(_invAtivo.id);
  if (tab==='coletores') renderInvColetores();
  if (tab==='dashboard') _iniciarDashboardRealtime(_invAtivo.id);
  if (tab==='bipagens'){ var f=document.getElementById('inv-bip-filter'); var sf=document.getElementById('inv-bip-setor-filter'); renderInvBipagens(f&&f.value||null,null,sf&&sf.value||null); }
  if (tab==='auditoria') renderTrilhaAuditoria(_invAtivo.id);
  if (tab==='monitor'){ window._resumoSort=window._resumoSort||{col:'valor',dir:-1}; window._resumoLimite=500; renderResumoBipagens(true); }
}

function renderInvColetores() {
  if (!_invAtivo) return;
  var wrap=document.getElementById('inv-coletores-wrap'); if(!wrap) return;
  wrap.innerHTML='<div style="color:var(--t3);font-size:13px;padding:16px 0">⏳ Carregando...</div>';
  // Busca dados frescos do inventário para ter coletoresReg atualizado
  db.collection('inv_inventarios').doc(_invAtivo.id).get().then(function(snap){
    if(!snap.exists) return;
    var reg=snap.data().coletoresReg||{};
    window._invColetoresRegCache = reg;
    var list=Object.keys(reg).map(function(uid){ return Object.assign({_regKey:uid}, reg[uid]); });
    list.sort(function(a,b){ return (a.coletorId||'').localeCompare(b.coletorId||'',undefined,{numeric:true}); });
    var n=list.length;
    var corN=n===0?'var(--r)':n<5?'#b38600':'#1a5c34';
    wrap.innerHTML=
      '<div style="display:flex;align-items:center;gap:16px;margin-bottom:16px;padding:16px;background:var(--gray);border-radius:12px;flex-wrap:wrap">'+
        '<div>'+
          '<div style="font-size:36px;font-weight:800;line-height:1;color:'+corN+'">'+n+'</div>'+
          '<div style="font-size:12px;color:var(--t2);margin-top:2px">coletores identificados</div>'+
        '</div>'+
        '<div style="font-size:12px;color:var(--t3);flex:1">'+
          (n===0?'Ninguém se identificou ainda.':
           'Cada coletor aparece aqui ao entrar no ID pela primeira vez neste inventário.')+
        '</div>'+
        '<button class="btn btn-s btn-sm" onclick="renderInvColetores()">↺ Atualizar</button>'+
      '</div>'+
      (n===0?'<div style="text-align:center;padding:40px;color:var(--t3)"><div style="font-size:40px;margin-bottom:10px">👥</div><div style="font-weight:600">Aguardando coletores...</div></div>':
        '<div class="card" style="padding:0"><table>'+
          '<thead><tr><th>ID</th><th>Nome</th><th>Usuário</th><th>Registrado em</th><th></th></tr></thead>'+
          '<tbody>'+
          list.map(function(c){
            var ts=c.registradoEm?new Date(c.registradoEm.seconds*1000).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';
            return '<tr>'+
              '<td><strong style="font-family:monospace;font-size:15px">'+esc(c.coletorId)+'</strong></td>'+
              '<td>'+esc(c.nome)+'</td>'+
              '<td style="font-size:11px;color:var(--t3)">'+esc(c.userNome||'—')+'</td>'+
              '<td style="font-size:11px;color:var(--t3)">'+ts+'</td>'+
              '<td style="white-space:nowrap;text-align:right">'+
                '<button class="btn btn-s btn-sm" onclick="_abrirModalEditColetor(\''+c._regKey+'\')" title="Editar" style="padding:5px 9px;margin-right:4px">✎</button>'+
                '<button class="btn btn-s btn-sm" onclick="_excluirColetorReg(\''+c._regKey+'\')" title="Excluir" style="padding:5px 9px;color:var(--r)">🗑</button>'+
              '</td>'+
            '</tr>';
          }).join('')+
          '</tbody></table></div>');
  }).catch(function(){ wrap.innerHTML='<div style="color:var(--r);padding:16px">Erro ao carregar coletores.</div>'; });
}

function _abrirModalEditColetor(regKey) {
  var reg = window._invColetoresRegCache||{};
  var cur = reg[regKey]; if(!cur) return;
  var html =
    '<div id="modal-edit-coletor" onclick="if(event.target===this)_fecharModalEditColetor()" style="position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:3000;display:flex;align-items:center;justify-content:center;padding:16px">'+
    '<div style="background:#fff;border-radius:16px;padding:24px;width:100%;max-width:360px;box-shadow:0 8px 40px rgba(0,0,0,.25)">'+
      '<div style="font-size:17px;font-weight:800;margin-bottom:4px">Editar coletor</div>'+
      '<div style="font-size:12px;color:var(--t3);margin-bottom:18px">Corrige o registro e atualiza também as bipagens já feitas por ele neste inventário.</div>'+
      '<label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--t2);display:block;margin-bottom:6px">ID de Coletor</label>'+
      '<input id="edit-coletor-id" type="text" value="'+esc(cur.coletorId)+'" style="width:100%;padding:11px;border:1.5px solid var(--gray2);border-radius:9px;font-size:15px;font-family:monospace;margin-bottom:12px;box-sizing:border-box"/>'+
      '<label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--t2);display:block;margin-bottom:6px">Nome</label>'+
      '<input id="edit-coletor-nome" type="text" value="'+esc(cur.nome||'')+'" style="width:100%;padding:11px;border:1.5px solid var(--gray2);border-radius:9px;font-size:14px;margin-bottom:18px;box-sizing:border-box;font-family:inherit"/>'+
      '<div style="display:flex;gap:10px">'+
        '<button onclick="_fecharModalEditColetor()" style="flex:1;padding:12px;background:#fff;border:1.5px solid var(--gray2);border-radius:9px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;color:var(--t2)">Cancelar</button>'+
        '<button onclick="_salvarEditColetor(\''+regKey+'\')" style="flex:1;padding:12px;background:var(--y);color:#111;border:none;border-radius:9px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">Salvar</button>'+
      '</div>'+
    '</div></div>';
  document.body.insertAdjacentHTML('beforeend', html);
  var el=document.getElementById('edit-coletor-id'); if(el){el.focus();el.select();}
}

function _fecharModalEditColetor() {
  var m=document.getElementById('modal-edit-coletor'); if(m) m.remove();
}

function _salvarEditColetor(regKey) {
  var reg = window._invColetoresRegCache||{};
  var cur = reg[regKey]; if(!cur||!_invAtivo) return;
  var newId = _normColetorId((document.getElementById('edit-coletor-id')||{}).value);
  var newNome = ((document.getElementById('edit-coletor-nome')||{}).value||'').trim();
  if (!newId) { alert('Informe o ID de coletor.'); return; }
  newNome = newNome||newId;
  var oldId = cur.coletorId;
  var newRegKey = 'col_'+newId;
  var upd = {};
  if (newRegKey !== regKey) {
    upd['coletoresReg.'+regKey] = firebase.firestore.FieldValue.delete();
  }
  upd['coletoresReg.'+newRegKey] = {coletorId:newId, nome:newNome, userNome:cur.userNome||'', registradoEm:cur.registradoEm||firebase.firestore.FieldValue.serverTimestamp()};

  db.collection('inv_inventarios').doc(_invAtivo.id).update(upd).then(function(){
    // Propaga pra bipagens já feitas com o ID antigo (ID e/ou nome corrigidos)
    return db.collection('inv_bipagens').where('invId','==',_invAtivo.id).get();
  }).then(function(snap){
    var docs = snap.docs.filter(function(d){ return d.data().coletorId===oldId; });
    if (!docs.length) return;
    var chunks = [];
    for (var i=0;i<docs.length;i+=400) chunks.push(docs.slice(i,i+400));
    var chain = Promise.resolve();
    chunks.forEach(function(chunk){
      chain = chain.then(function(){
        var batch = db.batch();
        chunk.forEach(function(d){ batch.update(d.ref, {coletorId:newId, coletorNome:newNome}); });
        return batch.commit();
      });
    });
    return chain;
  }).then(function(){
    _fecharModalEditColetor();
    renderInvColetores();
  }).catch(function(e){ alert('Erro ao salvar: '+e.message); });
}

function _excluirColetorReg(regKey) {
  var reg = window._invColetoresRegCache||{};
  var cur = reg[regKey]; if(!cur||!_invAtivo) return;
  if (!confirm('Remover "'+cur.nome+'" ('+cur.coletorId+') da lista de coletores identificados?\n\nAs bipagens já feitas por ele continuam normalmente — só some o registro desta lista.')) return;
  var upd = {}; upd['coletoresReg.'+regKey] = firebase.firestore.FieldValue.delete();
  db.collection('inv_inventarios').doc(_invAtivo.id).update(upd).then(function(){
    renderInvColetores();
  }).catch(function(e){ alert('Erro ao excluir: '+e.message); });
}

function voltarInvLista() {
  localStorage.removeItem('inv_detalhe_state');
  _pararDashboardRealtime();
  _pararEnderecosRealtime();
  _invAtivo=null;
  document.getElementById('inv-lista-wrap').style.display='block';
  document.getElementById('inv-detalhe-wrap').style.display='none';
  renderInvList();
}

// ── _eanEnterKey — Enter no campo EAN: vai pra qty se reconhecido ─────────

// Faixa fixa embaixo com o produto lido + teclado numérico próprio pra Qtd.
// Teclado nativo do Android é o padrão. Com leitor Bluetooth pareado (teclado físico via HID) o
// Android suprime o teclado virtual e focus() via JS não reabre — aí, e só aí, entra o teclado próprio.
function _descFixa(mostrar, keypad){
  var el=document.getElementById('inv-desc-fixo');
  if(!el){
    el=document.createElement('div'); el.id='inv-desc-fixo';
    el.style.cssText='position:fixed;left:0;right:0;bottom:0;z-index:1500;background:#fff8e1;border-top:3px solid #F97316;padding:10px 14px calc(10px + env(safe-area-inset-bottom,0px));box-shadow:0 -4px 16px rgba(0,0,0,.15);display:none;max-height:70vh;overflow:auto';
    el.innerHTML='<div id="inv-desc-fixo-txt" style="font-size:15px;font-weight:700;color:#111;line-height:1.3;margin-bottom:8px"></div>'+
      '<div id="inv-desc-fixo-visor" style="display:none;align-items:center;justify-content:space-between;gap:10px;background:#fff;border:2px solid #F97316;border-radius:10px;padding:6px 12px;margin-bottom:8px"><span id="inv-desc-fixo-visor-lbl" style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#7a5a00">Qtd</span><span id="inv-desc-fixo-visor-val" style="font-size:26px;font-weight:800;font-family:monospace;color:#111;min-height:32px"></span></div>'+
      '<div id="inv-desc-fixo-kp" style="display:none"></div>';
    document.body.appendChild(el);
    _montarKeypadQty();
    // Barra do Gboard em modo "teclado físico" (leitor Bluetooth) fica por cima de bottom:0 sem
    // encolher o layout — ancora a faixa no fim da viewport VISUAL, que desconta essa barra.
    if (window.visualViewport) {
      var _posFixa=function(){ var vv=window.visualViewport; el.style.bottom=Math.max(0, window.innerHeight-(vv.height+vv.offsetTop))+'px'; };
      window.visualViewport.addEventListener('resize', _posFixa);
      window.visualViewport.addEventListener('scroll', _posFixa);
      el._posFixa=_posFixa;
    }
  }
  if (el._posFixa) el._posFixa();
  // Se a tela de coleta for trocada (Mudar Endereço, Próximo etc.) com a faixa aberta, some junto.
  if (el._chk) { clearInterval(el._chk); el._chk=null; }
  if (mostrar) el._chk=setInterval(function(){ if(!document.getElementById('inv-qty-input')){ clearInterval(el._chk); el._chk=null; el.style.display='none'; _kpAlvo='qty'; } }, 300);
  var pr=document.getElementById('inv-desc-preview'); var txt=pr?pr.textContent.trim():'';
  var txtEl=document.getElementById('inv-desc-fixo-txt'), kp=document.getElementById('inv-desc-fixo-kp');
  if(mostrar&&(txt||keypad==='ean')){
    _kpAlvo = keypad==='ean' ? 'ean' : 'qty';
    if(txtEl) txtEl.textContent = _kpAlvo==='ean' ? 'Digite o código de barras e toque em ENTER' : txt+' — informe a quantidade';
    el.style.display='block'; if(kp) kp.style.display=keypad?'block':'none';
    _visorAtualizar();
    _kpAbrirEspaco(!!keypad);
  } else { el.style.display='none'; _kpAlvo='qty'; _kpAbrirEspaco(false); }
}
// Visor na faixa do teclado próprio: mostra o que está sendo digitado mesmo se o campo ficar escondido.
function _visorAtualizar(){
  var v=document.getElementById('inv-desc-fixo-visor'), kp=document.getElementById('inv-desc-fixo-kp');
  if(!v) return;
  var aberto=kp&&kp.style.display==='block';
  v.style.display=aberto?'flex':'none'; if(!aberto) return;
  var alvo=document.getElementById(_kpAlvo==='ean'?'inv-ean-input':'inv-qty-input');
  document.getElementById('inv-desc-fixo-visor-lbl').textContent=_kpAlvo==='ean'?'Código':'Qtd';
  document.getElementById('inv-desc-fixo-visor-val').textContent=alvo?alvo.value:'';
}
// Teclado próprio aberto: dá espaço embaixo da página e rola até o campo ficar acima da faixa.
function _kpAbrirEspaco(abrir){
  var el=document.getElementById('inv-desc-fixo');
  if(!abrir||!el){ document.body.style.paddingBottom=''; return; }
  setTimeout(function(){
    var h=el.offsetHeight||0; document.body.style.paddingBottom=(h+16)+'px';
    var alvo=document.getElementById(_kpAlvo==='ean'?'inv-ean-input':'inv-qty-input'); if(!alvo) return;
    var vv=window.visualViewport, altura=vv?vv.height:window.innerHeight;
    var limite=altura-h-12, r=alvo.getBoundingClientRect();
    if(r.bottom<=limite && r.top>=0) return;
    var delta=r.bottom-limite;
    // Rola o primeiro ancestral com rolagem própria; se nenhum, a janela.
    var p=alvo.parentElement;
    while(p&&p!==document.body){ var cs=getComputedStyle(p); if(/(auto|scroll)/.test(cs.overflowY)&&p.scrollHeight>p.clientHeight){ p.scrollTop+=delta; return; } p=p.parentElement; }
    window.scrollBy(0,delta);
  },30);
}
// Alvo do teclado próprio: 'qty' (padrão, abre sozinho no foco da Qtd) ou 'ean' (sob demanda pelo botão ⌨).
var _kpAlvo='qty';
function _montarKeypadQty(){
  var wrap=document.getElementById('inv-desc-fixo-kp'); if(!wrap) return;
  // ENTER em cima e grade de 4 colunas: a barra do Gboard/navegação cobre o fim da tela, então o
  // que importa fica no topo da faixa e o teclado inteiro cabe sem rolar.
  // Mesmo desenho do teclado numérico do Gboard: 3 colunas de dígitos + coluna de ação à direita.
  var base='border:none;border-radius:6px;font-family:inherit;font-size:22px;font-weight:500;height:48px;box-shadow:0 1px 0 rgba(0,0,0,.25);';
  function tecla(b,extra){ return '<button type="button" onmousedown="event.preventDefault()" onclick="_kpQty(\''+b+'\')" style="'+base+(extra||'background:#fff;color:#202124')+'">'+b+'</button>'; }
  var cinza='background:#c8ccd3;color:#202124;';
  wrap.innerHTML='<div style="display:grid;grid-template-columns:repeat(4,1fr);grid-auto-rows:48px;gap:6px;background:#dfe3e8;padding:8px;margin:0 -14px calc(-10px - env(safe-area-inset-bottom,0px));padding-bottom:calc(8px + env(safe-area-inset-bottom,0px))">'+
    tecla('1')+tecla('2')+tecla('3')+tecla('⌫',cinza)+
    tecla('4')+tecla('5')+tecla('6')+tecla('C',cinza)+
    tecla('7')+tecla('8')+tecla('9')+'<button type="button" id="inv-kp-enter" onmousedown="event.preventDefault()" onclick="_kpQty(\'ENTER\')" style="'+base+'grid-row:span 2;height:auto;background:#1a73e8;color:#fff;font-size:26px">↵</button>'+
    '<button type="button" onmousedown="event.preventDefault()" onclick="_descFixa(false)" title="Fechar" style="'+base+cinza+'font-size:18px">⌄</button>'+tecla('0')+tecla(',')+
  '</div>';
}
// Botão ⌨ do EAN: abre o teclado próprio apontando pro código de barras (digitar manual ou corrigir leitura).
function _teclarEan(){
  var ei=document.getElementById('inv-ean-input'); if(!ei||ei.disabled) return;
  var el=document.getElementById('inv-desc-fixo');
  if(el&&el.style.display==='block'&&_kpAlvo==='ean'){ _descFixa(false); return; }
  ei.dataset.limpo='1'; ei.focus();
  _descFixa(true,'ean');
}
// Quantidade decimal (produto de peso): aceita vírgula ou ponto, 3 casas, mínimo 0,001; vazio/inválido = 1.
function _qtdNum(v){ var n=parseFloat(String(v==null?'':v).trim().replace(',','.')); if(!(n>0)) return 1; return Math.round(n*1000)/1000; }
function _qtdFmt(n){ return String(_qtdNum(n)).replace('.',','); }
// Primeiro toque depois de focar/selecionar substitui o valor (como digitar por cima do texto selecionado).
function _kpQty(b){
  var alvo=document.getElementById(_kpAlvo==='ean'?'inv-ean-input':'inv-qty-input'); if(!alvo) return;
  if(b==='ENTER'){ if(_kpAlvo==='ean'){ _eanEnterKey(); } else { registrarBipagem(); } return; }
  if(b==='C'){ alvo.value=''; alvo.dataset.limpo='1'; }
  else if(b==='⌫'){ alvo.value=alvo.value.slice(0,-1); alvo.dataset.limpo='1'; }
  else if(b===','){
    if(_kpAlvo==='ean') return;
    if(alvo.dataset.limpo!=='1'){ alvo.value='0'; alvo.dataset.limpo='1'; }
    if(!/[,.]/.test(alvo.value)) alvo.value=(alvo.value||'0')+',';
  }
  else {
    if(alvo.dataset.limpo!=='1'){ alvo.value=''; alvo.dataset.limpo='1'; }
    alvo.value = _kpAlvo==='ean' ? alvo.value+b : (alvo.value+b).replace(/^0+(?=\d)/,'');
  }
  // O EAN tem listener de 'input' (preview do produto, pulo pra Qtd em EAN completo): dispara igual ao digitar.
  if(_kpAlvo==='ean') alvo.dispatchEvent(new Event('input',{bubbles:true}));
  _visorAtualizar();
}
// Botão ✕ ao lado do EAN: apaga o código lido errado sem depender de teclado (o campo não abre
// o teclado do SO por causa do leitor Bluetooth, então esse era o único jeito de corrigir).
function _limparEan(){
  var ei=document.getElementById('inv-ean-input'); if(!ei||ei.disabled) return;
  ei.value=''; var pr=document.getElementById('inv-desc-preview'); if(pr) pr.textContent='';
  ei.focus();
}
function _eanEnterKey(deScanner) {
  var ei=document.getElementById('inv-ean-input'); if(!ei) return;
  var val=ei.value.trim();
  var inv=_invColetaAtual?_invColetaAtual.inv:null;
  var cat=inv?(_catCache[inv.id]||null):null;
  var pr=document.getElementById('inv-desc-preview');
  if (!val){ ei.focus(); return; }
  var r=null;
  if (cat&&cat.total) {
    r=InvCore.resolverCodigo(cat,val);
    if (pr) {
      if (!r){ pr.textContent='⚠ Não cadastrado — '+(deScanner?'confira o código e toque em Registrar se estiver certo':'será registrado com marcação'); pr.style.color='var(--r)'; }
      else if (!r.multiplos){ pr.textContent='📦 '+r.codigo+' · '+r.desc+(r.un?' — '+r.un:''); pr.style.color='var(--g)'; }
    }
    // Trava 1 (leitor/câmera): fora da base não pula pra Qtd — pode ser leitura truncada
    if (deScanner&&!r){ _bipSom('alerta'); ei.focus(); ei.select(); return; }
    // Trava 2 (leitor/câmera): código curto pode ser pedaço de um EAN que virou código interno válido — confirma com a descrição
    if (deScanner&&r&&!r.multiplos&&/^\d{1,4}$/.test(val)){ _abrirConfirmaCurto(val,r); return; }
  }
  var qi=document.getElementById('inv-qty-input');
  _focoQtyTeclado(qi);
  if (r&&!r.multiplos) _dupAoLer(val,r);
}
// Enquanto uma decisão está aberta (código curto / EAN duplicado), leitor, câmera e teclado ficam bloqueados.
function _decisaoAberta(){ return !!(document.getElementById('modal-curto')||document.getElementById('modal-multi')||document.getElementById('modal-dup')); }
document.addEventListener('keydown', function(ev){ if(_decisaoAberta()){ if(ev.target&&ev.target.id==='dup-qty-input') return; ev.preventDefault(); ev.stopImmediatePropagation(); } }, true);
function _abrirConfirmaCurto(val,r){
  var m=document.getElementById('modal-curto'); if(m) m.remove();
  _bipSom('alerta');
  var html='<div id="modal-curto" style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:2300;display:flex;align-items:flex-end;justify-content:center">'+
    '<div style="background:#fff;border-radius:20px 20px 0 0;padding:20px;width:100%;max-width:480px">'+
    '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#b38600;margin-bottom:4px">Código curto lido pelo leitor</div>'+
    '<div style="font-size:26px;font-weight:800;font-family:monospace;margin-bottom:2px">'+esc(val)+'</div>'+
    '<div style="font-size:15px;font-weight:700;margin-bottom:14px">'+esc(r.desc||'')+(r.un?' <span style="font-weight:400;color:var(--t3)">— '+esc(r.un)+'</span>':'')+'</div>'+
    '<div style="font-size:12px;color:var(--t2);margin-bottom:14px">É esse produto? Se o leitor pegou só parte de um código de barras, cancele e leia de novo.</div>'+
    '<div style="display:flex;gap:10px">'+
      '<button onclick="_confirmaCurto(false)" style="flex:1;padding:13px;background:#fff;border:1.5px solid var(--gray2);border-radius:10px;font-size:14px;font-weight:700;font-family:inherit">Cancelar</button>'+
      '<button onclick="_confirmaCurto(true)" style="flex:2;padding:13px;background:var(--y);color:#111;border:none;border-radius:10px;font-size:15px;font-weight:700;font-family:inherit">✓ É esse</button>'+
    '</div></div></div>';
  document.body.insertAdjacentHTML('beforeend',html);
}
function _confirmaCurto(ok){
  var m=document.getElementById('modal-curto'); if(m) m.remove();
  var ei=document.getElementById('inv-ean-input'), qi=document.getElementById('inv-qty-input');
  if (ok){ _focoQtyTeclado(qi); var _cv=ei?ei.value.trim():''; var _inv=_invColetaAtual?_invColetaAtual.inv:null; var _cat=_inv?(_catCache[_inv.id]||null):null; var _cr=(_cat&&_cat.total)?InvCore.resolverCodigo(_cat,_cv):null; if(_cr&&!_cr.multiplos) _dupAoLer(_cv,_cr); return; }
  if (ei){ ei.value=''; var pr=document.getElementById('inv-desc-preview'); if(pr) pr.textContent=''; ei.focus(); }
}

// ── Override registrarBipagem — ID coletor + validação de base ────────────
// Leitor Bluetooth (keyboard wedge) pode disparar um código novo enquanto a Qtd está focada:
// detecta a rajada, registra a bipagem anterior com a Qtd que estava e joga o código novo no EAN.
var _rajadaQty = InvCore.criarDetectorRajada(100, 4);
// Instante em que a Qtd recebeu foco por causa de uma leitura. O leitor Bluetooth manda Enter como sufixo
// depois do último dígito; como o EAN completo já pulou o foco pra Qtd, esse Enter cairia aqui e gravaria com Qtd 1.
var _qtyFocoScanTs = 0;
// Pula pra Qtd depois de um bip; o onfocus (_qtyFocado) decide se precisa do teclado próprio.
function _focoQtyTeclado(qi) {
  if (!qi) return;
  _qtyFocoScanTs = Date.now();
  qi.dataset.limpo = '';
  qi.focus(); qi.select();
}
// Foco na Qtd: mostra só a faixa com o produto e espera o teclado nativo. Se em 450 ms a viewport
// visual não encolheu (teclado do Android não abriu — leitor Bluetooth pareado), abre o teclado próprio.
var _qtyFocoChk = 0;
// Maior altura visível já vista (sem teclado). Comparar com o momento do foco não serve: pela câmera o
// teclado do Android já está aberto no campo do código quando a Qtd recebe o foco.
var _vvMax = 0;
function _vvAtualizarMax(){ var vv=window.visualViewport; var h=vv?vv.height:window.innerHeight; if(h>_vvMax) _vvMax=h; }
_vvAtualizarMax();
if (window.visualViewport) window.visualViewport.addEventListener('resize', _vvAtualizarMax);
window.addEventListener('orientationchange', function(){ _vvMax=0; setTimeout(_vvAtualizarMax,600); });
function _qtyFocado() {
  _vvAtualizarMax();
  // Foco veio de um bip (leitor/câmera) e o teclado nativo não está aberto: o Android não abre o
  // teclado virtual em focus() via JS (e com leitor Bluetooth pareado nem abre) — mostra o próprio já.
  if (Date.now()-_qtyFocoScanTs < 1000 && !_tecladoNativoAberto()) { ++_qtyFocoChk; _descFixa(true, true); return; }
  _descFixa(true, false);
  var id = ++_qtyFocoChk;
  setTimeout(function(){
    if (id !== _qtyFocoChk) return;
    var a = document.activeElement; if (!a || a.id !== 'inv-qty-input') return;
    if (_tecladoNativoAberto()) return;
    _descFixa(true, true);
  }, 600);
}
// 180 px: teclado virtual de verdade tem 250+ px; a barra do Gboard em modo teclado físico (~50 px)
// somada à barra de endereço do Chrome (~56 px) não pode ser confundida com teclado aberto.
function _tecladoNativoAberto(){ var vv=window.visualViewport; return (_vvMax - (vv ? vv.height : window.innerHeight)) >= 180; }
// Toque na Qtd já focada não dispara onfocus de novo: sem teclado nativo, reabre o próprio.
function _qtyToque(){
  setTimeout(function(){
    var a=document.activeElement; if(!a||a.id!=='inv-qty-input') return;
    var kp=document.getElementById('inv-desc-fixo-kp'); if(kp&&kp.style.display==='block') return;
    if(!_tecladoNativoAberto()) _descFixa(true, true);
  }, 350);
}
// Pela câmera o teclado do Android pode abrir depois da checagem: quando abrir, o próprio sai da frente.
if (window.visualViewport) window.visualViewport.addEventListener('resize', function(){
  var a=document.activeElement; if(!a||a.id!=='inv-qty-input'||_kpAlvo!=='qty') return;
  var kp=document.getElementById('inv-desc-fixo-kp'); if(!kp||kp.style.display==='none') return;
  if (_tecladoNativoAberto()) _descFixa(true, false);
});
function _qtyKeydown(ev) {
  if ((ev.key==='Enter'||ev.keyCode===13) && Date.now()-_qtyFocoScanTs<400) { ev.preventDefault(); return false; } // ninguém confirma Qtd em <0,4 s depois do pulo: é o sufixo do leitor
  if (ev.key==='Enter') { ev.preventDefault(); if(_getModoPallet()){ var fi=document.getElementById('inv-fator-input'); if(fi){fi.focus();fi.select();} } else registrarBipagem(); return false; }
  if (ev.key && ev.key.length===1) {
    var buf=_rajadaQty.tecla(ev.key, Date.now());
    if (buf) {
      ev.preventDefault();
      var qi=ev.target, ei=document.getElementById('inv-ean-input');
      qi.value=String(qi.value).slice(0, -(buf.length-1)) || '1';
      registrarBipagem();
      if(ei){ ei.value=buf; ei.focus(); ei.dispatchEvent(new Event('input')); }
      return false;
    }
  }
  return true;
}
var _bipsLocais = [];   // últimas bipagens do endereço atual (mais nova primeiro)
// Grava sem esperar o servidor: a fila offline do Firestore (IndexedDB) garante o envio.
function _gravarBipagemLocal(bipData) {
  var ref = db.collection('inv_bipagens').doc();
  bipData.clienteId = bipData.clienteId || (S.currentUser && S.currentUser.clienteId) || '';
  bipData._id = ref.id;
  bipData._pend = true;
  _offlinePending++; if(window._atualizarOfflineBanner) window._atualizarOfflineBanner();
  var p = ref.set(bipData).then(function(){
    _offlinePending=Math.max(0,_offlinePending-1); if(window._atualizarOfflineBanner) window._atualizarOfflineBanner();
    bipData._pend=false;
  }).catch(function(e){
    _offlinePending=Math.max(0,_offlinePending-1); if(window._atualizarOfflineBanner) window._atualizarOfflineBanner();
    bipData._pend=false; bipData._erro=(e&&e.code)||'erro';
    _bipSom('erro'); showToast('❌ Falha ao gravar '+bipData.ean+': '+((e&&e.message)||e), 6000);
    _renderUltimasBipagens(_bipsLocais.slice(0,20), bipData.invId);
  });
  return { id: ref.id, promise: p };
}

// ── registrarBipagem — local-first, resolve pelo catálogo (código interno ou EAN) ──
function registrarBipagem() {
  if (!_invColetaAtual||_decisaoAberta()) return;
  if (_invColetaAtual.concluido){ alert('Você já finalizou sua contagem.'); return; }
  var ei=document.getElementById('inv-ean-input'), qi=document.getElementById('inv-qty-input');
  if (!ei||!qi) return;
  var fi=document.getElementById('inv-fator-input');
  var lido=ei.value.trim(), qty=_qtdNum(qi.value), fator=fi?Math.max(1,parseInt(fi.value)||1):1;
  if (!lido){ ei.focus(); return; }
  var coletorId=_getIdColetor();
  if (!coletorId){ _editarIdColetor(); return; }
  var inv=_invColetaAtual.inv;
  if (!InvCore.podeBipar(inv)){ showToast(inv.status==='pausado'?'Inventário pausado':'Inventário encerrado'); return; }
  var cat=_catCache[inv.id]||null;
  var res=(cat&&cat.total)?InvCore.resolverCodigo(cat,lido):null;
  if (res&&res.multiplos){ _abrirPickerMultiplos(res.multiplos, lido); return; }
  _registrarResolvido(lido, res, qty*fator, fator);
}
function _registrarResolvido(lido, res, qtyTotal, fator, pularDup) {
  var inv=_invColetaAtual.inv, end=_invColetaAtual.endereco, rodada=_invColetaAtual.rodada||1, modo=_invColetaAtual.modo||'colaboracao';
  // Código já coletado em qualquer endereço → aviso com opção de somar, salvo balanço marcado como Sequencial na criação.
  if (!pularDup && !inv.sequencial && _dupChecadoChave!==_dupChave(lido,res)) {
    _checarJaColetado(inv.id, lido, res).then(function(prev){
      if (prev && prev.total>0) _abrirModalJaColetado(lido, res, qtyTotal, fator, prev);
      else _registrarResolvido(lido, res, qtyTotal, fator, true);
    });
    return;
  }
  var cat=_catCache[inv.id]||null, hasCat=!!(cat&&cat.total);
  var bip={invId:inv.id,loja:inv.loja||'',endereco:end,seq:_nextSeq,ean:lido,codigo:res?res.codigo:'',qty:qtyTotal,rodada:rodada,modo:modo,
    setor:(_filaEndAtual&&_filaEndAtual.setor)||'',coletorId:_getIdColetor(),coletorNome:_getNomeColetor()||_getIdColetor(),ts:firebase.firestore.FieldValue.serverTimestamp()};
  if(fator>1) bip.fator=fator;
  if(hasCat&&!res) bip.naoCadastrado=true;
  _nextSeq++; _dupChecadoChave=null;
  _gravarBipagemLocal(bip);
  _bipsLocais.unshift(bip); if(_bipsLocais.length>50) _bipsLocais.length=50;
  _bipSom(bip.naoCadastrado?'alerta':'ok');
  var ei=document.getElementById('inv-ean-input'), qi=document.getElementById('inv-qty-input'), fi=document.getElementById('inv-fator-input');
  if(ei) ei.value=''; if(qi){ qi.value='1'; qi.dataset.limpo=''; } if(fi) fi.value='1';
  var pr=document.getElementById('inv-desc-preview'); if(pr) pr.textContent='';
  var sl=document.getElementById('inv-seq-label'); if(sl) sl.textContent='Próx. seq: '+_nextSeq;
  _renderUltimasBipagens(_bipsLocais.slice(0,20), inv.id);
  _descFixa(false);
  if(ei) ei.focus();
}
// ── Código já coletado (qualquer endereço) → aviso + somar ─────────────────
function _dupChave(lido,res){ return res&&res.codigo ? 'c:'+res.codigo : 'e:'+String(lido).trim(); }
function _dupMesmoProduto(bip,lido,res){ if(!bip) return false; var k=_dupChave(lido,res); return (bip.codigo?'c:'+bip.codigo:'e:'+bip.ean)===k; }
// Consulta pequena (1 produto) com teto de 1,5 s: sem rede, segue gravando sem aviso — a contagem nunca trava.
function _checarJaColetado(invId, lido, res, semTeto) {
  var q=db.collection('inv_bipagens').where('invId','==',invId);
  q = (res&&res.codigo) ? q.where('codigo','==',res.codigo) : q.where('ean','==',String(lido).trim()).where('codigo','==','');
  var consulta=q.get().then(function(snap){
    var total=0, locais={};
    snap.docs.forEach(function(d){ var b=d.data(); var qn=Number(b.qty)||0; total+=qn; var k=(b.endereco||'?')+'|'+(b.coletorNome||b.coletorId||'?'); locais[k]=(locais[k]||0)+qn; });
    var lista=Object.keys(locais).map(function(k){ var p=k.split('|'); return {endereco:p[0],coletor:p[1],qty:locais[k]}; }).sort(function(a,b){ return b.qty-a.qty; });
    return {total:total, locais:lista, linhas:snap.size};
  }).catch(function(){ return null; });
  if (semTeto) return consulta;
  var teto=new Promise(function(r){ setTimeout(function(){ r(null); },1500); });
  return Promise.race([consulta,teto]);
}
var _dupCtx=null, _dupAbertoTs=0, _dupChecadoChave=null;
// Na LEITURA (não no Enter): se o produto já tem contagem em qualquer endereço e não é sequencial, abre o aviso com a caixa de quantidade.
function _dupAoLer(lido,res){
  if(!_invColetaAtual||!res) return;
  var chave=_dupChave(lido,res); _dupChecadoChave=chave;
  if(_invColetaAtual.inv.sequencial) return; // balanço sequencial: repetir é o normal, sem aviso (a Auditoria marca)
  _checarJaColetado(_invColetaAtual.inv.id,lido,res,true).then(function(prev){
    if(!prev||!(prev.total>0)) return;
    var ei=document.getElementById('inv-ean-input');
    if(!ei||ei.value.trim()!==String(lido).trim()||_dupChecadoChave!==chave||_decisaoAberta()) return; // já registrou ou trocou de código
    var qi=document.getElementById('inv-qty-input'), fi=document.getElementById('inv-fator-input');
    var qty=_qtdNum(qi&&qi.value), fator=fi?Math.max(1,parseInt(fi.value)||1):1;
    _abrirModalJaColetado(lido,res,qty*fator,fator,prev);
  });
}
function _abrirModalJaColetado(lido,res,qtyTotal,fator,prev){
  var m=document.getElementById('modal-dup'); if(m) m.remove();
  _dupCtx={lido:lido,res:res,fator:fator,prev:prev}; _dupAbertoTs=Date.now();
  _bipSom('alerta');
  var qtdTela=_qtdFmt(_qtdNum(qtyTotal/(fator||1)));
  var titulo=res?('<b style="font-family:monospace">'+esc(res.codigo)+'</b> · '+esc(res.desc||'')):('<b style="font-family:monospace">'+esc(lido)+'</b> · não cadastrado');
  var vis=prev.locais.slice(0,5), resto=prev.locais.length-vis.length;
  var lista=vis.map(function(l){ return '<div style="display:flex;justify-content:space-between;font-size:13px;padding:6px 0;border-bottom:1px solid var(--gray2)"><span>End. <b>'+esc(l.endereco)+'</b> <span style="color:var(--t3)">· '+esc(l.coletor)+'</span></span><b>'+l.qty+' un</b></div>'; }).join('')+(resto>0?'<div style="font-size:12px;color:var(--t3);padding:6px 0">mais '+resto+' local(is)</div>':'');
  var html='<div id="modal-dup" style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:2300;display:flex;align-items:flex-end;justify-content:center">'+
    '<div style="background:#fff;border-radius:20px 20px 0 0;padding:20px;width:100%;max-width:480px">'+
    '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#b38600;margin-bottom:4px">Código já coletado neste inventário</div>'+
    '<div style="font-size:15px;font-weight:700;margin-bottom:6px">'+titulo+'</div>'+
    '<div style="font-size:22px;font-weight:800;margin-bottom:8px">Já coletado: '+prev.total+' un <span style="font-size:12px;font-weight:600;color:var(--t3)">('+prev.linhas+' bipagem'+(prev.linhas===1?'':'s')+')</span></div>'+
    '<div style="max-height:160px;overflow:auto;margin-bottom:12px">'+lista+'</div>'+
    '<label style="display:block;font-size:12px;font-weight:700;color:var(--t2);margin-bottom:4px">Quantidade nova (será somada)</label>'+
    '<input id="dup-qty-input" type="text" inputmode="decimal" autocomplete="off" value="'+qtdTela+'" onkeydown="return _dupQtyKeydown(event)" style="width:100%;padding:13px 10px;border:2px solid var(--y);border-radius:10px;font-size:22px;text-align:center;font-family:inherit;margin-bottom:12px"/>'+
    '<div style="display:flex;gap:10px">'+
      '<button onclick="_cancelarJaColetado()" style="flex:1;padding:13px;background:#fff;border:1.5px solid var(--gray2);border-radius:10px;font-size:14px;font-weight:700;font-family:inherit">Cancelar</button>'+
      '<button onclick="_somarJaColetado()" style="flex:2;padding:13px;background:var(--y);color:#111;border:none;border-radius:10px;font-size:15px;font-weight:700;font-family:inherit">+ Somar ao que já tem</button>'+
    '</div></div></div>';
  document.body.insertAdjacentHTML('beforeend',html);
  setTimeout(function(){ var i=document.getElementById('dup-qty-input'); if(i){ i.focus(); i.select(); } },80);
}
function _dupQtyKeydown(ev){
  if (ev.key==='Enter'||ev.keyCode===13){ ev.preventDefault(); if(Date.now()-_dupAbertoTs<400) return false; _somarJaColetado(); return false; }
  return true;
}
function _cancelarJaColetado(){
  var m=document.getElementById('modal-dup'); if(m) m.remove(); _dupCtx=null; _dupChecadoChave=null;
  var ei=document.getElementById('inv-ean-input'), qi=document.getElementById('inv-qty-input'), pr=document.getElementById('inv-desc-preview');
  if(ei) ei.value=''; if(qi){ qi.value='1'; qi.dataset.limpo=''; } if(pr) pr.textContent=''; _descFixa(false); if(ei) ei.focus();
}
function _somarJaColetado(){
  var c=_dupCtx; if(!c) return;
  var i=document.getElementById('dup-qty-input'); var nova=_qtdNum(i&&i.value);
  var m=document.getElementById('modal-dup'); if(m) m.remove(); _dupCtx=null;
  _registrarResolvido(c.lido, c.res, nova*(c.fator||1), c.fator||1, true);
  showToast('Somado. Total agora: '+_qtdFmt(c.prev.total+nova*(c.fator||1))+' un', 3500);
}
function _abrirPickerMultiplos(lista, lido) {
  var html='<div id="modal-multi" onclick="if(event.target===this)_cancelarMultiplo()" style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:2300;display:flex;align-items:flex-end;justify-content:center">'+
    '<div style="background:#fff;border-radius:20px 20px 0 0;padding:20px;width:100%;max-width:480px">'+
    '<div style="font-weight:800;font-size:16px;margin-bottom:4px">Mesmo código de barras em '+lista.length+' produtos</div>'+
    '<div style="font-size:12px;color:var(--t3);margin-bottom:12px">Toque no produto certo.</div>'+
    lista.map(function(p,i){ return '<button onclick="_escolherMultiplo('+i+')" style="width:100%;text-align:left;padding:12px;margin-bottom:8px;border:1.5px solid var(--gray2);border-radius:10px;background:#fff;font-family:inherit;cursor:pointer"><b style="font-family:monospace">'+esc(p.codigo)+'</b> · '+esc(p.desc)+'</button>'; }).join('')+
    '<button onclick="_cancelarMultiplo()" style="width:100%;padding:11px;border:1.5px solid var(--gray2);border-radius:10px;background:#fff;font-family:inherit">Cancelar</button></div></div>';
  window._multiLista=lista; window._multiLido=lido;
  document.body.insertAdjacentHTML('beforeend',html);
}
function _cancelarMultiplo(){ var m=document.getElementById('modal-multi'); if(m) m.remove(); var ei=document.getElementById('inv-ean-input'); if(ei){ ei.value=''; var pr=document.getElementById('inv-desc-preview'); if(pr) pr.textContent=''; ei.focus(); } }
function _escolherMultiplo(i) {
  var m=document.getElementById('modal-multi'); if(m) m.remove();
  var qi=document.getElementById('inv-qty-input'), fi=document.getElementById('inv-fator-input');
  var qty=_qtdNum(qi&&qi.value), fator=fi?Math.max(1,parseInt(fi.value)||1):1;
  _registrarResolvido(window._multiLido, window._multiLista[i], qty*fator, fator);
}

// ── Feature 2: Itens não coletados ───────────────────────────────────────
function mostrarItensNaoColetados() {
  if (!_invAtivo) return;
  var wrap=document.getElementById('inv-nao-coletados-wrap'); if(!wrap) return;
  wrap.innerHTML='<div style="color:var(--t3);font-size:13px;padding:10px 0">⏳ Carregando...</div>';
  loadCatalogoByInv(_invAtivo.id,function(cat){
    if (!cat.total) {
      wrap.innerHTML='<div style="font-size:13px;color:var(--t3);padding:10px 0">Nenhum catálogo importado para este inventário.</div>';
      return;
    }
    var itens=[];
    Object.keys(cat.porCodigo).forEach(function(c){ itens.push(cat.porCodigo[c]); });
    Object.keys(cat.porEan).forEach(function(k){ cat.porEan[k].forEach(function(it){ if(!it.c) itens.push(it); }); });
    db.collection('inv_bipagens').where('invId','==',_invAtivo.id).get().then(function(snap){
      var bip={};
      snap.docs.forEach(function(d){ var b=d.data(); if(b.codigo) bip['c:'+b.codigo]=true; if(b.ean) bip['e:'+InvCore.normEan(b.ean)]=true; });
      var naoCol=itens.filter(function(it){ return !(it.c&&bip['c:'+it.c]) && !(it.e&&bip['e:'+InvCore.normEan(it.e)]); });
      if (!naoCol.length) {
        wrap.innerHTML='<div style="padding:14px;background:#f0faf5;border-radius:10px;color:#1a5c34;font-weight:700;font-size:13px">✓ Todos os '+itens.length+' produtos foram coletados!</div>';
        return;
      }
      window._naoColetadosCache={itens:naoCol,total:itens.length,invNome:_invAtivo.nome,busca:''};
      _renderNaoColetados();
    }).catch(function(e){ wrap.innerHTML='<div style="color:var(--r);font-size:13px">Erro: '+e.message+'</div>'; });
  });
}

// Lista de não coletados: ações em cima (busca, imprimir, Excel, fechar), tabela embaixo.
function _renderNaoColetados() {
  var c=window._naoColetadosCache, wrap=document.getElementById('inv-nao-coletados-wrap'); if(!c||!wrap) return;
  var b=(c.busca||'').toLowerCase();
  var lista=b?c.itens.filter(function(it){ return ((it.c||'')+' '+(it.e||'')+' '+(it.d||'')).toLowerCase().indexOf(b)>=0; }):c.itens;
  var lim=window._naoColLimite||500;
  var rows=lista.slice(0,lim).map(function(it){
    return '<tr><td style="font-family:monospace;font-size:12px">'+esc(it.c||'—')+'</td><td style="font-family:monospace;font-size:12px">'+esc(it.e||'—')+'</td><td>'+esc(it.d||'—')+'</td><td style="color:var(--t3)">'+esc(it.u||'')+'</td></tr>';
  }).join('');
  wrap.innerHTML=
    '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:8px">'+
      '<input id="naocol-busca" placeholder="Buscar código, EAN ou descrição" value="'+esc(c.busca||'')+'" oninput="window._naoColetadosCache.busca=this.value;window._naoColLimite=500;_renderNaoColetados();var i=document.getElementById(\'naocol-busca\');if(i){i.focus();i.setSelectionRange(i.value.length,i.value.length);}" style="flex:1;min-width:180px;padding:7px 10px;border:1.5px solid var(--gray2);border-radius:8px;font-size:12px;font-family:inherit"/>'+
      '<span style="font-size:11px;color:var(--t3)">'+lista.length.toLocaleString('pt-BR')+' de '+c.total.toLocaleString('pt-BR')+' sem coleta</span>'+
      '<button class="btn btn-s btn-sm" onclick="_imprimirNaoColetados()">🖨 Imprimir</button>'+
      '<button class="btn btn-s btn-sm" onclick="_exportarNaoColetadosCsv()">⬇ Excel</button>'+
      '<button class="btn btn-s btn-sm" onclick="_fecharNaoColetados()">✕ Fechar</button>'+
    '</div>'+
    '<div style="overflow-x:auto;max-height:520px;overflow-y:auto"><table><thead><tr><th>Código</th><th>EAN</th><th>Descrição</th><th>Un</th></tr></thead><tbody>'+
      (rows||'<tr><td colspan="4" style="color:var(--t3)">Nada encontrado.</td></tr>')+
      (lista.length>lim?'<tr><td colspan="4" style="text-align:center;padding:10px"><button class="btn btn-s btn-sm" onclick="window._naoColLimite=(window._naoColLimite||500)+1000;_renderNaoColetados()">Mostrar mais ('+(lista.length-lim).toLocaleString('pt-BR')+')</button></td></tr>':'')+
    '</tbody></table></div>';
}
function _fecharNaoColetados(){ var w=document.getElementById('inv-nao-coletados-wrap'); if(w) w.innerHTML=''; window._naoColetadosCache=null; }
// Folha A4 isolada com logo, mesma linha visual da Folha de Conferência. Respeita a busca ativa.
function _imprimirNaoColetados() {
  var c=window._naoColetadosCache; if(!c) return;
  var b=(c.busca||'').toLowerCase();
  var lista=b?c.itens.filter(function(it){ return ((it.c||'')+' '+(it.e||'')+' '+(it.d||'')).toLowerCase().indexOf(b)>=0; }):c.itens;
  var esc=function(v){ return String(v==null?'':v).replace(/[&<>"]/g,function(ch){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]; }); };
  var logoUrl=new URL('logo-light.png',location.href).href;
  var agora=new Date(), dh=agora.toLocaleDateString('pt-BR')+' '+String(agora.getHours()).padStart(2,'0')+':'+String(agora.getMinutes()).padStart(2,'0');
  var rows=lista.map(function(it,i){ return '<tr><td class="c">'+(i+1)+'</td><td class="m">'+esc(it.c||'—')+'</td><td class="m">'+esc(it.e||'—')+'</td><td>'+esc(it.d||'—')+'</td><td class="c">'+esc(it.u||'')+'</td><td class="box"></td></tr>'; }).join('');
  var css='@page{size:A4;margin:12mm}body{font-family:"Manrope",system-ui,sans-serif;color:#111;margin:0;font-size:11px}'+
    'header{display:flex;align-items:center;gap:14px;border-bottom:3px solid #F97316;padding-bottom:8px;margin-bottom:8px}header img{height:40px}header .t{flex:1}.h1{font-size:18px;font-weight:800}.h2{font-size:12px;color:#555}'+
    '.end{text-align:right}.end .lbl{font-size:10px;text-transform:uppercase;letter-spacing:.6px;color:#777}.end .num{font-size:22px;font-weight:800}'+
    'table{width:100%;border-collapse:collapse}th{background:#ffe7d6;font-size:10px;text-transform:uppercase;letter-spacing:.4px;text-align:left;padding:5px 4px;border-bottom:1.5px solid #f3b184}'+
    'td{padding:4px;border-bottom:1px solid #ddd;vertical-align:middle}tr:nth-child(even) td{background:#fafafa}td.c{text-align:center}td.m{font-family:monospace;font-size:10.5px;white-space:nowrap}td.box{width:64px;border:1.5px solid #999;height:20px}thead{display:table-header-group}tr{page-break-inside:avoid}';
  var html='<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Itens Não Coletados</title>'+
    '<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;800&display=swap" rel="stylesheet"><style>'+css+'</style></head><body>'+
    '<header><img src="'+logoUrl+'" alt=""><div class="t"><div class="h1">Itens Não Coletados</div><div class="h2">'+esc(c.invNome)+' · gerado em '+dh+(b?' · filtro: "'+esc(c.busca)+'"':'')+'</div></div><div class="end"><div class="lbl">Sem coleta</div><div class="num">'+lista.length.toLocaleString('pt-BR')+' de '+c.total.toLocaleString('pt-BR')+'</div></div></header>'+
    '<table><thead><tr><th style="width:34px">#</th><th>Código</th><th>EAN</th><th>Descrição</th><th style="width:36px">Un</th><th style="width:64px">Contado</th></tr></thead><tbody>'+rows+'</tbody></table></body></html>';
  var antigo=document.getElementById('naocol-print-frame'); if(antigo) antigo.parentNode.removeChild(antigo);
  var frame=document.createElement('iframe'); frame.id='naocol-print-frame'; frame.setAttribute('aria-hidden','true');
  frame.style.cssText='position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none';
  document.body.appendChild(frame);
  var doc=frame.contentWindow.document; doc.open(); doc.write(html); doc.close();
  var imprimiu=false;
  var disparar=function(){ if(imprimiu) return; imprimiu=true; try{ frame.contentWindow.focus(); frame.contentWindow.print(); }catch(e){ showToast('Não foi possível abrir a impressão: '+e.message); } };
  var img=doc.querySelector('header img');
  if (img&&!img.complete){ img.onload=img.onerror=function(){ setTimeout(disparar,150); }; } else setTimeout(disparar,150);
  setTimeout(disparar,2500);
}
function _exportarNaoColetadosCsv() {
  var c=window._naoColetadosCache; if(!c) return;
  var lines=['CODIGO;EAN;DESCRICAO;UNIDADE'];
  var b=(c.busca||'').toLowerCase();
  var lista=b?c.itens.filter(function(it){ return ((it.c||'')+' '+(it.e||'')+' '+(it.d||'')).toLowerCase().indexOf(b)>=0; }):c.itens;
  lista.forEach(function(it){ lines.push([it.c||'',it.e||'',(it.d||'').replace(/;/g,','),it.u||''].join(';')); });
  var blob=new Blob(['﻿'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'});
  var url=URL.createObjectURL(blob);
  var a=document.createElement('a'); a.href=url;
  a.download=(c.invNome||'inventario').replace(/[^a-z0-9]/gi,'_')+'_nao_coletados.csv';
  a.click(); setTimeout(function(){ URL.revokeObjectURL(url); },2000);
}

// ── Feature 4: Relatório de produtividade por coletor ─────────────────────
function renderProdutividade() {
  if (!_invAtivo) return;
  var wrap=document.getElementById('inv-produtividade-wrap'); if(!wrap) return;
  wrap.innerHTML='<div style="color:var(--t3);font-size:13px;padding:10px 0">⏳ Calculando...</div>';
  loadBipagensByInv(_invAtivo.id, function(bips){
    if (!bips||!bips.length) {
      wrap.innerHTML='<div style="font-size:13px;color:var(--t3);padding:10px 0">Nenhuma bipagem registrada.</div>';
      return;
    }
    var por={};
    bips.forEach(function(b){
      if(b.modo==='correcao') return;
      var id=b.coletorId||'?';
      if (!por[id]) por[id]={nome:b.coletorNome||id,bips:0,pecas:0,firstTs:null,lastTs:null};
      por[id].bips++;
      por[id].pecas+=Number(b.qty)||1;
      var ts=b.ts&&b.ts.seconds?b.ts.seconds*1000:null;
      if (ts) {
        if (!por[id].firstTs||ts<por[id].firstTs) por[id].firstTs=ts;
        if (!por[id].lastTs||ts>por[id].lastTs) por[id].lastTs=ts;
      }
    });
    var ids=Object.keys(por);
    if (!ids.length) {
      wrap.innerHTML='<div style="font-size:13px;color:var(--t3);padding:10px 0">Nenhuma bipagem registrada.</div>';
      return;
    }
    var rows=ids.sort().map(function(id){
      var p=por[id];
      var durMin=p.firstTs&&p.lastTs?(p.lastTs-p.firstTs)/60000:0;
      var bph=durMin>1?Math.round(p.bips/(durMin/60)):p.bips;
      var durStr=durMin<1?'< 1 min':(durMin<60?Math.round(durMin)+' min':Math.floor(durMin/60)+'h '+Math.round(durMin%60)+'min');
      return '<tr>'+
        '<td><div style="font-family:monospace;font-weight:700;font-size:13px">'+esc(id)+'</div>'+(p.nome&&p.nome!==id?'<div style="font-size:11px;color:var(--t2)">'+esc(p.nome)+'</div>':'')+'</td>'+
        '<td style="text-align:right">'+p.bips+'</td>'+
        '<td style="text-align:right">'+p.pecas+'</td>'+
        '<td style="text-align:right">'+durStr+'</td>'+
        '<td style="text-align:right;font-weight:700;color:#b38600">'+bph+'/h</td>'+
      '</tr>';
    }).join('');
    wrap.innerHTML=
      '<div style="overflow-x:auto"><table>'+
        '<thead><tr><th>Coletor</th><th style="text-align:right">Itens</th><th style="text-align:right">Unidades</th><th style="text-align:right">Tempo</th><th style="text-align:right">Bip/h</th></tr></thead>'+
        '<tbody>'+rows+'</tbody>'+
      '</table></div>';
  });
}

// ── Feature 5: Modo Coleta Avulsa ─────────────────────────────────────────
var _avulsaInvId=null;

function renderColetaAvulsa() {
  var wrap=document.getElementById('inv-avulsa-wrap'); if(!wrap) return;
  var invs=(S.invsCache||[]).filter(function(i){ return i.status==='aberto'; });
  if (!invs.length) {
    wrap.innerHTML='<div style="text-align:center;padding:60px 20px;color:var(--t3)"><div style="font-size:40px;margin-bottom:12px">📦</div><div style="font-size:15px;font-weight:600;margin-bottom:8px">Nenhum inventário ativo</div><div style="font-size:13px">Crie ou abra um inventário para usar a coleta avulsa.</div></div>';
    return;
  }
  var coletorId=_getIdColetor();
  if (!coletorId) {
    var atual=_getIdColetor();
    wrap.innerHTML='<div style="max-width:360px;margin:50px auto;padding:28px 24px;background:#fff;border-radius:16px;border:1px solid var(--gray2);box-shadow:var(--sh)">'+
      '<div style="font-size:19px;font-weight:800;margin-bottom:6px">Identificação</div>'+
      '<div style="font-size:13px;color:var(--t2);margin-bottom:22px">Informe seu ID de coletor para começar.</div>'+
      '<label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--t2);display:block;margin-bottom:8px">ID de Coletor</label>'+
      '<input id="avulsa-coletor-id" type="text" value="'+esc(atual||'')+'" placeholder="Ex: 01, A1, JOAO" autocomplete="off" '+
        'style="width:100%;padding:14px;border:2.5px solid var(--y);border-radius:10px;font-size:22px;font-weight:700;font-family:monospace;text-align:center;letter-spacing:3px;margin-bottom:16px;box-sizing:border-box" '+
        'onkeydown="if(event.key===\'Enter\')_confirmarIdColetorAvulsa()"/>'+
      '<button onclick="_confirmarIdColetorAvulsa()" style="width:100%;padding:14px;background:var(--y);color:#111;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit">Começar →</button>'+
    '</div>';
    setTimeout(function(){ var el=document.getElementById('avulsa-coletor-id'); if(el){el.focus();el.select();} },100);
    return;
  }
  var optsInv=invs.map(function(i){ return '<option value="'+i.id+'"'+(i.id===_avulsaInvId?' selected':'')+'>'+esc(i.nome)+'</option>'; }).join('');
  if (!_avulsaInvId) _avulsaInvId=invs[0].id;
  var coletorChip='<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;padding:9px 14px;background:#fff8e1;border:1.5px solid #f5c518;border-radius:10px">'+
    '<span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:#b38600">Coletor</span>'+
    '<span style="font-size:17px;font-weight:800;font-family:monospace;flex:1;letter-spacing:2px">'+esc(coletorId)+'</span>'+
    '<button onclick="_editarIdColetor()" style="padding:4px 10px;background:#fff;border:1.5px solid #ddd;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;color:var(--t2)">✎ Mudar</button>'+
  '</div>';
  wrap.innerHTML=coletorChip+
    '<div class="card" style="margin-bottom:14px">'+
      '<div style="margin-bottom:12px">'+
        '<label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--t2);display:block;margin-bottom:6px">Inventário</label>'+
        '<select id="avulsa-inv-sel" style="width:100%;padding:10px 12px;border:1.5px solid var(--gray2);border-radius:10px;font-size:14px;font-family:inherit" onchange="_avulsaSelInv(this.value)">'+optsInv+'</select>'+
      '</div>'+
      '<div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">'+
        '<div style="flex:1;min-width:180px">'+
          '<label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--t2);display:block;margin-bottom:6px">EAN / Código de Barras</label>'+
          '<input id="avulsa-ean-input" type="text" inputmode="numeric" autocomplete="off" placeholder="Bipe ou digite o código..." style="width:100%;padding:13px 14px;border:2px solid var(--gray2);border-radius:10px;font-size:16px;font-family:monospace;letter-spacing:1px" onkeydown="if(event.key===\'Enter\'){var qi=document.getElementById(\'avulsa-qty-input\');if(qi){qi.focus();qi.select();}}"/>'+
          '<div id="avulsa-desc-preview" style="font-size:12px;margin-top:5px;min-height:18px"></div>'+
        '</div>'+
        '<button type="button" onclick="iniciarScanEAN(\'avulsa-ean-input\')" title="Ler código de barras com a câmera" style="padding:13px 16px;background:#fff;border:2px solid var(--gray2);border-radius:10px;font-size:18px;cursor:pointer">📷</button>'+
        '<div style="width:72px">'+
          '<label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--t2);display:block;margin-bottom:6px">Qtd</label>'+
          '<input id="avulsa-qty-input" type="number" value="1" min="1" style="width:100%;padding:13px 10px;border:2px solid var(--gray2);border-radius:10px;font-size:16px;text-align:center;font-family:inherit" onkeydown="if(event.key===\'Enter\')registrarBipagemAvulsa()"/>'+
        '</div>'+
        '<button onclick="registrarBipagemAvulsa()" style="padding:13px 22px;background:#F97316;color:#111;border:none;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap">Registrar</button>'+
      '</div>'+
    '</div>'+
    '<div class="card">'+
      '<div style="font-size:14px;font-weight:700;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between">'+
        'Bipagens Avulsas'+
        '<button class="btn btn-s btn-sm" onclick="_exportarAvulsaCsv()">⬇ CSV</button>'+
      '</div>'+
      '<div id="avulsa-lista-wrap"><div style="text-align:center;padding:24px;color:var(--t3);font-size:13px">Nenhuma bipagem ainda.</div></div>'+
    '</div>';
  var ei=document.getElementById('avulsa-ean-input');
  if (ei) {
    loadCatalogoByInv(_avulsaInvId,function(cat){
      ei.addEventListener('input',function(){
        var val=this.value.trim();
        var pr=document.getElementById('avulsa-desc-preview'); if(!pr) return;
        var p=_catItemDe(cat,val)||{};
        pr.textContent=p.desc?'📦 '+p.desc+(p.un?' — '+p.un:''):'';
        pr.style.color='var(--g)';
      });
    });
    setTimeout(function(){ ei.focus(); },150);
  }
  _carregarAvulsaLista();
}

function _confirmarIdColetorAvulsa() {
  var val=((document.getElementById('avulsa-coletor-id')||{}).value||'').trim().toUpperCase();
  if (!val){ alert('Informe seu ID de coletor.'); return; }
  _setIdColetor(val);
  renderColetaAvulsa();
}

function _avulsaSelInv(invId) {
  _avulsaInvId=invId;
  renderColetaAvulsa();
}


function registrarBipagemAvulsa() {
  var ei=document.getElementById('avulsa-ean-input'), qi=document.getElementById('avulsa-qty-input');
  if (!ei||!qi) return;
  var ean=ei.value.trim(), qty=_qtdNum(qi.value);
  if (!ean){ ei.focus(); return; }
  var coletorId=_getIdColetor();
  if (!coletorId){ _editarIdColetor(); return; }
  if (!_avulsaInvId) return;
  var inv=(S.invsCache||[]).find(function(i){ return i.id===_avulsaInvId; });
  if (!inv||!InvCore.podeBipar(inv)){ showToast(inv&&inv.status==='pausado'?'Inventário pausado':'Inventário não está aberto.'); return; }
  _gravarBipagemLocal({
    invId:_avulsaInvId, loja:inv.loja||'', endereco:'_AVULSO', seq:Date.now(), ean:ean, qty:qty,
    rodada:1, modo:'avulso',
    coletorId:coletorId, coletorNome:_getNomeColetor()||coletorId,
    ts:firebase.firestore.FieldValue.serverTimestamp()
  });
  _bipSom('ok');
  ei.value=''; qi.value='1';
  var pr=document.getElementById('avulsa-desc-preview'); if(pr) pr.textContent='';
  ei.focus();
  setTimeout(_carregarAvulsaLista, 400);
}

function _carregarAvulsaLista() {
  if (!_avulsaInvId) return;
  var wrap=document.getElementById('avulsa-lista-wrap'); if(!wrap) return;
  db.collection('inv_bipagens')
    .where('invId','==',_avulsaInvId)
    .where('endereco','==','_AVULSO')
    .orderBy('ts','desc').limit(30)
    .get().then(function(snap){
      if (snap.empty){ wrap.innerHTML='<div style="text-align:center;padding:24px;color:var(--t3);font-size:13px">Nenhuma bipagem avulsa ainda.</div>'; return; }
      var rows=snap.docs.map(function(d){
        var b=d.data();
        var ts=b.ts&&b.ts.seconds?new Date(b.ts.seconds*1000).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):'—';
        return '<tr><td style="font-family:monospace;font-size:12px">'+esc(b.ean)+'</td><td style="text-align:right;font-weight:700">'+b.qty+'</td><td style="font-size:11px;color:var(--t3)">'+ts+'</td><td style="font-size:11px;color:var(--t3)">'+esc(b.coletorId)+'</td></tr>';
      }).join('');
      wrap.innerHTML='<div style="overflow-x:auto"><table><thead><tr><th>EAN</th><th style="text-align:right">Qtd</th><th>Hora</th><th>Coletor</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
    }).catch(function(e){ console.error('Coleta avulsa: consulta falhou (verifique o índice composto em firestore.indexes.json)', e); });
}

function _exportarAvulsaCsv() {
  if (!_avulsaInvId) return;
  var inv=(S.invsCache||[]).find(function(i){ return i.id===_avulsaInvId; });
  db.collection('inv_bipagens').where('invId','==',_avulsaInvId).where('endereco','==','_AVULSO').get().then(function(snap){
    var lines=['EAN;QUANTIDADE;COLETOR;TIMESTAMP'];
    snap.docs.forEach(function(d){
      var b=d.data();
      var ts=b.ts&&b.ts.seconds?new Date(b.ts.seconds*1000).toISOString():'';
      lines.push([b.ean,b.qty,b.coletorId,ts].join(';'));
    });
    var blob=new Blob(['﻿'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'});
    var url=URL.createObjectURL(blob);
    var a=document.createElement('a'); a.href=url;
    a.download=((inv&&inv.nome)||'inventario').replace(/[^a-z0-9]/gi,'_')+'_avulso.csv';
    a.click(); setTimeout(function(){ URL.revokeObjectURL(url); },2000);
  }).catch(function(e){ alert('Erro: '+e.message); });
}

// ═══════════════════════════════════════════════════════════════════════════
// NOVAS FEATURES — Inventário
// ═══════════════════════════════════════════════════════════════════════════

// ── Variáveis globais das novas features ─────────────────────────────────
var _inv100pctAlerted = {};   // { invId: true } — evita repetir o alerta
var _offlinePending   = 0;    // bipagens aguardando sync

// ── Feature: Indicador de offline ────────────────────────────────────────
(function(){
  function _atualizarOfflineBanner(){
    var online=navigator.onLine;
    var el=document.getElementById('offline-banner');
    if(!el){
      el=document.createElement('div');
      el.id='offline-banner';
      el.style.cssText='position:fixed;bottom:0;left:0;right:0;z-index:9999;padding:10px 16px;font-size:13px;font-weight:700;text-align:center;transition:transform .3s;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:8px';
      document.body.appendChild(el);
    }
    if(!online){
      el.style.background='#c0392b'; el.style.color='#fff';
      el.style.transform='translateY(0)';
      var p=_offlinePending>0?' · '+_offlinePending+' bipagem(ns) aguardando envio':'';
      el.textContent='📡 Sem internet'+p+' — seus dados estão salvos localmente';
    } else if(_offlinePending>0){
      el.style.background='#b38600'; el.style.color='#fff';
      el.style.transform='translateY(0)';
      el.textContent='⏳ Sincronizando '+_offlinePending+' bipagem(ns)...';
    } else {
      el.style.transform='translateY(100%)';
    }
  }
  window.addEventListener('online',  _atualizarOfflineBanner);
  window.addEventListener('offline', _atualizarOfflineBanner);
  _atualizarOfflineBanner();
  window._atualizarOfflineBanner=_atualizarOfflineBanner;
})();

// ── Feature: Alerta 100% concluído ───────────────────────────────────────
function _alertar100pct(){
  // Som via AudioContext (sem asset externo)
  try{
    var ctx=new(window.AudioContext||window.webkitAudioContext)();
    var osc=ctx.createOscillator(); var g=ctx.createGain();
    osc.connect(g); g.connect(ctx.destination);
    osc.type='sine'; osc.frequency.setValueAtTime(880,ctx.currentTime);
    osc.frequency.setValueAtTime(1100,ctx.currentTime+0.15);
    osc.frequency.setValueAtTime(880,ctx.currentTime+0.3);
    g.gain.setValueAtTime(0.3,ctx.currentTime); g.gain.linearRampToValueAtTime(0,ctx.currentTime+0.5);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime+0.5);
  }catch(e){}
  // Toast visual
  var t=document.createElement('div');
  t.style.cssText='position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:9999;background:#1a5c34;color:#fff;padding:16px 28px;border-radius:16px;font-weight:800;font-size:16px;box-shadow:0 4px 24px rgba(0,0,0,.25);text-align:center;animation:none';
  t.innerHTML='🎉 Inventário 100% concluído!<br><span style="font-size:12px;font-weight:400">Todos os endereços foram finalizados.</span>';
  document.body.appendChild(t);
  setTimeout(function(){ if(t.parentNode) t.parentNode.removeChild(t); },6000);
}

// ── Feature: Produto sem código de barras ─────────────────────────────────
function _abrirSemEAN(){
  if(!_invColetaAtual||_invColetaAtual.concluido) return;
  var html=
    '<div id="modal-sem-ean" onclick="if(event.target===this)_fecharSemEAN()" style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:2200;display:flex;align-items:flex-end;justify-content:center;padding:0">'+
      '<div style="background:#fff;border-radius:20px 20px 0 0;padding:24px 20px 36px;width:100%;max-width:480px;box-shadow:0 -4px 32px rgba(0,0,0,.18)">'+
        '<div style="font-size:17px;font-weight:800;margin-bottom:4px">📝 Produto Sem Código</div>'+
        '<div style="font-size:13px;color:var(--t3);margin-bottom:16px">Item sem etiqueta ou código de barras.</div>'+
        '<label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--t2);display:block;margin-bottom:6px">Descrição do produto</label>'+
        '<input id="sem-ean-desc" type="text" placeholder="Ex: Suco laranja caixa 1L" autocomplete="off" style="width:100%;padding:12px 14px;border:2px solid var(--gray2);border-radius:10px;font-size:14px;font-family:inherit;margin-bottom:12px;box-sizing:border-box" onkeydown="if(event.key===\'Enter\')document.getElementById(\'sem-ean-qty\').focus()"/>'+
        '<label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--t2);display:block;margin-bottom:6px">Quantidade</label>'+
        '<input id="sem-ean-qty" type="number" value="1" min="1" style="width:100%;padding:12px 14px;border:2px solid var(--gray2);border-radius:10px;font-size:16px;font-weight:700;text-align:center;font-family:monospace;margin-bottom:16px;box-sizing:border-box" onkeydown="if(event.key===\'Enter\')_confirmarSemEAN()"/>'+
        '<div style="display:flex;gap:10px">'+
          '<button onclick="_fecharSemEAN()" style="flex:1;padding:13px;background:#fff;border:1.5px solid var(--gray2);border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;color:var(--t2)">Cancelar</button>'+
          '<button onclick="_confirmarSemEAN()" style="flex:2;padding:13px;background:var(--y);color:#111;border:none;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">✓ Registrar</button>'+
        '</div>'+
      '</div>'+
    '</div>';
  document.body.insertAdjacentHTML('beforeend',html);
  setTimeout(function(){ var e=document.getElementById('sem-ean-desc'); if(e) e.focus(); },100);
}

function _fecharSemEAN(){
  var m=document.getElementById('modal-sem-ean'); if(m) m.remove();
}

function _confirmarSemEAN(){
  var descEl=document.getElementById('sem-ean-desc');
  var qtyEl=document.getElementById('sem-ean-qty');
  var desc=(descEl?descEl.value.trim():'');
  var qty=parseInt(qtyEl?qtyEl.value:1)||1;
  if(!desc){ if(descEl){ descEl.style.borderColor='var(--r)'; descEl.focus(); } return; }
  _fecharSemEAN();
  if(!_invColetaAtual) return;
  var info=_invColetaAtual, inv=info.inv;
  var coletorId=_getIdColetor();
  var ean='SEM-EAN-'+Date.now();
  var bipData={
    invId:inv.id, loja:inv.loja||'', endereco:info.endereco,
    seq:_nextSeq, ean:ean, desc:desc, qty:qty, rodada:info.rodada||1,
    modo:info.modo||'colaboracao', setor:(_filaEndAtual&&_filaEndAtual.setor)||'',
    coletorId:coletorId, coletorNome:_getNomeColetor()||coletorId,
    semEAN:true, ts:firebase.firestore.FieldValue.serverTimestamp()
  };
  _nextSeq++;
  _gravarBipagemLocal(bipData);
  _bipsLocais.unshift(bipData); _bipSom('ok');
  showToast('📝 "'+desc+'" × '+qty+' registrado.');
  _renderUltimasBipagens(_bipsLocais.slice(0,20), inv.id);
  var ei=document.getElementById('inv-ean-input'); if(ei) ei.focus();
}


// Garante que inv_detalhe_state está salvo antes do F5/fechamento
window.addEventListener('beforeunload', function() {
  if (typeof _invAtivo !== 'undefined' && _invAtivo && _invAtivo.id) {
    var _tab = 'enderecos';
    var _activeTab = document.querySelector('#inv-detalhe-tabs .tab.on');
    if (_activeTab) {
      var _oc = _activeTab.getAttribute('onclick') || '';
      var _m = _oc.match(/switchInvTab\('([^']+)'/);
      if (_m) _tab = _m[1];
    }
    localStorage.setItem('inv_detalhe_state', JSON.stringify({invId:_invAtivo.id, tab:_tab}));
    localStorage.setItem('eco_forcar_restauracao', 'inv');
  }
});

// Restaura sessao ao recarregar a pagina
// (script e defer — DOM ja esta pronto aqui, sem precisar de DOMContentLoaded)
// Aguarda Firebase Auth inicializar antes de chamar finalizarLogin, evitando
// que leituras do Firestore rodem sem autenticacao (timing issue com IndexedDB).
(function() {
  try {
    var saved = sessionStorage.getItem('eco_session');
    if (saved) {
      var user = JSON.parse(saved);
      if (user && user.id && user.perfil) {
        var _restaurar = function() { finalizarLogin(user); };
        // A validação de clienteId x deploy atual roda dentro de finalizarLogin,
        // que é chamada tanto aqui (restore) quanto no login ativo.
        if (firebase.auth().currentUser) {
          _restaurar();
        } else {
          var _unsub = firebase.auth().onAuthStateChanged(function(fbUser) {
            _unsub();
            if (fbUser) {
              _restaurar();
            }
            // fbUser null = sessao Firebase expirou; tela de login ja aparece por padrao
          });
        }
      }
    }
  } catch(e) {}
})();

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
var _coletaInvUnsub=null, _coletaInvId=null, _coletaInvStatus=null;
function _iniciarColetaRealtime(invId){
  if(_coletaInvId===invId&&_coletaInvUnsub) return;
  _pararColetaRealtime(); _coletaInvId=invId; _coletaInvStatus=null;
  _coletaInvUnsub=db.collection('inv_inventarios').doc(invId).onSnapshot(function(snap){
    if(!snap.exists) return;
    var d=snap.data();
    var idx=(S.invsCache||[]).findIndex(function(i){ return i.id===invId; });
    // Compara com o último status visto por ESTE listener (não com o cache, que outro listener pode já ter atualizado).
    var antes=_coletaInvStatus; _coletaInvStatus=d.status;
    if(idx>=0){
      S.invsCache[idx]=Object.assign({id:invId},d);
      if(_invColetaAtual&&_invColetaAtual.inv&&_invColetaAtual.inv.id===invId) _invColetaAtual.inv=S.invsCache[idx];
    }
    if(antes!==null&&antes!==d.status) renderColeta();
  }, function(){ /* erro silencioso: a trava em registrarBipagem continua valendo */ });
}
function _pararColetaRealtime(){ if(_coletaInvUnsub){ _coletaInvUnsub(); _coletaInvUnsub=null; } _coletaInvId=null; _coletaInvStatus=null; }
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

// Copia o token recém-gerado (Integrações). Clipboard API; sem ela (http/navegador antigo), seleciona e usa execCommand.
function _copiarTokenInteg(){
  var v=document.getElementById('integ-token-valor'), b=document.getElementById('integ-token-copiar'); if(!v) return;
  var txt=v.textContent.trim();
  var ok=function(){ if(b){ b.innerHTML='&#10003; Copiado'; setTimeout(function(){ if(b) b.innerHTML='&#10697; Copiar token'; },2500); } showToast('Token copiado'); };
  var manual=function(){
    try{ var r=document.createRange(); r.selectNodeContents(v); var sel=window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
      if(document.execCommand('copy')){ ok(); return; } }catch(e){}
    showToast('Não deu pra copiar sozinho: o token ficou selecionado, use Ctrl+C',4000);
  };
  if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(ok,manual); else manual();
}
