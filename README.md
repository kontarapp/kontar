# Kontar — Inventário

App (PWA) de inventário para mercados e farmácias: o administrador cria o balanço, importa o catálogo do ERP, imprime QR dos endereços e acompanha em tempo real; os coletores bipam no celular (leitor físico, câmera ou digitação), com fila de endereços, setores, correções, auditoria (contado × sistema), folha de conferência e exportação para ERP.

## Origem

O Kontar é um recorte fiel do módulo **Inventário** do Fluxo360 (app interno de gestão de loja). Foram copiados, sem refatorar:

- `app.js` — seções *Inventário Fase 1/2/3* e *Novas features*, mais as funções de auditoria do balanço (resultado, pendências, folha de conferência) que viviam na seção "Central de Resultados", e a infraestrutura de que elas dependem: init do Firebase, service worker, verificação de modo anônimo, login/logout, navegação, capa (tela inicial mobile), cadastro de usuários, `showToast`.
- `index.html` — login, sidebar/topbar, capa, painéis `panel-inv`, `panel-inv-coleta`, `panel-inv-avulsa`, `panel-usuarios` e os modais do inventário/usuário.
- `style.css` — arquivo inteiro, com os tokens de marca trocados.
- `lib/inv-bip-core.js` — lógica pura (catálogo, resolução de código, resultado do balanço); copiado sem alterações.
- `sw.js` — mesmo service worker (network-first para `app.js`/`index.html`, cache-first para o resto).

O modelo de dados é o mesmo (coleções `inv_inventarios`, `inv_bipagens`, `inv_catalogo`, `inv_catalogo_blocos`, `inv_auditlog`, `usuarios`, `clientes`), então os dados de um inventário do Fluxo360 são compatíveis — mas o Kontar deve apontar para um **projeto Firebase próprio**.

Ficaram de fora: checklists, dashboard, central de resultados, relatórios, planos de ação, promotores, etiquetas, monitor, WhatsApp, assinatura digital, painel superadmin/impersonação, licenciamento por token e o formulário legado de inventário (`addInv/renderInv`).

## Rodar localmente

Não há build. Qualquer servidor estático serve:

```bash
npx serve -l 8080 .
# ou
python3 -m http.server 8080
```

Abra `http://localhost:8080`. O app precisa de internet na primeira carga (Firebase e bibliotecas vêm de CDN: jsQR, ZXing, SheetJS, Google Fonts).

## Testes

```bash
npm test
```

Cobre `lib/inv-bip-core.js` (normalização de EAN, catálogo, resolução de código, blocos, parser do TXT, mapeamento de colunas, detector de rajada e resultado do balanço) com `node --test`, sem dependências. Rodar antes de publicar.

## Teste de carga

`teste-carga.html` (mesma página usada no FC360): entre com um usuário do projeto de teste, crie um inventário "CARGA" com catálogo de 45.000 itens e rode N coletores simulados gravando bipagens pelo mesmo caminho do app (set sem esperar o servidor). Mostra enviadas/confirmadas/erros, latência média e p95, bip/s, e confere a contagem no servidor. O botão **Limpar tudo** apaga o inventário de carga e seus dados. Nunca rodar no projeto de um cliente.

## Configurar o Firebase (projeto novo)

1. Em <https://console.firebase.google.com> crie um projeto (ex.: `kontar-prod`).
2. **Authentication → Sign-in method**: ative *E-mail/senha*.
3. **Firestore Database**: crie o banco (modo produção).
4. **Configurações do projeto → Seus apps → Web**: registre um app web e copie o objeto `firebaseConfig`.
5. Copie `firebase-config.example.js` para `firebase-config.js` (este fica fora do git) e cole os valores:

```js
window.KONTAR_FIREBASE_CONFIG = {
  apiKey: "...",
  authDomain: "kontar-prod.firebaseapp.com",
  projectId: "kontar-prod",
  storageBucket: "kontar-prod.firebasestorage.app",
  messagingSenderId: "...",
  appId: "..."
};
window.KONTAR_CLIENT_ID = 'universal';
```

`KONTAR_CLIENT_ID = 'universal'` significa que o tenant (cliente) vem do campo `clienteId` do usuário logado. Para um deploy dedicado a um único cliente, coloque aqui o id do doc em `clientes/{id}`; o login passa a aceitar só usuários com esse `clienteId`.

