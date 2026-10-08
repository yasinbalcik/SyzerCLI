# SyzerCLI kurulum betiği (Windows PowerShell)
#   irm https://raw.githubusercontent.com/yasinbalcik/SyzerCLI/main/install.ps1 | iex
# Parametreler (iex ile değil, indirip çalıştırırsan): -Orca  -> Orca entegrasyonunu da kurar (masaüstü kısayolu dahil)
param([switch]$Orca)
$ErrorActionPreference = 'Stop'

function Fail($m) { Write-Host "HATA: $m" -ForegroundColor Red; exit 1 }

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Fail "Node.js bulunamadı. https://nodejs.org adresinden Node 18+ kur, sonra tekrar çalıştır." }
$major = [int]((node -v) -replace '^v(\d+).*', '$1')
if ($major -lt 18) { Fail "Node 18 veya üstü gerekli (şu an: $(node -v))." }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { Fail "npm bulunamadı." }

Write-Host "SyzerCLI kuruluyor..." -ForegroundColor Cyan
npm install -g github:yasinbalcik/SyzerCLI
if ($LASTEXITCODE -ne 0) { Fail "npm kurulumu başarısız oldu." }

$orcaExe = Join-Path $env:LOCALAPPDATA 'Programs\orca\Orca.exe'
if ($Orca -or ((Test-Path $orcaExe) -and -not $PSBoundParameters.ContainsKey('Orca'))) {
  if (Test-Path $orcaExe) {
    Write-Host "Orca bulundu, entegrasyon kuruluyor (Orca kapalı olmalı)..." -ForegroundColor Cyan
    syzer orca install --shortcut
  } elseif ($Orca) { Write-Host "Orca bulunamadı: $orcaExe" -ForegroundColor Yellow }
}

Write-Host ""
Write-Host "Tamam. Başlamak için: syzer   (ilk açılışta kurulum sihirbazı çalışır)" -ForegroundColor Green
