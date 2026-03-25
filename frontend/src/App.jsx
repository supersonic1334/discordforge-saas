import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { motion } from 'framer-motion'

import { useAuthStore } from './stores'
import { wsService } from './services/websocket'

import AppErrorBoundary from './components/AppErrorBoundary'
import Layout from './components/layout/Layout'
import AuthPage from './pages/AuthPage'
import SetupPage from './pages/SetupPage'
import Dashboard from './pages/Dashboard'
import AIAssistant from './pages/AIAssistant'
import ServersPage from './pages/ServersPage'
import ProtectionPage from './pages/ProtectionPage'
import ModerationPage from './pages/ModerationPage'
import MessagesPage from './pages/MessagesPage'
import BlockedPage from './pages/BlockedPage'
import CommandsPage from './pages/CommandsPage'
import AnalyticsPage from './pages/AnalyticsPage'
import ReviewsPage from './pages/ReviewsPage'
import SupportPage from './pages/SupportPage'
import SettingsPage from './pages/SettingsPage'
import AdminPanel from './pages/AdminPanel'
import ProviderPanel from './pages/ProviderPanel'
import OAuthCallback from './pages/OAuthCallback'
import { I18nProvider } from './i18n'

function getAccessFingerprint(snapshot) {
  const user = snapshot?.user
  return [
    user?.role || 'none',
    user?.is_primary_founder ? 'primary' : 'standard',
    snapshot?.hasBotToken ? 'bot' : 'no-bot',
  ].join('|')
}

function isEditableTarget(target) {
  if (!(target instanceof HTMLElement)) return false
  return !!target.closest('input, textarea, select, [contenteditable="true"], [data-allow-copy], [data-allow-context-menu], [data-allow-select]')
}

function RequireAuth({ children }) {
  const { token } = useAuthStore()
  if (!token) return <Navigate to="/auth" replace />
  return children
}

function RequireToken({ children }) {
  const { token, hasBotToken, user } = useAuthStore()
  if (!token) return <Navigate to="/auth" replace />
  if (!hasBotToken && user?.role !== 'api_provider') return <Navigate to="/setup" replace />
  return children
}

function RequireAdminPanelAccess({ children }) {
  const { user } = useAuthStore()
  if (!['founder', 'admin'].includes(user?.role)) return <Navigate to="/dashboard" replace />
  return children
}

function RequireProviderPanelAccess({ children }) {
  const { user } = useAuthStore()
  if (user?.role !== 'api_provider') return <Navigate to="/dashboard" replace />
  return children
}

function PageTransition({ children }) {
  const location = useLocation()
  return (
    <motion.div
      key={location.pathname}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      style={{ height: '100%', width: '100%', maxWidth: '100%', overflowX: 'hidden' }}
    >
      {children}
    </motion.div>
  )
}

function DashboardHome() {
  const { user } = useAuthStore()
  if (user?.role === 'api_provider') {
    return <Navigate to="/dashboard/provider" replace />
  }
  return <PageTransition><Dashboard /></PageTransition>
}

