#requires -Version 5.1
[CmdletBinding()]
param([Parameter(Mandatory)][string]$ConfigPath)
. "$PSScriptRoot\common.ps1"
try {
    $c = Read-FmConfig $ConfigPath
    $values = Read-FmEnv (Join-Path $c.DataRoot 'Secrets\runtime.env')
    Assert-FmDbEnv $c $values 'financemax_runtime'
    $env:NODE_OPTIONS = $null
    $env:TEMP = Join-Path $c.DataRoot 'Temp'; $env:TMP = $env:TEMP
    Set-Location -LiteralPath $c.AppPath
    Invoke-FmEnvironment $values {
        & $c.NodeExe 'node_modules/next/dist/bin/next' 'start' '--hostname' '127.0.0.1' '--port' ([string]$c.AppPort)
        if ($LASTEXITCODE -ne 0) { throw 'Процесс приложения завершился с ошибкой.' }
    }
} catch { Write-Error 'FinanceMAX остановлен: ошибка конфигурации или процесса. Секретные значения не выводятся.'; exit 1 }
