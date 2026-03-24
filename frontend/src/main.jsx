import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import App from './App'

const rootElement = document.getElementById('root')

function renderEmergencyFallback() {
  if (!rootElement || document.body?.getAttribute('data-app-shell') === 'ready') return

  rootElement.innerHTML = `
    <div style="min-height:100vh;background:#090910;color:#f4f7fb;display:flex;align-items:center;justify-content:center;padding:24px;font-family:'DM Sans',sans-serif;">
      <div style="width:100%;max-width:560px;border:1px solid rgba(255,255,255,0.08);background:rgba(20,20,31,0.94);border-radius:24px;padding:32px;box-shadow:0 30px 120px rgba(0,0,0,0.45);">
        <div style="width:56px;height:56px;border-radius:18px;background:rgba(248,113,113,0.1);border:1px solid rgba(248,113,113,0.2);display:flex;align-items:center;justify-content:center;color:#fca5a5;font-size:28px;font-weight:700;">!</div>
        <h1 style="margin:16px 0 0;font-family:'Syne',sans-serif;font-size:34px;line-height:1.05;">Chargement interrompu</h1>
        <p style="margin:14px 0 0;color:rgba(255,255,255,0.6);font-size:15px;line-height:1.65;">
          Le site a rencontre un probleme de chargement. Recharge la page pour relancer l interface.
        </p>
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:24px;">
          <button onclick="window.location.reload()" style="flex:1 1 220px;border:0;border-radius:14px;padding:14px 18px;background:linear-gradient(90deg,#00e5ff,#b04eff);color:white;font-weight:700;cursor:pointer;">Recharger</button>
          <button onclick="window.location.assign('/auth')" style="flex:1 1 220px;border-radius:14px;padding:14px 18px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);color:rgba(255,255,255,0.88);font-weight:700;cursor:pointer;">Retour connexion</button>
        </div>
      </div>
    </div>
  `
}

window.addEventListener('error', renderEmergencyFallback, { once: true })
window.addEventListener('unhandledrejection', renderEmergencyFallback, { once: true })

try {
  if (!rootElement) {
    throw new Error('Root element #root not found')
  }
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
} catch (error) {
  console.error('React boot failed:', error)
  renderEmergencyFallback()
}
