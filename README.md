# App de mozos

Cliente React/Vite separado para staff: autenticación propia, comanda táctil y sincronización por `/ws/mozos`. La UI está concentrada en `src/App.tsx` y el contrato HTTP en `src/api.ts`.

El modelo operativo está en [`../docs/ORDERS.md`](../docs/ORDERS.md) y la separación de sesiones en [`../docs/AUTH_AND_ONBOARDING.md`](../docs/AUTH_AND_ONBOARDING.md).

```bash
bun install
bun run dev
bun run build
bun run lint
```
