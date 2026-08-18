const API_URL = import.meta.env.VITE_API_URL || 'https://api.piru.app/api'
const SESSION_KEY = 'piru-mozos-session'
const MENU_KEY = 'piru-mozos-menu'

export type Session = { token: string; expiraAt: string; usuario: { id: number; nombre: string; rol: string; sucursalId: number | null } }
export type Producto = { id: number; categoriaId: number; nombre: string; precio: string | number; variantes: Array<{ id: number; nombre: string; precio: string | number }>; ingredientes: Array<{ id: number; nombre: string }>; agregados: Array<{ id: number; nombre: string; precio: string | number }> }
export type Menu = { categorias: Array<{ id: number; nombre: string }>; productos: Producto[] }
export type Mesa = { id: number; nombre: string; pedido: { id: number; estado: string; total: string | number; version: number } | null }
export type PedidoItem = { id: number; productoId: number; nombreProducto: string; varianteId: number | null; varianteNombre: string | null; precioUnitario: string | number; cantidad: number; ingredientesExcluidos: number[] | null; agregados: Array<{ id: number; nombre: string; precio: string | number }> | null }
export type Pedido = { id: number; estado: string; total: string | number; version: number; nombreCliente: string | null; notas: string | null; editable: boolean; motivosNoEditable: string[]; items: PedidoItem[] }
export type PedidoItemInput = { productoId: number; varianteId?: number; cantidad: number; ingredientesExcluidos: number[]; agregados: Array<{ id: number }> }
export class ApiError extends Error { constructor(message: string, public status: number, public data?: { pedido?: Pedido | null; code?: string }) { super(message) } }

export function getSession(): Session | null { try { const raw = localStorage.getItem(SESSION_KEY); return raw ? JSON.parse(raw) as Session : null } catch { return null } }
export function clearSession() { localStorage.removeItem(SESSION_KEY) }
async function request<T>(path: string, token?: string, init?: RequestInit): Promise<T> { let response: Response; try { response = await fetch(`${API_URL}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init?.headers } }) } catch { throw new ApiError('No hay conexión con Piru. Tu pedido no fue confirmado.', 0) } const body = response.status === 304 ? null : await response.json().catch(() => null); if (!response.ok) throw new ApiError(body?.message || 'No pudimos completar la operación', response.status, body?.data ? { ...body.data, code: body.code } : { code: body?.code }); return body?.data as T }
export async function login(codigoAcceso: string, pin: string) { const session = await request<Session>('/staff/login', undefined, { method: 'POST', body: JSON.stringify({ codigoAcceso, pin }) }); localStorage.setItem(SESSION_KEY, JSON.stringify(session)); return session }
export async function getMenu(token: string) { try { const menu = await request<Menu>('/mozos/menu', token); localStorage.setItem(MENU_KEY, JSON.stringify(menu)); return menu } catch (error) { const cached = localStorage.getItem(MENU_KEY); if (cached && (!(error instanceof ApiError) || error.status === 0)) return JSON.parse(cached) as Menu; throw error } }
export const getMesas = (token: string) => request<Mesa[]>('/mozos/mesas', token)
export const getPedido = (token: string, id: number) => request<Pedido>(`/mozos/pedidos/${id}`, token)
export const createPedido = (token: string, payload: unknown) => request<Pedido>('/mozos/pedidos', token, { method: 'POST', body: JSON.stringify(payload) })
export const addPedidoItem = (token: string, pedidoId: number, version: number, item: PedidoItemInput) => request<Pedido>(`/mozos/pedidos/${pedidoId}/items`, token, { method: 'POST', body: JSON.stringify({ ...item, version }) })
export const deletePedidoItem = (token: string, pedidoId: number, itemId: number, version: number) => request<Pedido>(`/mozos/pedidos/${pedidoId}/items/${itemId}`, token, { method: 'DELETE', body: JSON.stringify({ version }) })
export const updatePedidoDatos = (token: string, pedidoId: number, version: number, datos: { nombreCliente?: string | null; notas?: string | null }) => request<Pedido>(`/mozos/pedidos/${pedidoId}`, token, { method: 'PUT', body: JSON.stringify({ ...datos, version }) })

export function connectPedidos(token: string, onEvent: () => void) {
  const configured = import.meta.env.VITE_WS_URL as string | undefined
  const base = configured || API_URL.replace(/\/api\/?$/, '')
  const url = `${base.replace(/^http/, 'ws').replace(/\/$/, '')}/ws/mozos?token=${encodeURIComponent(token)}`
  let socket: WebSocket | null = null
  let cerradoPorUsuario = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let intento = 0

  const conectar = () => {
    const ws = new WebSocket(url)
    socket = ws
    ws.onmessage = (event) => { try { if (JSON.parse(event.data).type === 'MOZO_PEDIDO_EVENT') onEvent() } catch { /* evento inválido */ } }
    ws.onopen = () => { intento = 0 }
    ws.onclose = (event) => {
      if (cerradoPorUsuario || event.code === 1008) return // 1008: sesión inválida (los HTTP avisan y cierran el turno)
      // Reconexión con backoff: 2s → 4s → 8s … (tope 30s). Al reconectar, el
      // servidor retoma el envío de eventos y el turno sigue vivo.
      const espera = Math.min(2000 * 2 ** intento, 30_000)
      intento += 1
      timer = setTimeout(conectar, espera)
    }
  }
  conectar()

  return {
    close(code?: number, reason?: string) {
      cerradoPorUsuario = true
      if (timer) clearTimeout(timer)
      socket?.close(code, reason)
    },
  }
}
