# imported-body

Готовая low-poly сетка человека как ассет FitCast + параметрические ползунки.

```
npm run ib:prepare   # FBX → чистка → симметризация → масштаб → out/asset.json
npm run ib:check     # блокирующая проверка: 32 комбинации ползунков (exit 1 при провале)
npm run ib:viewer    # живые ползунки и сантиметры в браузере
npm run ib:render presets
```

Исходник: `assets/source.fbx`. Лицензия на результат генерации не проверена — см. docs/STATUS.md.
