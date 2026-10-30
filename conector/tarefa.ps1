# Cria, para ou remove a tarefa do Windows que mantém o Conector Kontar rodando (usado pelo instalador).
#   tarefa.ps1 -Acao Instalar -Node <node.exe> -Index <index.js> -Config <conector.json> [-Log <arquivo>]
#   tarefa.ps1 -Acao Parar   |   tarefa.ps1 -Acao Remover
# Usa o schtasks.exe com definição em XML (não depende do módulo ScheduledTasks/CIM do PowerShell).
# Cada passo vai pro arquivo de log; em erro, a última linha começa com "ERRO:" (o instalador mostra ela).
param([ValidateSet('Instalar', 'Parar', 'Remover')][string]$Acao, [string]$Node, [string]$Index, [string]$Config,
  [string]$Log = (Join-Path $env:ProgramData 'Kontar Conector\logs\instalacao.log'))
$ErrorActionPreference = 'Stop'
$TAREFA = 'KontarConector'
$schtasks = Join-Path $env:SystemRoot 'System32\schtasks.exe'

function Reg($m) {
  $linha = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' [' + $Acao + '] ' + $m
  try { New-Item -ItemType Directory -Force (Split-Path -Parent $Log) | Out-Null; Add-Content -Path $Log -Value $linha -Encoding UTF8 } catch {}
  Write-Output $linha
}
# Chama o schtasks sem deixar o texto que ele escreve no stderr virar exceção (no PowerShell 5.1, com
# ErrorActionPreference=Stop, "ERRO: O sistema não pode encontrar o arquivo especificado." do /Query derrubava tudo).
# Vale só o código de saída.
function Sch {
  $ErrorActionPreference = 'Continue'
  $saida = (& $schtasks @args 2>&1 | ForEach-Object { "$_" }) -join ' '
  [pscustomobject]@{ Codigo = $LASTEXITCODE; Saida = $saida.Trim() }
}
function Existe { return ((Sch /Query /TN $TAREFA).Codigo -eq 0) }
function Parar {
  if (Existe) { $r = Sch /End /TN $TAREFA; Reg "tarefa parada (schtasks /End: $($r.Codigo))" }
  # Mata o node do conector (pra liberar os arquivos na atualização). Se o CIM não estiver disponível, segue.
  try {
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction Stop |
      Where-Object { $_.CommandLine -like '*Kontar Conector*index.js*' -or $_.CommandLine -like '*KontarConector*index.js*' } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; Reg "processo node $($_.ProcessId) encerrado" }
  } catch { Reg "aviso: não consegui listar processos ($($_.Exception.Message))" }
}
function X([string]$t) { [Security.SecurityElement]::Escape($t) }

try {
  Reg "início (usuário $env:USERNAME)"
  if ($Acao -eq 'Parar') { Parar; Reg 'ok'; exit 0 }
  if ($Acao -eq 'Remover') {
    Parar
    if (Existe) { $r = Sch /Delete /TN $TAREFA /F; Reg "tarefa removida (schtasks /Delete: $($r.Codigo))" }
    Reg 'ok'; exit 0
  }
  foreach ($a in @(@('Node', $Node), @('Index', $Index), @('Config', $Config))) {
    if (-not $a[1] -or -not (Test-Path $a[1])) { throw "arquivo não encontrado ($($a[0])): $($a[1])" }
  }
  Parar
  $dir = Split-Path -Parent $Index
  $argumentos = '"' + $Index + '" --config "' + $Config + '"'
  $xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Author>Kontar</Author>
    <Description>Conector Kontar: leva os inventários do ERP pro Kontar e devolve a contagem.</Description>
  </RegistrationInfo>
  <Triggers>
    <BootTrigger><Enabled>true</Enabled></BootTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author"><UserId>S-1-5-18</UserId><RunLevel>HighestAvailable</RunLevel></Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <AllowHardTerminate>true</AllowHardTerminate>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <RestartOnFailure><Interval>PT1M</Interval><Count>999</Count></RestartOnFailure>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>$(X $Node)</Command>
      <Arguments>$(X $argumentos)</Arguments>
      <WorkingDirectory>$(X $dir)</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@
  $arqXml = Join-Path $env:TEMP ('kontar-tarefa-' + [guid]::NewGuid().ToString('N') + '.xml')
  [IO.File]::WriteAllText($arqXml, $xml, [Text.Encoding]::Unicode)
  $r = Sch /Create /TN $TAREFA /XML $arqXml /F
  Remove-Item $arqXml -Force -ErrorAction SilentlyContinue
  Reg ("schtasks /Create -> " + $r.Codigo + ' ' + $r.Saida)
  if ($r.Codigo -ne 0) { throw "schtasks /Create falhou ($($r.Codigo)): $($r.Saida)" }
  $r = Sch /Run /TN $TAREFA
  Reg ("schtasks /Run -> " + $r.Codigo + ' ' + $r.Saida)
  if ($r.Codigo -ne 0) { throw "a tarefa foi criada mas não iniciou: $($r.Saida)" }
  Reg 'ok'
  exit 0
} catch {
  Reg ('ERRO: ' + $_.Exception.Message)
  exit 1
}
