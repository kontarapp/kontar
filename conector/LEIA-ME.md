# Conector Kontar

Programa que roda no servidor central do cliente e liga o ERP ao Kontar.

1. Um inventário aberto no ERP aparece sozinho no Kontar, já com o catálogo da loja (estoque, custo e venda).
2. A equipe conta no Kontar.
3. Enquanto bipam, a cada 5 minutos a contagem do momento vai sendo gravada no inventário do ERP (dá pra acompanhar no Dlinks).
4. Quando o balanço é encerrado no Kontar, a contagem final é gravada e conferida. Depois é só fechar o inventário no ERP como sempre.

ERP suportado: **Dlinks** (MySQL `central`).

## Instalar

1. Abra o **KontarConectorSetup.exe** no servidor central. O Windows pede permissão de Administrador.
2. Siga o assistente: cole o token do Kontar (app Kontar > Integrações > Gerar novo token > Copiar token), informe o servidor, usuário e senha do banco do ERP e marque as lojas.
3. Clique em **Instalar**.

O instalador testa o token e o banco antes de instalar, leva o Node junto (não precisa instalar nada antes) e cria a tarefa do Windows `KontarConector`, que liga com o servidor e reinicia se cair. Por padrão só os inventários abertos **depois** da instalação vão pro Kontar (dá pra mudar em Opções avançadas).

Se o Windows mostrar "O Windows protegeu o computador", clique em **Mais informações** > **Executar assim mesmo** (o instalador ainda não tem assinatura digital).

- Pasta do programa: `C:\Program Files\Kontar Conector`
- Configuração e registros: `C:\ProgramData\Kontar Conector` (`conector.json` só Administradores leem, porque guarda a senha do banco)
- Para remover: **Configurações > Aplicativos > Kontar Conector > Desinstalar**.
- Atualizar: abra o instalador novo por cima; ele já vem preenchido com a configuração atual.

Instalação sem telas (várias centrais), como Administrador:

```
KontarConectorSetup.exe /VERYSILENT /TOKEN=xxx /SERVIDOR=127.0.0.1 /USUARIO=u /SENHA=s /LOJAS=1,2
```

Opcionais: `/PORTA=3306 /BANCO=central /DESDE=781 /ENDERECOS=1-10`.

## O que o conector faz no banco do ERP

- **Lê**: `inventario`, `itens`, `estoquen{loja}`.
- **Insere** (nunca altera nem apaga): uma linha em `inventariodigitador` com o nome `KONTAR` por inventário e as linhas de contagem em `inventariocontagem` (código, quantidade com 3 casas, endereço, data e hora).
- A cada envio grava **só a diferença** entre o que o `KONTAR` já tem no inventário e a contagem atual do Kontar: positiva quando bipam mais, negativa quando excluem, zeram ou corrigem (o Dlinks soma as linhas, igual a um "-3" lançado na tela). Depois de gravar, confere na mesma transação que a soma bate com o Kontar; se não bater, desfaz e avisa no Kontar.
- Não cria tabela nem coluna. Se o inventário já estiver fechado no ERP, não grava e avisa no Kontar.
- Gravar de novo sem mudança não grava nada (não duplica). Se o inventário for fechado no ERP antes do fim, o conector para de gravar e avisa no Kontar.

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
| `envioDuranteSeg` | de quanto em quanto tempo manda a contagem pro ERP com o balanço aberto (padrão 300 s; `0` = só no encerramento) |

Comandos manuais (na pasta do conector):

```
node index.js --testar      testa token e banco, sem gravar nada
node index.js --uma-vez     roda um ciclo e sai
```
