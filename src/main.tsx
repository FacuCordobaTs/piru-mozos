import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then((registration) => registration.update())
    let recargando = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (recargando) return
      recargando = true
      window.location.reload()
    })
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>,
)
