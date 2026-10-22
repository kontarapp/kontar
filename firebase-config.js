// Kontar — configuração do Firebase (projeto kontar-e2650, separado do Fluxo360)
// Arquivo fora do git (.gitignore). Valores obtidos com: firebase apps:sdkconfig WEB --project kontar-e2650
window.KONTAR_FIREBASE_CONFIG = {
  apiKey: "AIzaSyDbSD0FnpIq7HJPUzhsIvC5ISU3WDNhEkU",
  authDomain: "kontar-e2650.firebaseapp.com",
  projectId: "kontar-e2650",
  storageBucket: "kontar-e2650.firebasestorage.app",
  messagingSenderId: "378518982267",
  appId: "1:378518982267:web:8e079a6b8b445fdd40dcde"
};

// Tenant (cliente) deste deploy.
// 'universal' = o clienteId vem do usuário logado (campo clienteId em usuarios/{id}).
window.KONTAR_CLIENT_ID = 'universal';
