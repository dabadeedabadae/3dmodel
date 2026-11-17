#!/bin/bash
# Запуск photo-garments: установка зависимостей (если нужно) и dev-сервер.
cd "$(dirname "$0")"
if [ ! -d node_modules/vite ]; then npm ci; fi
echo "Открой: http://127.0.0.1:5174/garment.html"
npm run dev
