# Remove a tarefa do Conector Kontar. A pasta (com conector.json e logs) fica; apague à mão se quiser.
$TAREFA = 'KontarConector'
if (Get-ScheduledTask -TaskName $TAREFA -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $TAREFA -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TAREFA -Confirm:$false
  Write-Host "Tarefa '$TAREFA' removida." -ForegroundColor Green
} else { Write-Host "Tarefa '$TAREFA' não existe." }
