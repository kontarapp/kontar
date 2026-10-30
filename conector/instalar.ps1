# Instalador do Conector Kontar (Windows, PowerShell 5.1+). Rode como Administrador:
#   botão direito em instalar.ps1 > "Executar com o PowerShell"   (ou)
#   powershell -ExecutionPolicy Bypass -File instalar.ps1
# Parâmetros opcionais (instalação sem perguntas):
#   -Pasta C:\KontarConector -Token xxx -MysqlHost 127.0.0.1 -MysqlPorta 3306 -MysqlUsuario u -MysqlSenha s
#   -MysqlBanco central -Lojas "1,2,3" -DesdeInventario 0 -Enderecos "1-10" -SemTarefa
param(
  [string]$Pasta = 'C:\KontarConector',
  [string]$Token, [string]$MysqlHost, [int]$MysqlPorta = 3306, [string]$MysqlUsuario, [string]$MysqlSenha,
  [string]$MysqlBanco = 'central', [string]$Lojas, [int]$DesdeInventario = -1, [string]$Enderecos = '1-10',
  [switch]$SemTarefa
)
$ErrorActionPreference = 'Stop'
$TAREFA = 'KontarConector'
$NODE_VER = 'v22.11.0'
function Passo($t) { Write-Host ''; Write-Host "== $t" -ForegroundColor Cyan }
function Perguntar($texto, $padrao) {
  $r = Read-Host ($(if ($padrao) { "$texto [$padrao]" } else { $texto }))
  if ([string]::IsNullOrWhiteSpace($r)) { return $padrao } else { return $r.Trim() }
}

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin -and -not $SemTarefa) { Write-Host 'Rode este instalador como Administrador (ou use -SemTarefa para só copiar e testar).' -ForegroundColor Red; exit 1 }

Passo "Copiando arquivos para $Pasta"
$origem = Split-Path -Parent $MyInvocation.MyCommand.Path
New-Item -ItemType Directory -Force -Path $Pasta | Out-Null
if ((Resolve-Path $origem).Path -ne (Resolve-Path $Pasta).Path) {
  Get-ChildItem -Path $origem -Force | Where-Object { $_.Name -notin @('conector.json', 'logs') } | ForEach-Object {
    Copy-Item -Path $_.FullName -Destination $Pasta -Recurse -Force
  }
}

Passo 'Node.js'
$node = $null
$cmd = Get-Command node -ErrorAction SilentlyContinue
if ($cmd) { $v = (& $cmd.Source -v) -replace '^v', ''; if ([int]($v.Split('.')[0]) -ge 18) { $node = $cmd.Source } }
if (-not $node -and (Test-Path "$Pasta\node\node.exe")) { $node = "$Pasta\node\node.exe" }
if (-not $node) {
  Write-Host "Node não encontrado: baixando Node $NODE_VER portátil (só para o conector)..."
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $zip = Join-Path $env:TEMP "node-$NODE_VER.zip"
  Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/$NODE_VER/node-$NODE_VER-win-x64.zip" -OutFile $zip
  $tmp = Join-Path $env:TEMP "node-$NODE_VER-x"
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  Expand-Archive -Path $zip -DestinationPath $tmp -Force
  New-Item -ItemType Directory -Force -Path "$Pasta\node" | Out-Null
  Copy-Item "$tmp\node-$NODE_VER-win-x64\node.exe" "$Pasta\node\node.exe" -Force
  $node = "$Pasta\node\node.exe"
}
Write-Host "Usando $node ($(& $node -v))"

