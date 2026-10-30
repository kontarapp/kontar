# Janela do instalador do Conector Kontar. Aberta pelo Instalar.cmd (que já pede Administrador).
# Por baixo chama o instalar.ps1 com os valores digitados e mostra o andamento na própria janela.
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$aqui = Split-Path -Parent $MyInvocation.MyCommand.Path
$instalar = Join-Path $aqui 'instalar.ps1'
$PASTA_PADRAO = 'C:\KontarConector'

# Valores iniciais: os de uma instalação anterior, se existir.
$ini = @{ token = ''; host = '127.0.0.1'; port = '3306'; user = ''; password = ''; database = 'central'; lojas = ''; enderecos = '1-10'; desde = '' }
$cfgAnt = Join-Path $PASTA_PADRAO 'conector.json'
if (Test-Path $cfgAnt) {
  try {
    $c = Get-Content $cfgAnt -Raw | ConvertFrom-Json
    $ini.token = $c.kontar.token; $ini.host = $c.mysql.host; $ini.port = [string]$c.mysql.port; $ini.user = $c.mysql.user
    $ini.password = $c.mysql.password; $ini.database = $c.mysql.database; $ini.lojas = (@($c.lojas) -join ','); $ini.enderecos = $c.enderecosPadrao
    if ($c.dlinks.desdeNIven) { $ini.desde = [string]$c.dlinks.desdeNIven }
  } catch {}
}

$laranja = [System.Drawing.Color]::FromArgb(249, 115, 22)
$escuro = [System.Drawing.Color]::FromArgb(24, 24, 27)
$fonte = New-Object System.Drawing.Font('Segoe UI', 9.5)

$f = New-Object System.Windows.Forms.Form
$f.Text = 'Instalar Conector Kontar'
$f.Size = New-Object System.Drawing.Size(640, 720)
$f.StartPosition = 'CenterScreen'
$f.FormBorderStyle = 'FixedDialog'; $f.MaximizeBox = $false
$f.BackColor = [System.Drawing.Color]::White
$f.Font = $fonte

$topo = New-Object System.Windows.Forms.Panel
$topo.Dock = 'Top'; $topo.Height = 78; $topo.BackColor = $escuro
$f.Controls.Add($topo)
$tit = New-Object System.Windows.Forms.Label
$tit.Text = 'Conector Kontar'; $tit.ForeColor = $laranja; $tit.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 16)
$tit.Location = New-Object System.Drawing.Point(20, 10); $tit.AutoSize = $true
$topo.Controls.Add($tit)
$sub = New-Object System.Windows.Forms.Label
$sub.Text = 'Liga o ERP ao Kontar: inventário aberto no ERP vai pro Kontar e a contagem volta pro ERP.'
$sub.ForeColor = [System.Drawing.Color]::Gainsboro; $sub.Location = New-Object System.Drawing.Point(22, 46); $sub.AutoSize = $true
$topo.Controls.Add($sub)

$y = 92
function Campo($rotulo, $valor, $dica, [switch]$Senha, $largura = 360) {
  $l = New-Object System.Windows.Forms.Label
  $l.Text = $rotulo; $l.Location = New-Object System.Drawing.Point(22, ($script:y + 3)); $l.Size = New-Object System.Drawing.Size(200, 22)
  $f.Controls.Add($l)
  $t = New-Object System.Windows.Forms.TextBox
  $t.Location = New-Object System.Drawing.Point(225, $script:y); $t.Size = New-Object System.Drawing.Size($largura, 24); $t.Text = $valor
  if ($Senha) { $t.UseSystemPasswordChar = $true }
  $f.Controls.Add($t)
  if ($dica) {
    $d = New-Object System.Windows.Forms.Label
    $d.Text = $dica; $d.ForeColor = [System.Drawing.Color]::Gray; $d.Font = New-Object System.Drawing.Font('Segoe UI', 8)
    $d.Location = New-Object System.Drawing.Point(225, ($script:y + 26)); $d.AutoSize = $true
    $f.Controls.Add($d); $script:y += 50
  } else { $script:y += 34 }
  return $t
}

