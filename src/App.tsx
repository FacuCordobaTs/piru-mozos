import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import {
  addPedidoItem, ApiError, clearSession, connectPedidos, createPedido, deletePedidoItem,
  getMenu, getMesas, getPedido, getSession, startLoginOtp, updatePedidoItem, verifyLoginOtp,
  type Mesa, type Menu, type Pedido, type PedidoItem, type PedidoItemInput, type Producto, type Session,
} from './api'

type DraftItem = { producto: Producto; cantidad: number; varianteId?: number; varianteSecundariaId?: number; ingredientesExcluidos: number[]; agregados: number[]; nota?: string }

const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })
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
  const [telefono, setTelefono] = useState('')
  const [numeroMozo, setNumeroMozo] = useState('')
  const [codigo, setCodigo] = useState('')
  const [verificationId, setVerificationId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)
  const telefonoNormalizado = () => {
    const digitos = telefono.replace(/\D/g, '')
    return digitos.startsWith('54') ? digitos : `54${digitos}`
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setEnviando(true)
    try {
      const numero = Number(numeroMozo)
      if (!verificationId) {
        const inicio = await startLoginOtp(telefonoNormalizado(), numero)
        setVerificationId(inicio.verificationId)
        setCodigo('')
      } else {
        onLogin(await verifyLoginOtp(verificationId, codigo, numero))
      }
    }
    catch (e) { setError(e instanceof Error ? e.message : 'No pudimos iniciar el turno') }
    finally { setEnviando(false) }
  }
  return <main className="login-page"><form className="login-card" onSubmit={submit}>
    <p className="eyebrow">Piru · Mozos</p><h1>Empezá tu turno</h1>
    {!verificationId ? <>
      <p className="login-help">Ingresá el WhatsApp del local y tu número de mozo.</p>
      <label>WhatsApp del local<input type="tel" inputMode="numeric" autoComplete="tel" placeholder="9 351 123 4567" value={telefono} onChange={(e) => setTelefono(e.target.value)} minLength={8} required /></label>
      <label>Tu número de mozo<input inputMode="numeric" autoComplete="username" placeholder="Ej: 2" value={numeroMozo} onChange={(e) => setNumeroMozo(e.target.value.replace(/\D/g, '').slice(0, 6))} min="1" required /></label>
    </> : <>
      <p className="login-help">Enviamos un código de 6 dígitos al WhatsApp del local.</p>
      <label>Código de WhatsApp<input className="otp-input" inputMode="numeric" autoComplete="one-time-code" value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))} minLength={6} maxLength={6} autoFocus required /></label>
      <button className="text-button" type="button" onClick={() => { setVerificationId(null); setCodigo(''); setError('') }}>Cambiar datos</button>
    </>}
    {error && <p className="error" role="alert">{error}</p>}<button className="primary wide" disabled={enviando}>{enviando ? 'Procesando…' : verificationId ? 'Ingresar' : 'Enviar código'}</button>
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
  const [vistaMesas, setVistaMesas] = useState<'lista' | 'mapa'>('lista')

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
  const volverAMesas = () => { setMesa(null); setPedido(null); setDraft([]); setVistaMesas('lista'); void cargar() }
  if (mesa) return <Comanda session={session} menu={menu} mesa={mesa} pedido={pedido} draft={draft} setDraft={setDraft} offline={offline} error={error} onError={setError} syncVersion={syncVersion} onBack={volverAMesas} onPedidoCreado={() => volverAMesas()} onPedidoActualizado={setPedido} />
  return <main className="mesas"><header className="hero"><button className="text-button" type="button" onClick={onSalir}>Salir</button></header>
    {offline && <p className="network warning">Sin conexión</p>}
    {error && <p className="network error" role="alert">{error}</p>}
    <section aria-labelledby="mesas-title"><div className="section-heading"><div><p className="eyebrow">Tu local</p><h2 id="mesas-title">{vistaMesas === 'mapa' ? 'Mapa de mesas' : 'Mesas'}</h2></div><button className="refresh" type="button" onClick={() => void cargar()} disabled={loading}>↻</button></div>
      <button className="view-toggle" type="button" onClick={() => setVistaMesas(vistaMesas === 'mapa' ? 'lista' : 'mapa')}>{vistaMesas === 'mapa' ? '‹ Volver al listado' : 'Ver mapa de mesas'}</button>
      {vistaMesas === 'mapa'
        ? <MapaMesas mesas={mesas} cargando={loading} onAbrir={(m) => void abrirMesa(m)} />
        : <ListaMesas mesas={mesas} cargando={loading} onAbrir={(m) => void abrirMesa(m)} />}
    </section></main>
}

