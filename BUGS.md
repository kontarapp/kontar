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
