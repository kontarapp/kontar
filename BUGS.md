# Kontar — Bugs encontrados nos testes locais

Formato: **[status]** descrição — causa — correção. Status: ABERTO / CORRIGIDO / OBSERVAÇÃO.

## 2026-10-07 — primeira rodada (servidor local, antes do login)

1. **[CORRIGIDO]** `firebase-config.js` estava idêntico ao `firebase-config.example.js` (placeholders `COLE_AQUI`) — o app iniciava o Firebase com config vazia e o login falharia com `auth/invalid-api-key`. Preenchido com a config web real do projeto `kontar-e2650` (obtida via `firebase apps:sdkconfig WEB`). Arquivo continua fora do git.

2. **[CORRIGIDO]** Trocar a própria senha em *Usuários* não atualizava `S.currentUser` nem a sessão (`eco_session`) — `aplicarSalvar` só mexia na lista `users`. Efeito: logo após trocar a senha, **Encerrar Inventário** conferia contra o hash antigo e acusava "senha incorreta" com a senha nova (até fazer logout/login). Fix em `app.js` (`aplicarSalvar`): se `editingUserId === S.currentUser.id`, aplica as mesmas `updates` em `S.currentUser` e regrava `eco_session`.

3. **[OBSERVAÇÃO]** `saveUsers()` regrava **todos** os usuários do cache com `set(u)` (doc inteiro) a cada salvamento. Como o cache é filtrado por `clienteId`, não afeta outros tenants, mas sobrescreve campos gravados fora do app (ex.: `_fbNewPass` pendente de outro usuário é mantido só porque está no cache). Herdado do Fluxo360; não mexido.

4. **[OBSERVAÇÃO]** A conta no Firebase Auth (`tiago.freire.silva@gmail.com`) existe no projeto, mas o doc `usuarios/admin` provavelmente ainda não tem o campo `senha` (hash). Até trocar a senha em *Usuários*, Encerrar Inventário vai acusar "senha incorreta" (comportamento documentado no README).

## Pendente de teste (fluxo manual)
- [ ] Login
- [ ] Trocar senha do admin em Usuários
- [ ] Criar inventário
- [ ] Importar catálogo TXT (`testes/catalogo-teste.txt`)
- [ ] Cadastrar coletor
- [ ] Bipar em Minha Coleta
- [ ] Bipar em Coleta Avulsa
- [ ] Encerrar inventário
- [ ] Exportar

## 2026-10-22 — rodada de melhorias (só Kontar, FC360 intocado)

5. **[FEITO]** Testes automatizados do núcleo `lib/inv-bip-core.js` (`npm test`, 43 casos, node --test sem dependências). Provado que pegam quebra: regra do UPC-A sabotada de propósito → 1 falha; restaurado → 43 ok.

6. **[OBSERVAÇÃO — sem mudança]** "Bipagem não enviada sem aviso" NÃO procede: `_gravarBipagemLocal` já conta pendentes (`_offlinePending`), mostra faixa "⏳ Sincronizando N bipagem(ns)" / "📡 Sem internet · N aguardando envio" e, em falha, toca som de erro + toast "❌ Falha ao gravar EAN". Correções (`aplicarCorrecaoBipagem`) mostram o erro no próprio modal. Os 29 `catch` vazios restantes são localStorage/câmera/signOut, log de auditoria, liberação de endereço na fila e `coletoresReg` — todos reenviados pelo Firestore offline quando a rede volta (só falhariam por permissão, que as regras atuais não negam). Decisão: não mexer.

7. **[FEITO — BUILD 2]** Escape de HTML: função `esc()` única (após `genId`) aplicada em 101 pontos onde texto do ERP/cadastro entra em HTML (tabelas de catálogo, bipagens, usuários, endereços, fila, relatórios via document.write). Não muda o que é gravado nem exportado. Validação: `node --check`, 43/43 testes, nenhum `esc` dentro de onclick, nenhum escape duplo. Publicado em https://kontarapp.github.io/kontar/ (version.json = 2). **Pendente: Tiago testar o fluxo completo na URL pública com BUILD 2.**

8. **[CORRIGIDO — BUILD 3]** Monitor e Auditoria mostravam "(não cadastrado) NC" pra produto que a aba Bipagens resolvia normalmente. Causa: a bipagem grava `codigo` resolvido na hora do bip; se o catálogo é reenviado depois com outro mapeamento (ex.: coluna Código deixa de existir), Monitor (`renderResumoBipagens`) e núcleo (`calcularResultado.keyOf`) procuravam esse código direto em `porCodigo` e, não achando, marcavam NC. A aba Bipagens usa `resolverCodigo` (código OU EAN) e por isso achava. Fix: os dois caminhos agora só confiam no `codigo` gravado se ele ainda existir no catálogo; senão resolvem pelo código e depois pelo EAN. 2 testes de regressão em `test/inv-bip-core.test.js` (falhavam antes, 45/45 depois). Mesmo comportamento existe no FC360 (não alterado por decisão do Tiago).
