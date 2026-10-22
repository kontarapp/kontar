// Kontar — configuração do Firebase (projeto NOVO, separado do Fluxo360)
// Crie um projeto em https://console.firebase.google.com, ative Authentication (E-mail/senha)
// e Firestore, depois cole aqui as credenciais Web do app.
window.KONTAR_FIREBASE_CONFIG = {
  apiKey: "COLE_AQUI",
  authDomain: "SEU-PROJETO.firebaseapp.com",
  projectId: "SEU-PROJETO",
  storageBucket: "SEU-PROJETO.firebasestorage.app",
  messagingSenderId: "COLE_AQUI",
  appId: "COLE_AQUI"
};

// Tenant (cliente) deste deploy.
// 'universal' = o clienteId vem do usuário logado (campo clienteId em usuarios/{id}).
// Para um deploy dedicado a um único cliente, coloque aqui o id do doc em clientes/{id}
// (o login então só aceita usuários com esse mesmo clienteId).
window.KONTAR_CLIENT_ID = 'universal';
