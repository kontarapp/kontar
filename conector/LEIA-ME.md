# Conector Kontar

Programa que roda no servidor central do cliente e liga o ERP ao Kontar.

1. Um inventário aberto no ERP aparece sozinho no Kontar, já com o catálogo da loja (estoque, custo e venda).
2. A equipe conta no Kontar.
3. Quando o balanço é encerrado no Kontar, a contagem é gravada no inventário do ERP. Depois é só fechar o inventário no ERP como sempre.

ERP suportado: **Dlinks** (MySQL `central`).

## Instalar

1. Abra o **KontarConectorSetup.exe** no servidor central (ou, no zip, clique duas vezes em **Instalar.cmd**). O Windows pede permissão de Administrador.
2. Na janela, preencha o token do Kontar (aba **Integrações** do app), servidor, porta, usuário e senha do MySQL do ERP e as lojas.
3. Clique em **Testar conexão** e depois em **Instalar**.

Se o Windows mostrar "O Windows protegeu o computador", clique em **Mais informações** > **Executar assim mesmo** (o instalador ainda não é assinado).

Sem janela (linha de comando, como Administrador): `powershell -ExecutionPolicy Bypass -File instalar.ps1` e responda as perguntas.

O instalador:

- baixa um Node portátil se o servidor não tiver Node 18+;
- testa o token e o banco antes de ativar;
- configura para levar só inventários abertos **depois** da instalação;
- cria a tarefa do Windows `KontarConector`, que liga com o servidor e reinicia se cair.

Log diário em `C:\KontarConector\logs\`. Para remover: `desinstalar.ps1`.

## O que o conector faz no banco do ERP

- **Lê**: `inventario`, `itens`, `estoquen{loja}`.
- **Insere** (nunca altera nem apaga): uma linha em `inventariodigitador` com o nome `KONTAR` por inventário e as linhas de contagem em `inventariocontagem` (código, quantidade com 3 casas, endereço, data e hora).
- Não cria tabela nem coluna. Se o inventário já estiver fechado no ERP, não grava e avisa no Kontar.
- Gravar duas vezes não duplica: se o digitador `KONTAR` do inventário já tem contagem, ele não grava de novo.

Usuário do MySQL recomendado: só leitura, com `INSERT` apenas em `inventariodigitador` e `inventariocontagem`.

## Configuração (`conector.json`)

| Campo | Para que serve |
|---|---|
| `lojas` | lojas atendidas por este servidor |
| `dlinks.desdeNIven` | só inventários com número igual ou maior vão para o Kontar |
| `dlinks.statusFechados` | status do inventário que contam como fechado no ERP (padrão 2 e 3) |
| `enderecosPadrao` | endereços criados no balanço do Kontar (ex.: `1-10` ou `C01,C02`) |
| `porEndereco` | `true` grava uma linha por produto e endereço; `false`, uma linha por produto |
| `intervaloSeg` | de quanto em quanto tempo o conector verifica (padrão 60 s) |

Comandos manuais (na pasta do conector):

```
node index.js --testar      testa token e banco, sem gravar nada
node index.js --uma-vez     roda um ciclo e sai
```
