#!/usr/bin/env bash
#
# Publica las 22 descripciones en el panel de Villanisa.
#
# La contraseña la escribes TÚ cuando el script la pida: no queda en el
# historial de la terminal, ni en este archivo, ni en ningún sitio.
#
#   chmod +x publicar-descripciones.sh
#   ./publicar-descripciones.sh
#
set -euo pipefail

ARCHIVO="${1:-descripciones.json}"
USUARIO="${PANEL_USUARIO:-villanisa}"

if [ ! -f "$ARCHIVO" ]; then
  echo "No encuentro $ARCHIVO. Corre el script desde la carpeta del proyecto." >&2
  exit 1
fi

echo "Se van a publicar $(grep -c '"descripcion"' "$ARCHIVO") descripciones."
echo "Usuario del panel: $USUARIO"
read -rsp "Contraseña del panel: " CLAVE
echo

RESPUESTA=$(curl -sS -w '\n%{http_code}' \
  -u "$USUARIO:$CLAVE" \
  -H 'Content-Type: application/json' \
  --data-binary "@$ARCHIVO" \
  https://villanisa.com.do/api/contenido)

CODIGO=$(echo "$RESPUESTA" | tail -n1)
CUERPO=$(echo "$RESPUESTA" | sed '$d')

echo
case "$CODIGO" in
  200) echo "✅ $CUERPO"
       echo
       echo "El sitio se está republicando. Los textos salen publicados en un par de minutos." ;;
  401) echo "❌ Contraseña o usuario incorrectos." ;;
  503) echo "❌ $CUERPO"
       echo "   No se guardó nada. Vuelve a intentarlo en un minuto." ;;
  *)   echo "❌ HTTP $CODIGO — $CUERPO" ;;
esac
