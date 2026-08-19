import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import {
  addPedidoItem, ApiError, clearSession, connectPedidos, createPedido, deletePedidoItem,
  getMenu, getMesas, getPedido, getSession, login,
  type Mesa, type Menu, type Pedido, type PedidoItemInput, type Producto, type Session,
} from './api'

type DraftItem = { producto: Producto; cantidad: number; varianteId?: number; ingredientesExcluidos: number[]; agregados: number[] }

const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })
const estadoLabel: Record<string, string> = { pending: 'Pendiente', confirmed: 'Confirmado', preparing: 'Preparando', ready: 'Listo', delivered: 'Entregado' }
// Mapa de mesas: mismas medidas y reglas del plano del admin (MesasOperativas).
const MAPA_CELL = 56
const MAPA_MIN_ZOOM = 0.2
const MAPA_MAX_ZOOM = 1.5
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

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
    <p className="eyebrow">Piru · Mozos</p><h1>Empezá tu turno</h1>
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
  return <main className="mesas"><header className="hero"><button className="text-button" type="button" onClick={onSalir}>Salir</button></header>
    {offline && <p className="network warning">Sin conexión</p>}
    {error && <p className="network error" role="alert">{error}</p>}
    <section aria-labelledby="mesas-title"><div className="section-heading"><div><p className="eyebrow">Tu local</p><h2 id="mesas-title">Mesas</h2></div><button className="refresh" type="button" onClick={() => void cargar()} disabled={loading}>↻</button></div>
      <MapaMesas mesas={mesas} cargando={loading} onAbrir={(m) => void abrirMesa(m)} />
    </section></main>
}

