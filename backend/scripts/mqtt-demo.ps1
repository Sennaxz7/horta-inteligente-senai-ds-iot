param([string]$ApiUrl = "http://127.0.0.1:3000/api/v1")
$ErrorActionPreference = "Stop"
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$email = Read-Host "E-mail do usuário cadastrado no projeto"
$securePassword = Read-Host "Senha" -AsSecureString
$credential = [System.Net.NetworkCredential]::new("", $securePassword)
$loginBody = @{ email = $email; senha = $credential.Password } | ConvertTo-Json
$login = Invoke-RestMethod -Method Post -Uri "$ApiUrl/auth/login" -ContentType "application/json" -Body $loginBody
$loginBody = $null
$credential = $null
$headers = @{ Authorization = "Bearer $($login.data.accessToken)" }
$device = Invoke-RestMethod -Method Post -Uri "$ApiUrl/dispositivos" -Headers $headers -ContentType "application/json" -Body '{"nome":"ESP32 simulado","simulado":true}'
$deviceId = $device.data.id
$zone = Invoke-RestMethod -Method Post -Uri "$ApiUrl/dispositivos/$deviceId/zonas" -Headers $headers -ContentType "application/json" -Body '{"nome":"Zona de demonstracao","calibracao":{"distanciaVazioCm":30,"distanciaCheioCm":5}}'
$zoneId = $zone.data.id
Write-Host "Dispositivo: $deviceId"
Write-Host "Zona: $zoneId"
Write-Host "Em outro PowerShell, na pasta backend, execute:"
Write-Host "`$env:MQTT_SIM_DEVICE_ID='$deviceId'"
Write-Host "`$env:MQTT_SIM_ZONE_ID='$zoneId'"
Write-Host "npm.cmd run mqtt:simulate"
Read-Host "Depois que o simulador conectar e o backend mostrar assinaturas ativas, pressione Enter"
$body = '{"intervaloLeituraSegundos":5,"automacaoHabilitada":false,"calibracaoReservatorio":{"distanciaVazioCm":30,"distanciaCheioCm":5}}'
$config = Invoke-RestMethod -Method Post -Uri "$ApiUrl/dispositivos/$deviceId/zonas/$zoneId/sincronizacao" -Headers $headers -ContentType "application/json" -Body $body
Write-Host "Configuracao enviada: $($config.data.id). Aguardando ACK..."
for ($attempt = 0; $attempt -lt 15; $attempt++) {
    Start-Sleep -Seconds 1
    $result = Invoke-RestMethod -Uri "$ApiUrl/dispositivos/$deviceId/zonas/$zoneId/configuracao" -Headers $headers
    if ($result.data.status -eq "CONFIRMADA") { break }
}
Write-Host "Estado da configuracao: $($result.data.status)"
$history = Invoke-RestMethod -Uri "$ApiUrl/dispositivos/$deviceId/leituras?limite=5" -Headers $headers
$history.data | ForEach-Object {
    [PSCustomObject]@{ Horario = $_.medidoEm; UmidadeSolo = $_.dados.umidadeSoloPercentual; DistanciaCm = $_.dados.distanciaAguaCm; NivelAgua = $_.dados.nivelAguaPercentual; Simulado = $_.dados.simulado }
} | Format-Table
Write-Host "Historico salvo no PostgreSQL. Novas demonstracoes criam outro dispositivo."
