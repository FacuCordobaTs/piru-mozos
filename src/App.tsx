import { useEffect, useMemo, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import {
  addPedidoItem, ApiError, clearSession, connectPedidos, createPedido, deletePedidoItem,
  getMenu, getMesas, getPedido, getSession, login, updatePedidoDatos,
  type Mesa, type Menu, type Pedido, type PedidoItemInput, type Producto, type Session,
} from './api'

type DraftItem = { producto: Producto; cantidad: number; varianteId?: number; ingredientesExcluidos: number[]; agregados: number[] }

const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })
const estadoLabel: Record<string, string> = { pending: 'Pendiente', confirmed: 'Confirmado', preparing: 'Preparando', ready: 'Listo', delivered: 'Entregado' }

export function App() {
  const [session, setSession] = useState<Session | null>(() => getSession())
  return session ? <Turno session={session} onSalir={() => { clearSession(); setSession(null) }} /> : <Login onLogin={setSession} />
}

function Login({ onLogin }: { onLogin: (session: Session) => void }) {
  const [codigoAcceso, setCodigoAcceso] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setEnviando(true)
    try { onLogin(await login(codigoAcceso.trim(), pin)) }
    catch (e) { setError(e instanceof Error ? e.message : 'No pudimos iniciar el turno') }
    finally { setEnviando(false) }
  }
  return <main className="login-page"><form className="login-card" onSubmit={submit}>
    <p className="eyebrow">Piru · Mozos</p><h1>Empezá tu turno</h1><p className="muted">Ingresá el código que te compartió tu encargado y tu PIN personal.</p>
    <label>Código de acceso<input autoCapitalize="none" autoComplete="username" value={codigoAcceso} onChange={(e) => setCodigoAcceso(e.target.value)} minLength={16} required /></label>
    <label>PIN<input inputMode="numeric" autoComplete="current-password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))} minLength={4} maxLength={8} required /></label>
    {error && <p className="error" role="alert">{error}</p>}<button className="primary wide" disabled={enviando}>{enviando ? 'Ingresando…' : 'Ingresar'}</button>
  </form></main>
}

function Turno({ session, onSalir }: { session: Session; onSalir: () => void }) {
  const [menu, setMenu] = useState<Menu | null>(null)
  const [mesas, setMesas] = useState<Mesa[]>([])
  const [mesa, setMesa] = useState<Mesa | null>(null)
  const [pedido, setPedido] = useState<Pedido | null>(null)
  const [draft, setDraft] = useState<DraftItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [offline, setOffline] = useState(!navigator.onLine)
  const [syncVersion, setSyncVersion] = useState(0)

  async function cargar() {
    setLoading(true); setError('')
    try { const [nuevoMenu, nuevasMesas] = await Promise.all([getMenu(session.token), getMesas(session.token)]); setMenu(nuevoMenu); setMesas(nuevasMesas) }
    catch (e) { manejarError(e, setError, onSalir) }
    finally { setLoading(false) }
  }
  useEffect(() => { void cargar() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const cambiar = () => setOffline(!navigator.onLine); window.addEventListener('online', cambiar); window.addEventListener('offline', cambiar); return () => { window.removeEventListener('online', cambiar); window.removeEventListener('offline', cambiar) } }, [])
  useEffect(() => {
    const ws = connectPedidos(session.token, () => { setSyncVersion((version) => version + 1); void cargar() })
    return () => ws.close(1000, 'Fin de turno')
  }, [session.token])

  async function abrirMesa(nuevaMesa: Mesa) {
    setMesa(nuevaMesa); setDraft([]); setPedido(null); setError('')
    if (!nuevaMesa.pedido) return
    try { setLoading(true); setPedido(await getPedido(session.token, nuevaMesa.pedido.id)) }
    catch (e) { manejarError(e, setError, onSalir) }
    finally { setLoading(false) }
  }
  if (mesa) return <Comanda session={session} menu={menu} mesa={mesa} pedido={pedido} draft={draft} setDraft={setDraft} offline={offline} error={error} onError={setError} syncVersion={syncVersion} onBack={() => { setMesa(null); setPedido(null); setDraft([]); void cargar() }} onPedidoCreado={(nuevo) => { setPedido(nuevo); setDraft([]); void cargar() }} onPedidoActualizado={setPedido} />
  return <main className="mesas"><header className="hero"><div><p className="eyebrow">Turno de hoy</p><h1>Hola, {session.usuario.nombre}</h1><p>Elegí una mesa para tomar o consultar un pedido.</p></div><button className="text-button" type="button" onClick={onSalir}>Salir</button></header>
    {offline && <p className="network warning">Sin conexión: podés ver el menú guardado, pero no enviar pedidos.</p>}
    {error && <p className="network error" role="alert">{error}</p>}
    <section aria-labelledby="mesas-title"><div className="section-heading"><div><p className="eyebrow">Tu local</p><h2 id="mesas-title">Mesas</h2></div><button className="refresh" type="button" onClick={() => void cargar()} disabled={loading}>↻</button></div>
      {loading ? <p className="muted loading">Actualizando mesas…</p> : <div className="mesa-grid">{mesas.map((m) => <button key={m.id} type="button" className={`mesa ${estadoMesa(m)}`} onClick={() => void abrirMesa(m)}><span className="mesa-number">{m.nombre.replace(/^Mesa\s*/i, '')}</span><span>{estadoMesaLabel(m)}</span>{m.pedido && <small>{money.format(Number(m.pedido.total))}</small>}</button>)}</div>}
    </section></main>
}