function Comanda({ session, menu, mesa, pedido, draft, setDraft, offline, error, onError, syncVersion, onBack, onPedidoCreado, onPedidoActualizado }: { session: Session; menu: Menu | null; mesa: Mesa; pedido: Pedido | null; draft: DraftItem[]; setDraft: Dispatch<SetStateAction<DraftItem[]>>; offline: boolean; error: string; onError: (error: string) => void; syncVersion: number; onBack: () => void; onPedidoCreado: (pedido: Pedido) => void; onPedidoActualizado: (pedido: Pedido) => void }) {
  const [categoria, setCategoria] = useState<number | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const [indiceSeleccionado, setIndiceSeleccionado] = useState(0)
  const [producto, setProducto] = useState<Producto | null>(null)
  const [confirmando, setConfirmando] = useState(false)
  const [mutando, setMutando] = useState(false)
  const total = useMemo(() => draft.reduce((sum, item) => sum + precioItem(item) * item.cantidad, 0), [draft])
  const categorias = menu?.categorias ?? []
  const categoriaActiva = categoria ?? categorias[0]?.id ?? null
  // Búsqueda tipo POS: filtra el menú completo por nombre y categoría. Sin
  // búsqueda se muestra la categoría activa; con búsqueda, todas las que matcheen.
  const buscando = busqueda.trim() !== ''
  const productosVisibles = useMemo(() => {
    const todos = menu?.productos ?? []
    const terms = busqueda.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (terms.length === 0) return todos.filter((p) => p.categoriaId === categoriaActiva)
    return todos.filter((p) => {
      const texto = `${p.nombre} ${categorias.find((c) => c.id === p.categoriaId)?.nombre ?? ''}`.toLowerCase()
      return terms.every((term) => texto.includes(term))
    })
  }, [menu, busqueda, categoriaActiva, categorias])
  const porCategoria = useMemo(() => {
    const map: Record<string, Producto[]> = {}
    productosVisibles.forEach((p) => {
      const cat = categorias.find((c) => c.id === p.categoriaId)?.nombre ?? 'Sin categoría'
      if (!map[cat]) map[cat] = []
      map[cat].push(p)
    })
    return Object.entries(map).sort((a, b) => {
      if (a[0] === 'Sin categoría') return 1
      if (b[0] === 'Sin categoría') return -1
      return a[0].localeCompare(b[0])
    })
  }, [productosVisibles, categorias])
  const indicePlano = useMemo(() => {
    const map = new Map<number, number>()
    let index = 0
    porCategoria.forEach(([, items]) => items.forEach((p) => map.set(p.id, index++)))
    return map
  }, [porCategoria])
  // Al cambiar el resultado (búsqueda o categoría) la selección vuelve al primero.
  useEffect(() => { setIndiceSeleccionado(0) }, [busqueda, categoriaActiva])
  const confirmar = async () => {
    if (!draft.length || offline || pedido) return
    setConfirmando(true); onError('')
    try { onPedidoCreado(await createPedido(session.token, { mesaLocalId: mesa.id, items: draft.map((item) => ({ productoId: item.producto.id, varianteId: item.varianteId, cantidad: item.cantidad, ingredientesExcluidos: item.ingredientesExcluidos, agregados: item.agregados.map((id) => ({ id })) })) })) }
    catch (e) { manejarError(e, onError, () => undefined) }
    finally { setConfirmando(false) }
  }
  useEffect(() => {
    if (!pedido || syncVersion === 0) return
    void getPedido(session.token, pedido.id).then(onPedidoActualizado).catch((e) => manejarError(e, onError, () => undefined))
  }, [syncVersion])
  const itemInput = (item: DraftItem): PedidoItemInput => ({ productoId: item.producto.id, varianteId: item.varianteId, cantidad: item.cantidad, ingredientesExcluidos: item.ingredientesExcluidos, agregados: item.agregados.map((id) => ({ id })) })
  const recuperarConflicto = (e: unknown) => {
    if (e instanceof ApiError && e.status === 409 && e.data?.pedido) {
      onPedidoActualizado(e.data.pedido)
      onError('La comanda cambió en otra pantalla.')
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
  return <main className="pedido"><header className="topbar"><button className="back" type="button" onClick={onBack}>‹ Mesas</button><div><p className="eyebrow">{pedido ? 'Pedido en curso' : 'Tomando pedido'}</p><h1>{mesa.nombre}</h1></div><span className={`status ${estadoMesa(mesa)}`}>{pedido ? estadoLabel[pedido.estado] ?? pedido.estado : 'Nueva'}</span></header>
    {offline && <p className="network warning">Sin conexión</p>}{error && <p className="network error" role="alert">{error}</p>}
    <section className="order-card"><div className="order-heading"><span>Comanda</span><strong>{pedido ? money.format(Number(pedido.total)) : draft.length ? money.format(total) : 'Sin productos'}</strong></div>{pedido ? <ul className="items">{pedido.items.map((item) => <li key={item.id}><div><strong>{item.nombreProducto}</strong><small>{item.varianteNombre || 'Base'} · {money.format(Number(item.precioUnitario))}</small></div><div className="item-actions"><b>×{item.cantidad}</b><button className="remove" type="button" disabled={!pedido.editable || offline || mutando} onClick={() => void eliminarExistente(item.id)}>Quitar</button></div></li>)}</ul> : <DraftItems items={draft} setItems={setDraft} />}{pedido && !pedido.editable && <p className="readonly">Comanda cerrada</p>}</section>
    <section className="menu"><div className="section-heading"><h2>{pedido ? 'Agregar a la comanda' : 'Menú'}</h2></div>
      <input className="menu-search" placeholder="Buscar producto..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} onKeyDown={(e) => {
        // Las flechitas recorren el resultado; Enter abre el producto destacado.
        if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && productosVisibles.length > 0) { e.preventDefault(); setIndiceSeleccionado((prev) => (prev + (e.key === 'ArrowDown' ? 1 : -1) + productosVisibles.length) % productosVisibles.length) }
        if (e.key === 'Enter' && productosVisibles.length > 0) { e.preventDefault(); setProducto(productosVisibles[Math.min(indiceSeleccionado, productosVisibles.length - 1)] ?? null) }
      }} />
      {!buscando && <div className="tabs" role="tablist">{categorias.map((c) => <button key={c.id} type="button" className={categoriaActiva === c.id ? 'active' : ''} onClick={() => setCategoria(c.id)}>{c.nombre}</button>)}</div>}
      <div className="product-list">{productosVisibles.length === 0 ? (menu ? <p className="muted">No se encontraron productos.</p> : null) : porCategoria.map(([cat, items]) => <div key={cat}>{buscando && <h3 className="categoria-title">{cat}</h3>}{items.map((p) => <button key={p.id} type="button" disabled={!!pedido && (!pedido.editable || mutando)} className={`product${indicePlano.get(p.id) === indiceSeleccionado ? ' selected' : ''}`} onClick={() => setProducto(p)}><span><strong>{p.nombre}</strong><small>{money.format(Number(p.precio))}</small></span><b>+</b></button>)}</div>)}</div>
    </section>
    {!pedido && <footer className="checkout"><span>Total <strong>{money.format(total)}</strong></span><button className="primary" type="button" disabled={!draft.length || offline || confirmando} onClick={() => void confirmar()}>{confirmando ? 'Confirmando…' : 'Confirmar pedido'}</button></footer>}
    {producto && <Configurador producto={producto} onClose={() => setProducto(null)} onAgregar={(item) => { if (pedido) void agregarExistente(item); else setDraft((current) => [...current, item]); setProducto(null); setBusqueda('') }} />}
  </main>
}