$cfgArq = Join-Path $Pasta 'conector.json'
if (-not (Test-Path $cfgArq)) {
  Passo 'Configuração (os dados ficam só neste servidor, em conector.json)'
  if (-not $Token) { $Token = Perguntar 'Token do Kontar (app Kontar > Integrações > Gerar novo token)' '' }
  if (-not $MysqlHost) { $MysqlHost = Perguntar 'Servidor MySQL do ERP' '127.0.0.1' }
  if (-not $PSBoundParameters.ContainsKey('MysqlPorta')) { $MysqlPorta = [int](Perguntar 'Porta do MySQL' '3306') }
  if (-not $MysqlUsuario) { $MysqlUsuario = Perguntar 'Usuário do MySQL' '' }
  if (-not $PSBoundParameters.ContainsKey('MysqlSenha')) { $MysqlSenha = Perguntar 'Senha do MySQL' '' }
  if (-not $PSBoundParameters.ContainsKey('MysqlBanco')) { $MysqlBanco = Perguntar 'Banco do ERP' 'central' }
  if (-not $Lojas) { $Lojas = Perguntar 'Lojas que o conector atende (números separados por vírgula)' '1' }
  $lista = @($Lojas.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ -match '^\d+$' } | ForEach-Object { [int]$_ })
  $cfg = [ordered]@{
    kontar = [ordered]@{ url = 'https://southamerica-east1-kontar-e2650.cloudfunctions.net/api/v1'; token = $Token }
    erp = 'dlinks'
    mysql = [ordered]@{ host = $MysqlHost; port = $MysqlPorta; user = $MysqlUsuario; password = $MysqlSenha; database = $MysqlBanco }
    lojas = $lista
    dlinks = [ordered]@{ statusFechados = @(2, 3); desdeNIven = 0 }
    enderecosPadrao = $Enderecos
    porEndereco = $true
    app = 0
    intervaloSeg = 60
  }
  [IO.File]::WriteAllText($cfgArq, ($cfg | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding($false)))
  # Só inventários abertos DEPOIS da instalação vão pro Kontar (os antigos ficam como estão no ERP).
  if ($DesdeInventario -lt 0) {
    $maior = (& $node "$Pasta\index.js" --maior-niven).Trim()
    if ($LASTEXITCODE -ne 0 -or $maior -notmatch '^\d+$') { Write-Host 'Não consegui ler o banco do ERP. Confira host/usuário/senha em conector.json e rode o instalador de novo.' -ForegroundColor Red; exit 1 }
    $DesdeInventario = [int]$maior + 1
  }
  $c = Get-Content $cfgArq -Raw | ConvertFrom-Json
  $c.dlinks.desdeNIven = $DesdeInventario
  [IO.File]::WriteAllText($cfgArq, ($c | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding($false)))
  Write-Host "Inventários a partir do nº $DesdeInventario vão para o Kontar."
} else { Write-Host 'conector.json já existe: mantido.' }

Passo 'Testando token do Kontar e banco do ERP'
& $node "$Pasta\index.js" --testar
if ($LASTEXITCODE -ne 0) { Write-Host 'Teste falhou. Corrija conector.json e rode o instalador de novo.' -ForegroundColor Red; exit 1 }

if ($SemTarefa) { Write-Host ''; Write-Host "Pronto (sem tarefa). Para rodar: `"$node`" `"$Pasta\index.js`"" -ForegroundColor Green; exit 0 }

Passo "Tarefa do Windows '$TAREFA' (liga junto com o servidor, reinicia se cair)"
if (Get-ScheduledTask -TaskName $TAREFA -ErrorAction SilentlyContinue) { Stop-ScheduledTask -TaskName $TAREFA -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName $TAREFA -Confirm:$false }
$acao = New-ScheduledTaskAction -Execute $node -Argument "`"$Pasta\index.js`"" -WorkingDirectory $Pasta
$gatilho = New-ScheduledTaskTrigger -AtStartup
$quem = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$ajustes = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $TAREFA -Action $acao -Trigger $gatilho -Principal $quem -Settings $ajustes -Description 'Conector Kontar <-> ERP (leva inventários pro Kontar e devolve a contagem)' | Out-Null
Start-ScheduledTask -TaskName $TAREFA
Start-Sleep -Seconds 5
$info = Get-ScheduledTask -TaskName $TAREFA
Write-Host ''
Write-Host "Instalado. Tarefa '$TAREFA': $($info.State). Log em $Pasta\logs\" -ForegroundColor Green