function Comanda({ session, menu, mesa, pedido, draft, setDraft, offline, error, onError, syncVersion, onBack, onPedidoCreado, onPedidoActualizado }: { session: Session; menu: Menu | null; mesa: Mesa; pedido: Pedido | null; draft: DraftItem[]; setDraft: Dispatch<SetStateAction<DraftItem[]>>; offline: boolean; error: string; onError: (error: string) => void; syncVersion: number; onBack: () => void; onPedidoCreado: () => void; onPedidoActualizado: (pedido: Pedido) => void }) {
  const [categoria, setCategoria] = useState<number | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const [indiceSeleccionado, setIndiceSeleccionado] = useState(0)
  const [producto, setProducto] = useState<Producto | null>(null)
  const [draftEditando, setDraftEditando] = useState<number | null>(null)
  const [itemEditando, setItemEditando] = useState<PedidoItem | null>(null)
  const [confirmando, setConfirmando] = useState(false)
  const [mutando, setMutando] = useState(false)
  const total = useMemo(() => draft.reduce((sum, item) => sum + precioItem(item) * item.cantidad, 0), [draft])
  const categorias = useMemo(() => {
    const productos = menu?.productos ?? []
    return (menu?.categorias ?? []).filter((cat) => productos.some((producto) => producto.categoriaId === cat.id))
  }, [menu])
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
    try {
      await createPedido(session.token, { mesaLocalId: mesa.id, items: draft.map(itemInput) })
      onPedidoCreado()
    }
    catch (e) { manejarError(e, onError, () => undefined) }
    finally { setConfirmando(false) }
  }
  useEffect(() => {
    if (!pedido || syncVersion === 0) return
    void getPedido(session.token, pedido.id).then(onPedidoActualizado).catch((e) => manejarError(e, onError, () => undefined))
  }, [syncVersion])
  function itemInput(item: DraftItem): PedidoItemInput { return { productoId: item.producto.id, varianteId: item.varianteId, varianteSecundariaId: item.varianteSecundariaId, cantidad: item.cantidad, ingredientesExcluidos: item.ingredientesExcluidos, agregados: item.agregados.map((id) => ({ id })), nota: item.nota } }
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
  const editarExistente = async (itemId: number, item: DraftItem) => {
    if (!pedido || offline || !pedido.editable) return
    setMutando(true); onError('')
    try { onPedidoActualizado(await updatePedidoItem(session.token, pedido.id, itemId, pedido.version, itemInput(item))) }
    catch (e) { if (!recuperarConflicto(e)) manejarError(e, onError, () => undefined) }
    finally { setMutando(false) }
  }
  const abrirProducto = (productoSeleccionado: Producto, opciones?: { draftIndex?: number; item?: PedidoItem }) => {
    setProducto(productoSeleccionado)
    setDraftEditando(opciones?.draftIndex ?? null)
    setItemEditando(opciones?.item ?? null)
  }
  const cerrarConfigurador = () => { setProducto(null); setDraftEditando(null); setItemEditando(null) }
  const sinProductos = !pedido && draft.length === 0
  return <main className="pedido"><header className="mesa-header"><button className="back" type="button" onClick={onBack}>‹ Mesas</button><h1>{mesa.nombre}</h1></header>
    {offline && <p className="network warning">Sin conexión</p>}{error && <p className="network error" role="alert">{error}</p>}
    {sinProductos ? <p className="mesa-vacia">MESA VACIA</p> : <section className="order-card"><div className="order-heading"><span>Comanda</span><strong>{pedido ? money.format(Number(pedido.total)) : money.format(total)}</strong></div>{pedido ? <ul className="items">{pedido.items.map((item) => {
      const productoItem = menu?.productos.find((productoMenu) => productoMenu.id === item.productoId)
      return <li key={item.id} className={productoItem && pedido.editable ? 'item-editable' : ''} onClick={() => productoItem && pedido.editable && abrirProducto(productoItem, { item })}><div><strong>{item.nombreProducto}</strong><small>{descripcionPedidoItem(item)} · {money.format(Number(item.precioUnitario))}{item.cantidad > 1 ? ` × ${item.cantidad}` : ''}</small></div><button className="remove-x" aria-label={`Quitar ${item.nombreProducto}`} type="button" disabled={!pedido.editable || offline || mutando} onClick={(event) => { event.stopPropagation(); void eliminarExistente(item.id) }}>×</button></li>
    })}</ul> : <DraftItems items={draft} onEdit={(index) => abrirProducto(draft[index].producto, { draftIndex: index })} onRemove={(index) => setDraft((items) => items.filter((_, i) => i !== index))} />}{pedido && !pedido.editable && <p className="readonly">Comanda cerrada</p>}</section>}
    <section className="menu">
      <input className="menu-search" aria-label="Buscar producto" placeholder="Buscar producto..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} onKeyDown={(e) => {
        // Las flechitas recorren el resultado; Enter abre el producto destacado.
        if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && productosVisibles.length > 0) { e.preventDefault(); setIndiceSeleccionado((prev) => (prev + (e.key === 'ArrowDown' ? 1 : -1) + productosVisibles.length) % productosVisibles.length) }
        if (e.key === 'Enter' && productosVisibles.length > 0) { e.preventDefault(); const seleccionado = productosVisibles[Math.min(indiceSeleccionado, productosVisibles.length - 1)]; if (seleccionado) abrirProducto(seleccionado) }
      }} />
      {!buscando && <div className="tabs" role="tablist">{categorias.map((c) => <button key={c.id} type="button" className={categoriaActiva === c.id ? 'active' : ''} onClick={() => setCategoria(c.id)}>{c.nombre}</button>)}</div>}
      <div className="product-list">{productosVisibles.length === 0 ? (menu ? <p className="muted">No se encontraron productos.</p> : null) : porCategoria.map(([cat, items]) => <div key={cat}>{buscando && <h3 className="categoria-title">{cat}</h3>}{items.map((p) => <button key={p.id} type="button" disabled={!!pedido && (!pedido.editable || mutando)} className={`product${indicePlano.get(p.id) === indiceSeleccionado ? ' selected' : ''}`} onClick={() => abrirProducto(p)}><span><strong>{p.nombre}</strong><small>{money.format(Number(p.precio))}</small></span><b>+</b></button>)}</div>)}</div>
    </section>
    {!pedido && <footer className="checkout"><span>Total <strong>{money.format(total)}</strong></span><button className="primary" type="button" disabled={!draft.length || offline || confirmando} onClick={() => void confirmar()}>{confirmando ? 'Confirmando…' : 'Confirmar pedido'}</button></footer>}
    {producto && <Configurador producto={producto} initialItem={draftEditando != null ? draft[draftEditando] : itemEditando ? draftDesdePedido(producto, itemEditando) : undefined} editando={draftEditando != null || itemEditando != null} onClose={cerrarConfigurador} onGuardar={(item) => {
      if (itemEditando) void editarExistente(itemEditando.id, item)
      else if (draftEditando != null) setDraft((current) => current.map((value, index) => index === draftEditando ? item : value))
      else if (pedido) void agregarExistente(item)
      else setDraft((current) => [...current, item])
      cerrarConfigurador(); setBusqueda('')
    }} />}
  </main>
}