function AppRoot() {
  const { token, fetchMe, logout } = useAuthStore()

  useEffect(() => {
    if (!import.meta.env.PROD) return undefined

    document.body.classList.add('app-protected')

    const preventIfNeeded = (event, condition = true) => {
      if (!condition) return
      event.preventDefault()
      event.stopPropagation()
    }

    const onContextMenu = (event) => {
      preventIfNeeded(event, !isEditableTarget(event.target))
    }

    const onDragStart = (event) => {
      preventIfNeeded(event, !isEditableTarget(event.target))
    }

    const onSelectStart = (event) => {
      preventIfNeeded(event, !isEditableTarget(event.target))
    }

    const onCopyCut = (event) => {
      preventIfNeeded(event, !isEditableTarget(event.target))
    }

    const onKeyDown = (event) => {
      const key = String(event.key || '').toLowerCase()
      const combo = event.ctrlKey || event.metaKey
      const isEditable = isEditableTarget(event.target)
      const blockedShortcuts = (
        key === 'f12'
        || (combo && key === 'u')
        || (combo && key === 's')
        || (combo && key === 'p')
        || (combo && event.shiftKey && ['i', 'j', 'c', 'k'].includes(key))
      )

      if (blockedShortcuts) {
        preventIfNeeded(event)
        return
      }

      if (!isEditable && combo && ['c', 'x'].includes(key)) {
        preventIfNeeded(event)
      }
    }

    document.addEventListener('contextmenu', onContextMenu, true)
    document.addEventListener('dragstart', onDragStart, true)
    document.addEventListener('selectstart', onSelectStart, true)
    document.addEventListener('copy', onCopyCut, true)
    document.addEventListener('cut', onCopyCut, true)
    window.addEventListener('keydown', onKeyDown, true)

    return () => {
      document.body.classList.remove('app-protected')
      document.removeEventListener('contextmenu', onContextMenu, true)
      document.removeEventListener('dragstart', onDragStart, true)
      document.removeEventListener('selectstart', onSelectStart, true)
      document.removeEventListener('copy', onCopyCut, true)
      document.removeEventListener('cut', onCopyCut, true)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [])

  useEffect(() => {
    document.body.setAttribute('data-app-shell', 'ready')
    return () => {
      document.body.removeAttribute('data-app-shell')
    }
  }, [])

  useEffect(() => {
    let disposed = false

    if (token) {
      fetchMe().then((ok) => {
        if (!disposed && ok) {
          wsService.connect(token)
        }
      })
    } else {
      wsService.disconnect()
    }

    return () => {
      disposed = true
      wsService.disconnect()
    }
  }, [token, fetchMe])

  useEffect(() => {
    if (!token) return undefined

    const refreshSession = async (payload = {}) => {
      const ok = await fetchMe()
      if (!ok) {
        logout()
        window.location.replace('/auth')
        return
      }

      wsService.connect(token)
    }

    const unsubProfileUpdated = wsService.on('account:profileUpdated', refreshSession)
    return () => {
      unsubProfileUpdated()
    }
  }, [token, fetchMe, logout])

  useEffect(() => {
    if (!token) return undefined

    let cancelled = false

    const checkRoleRefresh = async () => {
      if (cancelled || document.visibilityState === 'hidden') return

      const before = getAccessFingerprint(useAuthStore.getState())
      const ok = await fetchMe()
      if (!ok || cancelled) return

      const after = getAccessFingerprint(useAuthStore.getState())
      if (before !== after) {
        wsService.connect(token)
      }
    }

    const intervalId = window.setInterval(checkRoleRefresh, 4000)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        checkRoleRefresh()
      }
    }

    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [token, fetchMe])

  return (
    <>
      <Toaster position="top-right" gutter={8} toastOptions={{
        duration: 4000,
        style: {
          background: '#14141f',
          color: '#fff',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '12px',
          fontFamily: 'DM Sans, sans-serif',
          fontSize: '14px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        },
        success: { iconTheme: { primary: '#00e5ff', secondary: '#14141f' } },
        error:   { iconTheme: { primary: '#f87171', secondary: '#14141f' } },
      }} />

      <Routes>
        <Route path="/auth" element={<PageTransition><AuthPage /></PageTransition>} />
        <Route path="/auth/callback" element={<OAuthCallback />} />

        <Route path="/setup" element={
          <RequireAuth><PageTransition><SetupPage /></PageTransition></RequireAuth>
        } />

        <Route path="/dashboard" element={
          <RequireToken><Layout /></RequireToken>
        }>
          <Route index element={<DashboardHome />} />
          <Route path="servers" element={<PageTransition><ServersPage /></PageTransition>} />
          <Route path="servers/:guildId" element={<Navigate to="/dashboard/servers" replace />} />
          <Route path="protection" element={<PageTransition><ProtectionPage /></PageTransition>} />
          <Route path="moderation" element={<PageTransition><ModerationPage /></PageTransition>} />
          <Route path="messages" element={<PageTransition><MessagesPage /></PageTransition>} />
          <Route path="blocked" element={<PageTransition><BlockedPage /></PageTransition>} />
          <Route path="commands" element={<PageTransition><CommandsPage /></PageTransition>} />
          <Route path="analytics" element={<PageTransition><AnalyticsPage /></PageTransition>} />
          <Route path="reviews" element={<PageTransition><ReviewsPage /></PageTransition>} />
          <Route path="support" element={<PageTransition><SupportPage /></PageTransition>} />
          <Route path="ai" element={<PageTransition><AIAssistant /></PageTransition>} />
          <Route path="settings" element={<PageTransition><SettingsPage /></PageTransition>} />
          <Route path="provider" element={
            <RequireProviderPanelAccess><PageTransition><ProviderPanel /></PageTransition></RequireProviderPanelAccess>
          } />
          <Route path="admin" element={
            <RequireAdminPanelAccess><PageTransition><AdminPanel /></PageTransition></RequireAdminPanelAccess>
          } />
        </Route>

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </>
  )
}

export default function App() {
  return (
    <AppErrorBoundary>
      <BrowserRouter>
        <I18nProvider>
          <AppRoot />
        </I18nProvider>
      </BrowserRouter>
    </AppErrorBoundary>
  )
}
