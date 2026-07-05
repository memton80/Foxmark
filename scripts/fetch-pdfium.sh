#!/usr/bin/env bash
# fetch-pdfium.sh — Télécharge la bibliothèque PDFium (binaire précompilé)
# dans src-tauri/resources/pdfium/, où Foxmark la charge à l'exécution
# (et où le bundler Tauri l'embarque dans le .rpm).
#
# Binaires : https://github.com/bblanchon/pdfium-binaries (licence Apache-2.0)
set -euo pipefail

ARCH="${1:-x64}" # x64 | arm64
DEST_DIR="$(cd "$(dirname "$0")/.." && pwd)/src-tauri/resources/pdfium"
URL="https://github.com/bblanchon/pdfium-binaries/releases/latest/download/pdfium-linux-${ARCH}.tgz"

mkdir -p "${DEST_DIR}"
echo "Téléchargement de PDFium (linux-${ARCH})…"
TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

curl -fsSL "${URL}" -o "${TMP}/pdfium.tgz"
tar -xzf "${TMP}/pdfium.tgz" -C "${TMP}"
cp "${TMP}/lib/libpdfium.so" "${DEST_DIR}/libpdfium.so"

echo "✓ ${DEST_DIR}/libpdfium.so"