Se for hospedar em domínio próprio, adicione o domínio em **Authentication → Settings → Authorized domains**.

### Regras do Firestore

```bash
npm i -g firebase-tools
firebase login
firebase init firestore   # aponte para firestore.rules e firestore.indexes.json deste repositório
firebase deploy --only firestore:rules,firestore:indexes
```

O arquivo `firestore.indexes.json` cria o índice composto que a **Coleta Avulsa** precisa (`inv_bipagens`: invId + endereco + ts). Sem ele a lista da avulsa fica vazia e o erro aparece só no console.

As regras liberam leitura/escrita das coleções `inv_*` e `usuarios` para qualquer usuário autenticado por e-mail/senha, e leitura (`get`) de `clientes/{id}`. Como os docs de `usuarios` são indexados por um id interno (não pelo uid do Auth), não dá para checar "é admin" nas regras sem um índice auxiliar — veja *Pendências* abaixo.

### Primeiro usuário administrador

O app não tem tela de cadastro público: o primeiro admin é criado à mão.

1. **Authentication → Users → Add user**: e-mail e senha (mínimo 6 caracteres).
2. **Firestore → coleção `usuarios`** → crie um documento. Use como **id do documento** um identificador simples (ex.: `admin`) e grave exatamente estes campos:

| campo | tipo | valor |
|---|---|---|
| `id` | string | igual ao id do documento (ex.: `admin`) |
| `nome` | string | `Administrador` |
| `email` | string | o mesmo e-mail do Authentication, **em minúsculas** |
| `perfil` | string | `admin` |
| `ativo` | boolean | `true` |
| `clienteId` | string | um slug do seu cliente/loja, ex.: `minha-loja` (obrigatório no modo `universal`) |
| `loja` | string | `""` (vazio = vê inventários de todas as lojas; se preenchido, só os dessa loja) |
| `senha` | string | **SHA-256 (hex) da senha** — ex.: `echo -n 'SuaSenha' \| sha256sum` |
| `setor`, `cargo`, `telefone` | string | opcionais |

> Por que `senha`? O login é pelo Firebase Auth, mas **Encerrar Inventário** confere a senha digitada contra esse hash (herdado do Fluxo360); sem o campo, o encerramento sempre acusa "senha incorreta". Usuários criados pela tela *Usuários* já recebem o hash automaticamente, e `Excluir Inventário` usa reautenticação do Auth (o hash é só fallback).

3. (Opcional) **coleção `clientes`** → doc com id igual ao `clienteId` acima: `{ nome: "Minha Loja", modulos: { inventario: true } }`. O `nome` aparece no título da capa. Se o doc não existir, o app segue normalmente com todos os módulos ativos.

Depois, entre com esse admin e cadastre os coletores em **Usuários** (perfis: *Coletor*, *Supervisor*, *Administrador*). Esses cadastros criam a conta no Firebase Auth e o doc em `usuarios` com `clienteId` herdado do admin.

Perfis e o que veem:

- **admin** — Inventários (gestão), Minha Coleta, Coleta Avulsa, Usuários.
- **supervisor** — Minha Coleta / Coleta Avulsa quando há inventário aberto; a senha do supervisor autoriza a exclusão de bipagem no celular do coletor.
- **coletor** — Minha Coleta / Coleta Avulsa quando há inventário aberto.

Docs de `usuarios`/`inv_inventarios` **sem** `clienteId` não aparecem para ninguém; sempre grave `clienteId`.

## Instalar como app (Android / PWA)

Publique a pasta num host HTTPS (Firebase Hosting, GitHub Pages, Netlify…).

No Chrome Android: menu ⋮ → *Instalar app* (ou o banner "Adicionar à tela inicial"). O app abre em tela cheia, funciona offline (bipagens ficam na fila do Firestore e sobem quando a rede volta) e se atualiza sozinho quando `app.js?v=` / `CACHE_NAME` mudam.

### Gerar um APK (Play Store / sideload)