function DraftItems({ items, setItems }: { items: DraftItem[]; setItems: Dispatch<SetStateAction<DraftItem[]>> }) { return items.length ? <ul className="items">{items.map((item, index) => <li key={`${item.producto.id}-${index}`}><div><strong>{item.producto.nombre}</strong><small>{descripcionItem(item)} · {money.format(precioItem(item))}</small></div><div className="stepper"><button type="button" onClick={() => setItems((actual) => actual.flatMap((value, i) => i !== index ? [value] : value.cantidad > 1 ? [{ ...value, cantidad: value.cantidad - 1 }] : []))}>−</button><span>{item.cantidad}</span><button type="button" onClick={() => setItems((actual) => actual.map((value, i) => i === index ? { ...value, cantidad: value.cantidad + 1 } : value))}>+</button></div></li>)}</ul> : null }
function Configurador({ producto, onClose, onAgregar }: { producto: Producto; onClose: () => void; onAgregar: (item: DraftItem) => void }) { const [varianteId, setVarianteId] = useState<number | undefined>(producto.variantes[0]?.id); const [ingredientesExcluidos, setIngredientes] = useState<number[]>([]); const [agregados, setAgregados] = useState<number[]>([]); return <div className="sheet-backdrop" role="presentation" onMouseDown={onClose}><section className="sheet" role="dialog" aria-modal="true" aria-label={`Configurar ${producto.nombre}`} onMouseDown={(e) => e.stopPropagation()}><div className="sheet-header"><div><p className="eyebrow">Agregar a comanda</p><h2>{producto.nombre}</h2></div><button className="text-button" onClick={onClose}>Cerrar</button></div>{producto.variantes.length > 0 && <fieldset><legend>Variante</legend>{producto.variantes.map((v) => <label className="choice" key={v.id}><input type="radio" checked={varianteId === v.id} onChange={() => setVarianteId(v.id)} />{v.nombre}<span>{money.format(Number(v.precio))}</span></label>)}</fieldset>}{producto.ingredientes.length > 0 && <fieldset><legend>Sin…</legend>{producto.ingredientes.map((i) => <label className="choice" key={i.id}><input type="checkbox" checked={ingredientesExcluidos.includes(i.id)} onChange={() => setIngredientes((v) => v.includes(i.id) ? v.filter((id) => id !== i.id) : [...v, i.id])} />{i.nombre}</label>)}</fieldset>}{producto.agregados.length > 0 && <fieldset><legend>Agregar</legend>{producto.agregados.map((a) => <label className="choice" key={a.id}><input type="checkbox" checked={agregados.includes(a.id)} onChange={() => setAgregados((v) => v.includes(a.id) ? v.filter((id) => id !== a.id) : [...v, a.id])} />{a.nombre}<span>+{money.format(Number(a.precio))}</span></label>)}</fieldset>}<button className="primary wide" type="button" onClick={() => onAgregar({ producto, cantidad: 1, varianteId, ingredientesExcluidos, agregados })}>Agregar a la comanda</button></section></div> }
function precioItem(item: DraftItem) { const variante = item.producto.variantes.find((v) => v.id === item.varianteId); return Number(variante?.precio ?? item.producto.precio) + item.agregados.reduce((sum, id) => sum + Number(item.producto.agregados.find((a) => a.id === id)?.precio ?? 0), 0) }
function descripcionItem(item: DraftItem) { const variante = item.producto.variantes.find((v) => v.id === item.varianteId)?.nombre; const extras = item.agregados.map((id) => item.producto.agregados.find((a) => a.id === id)?.nombre).filter(Boolean); return [variante, ...extras].filter(Boolean).join(' · ') || 'Sin cambios' }
function estadoMesa(mesa: Mesa) { if (!mesa.pedido) return 'libre'; if (mesa.pedido.estado === 'ready') return 'lista'; if (mesa.pedido.estado === 'preparing') return 'preparando'; return 'ocupada' }
function estadoMesaLabel(mesa: Mesa) { return { libre: 'Libre', lista: 'Lista', preparando: 'Preparando', ocupada: 'Ocupada' }[estadoMesa(mesa)] }