$tToken = Campo 'Token do Kontar' $ini.token 'App Kontar > Integrações > Gerar novo token'
$tHost = Campo 'Servidor do banco (MySQL)' $ini.host 'IP ou nome do servidor onde está o banco do ERP'
$tPorta = Campo 'Porta' $ini.port '' -largura 80
$tUser = Campo 'Usuário do banco' $ini.user ''
$tSenha = Campo 'Senha do banco' $ini.password '' -Senha
$tBanco = Campo 'Banco' $ini.database '' -largura 160
$tLojas = Campo 'Lojas' $ini.lojas 'Números separados por vírgula. Ex.: 1,2,3'
$tEnd = Campo 'Endereços do balanço' $ini.enderecos 'Criados em cada balanço. Ex.: 1-10 ou C01,C02'
$tDesde = Campo 'A partir do inventário nº' $ini.desde 'Em branco = só inventários abertos depois de instalar' -largura 120
$tPasta = Campo 'Pasta de instalação' $PASTA_PADRAO ''

$log = New-Object System.Windows.Forms.TextBox
$log.Multiline = $true; $log.ReadOnly = $true; $log.ScrollBars = 'Vertical'
$log.Location = New-Object System.Drawing.Point(22, ($y + 4)); $log.Size = New-Object System.Drawing.Size(580, 118)
$log.BackColor = [System.Drawing.Color]::FromArgb(245, 245, 245); $log.Font = New-Object System.Drawing.Font('Consolas', 8.5)
$log.Text = 'Preencha os dados e clique em Testar conexão. Se der tudo certo, clique em Instalar.'
$f.Controls.Add($log)
$yb = $y + 132

function Botao($texto, $x, $larg, $principal) {
  $b = New-Object System.Windows.Forms.Button
  $b.Text = $texto; $b.Location = New-Object System.Drawing.Point($x, $yb); $b.Size = New-Object System.Drawing.Size($larg, 34)
  $b.FlatStyle = 'Flat'
  if ($principal) { $b.BackColor = $laranja; $b.ForeColor = [System.Drawing.Color]::White; $b.FlatAppearance.BorderSize = 0; $b.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 10) }
  $f.Controls.Add($b); return $b
}
$bTestar = Botao 'Testar conexão' 22 150 $false
$bInstalar = Botao 'Instalar' 382 120 $true
$bFechar = Botao 'Fechar' 512 90 $false
$bFechar.Add_Click({ $f.Close() })

$script:proc = $null; $script:saida = $null; $script:modo = ''
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 500

function Aspas($v) { "'" + ([string]$v).Replace("'", "''") + "'" }
# Lê o arquivo de saída mesmo com o instalador ainda escrevendo nele (sem compartilhar, o Windows recusa).
function LerTexto($arq) {
  try {
    $fs = New-Object IO.FileStream($arq, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]'ReadWrite, Delete')
    $sr = New-Object IO.StreamReader($fs, [Text.Encoding]::UTF8, $true)
    $t = $sr.ReadToEnd(); $sr.Close(); return $t
  } catch { return '' }
}

