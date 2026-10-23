#!/bin/sh
# Делает лёгкие превью для карточек каталога (macOS, встроенный sips).
# Запуск из корня проекта:  sh tools/make-thumbs.sh            — только новые фото
#                           sh tools/make-thumbs.sh --force    — пересоздать все
# Оригиналы:  photos/<категория>/<номер>_<n>.jpg
# Превью:     photos/<категория>/thumbs/<номер>_<n>.jpg  (до 800px, качество 60)

cd "$(dirname "$0")/.." || exit 1
FORCE=$1

for dir in photos/*/; do
  mkdir -p "${dir}thumbs"
  for src in "${dir}"*.jpg; do
    [ -f "$src" ] || continue
    out="${dir}thumbs/$(basename "$src")"
    if [ "$FORCE" = "--force" ] || [ ! -f "$out" ] || [ "$src" -nt "$out" ]; then
      sips -Z 800 -s format jpeg -s formatOptions 60 "$src" --out "$out" >/dev/null && echo "✓ $out"
    fi
  done
done
