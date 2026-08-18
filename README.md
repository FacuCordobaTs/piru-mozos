# Piru Mozos — PWA operativa T40

PWA React + Vite separada para mozos, conectada exclusivamente a la API de staff de Piru.

## Alcance deliberado

- Login rápido con código de acceso y PIN de staff; no acepta el JWT del dueño.
- Grid de mesas limitado a la sucursal del mozo y comanda táctil con variantes, ingredientes excluidos y agregados.
- Menú real cacheado en `localStorage` y app shell cacheable por service worker.
- Un pedido nuevo queda como borrador local hasta que `POST /api/mozos/pedidos` responde exitosamente. Sin red, el botón de confirmar se deshabilita y se informa el estado: nunca se confirma localmente.
- Mantiene un WebSocket separado de staff por sucursal. Las altas, cambios desde admin y cambios de otros mozos actualizan el grid y la comanda abierta en tiempo real.
- Las comandas abiertas permiten agregar/quitar ítems y editar datos del cliente con la `version` vigente. Un `409` reemplaza la vista con la versión devuelta por el servidor y explica el conflicto antes de permitir otro cambio.
- Configurar `VITE_API_URL` para un backend remoto; por defecto usa `http://localhost:3000/api`.

## Medición reproducible

```bash
bun install
bun run build
du -h dist/assets/*
bun run preview -- --host 127.0.0.1
curl -sS -o /dev/null -w 'TTFB=%{time_starttransfer}s total=%{time_total}s\n' http://127.0.0.1:4173/
```

Flujo principal: mesa → producto → “Agregar a la comanda” → “Confirmar pedido”. Luego, una comanda abierta se sincroniza por WebSocket y todas sus mutaciones dependen de una respuesta remota exitosa.