function Rodar($soTestar) {
  if (-not $tToken.Text.Trim()) { [System.Windows.Forms.MessageBox]::Show('Informe o token do Kontar.', 'Conector Kontar') | Out-Null; return }
  if (-not $tLojas.Text.Trim()) { [System.Windows.Forms.MessageBox]::Show('Informe as lojas.', 'Conector Kontar') | Out-Null; return }
  if ($tDesde.Text.Trim() -and $tDesde.Text.Trim() -notmatch '^\d+$') { [System.Windows.Forms.MessageBox]::Show('"A partir do inventário" precisa ser um número (ou em branco).', 'Conector Kontar') | Out-Null; return }
  $porta = 3306; if ($tPorta.Text.Trim() -match '^\d+$') { $porta = [int]$tPorta.Text.Trim() }
  $desde = -1; if ($tDesde.Text.Trim()) { $desde = [int]$tDesde.Text.Trim() }
  # Lançador temporário com os parâmetros (aceita senha vazia e caracteres especiais sem problema de aspas).
  $lan = Join-Path $env:TEMP ('kontar-inst-' + [guid]::NewGuid().ToString('N') + '.ps1')
  $linhas = @(
    '$ErrorActionPreference = ''Continue''',
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8; $OutputEncoding = [Text.Encoding]::UTF8',
    '$p = @{',
    "  Pasta = $(Aspas $tPasta.Text.Trim()); Token = $(Aspas $tToken.Text.Trim()); MysqlHost = $(Aspas $tHost.Text.Trim()); MysqlPorta = $porta",
    "  MysqlUsuario = $(Aspas $tUser.Text.Trim()); MysqlSenha = $(Aspas $tSenha.Text); MysqlBanco = $(Aspas $tBanco.Text.Trim())",
    "  Lojas = $(Aspas $tLojas.Text.Trim()); Enderecos = $(Aspas $tEnd.Text.Trim()); DesdeInventario = $desde; Recriar = `$true",
    '}',
    $(if ($soTestar) { '$p.SemTarefa = $true' } else { '' }),
    "& $(Aspas $instalar) @p *>&1",
    'exit $LASTEXITCODE'
  )
  [IO.File]::WriteAllLines($lan, $linhas, (New-Object Text.UTF8Encoding($true)))
  $script:saida = Join-Path $env:TEMP ('kontar-inst-' + [guid]::NewGuid().ToString('N') + '.log')
  $script:lancador = $lan
  $script:modo = $(if ($soTestar) { 'teste' } else { 'instalar' })
  $log.Text = $(if ($soTestar) { 'Testando... (na primeira vez pode baixar o Node, aguarde)' } else { 'Instalando... (pode levar alguns minutos)' })
  $bTestar.Enabled = $false; $bInstalar.Enabled = $false; $f.Cursor = 'WaitCursor'
  $script:proc = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$lan`"") `
    -RedirectStandardOutput $script:saida -RedirectStandardError ($script:saida + '.err') -WindowStyle Hidden -PassThru
  $null = $script:proc.Handle  # sem pegar o Handle logo, o ExitCode volta vazio no fim (comportamento do Start-Process)
  $timer.Start()
}

$timer.Add_Tick({
  $txt = ''
  if ($script:saida -and (Test-Path $script:saida)) { $txt = LerTexto $script:saida }
  if ($txt) { $log.Text = $txt; $log.SelectionStart = $log.Text.Length; $log.ScrollToCaret() }
  if ($script:proc -and $script:proc.HasExited) {
    $timer.Stop()
    $err = ''; if (Test-Path ($script:saida + '.err')) { $err = LerTexto ($script:saida + '.err') }
    if ($err.Trim()) { $log.AppendText("`r`n" + $err) }
    $ok = ($script:proc.ExitCode -eq 0)
    $bTestar.Enabled = $true; $bInstalar.Enabled = $true; $f.Cursor = 'Default'
    Remove-Item $script:lancador, ($script:saida + '.err') -ErrorAction SilentlyContinue
    if ($ok -and $script:modo -eq 'instalar') {
      [System.Windows.Forms.MessageBox]::Show("Conector instalado e rodando.`n`nEle liga junto com o servidor e verifica o ERP a cada minuto.`nLog em $($tPasta.Text.Trim())\logs", 'Conector Kontar', 'OK', 'Information') | Out-Null
    } elseif ($ok) {
      [System.Windows.Forms.MessageBox]::Show('Conexão OK com o Kontar e com o banco do ERP. Agora clique em Instalar.', 'Conector Kontar', 'OK', 'Information') | Out-Null
    } else {
      [System.Windows.Forms.MessageBox]::Show('Não deu certo. Veja a mensagem no quadro da janela, corrija e tente de novo.', 'Conector Kontar', 'OK', 'Warning') | Out-Null
    }
  }
})

$bTestar.Add_Click({ Rodar $true })
$bInstalar.Add_Click({ Rodar $false })
$f.Height = $yb + 90
[void]$f.ShowDialog()