function DraftItems({ items, onEdit, onRemove }: { items: DraftItem[]; onEdit: (index: number) => void; onRemove: (index: number) => void }) { return <ul className="items">{items.map((item, index) => <li className="item-editable" key={`${item.producto.id}-${index}`} onClick={() => onEdit(index)}><div><strong>{item.producto.nombre}</strong><small>{descripcionItem(item)} · {money.format(precioItem(item))}{item.cantidad > 1 ? ` × ${item.cantidad}` : ''}</small></div><button className="remove-x" type="button" aria-label={`Quitar ${item.producto.nombre}`} onClick={(event) => { event.stopPropagation(); onRemove(index) }}>×</button></li>)}</ul> }

function Configurador({ producto, initialItem, editando, onClose, onGuardar }: { producto: Producto; initialItem?: DraftItem; editando: boolean; onClose: () => void; onGuardar: (item: DraftItem) => void }) {
  const [varianteId, setVarianteId] = useState<number | undefined>(initialItem?.varianteId ?? producto.variantes[0]?.id)
  const [varianteSecundariaId, setVarianteSecundariaId] = useState<number | undefined>(initialItem?.varianteSecundariaId ?? producto.variantesSecundarias[0]?.id)
  const [ingredientesExcluidos, setIngredientes] = useState<number[]>(initialItem?.ingredientesExcluidos ?? [])
  const [agregados, setAgregados] = useState<number[]>(initialItem?.agregados ?? [])
  const [nota, setNota] = useState(initialItem?.nota ?? '')
  const [mostrarIngredientes, setMostrarIngredientes] = useState(false)
  const [mostrarExtras, setMostrarExtras] = useState(false)
  const toggle = (values: number[], id: number, setValues: Dispatch<SetStateAction<number[]>>) => setValues(values.includes(id) ? values.filter((value) => value !== id) : [...values, id])
  const grupoVariantes = (titulo: string, opciones: Producto['variantes'], seleccionado: number | undefined, setSeleccionado: (id: number) => void, adicional = false) => opciones.length > 0 && <fieldset><legend>{titulo}</legend><div className="variant-grid">{opciones.map((opcion) => <button key={opcion.id} className={`variant-card${seleccionado === opcion.id ? ' active' : ''}`} type="button" onClick={() => setSeleccionado(opcion.id)}><strong>{opcion.nombre}</strong><span>{adicional && Number(opcion.precio) > 0 ? '+' : ''}{money.format(Number(opcion.precio))}</span></button>)}</div></fieldset>
  const extras = [...producto.agregadosPrimarios, ...producto.agregadosSecundarios]
  return <div className="sheet-backdrop" role="presentation" onMouseDown={onClose}><section className="sheet" role="dialog" aria-modal="true" aria-label={`Configurar ${producto.nombre}`} onMouseDown={(e) => e.stopPropagation()}><div className="sheet-header"><h2>{producto.nombre}</h2><button className="sheet-close" type="button" aria-label="Cerrar" onClick={onClose}>×</button></div>
    {grupoVariantes(producto.tituloVariantesPrimarias, producto.variantes, varianteId, setVarianteId)}
    {grupoVariantes(producto.tituloVariantesSecundarias, producto.variantesSecundarias, varianteSecundariaId, setVarianteSecundariaId, true)}
    {(producto.ingredientes.length > 0 || extras.length > 0) && <div className="customization-actions">{producto.ingredientes.length > 0 && <button type="button" className={mostrarIngredientes ? 'active' : ''} onClick={() => setMostrarIngredientes((value) => !value)}>Quitar ingredientes</button>}{extras.length > 0 && <button type="button" className={mostrarExtras ? 'active' : ''} onClick={() => setMostrarExtras((value) => !value)}>Agregar extras</button>}</div>}
    {mostrarIngredientes && <fieldset><legend>Quitar ingredientes</legend>{producto.ingredientes.map((ingrediente) => <label className="choice" key={ingrediente.id}><input type="checkbox" checked={ingredientesExcluidos.includes(ingrediente.id)} onChange={() => toggle(ingredientesExcluidos, ingrediente.id, setIngredientes)} />Sin {ingrediente.nombre}</label>)}</fieldset>}
    {mostrarExtras && <>{producto.agregadosPrimarios.length > 0 && <fieldset><legend>{producto.tituloExtrasPrimarios}</legend>{producto.agregadosPrimarios.map((extra) => <label className="choice" key={extra.id}><input type="checkbox" checked={agregados.includes(extra.id)} onChange={() => toggle(agregados, extra.id, setAgregados)} />{extra.nombre}<span>+{money.format(Number(extra.precio))}</span></label>)}</fieldset>}{producto.agregadosSecundarios.length > 0 && <fieldset><legend>{producto.tituloExtrasSecundarios}</legend>{producto.agregadosSecundarios.map((extra) => <label className="choice" key={extra.id}><input type="checkbox" checked={agregados.includes(extra.id)} onChange={() => toggle(agregados, extra.id, setAgregados)} />{extra.nombre}<span>+{money.format(Number(extra.precio))}</span></label>)}</fieldset>}</>}
    {producto.permiteNota && <label className="product-note"><strong>{producto.tituloNota}</strong><textarea maxLength={500} value={nota} onChange={(event) => setNota(event.target.value)} placeholder="Escribí una aclaración..." /></label>}
    <button className="primary wide" type="button" onClick={() => onGuardar({ producto, cantidad: initialItem?.cantidad ?? 1, varianteId, varianteSecundariaId, ingredientesExcluidos, agregados, nota: nota.trim() || undefined })}>{editando ? 'Guardar cambios' : 'Agregar'}</button>
  </section></div>
}
function precioItem(item: DraftItem) { const variante = item.producto.variantes.find((v) => v.id === item.varianteId); const secundaria = item.producto.variantesSecundarias.find((v) => v.id === item.varianteSecundariaId); return Number(variante?.precio ?? item.producto.precio) + Number(secundaria?.precio ?? 0) + item.agregados.reduce((sum, id) => sum + Number(item.producto.agregados.find((a) => a.id === id)?.precio ?? 0), 0) }
function descripcionItem(item: DraftItem) { const variante = item.producto.variantes.find((v) => v.id === item.varianteId)?.nombre; const secundaria = item.producto.variantesSecundarias.find((v) => v.id === item.varianteSecundariaId)?.nombre; const sin = item.ingredientesExcluidos.map((id) => item.producto.ingredientes.find((i) => i.id === id)?.nombre).filter(Boolean).map((nombre) => `Sin ${nombre}`); const extras = item.agregados.map((id) => item.producto.agregados.find((a) => a.id === id)?.nombre).filter(Boolean); return [variante, secundaria, ...sin, ...extras, item.nota].filter(Boolean).join(' · ') || 'Sin cambios' }
function descripcionPedidoItem(item: PedidoItem) { return [item.varianteNombre, item.varianteSecundariaNombre, ...(item.ingredientesExcluidosNombres ?? []).map((nombre) => `Sin ${nombre}`), ...(item.agregados ?? []).map((extra) => extra.nombre), item.nota].filter(Boolean).join(' · ') || 'Sin cambios' }
function draftDesdePedido(producto: Producto, item: PedidoItem): DraftItem { return { producto, cantidad: item.cantidad, varianteId: item.varianteId ?? undefined, varianteSecundariaId: item.varianteSecundariaId ?? undefined, ingredientesExcluidos: item.ingredientesExcluidos ?? [], agregados: (item.agregados ?? []).map((extra) => extra.id), nota: item.nota ?? undefined } }
function estadoMesa(mesa: Mesa) { if (!mesa.pedido) return 'libre'; if (mesa.pedido.estado === 'ready') return 'lista'; if (mesa.pedido.estado === 'preparing') return 'preparando'; return 'ocupada' }
function estadoMesaLabel(mesa: Mesa) { return { libre: 'Libre', lista: 'Lista', preparando: 'Preparando', ocupada: 'Ocupada' }[estadoMesa(mesa)] }

function ListaMesas({ mesas, cargando, onAbrir }: { mesas: Mesa[]; cargando: boolean; onAbrir: (mesa: Mesa) => void }) {
  if (cargando) return <p className="muted loading">Actualizando mesas…</p>
  if (mesas.length === 0) return <p className="muted">Todavía no hay mesas configuradas.</p>
  return <div className="mesas-grid">{mesas.map((mesa) => <button key={mesa.id} type="button" className={`mesa-card ${estadoMesa(mesa)}`} onClick={() => onAbrir(mesa)}><strong>{mesa.nombre}</strong><span>{estadoMesaLabel(mesa)}</span>{mesa.pedido && <small>{money.format(Number(mesa.pedido.total))}</small>}</button>)}</div>
}

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
