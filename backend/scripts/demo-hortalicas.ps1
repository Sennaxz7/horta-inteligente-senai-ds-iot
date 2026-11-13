param([string]$ApiUrl = "http://127.0.0.1:3000/api/v1")

$ErrorActionPreference = "Stop"
Push-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$previousApiUrl = $env:HORTA_DEMO_API_URL
try {
    $email = Read-Host "E-mail da conta de demonstracao ja cadastrada"
    $senha = Read-Host "Senha" -AsSecureString
    $credential = [System.Net.NetworkCredential]::new("", $senha)
    $env:HORTA_DEMO_API_URL = $ApiUrl
    $login = @{ email = $email; senha = $credential.Password } | ConvertTo-Json -Compress
    [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($login)) | node .\scripts\demo-hortalicas.js
    if ($LASTEXITCODE -ne 0) { throw "A demonstracao terminou com erro." }
}
finally {
    $env:HORTA_DEMO_API_URL = $previousApiUrl
    $login = $credential = $senha = $null
    Pop-Location
}
