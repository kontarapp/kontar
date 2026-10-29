# Kontar — Direção visual "Ardósia" (design spec)

Data: 2026-10-28. Aprovado por Tiago após comparar 4 direções (A Ardósia, B Faixa, C Galpão, D Etiqueta).

## Objetivo

O Kontar herdou o CSS do Fluxo360 com a cor trocada. Esta spec define uma identidade própria, aplicada em todas as telas, sem mudar função, dados ou fluxo. O FC360 não é tocado.

## O que denunciava o Fluxo (e sai)

Space Grotesk, fundo creme, sidebar preta, botão verde-escuro, cards arredondados com sombra, pílulas de status com fundo colorido, emojis em botões.

## Tokens

Decisão do Tiago (28/10, depois do 1º protótipo): as cores originais do Kontar ficam; só o layout muda. O acabamento é premium (profundidade real, chips tintados, ícones nos KPIs), não minimalista.

- Fundo da página `#F5F3EE` (neutro quente), superfícies `#fff`, linhas `#e6e2da` (forte) e `#efece6` (fraca).
- Texto `#0f172a`, secundário `#475569`, apagado `#64748b`, placeholder `#94a3b8`.
- Barra superior escura `#1B1B1F` → `#2A2A30`, com a logo branca. Item ativo com sublinhado laranja.
- Laranja da marca `#F97316` (hover `#C2410C`): sublinhado do menu e das abas, avatar do usuário, ícones da capa. Nunca em botão de ação.
- Verde de ação `#1a7a4a` (gradiente até `#2d9e62`): botão principal, links de ação, foco de inputs.
- Semânticos: ok verde `#166534/#dcfce7`, andamento âmbar `#92400e/#fef3c7`, atenção laranja `#9a3412/#ffedd5`, erro `#991b1b/#fee2e2`, info azul, auditoria roxo.
- Tipografia: Manrope (UI, 500 a 800) e IBM Plex Mono (números, códigos, EAN, datas e horas em tabela). Google Fonts.
- Raio 6px em botões e inputs, 10px em cartões e tabelas, 14px em modais. Sombras em camadas, suaves, só em cartões, botões principais, menus e modais.
- Transições só nas propriedades que mudam (160ms). Botão pressionado `scale(.97)`.

## Estrutura (shell)

- Sem sidebar. Uma barra superior escura de 56px: logo branca à esquerda, itens de navegação inline (Início, Inventários, Minha Coleta, Coleta Avulsa, Usuários), usuário à direita. Item ativo com sublinhado de 2px no acento.
- No celular (≤768px) a barra mostra só o botão de início, o título da página e a conta. A navegação continua pela capa de módulos, como hoje.
- Conteúdo com padding 22px/24px no desktop e 14px no celular.
- Título da tela dentro do conteúdo (h3 20px/600), subtítulo apagado ao lado.

## Componentes

- Abas (`.tabs/.tab`): texto sublinhado, sem fundo cinza, sem caixa. Ativa: texto escuro + linha 2px no acento. Rolagem horizontal quando não cabe.
- Botões (`.btn`): raio 4px, 13px/500. `.btn-p` cheio no acento (um por tela, a ação principal). `.btn-s` branco com contorno `#cbd5e1`. `.btn-d` branco com texto e contorno vermelhos. Sem emoji.
- Tabelas: borda externa 1px forte, cabeçalho 11px maiúsculo apagado, linhas 1px fraca, sem fundo zebrado. Coluna ordenada marcada no próprio cabeçalho.
- Status (`.st`): chip tintado arredondado com ponto 7px + texto 12px/700. Variantes ok / run / warn / err / info / mute. "Em andamento" pulsa.
- Etiquetas de modo e tipo (`.tg`): 11px/700 em fundo tintado claro, raio 5px. Variantes: padrão, auditoria (roxo), colab/atenção (âmbar), erro (vermelho), info (azul), ok (verde).
- KPIs (`.kpis` + `.mc`): cartões brancos com sombra, ícone tintado no canto (classe `k-ac/k-ok/k-bl/k-am/k-r/k-pu`), rótulo 11px maiúsculo, valor 26px em Plex Mono.
- Barra de ações (`.bar`): flex com `gap:10px`, acima da tabela. Ações de perigo à direita. Nunca no rodapé.
- Formulários: inputs 1px `#cbd5e1`, raio 4px, foco no acento.
- Modais: raio 8px, sombra discreta, título 16px/600.
- Login: lado da marca em `#0f172a` com logo clara; lado do formulário branco; botão no acento.

## Por aba do inventário

- Endereços: Encerrar e Excluir sobem pra barra do topo, à direita. Status do catálogo vira texto na barra.
- Coletores: resumo numa linha ("N coletores identificados"), Editar/Excluir como links na linha.
- Dashboard: régua de KPIs; tabela com status ponto+texto.
- Bipagens: filtros, contador, checkbox, Correção e PDF numa barra única.
- Monitor: busca, chips de alerta e botões numa barra; tabela com números em mono.
- Auditoria: seis ferramentas como linhas de uma caixa só (título, descrição, botão à direita); trilha embaixo.
- Exportar: bloco de código com cabeçalho em destaque, botão principal + nome do arquivo.

## Fases

1. Shell, tokens, componentes globais, telas Inventários (lista) e Dashboard. Publicar.
2. Demais abas (Endereços, Coletores, Bipagens, Monitor, Auditoria, Exportar), Minha Coleta, Coleta Avulsa, Usuários.
3. Login, modais, impressões (folha, QR, PDFs).

## Fora de escopo

Novos cálculos ou colunas que exijam leitura extra do Firestore. Mudança de fluxo. Qualquer alteração no FC360.
