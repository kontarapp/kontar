# Cria, para ou remove a tarefa do Windows que mantém o Conector Kontar rodando (usado pelo instalador).
#   tarefa.ps1 -Acao Instalar -Node <node.exe> -Index <index.js> -Config <conector.json>
#   tarefa.ps1 -Acao Parar   |   tarefa.ps1 -Acao Remover
param([ValidateSet('Instalar', 'Parar', 'Remover')][string]$Acao, [string]$Node, [string]$Index, [string]$Config)
$ErrorActionPreference = 'Stop'
$TAREFA = 'KontarConector'

function Parar {
  if (Get-ScheduledTask -TaskName $TAREFA -ErrorAction SilentlyContinue) { Stop-ScheduledTask -TaskName $TAREFA -ErrorAction SilentlyContinue }
  # Mata o node do conector (a tarefa pode ter deixado o processo vivo) pra liberar os arquivos na atualização.
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*Kontar Conector*index.js*' -or $_.CommandLine -like '*KontarConector*index.js*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

try {
  if ($Acao -eq 'Parar') { Parar; exit 0 }
  if ($Acao -eq 'Remover') {
    Parar
    if (Get-ScheduledTask -TaskName $TAREFA -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $TAREFA -Confirm:$false }
    exit 0
  }
  Parar
  if (Get-ScheduledTask -TaskName $TAREFA -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $TAREFA -Confirm:$false }
  $dir = Split-Path -Parent $Index
  $acao = New-ScheduledTaskAction -Execute $Node -Argument "`"$Index`" --config `"$Config`"" -WorkingDirectory $dir
  $gatilho = New-ScheduledTaskTrigger -AtStartup
  $quem = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  $ajustes = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName $TAREFA -Action $acao -Trigger $gatilho -Principal $quem -Settings $ajustes `
    -Description 'Conector Kontar: leva os inventários do ERP pro Kontar e devolve a contagem.' | Out-Null
  Start-ScheduledTask -TaskName $TAREFA
  exit 0
} catch {
  Write-Output ('ERRO: ' + $_.Exception.Message)
  exit 1
}