- **PWABuilder** (<https://www.pwabuilder.com>): informe a URL publicada → *Package for stores → Android*. Use **Package ID** `com.kontar.app`, nome `Kontar`. O resultado é um Trusted Web Activity (TWA) que abre o PWA.
- **Bubblewrap** (linha de comando, mesmo resultado):

```bash
npm i -g @bubblewrap/cli
bubblewrap init --manifest https://SEU-HOST/manifest.json   # package: com.kontar.app
bubblewrap build
```

Para o TWA abrir sem a barra do navegador, publique o `assetlinks.json` gerado em `https://SEU-HOST/.well-known/assetlinks.json`.

## Publicar uma nova versão

1. `app.js`: `var BUILD = 'N'`.
2. `sw.js`: `CACHE_NAME = 'kontar-vN'` e os `?v=N` da lista `SHELL_ASSETS`.
3. `index.html`: `app.js?v=N`, `style.css?v=N`, `lib/inv-bip-core.js?v=N`.
4. `version.json`: `{"build":"N"}`.

## O que mudou em relação ao Fluxo360 (além de remover módulos)

- Marca: título/manifest/`short_name` → Kontar; cores `#FFC600` → paleta Kontar (`--dk:#1B1B1F` fundo escuro, `--y:#F97316` acento, `--neutral:#F5F3EE`); fonte Plus Jakarta Sans → Space Grotesk; sidebar passou a ter texto claro sobre fundo escuro.
- `var(--y)` era usado em dezenas de estilos inline do inventário mas **nunca estava definido** no `style.css` original; agora está (`#F97316`).
- Credenciais do Firebase saíram do `app.js` para `firebase-config.js` (`window.KONTAR_FIREBASE_CONFIG`); o auth secundário (criação de usuário / senha do supervisor) usa a mesma config. A variável de tenant passou a ser `window.KONTAR_CLIENT_ID`.
- Chaves de `localStorage` locais renomeadas de `fc360_*` para `kontar_*` (build, coletor_id/nome/inv, modo_pallet, cam_fixa, erp_profile, debug). As chaves `eco_*`/`inv_detalhe_state` foram mantidas.
- Preset de exportação ERP `fc360` ("FC360 Padrão") → `kontar` ("Kontar Padrão"); mesmas colunas.
- Sidebar ganhou o item **Coleta Avulsa** (`nav-inv-avulsa`): o painel existia na origem mas não tinha entrada no menu. `atualizarNavColeta()` mostra *Minha Coleta* e *Coleta Avulsa* para **qualquer perfil** quando há inventário aberto (na origem só admin/coletor; os outros perfis viviam no checklist).
- Capa mobile com 4 cards (Inventários, Minha Coleta, Coleta Avulsa, Usuários) + Saída, em grade 2 colunas.
- Tela de Usuários: abas/contadores por Administrador / Supervisor / Coletor; o select de perfil oferece Coletor, Supervisor e Administrador (a origem não permitia criar outros admins pela UI); checkbox "Ativo no Checklist" removido.
- Página inicial após login no desktop: admin → *Inventários*; demais → *Minha Coleta*. No mobile continua a capa.
- `renderUsers()` passou a tolerar a ausência dos contadores no HTML.
- Bloco `?debug=1` do `index.html` (painel de erros na tela) tinha aspas sem escape na origem — era um `SyntaxError` silencioso; corrigido.
- Licenciamento por token (`_checkAssinatura`, `tokens`, modal "Licença") removido: o Kontar não bloqueia por validade.

## Stubs / TODOs

- `_atualizarBadgeNotificacoes()` — **stub vazio** (`// TODO Kontar`). Na origem controlava o sino de pendências de planos de ação; `setupRole()`/`nav()` ainda chamam.
- Referências a ids que já não existiam no HTML da origem (todas com guarda de nulo, sem efeito): `dash-inv-meta` (meta de acurácia no dashboard), `#modal-inv-novo .btn.btn-p` (estado "Criando..." do botão), `impersonar-faixa`, `u-checklist-ativo`.

## Pendências recomendadas

- **Regras**: qualquer usuário logado pode escrever em `usuarios` e `inv_*`. Para endurecer, usar *custom claims* de admin (Cloud Function) ou migrar o id dos docs de `usuarios` para o uid do Auth e checar `perfil` nas regras.
- Se quiser cobrar/licenciar, reimplementar o gate de assinatura (o Fluxo360 usava `clientes/{id}.validade` + coleção `tokens`).
