# Gera o KontarConectorSetup.exe (Inno Setup 6) e o kontar-conector.zip.
#   powershell -ExecutionPolicy Bypass -File conector\instalador\build.ps1 -NodeExe C:\caminho\node.exe [-Versao 1.1.0] [-Saida pasta]
# Precisa: Inno Setup 6 (ISCC.exe) e um node.exe Windows x64 (Node 22 LTS) pra embutir.
param(
  [Parameter(Mandatory = $true)][string]$NodeExe,
  [string]$Versao = '1.1.0',
  [string]$Saida = (Join-Path $env:TEMP 'kontar-conector-build\saida'),
  [switch]$Teste   # versão de teste: instala na pasta do usuário, sem Administrador e sem tarefa do Windows
)
$ErrorActionPreference = 'Stop'
$aqui = Split-Path -Parent $MyInvocation.MyCommand.Path
$conector = Split-Path -Parent $aqui
$tmp = Join-Path $env:TEMP 'kontar-conector-build'
$app = Join-Path $tmp 'app'

$iscc = @("$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe", "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) { throw 'Inno Setup 6 não encontrado (winget install JRSoftware.InnoSetup).' }
if (-not (Test-Path $NodeExe)) { throw "node.exe não encontrado: $NodeExe" }
if (-not (Test-Path "$conector\node_modules\mysql2")) { throw 'Rode "npm install --omit=dev" na pasta conector antes.' }

if (Test-Path $app) { Remove-Item $app -Recurse -Force }
New-Item -ItemType Directory -Force $app, $Saida | Out-Null
foreach ($i in 'index.js', 'package.json', 'tarefa.ps1', 'LEIA-ME.md', 'conector.exemplo.json', 'lib', 'erps', 'node_modules') {
  Copy-Item (Join-Path $conector $i) $app -Recurse -Force
}
$pre = Join-Path $tmp 'pre.zip'
if (Test-Path $pre) { Remove-Item $pre -Force }
Compress-Archive -Path "$app\*" -DestinationPath $pre

$extra = @(); if ($Teste) { $extra += '/DTESTE=1' }
& $iscc /Q @extra "/DVersao=$Versao" "/DAppDir=$app" "/DNodeExe=$NodeExe" "/DPreZip=$pre" "/DSaida=$Saida" (Join-Path $aqui 'kontar-conector.iss')
if ($LASTEXITCODE -ne 0) { throw "ISCC falhou ($LASTEXITCODE)" }

# zip para instalação manual (sem Node embutido): instalar.ps1 baixa o Node se faltar
$zip = Join-Path $Saida 'kontar-conector.zip'
if (Test-Path $zip) { Remove-Item $zip -Force }
Copy-Item (Join-Path $conector 'instalar.ps1'), (Join-Path $conector 'desinstalar.ps1') $app -Force
Compress-Archive -Path "$app\*" -DestinationPath $zip
Get-ChildItem $Saida | ForEach-Object { '{0}  {1:N0} KB' -f $_.Name, ($_.Length / 1KB) }