function MapaMesas({ mesas, cargando, onAbrir }: { mesas: Mesa[]; cargando: boolean; onAbrir: (mesa: Mesa) => void }) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const limites = useMemo(() => {
    if (mesas.length === 0) return { minX: 0, minY: 0, columnas: 1, filas: 1 }
    const minX = Math.min(...mesas.map((m) => m.posicionX))
    const minY = Math.min(...mesas.map((m) => m.posicionY))
    const maxX = Math.max(...mesas.map((m) => m.posicionX + m.ancho))
    const maxY = Math.max(...mesas.map((m) => m.posicionY + m.alto))
    return { minX, minY, columnas: Math.max(1, maxX - minX), filas: Math.max(1, maxY - minY) }
  }, [mesas])
  const boardWidth = limites.columnas * MAPA_CELL + 32
  const boardHeight = limites.filas * MAPA_CELL + 32

  // Encuadra el plano completo apenas carga o cambia el tamaño del contenedor.
  const encajar = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport || mesas.length === 0) return
    setZoom(clamp(Math.min((viewport.clientWidth - 32) / boardWidth, (viewport.clientHeight - 32) / boardHeight, 1.15), MAPA_MIN_ZOOM, MAPA_MAX_ZOOM))
    requestAnimationFrame(() => viewport.scrollTo({ left: 0, top: 0 }))
  }, [boardHeight, boardWidth, mesas.length])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || mesas.length === 0) return
    const frame = requestAnimationFrame(encajar)
    const observer = new ResizeObserver(encajar)
    observer.observe(viewport)
    return () => { cancelAnimationFrame(frame); observer.disconnect() }
  }, [encajar, mesas.length])

  const cambiarZoom = (siguiente: number) => {
    const viewport = viewportRef.current
    const limitado = clamp(siguiente, MAPA_MIN_ZOOM, MAPA_MAX_ZOOM)
    if (!viewport || limitado === zoom) { setZoom(limitado); return }
    const centroX = (viewport.scrollLeft + viewport.clientWidth / 2) / zoom
    const centroY = (viewport.scrollTop + viewport.clientHeight / 2) / zoom
    setZoom(limitado)
    requestAnimationFrame(() => viewport.scrollTo({ left: centroX * limitado - viewport.clientWidth / 2, top: centroY * limitado - viewport.clientHeight / 2 }))
  }

  if (cargando) return <p className="muted loading">Actualizando mesas…</p>
  if (mesas.length === 0) return <p className="muted">Todavía no hay mesas configuradas.</p>

  return <div>
    <div className="mapa-toolbar">
      <div className="mapa-controls">
        <button type="button" aria-label="Alejar" disabled={zoom <= MAPA_MIN_ZOOM} onClick={() => cambiarZoom(zoom - 0.1)}>−</button>
        <span className="mapa-zoom">{Math.round(zoom * 100)}%</span>
        <button type="button" aria-label="Acercar" disabled={zoom >= MAPA_MAX_ZOOM} onClick={() => cambiarZoom(zoom + 0.1)}>+</button>
        <button type="button" aria-label="Encuadrar todas las mesas" onClick={encajar}>⤢</button>
      </div>
    </div>
    <div ref={viewportRef} className="mapa-mesas" onWheel={(event) => { if (event.ctrlKey || event.metaKey) { event.preventDefault(); cambiarZoom(zoom + (event.deltaY < 0 ? 0.1 : -0.1)) } }}>
      <div className="mapa-contenedor" style={{ width: `max(100%, ${boardWidth * zoom}px)`, height: `max(100%, ${boardHeight * zoom}px)` }}>
        <div className="mapa-plano" style={{ width: boardWidth, height: boardHeight, transform: `scale(${zoom})` }}>
          {mesas.map((mesa) => {
            const estado = estadoMesa(mesa)
            const pedido = mesa.pedido
            return <button key={mesa.id} type="button" aria-label={`${mesa.nombre}, ${estadoMesaLabel(mesa)}`} className={`mapa-mesa ${estado}`} onClick={() => onAbrir(mesa)} style={{ left: (mesa.posicionX - limites.minX) * MAPA_CELL + 16, top: (mesa.posicionY - limites.minY) * MAPA_CELL + 16, width: Math.max(104, mesa.ancho * MAPA_CELL - 8), height: Math.max(88, mesa.alto * MAPA_CELL - 8) }}>
              <strong>{mesa.nombre}</strong>
              <span className="mapa-estado"><i className="mapa-dot" />{estadoMesaLabel(mesa)}{pedido && ` · #${pedido.id}`}</span>
              <span className="mapa-meta">{pedido ? money.format(Number(pedido.total)) : `${mesa.capacidad} personas`}</span>
            </button>
          })}
        </div>
      </div>
    </div>
  </div>
}

function manejarError(error: unknown, setError: (message: string) => void, onUnauthorized: () => void) { if (error instanceof ApiError && error.status === 401) { clearSession(); onUnauthorized(); return } setError(error instanceof Error ? error.message : 'No pudimos completar la operación. Revisá la conexión e intentá de nuevo.') }
