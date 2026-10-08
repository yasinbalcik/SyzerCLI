#!/usr/bin/env sh
# SyzerCLI kurulumu (macOS / Linux):  curl -fsSL https://raw.githubusercontent.com/yasinbalcik/SyzerCLI/main/install.sh | sh
set -e
command -v node >/dev/null 2>&1 || { echo "HATA: Node.js 18+ gerekli (https://nodejs.org)"; exit 1; }
MAJOR=$(node -p "process.versions.node.split('.')[0]")
[ "$MAJOR" -ge 18 ] || { echo "HATA: Node 18+ gerekli (şu an: $(node -v))"; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "HATA: npm bulunamadı"; exit 1; }
echo "SyzerCLI kuruluyor..."
npm install -g github:yasinbalcik/SyzerCLI
echo ""
echo "Tamam. Başlamak için: syzer   (sorun olursa: syzer doctor)"