function Comanda({ session, menu, mesa, pedido, draft, setDraft, offline, error, onError, syncVersion, onBack, onPedidoCreado, onPedidoActualizado }: { session: Session; menu: Menu | null; mesa: Mesa; pedido: Pedido | null; draft: DraftItem[]; setDraft: Dispatch<SetStateAction<DraftItem[]>>; offline: boolean; error: string; onError: (error: string) => void; syncVersion: number; onBack: () => void; onPedidoCreado: (pedido: Pedido) => void; onPedidoActualizado: (pedido: Pedido) => void }) {
  const [categoria, setCategoria] = useState<number | null>(null)
  const [producto, setProducto] = useState<Producto | null>(null)
  const [confirmando, setConfirmando] = useState(false)
  const [cliente, setCliente] = useState('')
  const [notas, setNotas] = useState('')
  const [mutando, setMutando] = useState(false)
  const total = useMemo(() => draft.reduce((sum, item) => sum + precioItem(item) * item.cantidad, 0), [draft])
  const categorias = menu?.categorias ?? []
  const categoriaActiva = categoria ?? categorias[0]?.id ?? null
  const productos = menu?.productos.filter((p) => p.categoriaId === categoriaActiva) ?? []
  const confirmar = async () => {
    if (!draft.length || offline || pedido) return
    setConfirmando(true); onError('')
    try { onPedidoCreado(await createPedido(session.token, { mesaLocalId: mesa.id, nombreCliente: cliente || undefined, items: draft.map((item) => ({ productoId: item.producto.id, varianteId: item.varianteId, cantidad: item.cantidad, ingredientesExcluidos: item.ingredientesExcluidos, agregados: item.agregados.map((id) => ({ id })) })) })) }
    catch (e) { manejarError(e, onError, () => undefined) }
    finally { setConfirmando(false) }
  }
  useEffect(() => {
    if (!pedido || syncVersion === 0) return
    void getPedido(session.token, pedido.id).then(onPedidoActualizado).catch((e) => manejarError(e, onError, () => undefined))
  }, [syncVersion])
  useEffect(() => { if (pedido) { setCliente(pedido.nombreCliente || ''); setNotas(pedido.notas || '') } }, [pedido?.id, pedido?.version])
  const itemInput = (item: DraftItem): PedidoItemInput => ({ productoId: item.producto.id, varianteId: item.varianteId, cantidad: item.cantidad, ingredientesExcluidos: item.ingredientesExcluidos, agregados: item.agregados.map((id) => ({ id })) })
  const recuperarConflicto = (e: unknown) => {
    if (e instanceof ApiError && e.status === 409 && e.data?.pedido) {
      onPedidoActualizado(e.data.pedido)
      onError('La comanda cambió en otra pantalla. Mostramos la última versión para que la revises.')
      return true
    }
    return false
  }
  const agregarExistente = async (item: DraftItem) => {
    if (!pedido || offline || !pedido.editable) return
    setMutando(true); onError('')
    try { onPedidoActualizado(await addPedidoItem(session.token, pedido.id, pedido.version, itemInput(item))) }
    catch (e) { if (!recuperarConflicto(e)) manejarError(e, onError, () => undefined) }
    finally { setMutando(false) }
  }
  const eliminarExistente = async (itemId: number) => {
    if (!pedido || offline || !pedido.editable) return
    setMutando(true); onError('')
    try { onPedidoActualizado(await deletePedidoItem(session.token, pedido.id, itemId, pedido.version)) }
    catch (e) { if (!recuperarConflicto(e)) manejarError(e, onError, () => undefined) }
    finally { setMutando(false) }
  }
  const guardarDatos = async () => {
    if (!pedido || offline || !pedido.editable) return
    setMutando(true); onError('')
    try { onPedidoActualizado(await updatePedidoDatos(session.token, pedido.id, pedido.version, { nombreCliente: cliente || null, notas: notas || null })) }
    catch (e) { if (!recuperarConflicto(e)) manejarError(e, onError, () => undefined) }
    finally { setMutando(false) }
  }
  return <main className="pedido"><header className="topbar"><button className="back" type="button" onClick={onBack}>‹ Mesas</button><div><p className="eyebrow">{pedido ? 'Pedido en curso' : 'Tomando pedido'}</p><h1>{mesa.nombre}</h1></div><span className={`status ${estadoMesa(mesa)}`}>{pedido ? estadoLabel[pedido.estado] ?? pedido.estado : 'Nueva'}</span></header>
    {offline && <p className="network warning">Sin conexión. El pedido queda en esta pantalla hasta que vuelva la red; no se confirmó.</p>}{error && <p className="network error" role="alert">{error}</p>}
    <section className="customer"><label>Nombre del cliente <input disabled={!!pedido && (!pedido.editable || mutando)} value={cliente} onChange={(e) => setCliente(e.target.value)} placeholder="Opcional" /></label>{pedido && <><label>Notas <input disabled={!pedido.editable || mutando} value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Opcional" /></label><button className="secondary" type="button" disabled={!pedido.editable || offline || mutando} onClick={() => void guardarDatos()}>{mutando ? 'Guardando…' : 'Guardar datos'}</button></>}</section>
    <section className="order-card"><div className="order-heading"><span>Comanda</span><strong>{pedido ? money.format(Number(pedido.total)) : draft.length ? money.format(total) : 'Sin productos'}</strong></div>{pedido ? <ul className="items">{pedido.items.map((item) => <li key={item.id}><div><strong>{item.nombreProducto}</strong><small>{item.varianteNombre || 'Base'} · {money.format(Number(item.precioUnitario))}</small></div><div className="item-actions"><b>×{item.cantidad}</b><button className="remove" type="button" disabled={!pedido.editable || offline || mutando} onClick={() => void eliminarExistente(item.id)}>Quitar</button></div></li>)}</ul> : <DraftItems items={draft} setItems={setDraft} />}{pedido && !pedido.editable && <p className="readonly">Esta comanda ya no admite ediciones: {pedido.motivosNoEditable[0] || 'el pedido fue cerrado'}.</p>}</section>
    <section className="menu"><div className="section-heading"><div><p className="eyebrow">Menú {menu ? 'actualizado' : 'no disponible'}</p><h2>{pedido ? 'Agregar a la comanda' : '¿Qué agregamos?'}</h2></div><span className="cached">{offline ? 'Guardado' : 'Conectado'}</span></div><div className="tabs" role="tablist">{categorias.map((c) => <button key={c.id} type="button" className={categoriaActiva === c.id ? 'active' : ''} onClick={() => setCategoria(c.id)}>{c.nombre}</button>)}</div><div className="product-list">{productos.map((p) => <button key={p.id} type="button" disabled={!!pedido && (!pedido.editable || mutando)} className="product" onClick={() => setProducto(p)}><span><strong>{p.nombre}</strong><small>{money.format(Number(p.precio))}</small></span><b>+</b></button>)}</div></section>
    {!pedido && <footer className="checkout"><span>Total <strong>{money.format(total)}</strong></span><button className="primary" type="button" disabled={!draft.length || offline || confirmando} onClick={() => void confirmar()}>{confirmando ? 'Confirmando…' : 'Confirmar pedido'}</button></footer>}
    {producto && <Configurador producto={producto} onClose={() => setProducto(null)} onAgregar={(item) => { if (pedido) void agregarExistente(item); else setDraft((current) => [...current, item]); setProducto(null) }} />}
  </main>
}

function DraftItems({ items, setItems }: { items: DraftItem[]; setItems: Dispatch<SetStateAction<DraftItem[]>> }) { return items.length ? <ul className="items">{items.map((item, index) => <li key={`${item.producto.id}-${index}`}><div><strong>{item.producto.nombre}</strong><small>{descripcionItem(item)} · {money.format(precioItem(item))}</small></div><div className="stepper"><button type="button" onClick={() => setItems((actual) => actual.flatMap((value, i) => i !== index ? [value] : value.cantidad > 1 ? [{ ...value, cantidad: value.cantidad - 1 }] : []))}>−</button><span>{item.cantidad}</span><button type="button" onClick={() => setItems((actual) => actual.map((value, i) => i === index ? { ...value, cantidad: value.cantidad + 1 } : value))}>+</button></div></li>)}</ul> : <p className="empty-order">Elegí productos. Hasta tocar “Confirmar pedido”, no se envía nada.</p> }
function Configurador({ producto, onClose, onAgregar }: { producto: Producto; onClose: () => void; onAgregar: (item: DraftItem) => void }) { const [varianteId, setVarianteId] = useState<number | undefined>(producto.variantes[0]?.id); const [ingredientesExcluidos, setIngredientes] = useState<number[]>([]); const [agregados, setAgregados] = useState<number[]>([]); return <div className="sheet-backdrop" role="presentation" onMouseDown={onClose}><section className="sheet" role="dialog" aria-modal="true" aria-label={`Configurar ${producto.nombre}`} onMouseDown={(e) => e.stopPropagation()}><div className="sheet-header"><div><p className="eyebrow">Agregar a comanda</p><h2>{producto.nombre}</h2></div><button className="text-button" onClick={onClose}>Cerrar</button></div>{producto.variantes.length > 0 && <fieldset><legend>Variante</legend>{producto.variantes.map((v) => <label className="choice" key={v.id}><input type="radio" checked={varianteId === v.id} onChange={() => setVarianteId(v.id)} />{v.nombre}<span>{money.format(Number(v.precio))}</span></label>)}</fieldset>}{producto.ingredientes.length > 0 && <fieldset><legend>Sin…</legend>{producto.ingredientes.map((i) => <label className="choice" key={i.id}><input type="checkbox" checked={ingredientesExcluidos.includes(i.id)} onChange={() => setIngredientes((v) => v.includes(i.id) ? v.filter((id) => id !== i.id) : [...v, i.id])} />{i.nombre}</label>)}</fieldset>}{producto.agregados.length > 0 && <fieldset><legend>Agregar</legend>{producto.agregados.map((a) => <label className="choice" key={a.id}><input type="checkbox" checked={agregados.includes(a.id)} onChange={() => setAgregados((v) => v.includes(a.id) ? v.filter((id) => id !== a.id) : [...v, a.id])} />{a.nombre}<span>+{money.format(Number(a.precio))}</span></label>)}</fieldset>}<button className="primary wide" type="button" onClick={() => onAgregar({ producto, cantidad: 1, varianteId, ingredientesExcluidos, agregados })}>Agregar a la comanda</button></section></div> }
function precioItem(item: DraftItem) { const variante = item.producto.variantes.find((v) => v.id === item.varianteId); return Number(variante?.precio ?? item.producto.precio) + item.agregados.reduce((sum, id) => sum + Number(item.producto.agregados.find((a) => a.id === id)?.precio ?? 0), 0) }
function descripcionItem(item: DraftItem) { const variante = item.producto.variantes.find((v) => v.id === item.varianteId)?.nombre; const extras = item.agregados.map((id) => item.producto.agregados.find((a) => a.id === id)?.nombre).filter(Boolean); return [variante, ...extras].filter(Boolean).join(' · ') || 'Sin cambios' }
function estadoMesa(mesa: Mesa) { if (!mesa.pedido) return 'libre'; if (mesa.pedido.estado === 'ready') return 'lista'; if (mesa.pedido.estado === 'preparing') return 'preparando'; return 'ocupada' }
function estadoMesaLabel(mesa: Mesa) { return mesa.pedido ? estadoLabel[mesa.pedido.estado] ?? 'Ocupada' : 'Libre' }
function manejarError(error: unknown, setError: (message: string) => void, onUnauthorized: () => void) { if (error instanceof ApiError && error.status === 401) { clearSession(); onUnauthorized(); return } setError(error instanceof Error ? error.message : 'No pudimos completar la operación. Revisá la conexión e intentá de nuevo.') }
