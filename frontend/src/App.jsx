import { useEffect, useRef } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { motion } from 'framer-motion'

import { useAuthStore, useGuildStore, useBotStore } from './stores'
import { wsService } from './services/websocket'

import AppErrorBoundary from './components/AppErrorBoundary'
import Layout from './components/layout/Layout'
import AuthPage from './pages/AuthPage'
import SetupPage from './pages/SetupPage'
import Dashboard from './pages/Dashboard'
import AIAssistant from './pages/AIAssistant'
import ServersPage from './pages/ServersPage'
import ProtectionPage from './pages/ProtectionPage'
import PlaybooksPage from './pages/PlaybooksPage'
import SearchPage from './pages/SearchPage'
import ScanPage from './pages/ScanPage'
import LogsPage from './pages/LogsPage'
import MessagesPage from './pages/MessagesPage'
import DMCenterPage from './pages/DMCenterPage'
import NotificationsPage from './pages/NotificationsPage'
import AccessControlPage from './pages/AccessControlPage'
import CommandsPage from './pages/CommandsPage'
import AnalyticsPage from './pages/AnalyticsPage'
import IncidentsPage from './pages/IncidentsPage'
import ReviewsPage from './pages/ReviewsPage'
import RolesOnboardingPage from './pages/RolesOnboardingPage'
import SupportPage from './pages/SupportPage'
import TeamPage from './pages/TeamPage'
import SettingsPage from './pages/SettingsPage'
import AdminPanel from './pages/AdminPanel'
import ProviderPanel from './pages/ProviderPanel'
import EmailFastPage from './pages/EmailFastPage'
import OAuthCallback from './pages/OAuthCallback'
import { I18nProvider } from './i18n'

function getAccessFingerprint(snapshot) {
  const user = snapshot?.user
  return [
    user?.role || 'none',
    user?.is_primary_founder ? 'primary' : 'standard',
    snapshot?.hasBotToken ? 'bot' : 'no-bot',
    snapshot?.accessibleGuildCount || 0,
    snapshot?.sharedGuildCount || 0,
  ].join('|')
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
      className="page-transition-shell"
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
  const viewportRafRef = useRef(null)
  const viewportStableHeightRef = useRef(0)
  const focusScrollTimersRef = useRef([])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const isTouchInputMode = 'ontouchstart' in window || (navigator?.maxTouchPoints || 0) > 0

    const isEditableElement = (element) => (
      element instanceof HTMLElement
      && (
        element.matches('input, textarea, select')
        || element.getAttribute('contenteditable') === 'true'
      )
    )

    const clearFocusScrollTimers = () => {
      focusScrollTimersRef.current.forEach((timerId) => window.clearTimeout(timerId))
      focusScrollTimersRef.current = []
    }

    const getScrollableParent = (element) => {
      const appScrollRoot = document.querySelector('.app-screen-scroll, .app-main-scroll')

      if (isTouchInputMode && appScrollRoot) {
        return appScrollRoot
      }

      let current = element?.parentElement

      while (current && current !== document.body) {
        const style = window.getComputedStyle(current)
        const canScrollY = /(auto|scroll|overlay)/.test(style.overflowY)
        if (canScrollY && current.scrollHeight > current.clientHeight + 4) {
          return current
        }
        current = current.parentElement
      }

      return document.querySelector('.app-screen-scroll, .app-main-scroll') || document.scrollingElement
    }

    const restoreWindowHorizontalPosition = () => {
      if (window.scrollX === 0) return
      window.requestAnimationFrame(() => {
        window.scrollTo({
          left: 0,
          top: window.scrollY,
          behavior: 'auto',
        })
      })
    }

    const scrollActiveFieldIntoView = (behavior = 'smooth') => {
      const activeElement = document.activeElement
      if (!isEditableElement(activeElement)) return

      const visualViewport = window.visualViewport
      const visibleHeight = Math.round(visualViewport?.height || window.innerHeight || 0)
      const visibleTop = Math.round(visualViewport?.offsetTop || 0)
      const keyboardOpen = document.body.dataset.keyboardOpen === 'true'
      const rect = activeElement.getBoundingClientRect()
      const topSafeZone = visibleTop + 18
      const bottomSafeZone = visibleTop + visibleHeight - (keyboardOpen ? 118 : 34)

      if (rect.top >= topSafeZone && rect.bottom <= bottomSafeZone) {
        return
      }

      const scrollParent = getScrollableParent(activeElement)
      if (
        !scrollParent
        || scrollParent === document.body
        || scrollParent === document.documentElement
        || scrollParent === document.scrollingElement
      ) {
        const nextTop = Math.max(0, window.scrollY + rect.top - Math.max(24, visibleHeight * 0.24))
        window.scrollTo({
          top: nextTop,
          left: 0,
          behavior: isTouchInputMode ? 'auto' : behavior,
        })
        restoreWindowHorizontalPosition()
        return
      }

      const parentRect = scrollParent.getBoundingClientRect()
      const currentScrollTop = scrollParent.scrollTop
      const currentScrollLeft = scrollParent.scrollLeft
      const fieldTop = rect.top - parentRect.top + currentScrollTop
      const fieldBottom = rect.bottom - parentRect.top + currentScrollTop
      const viewportPaddingTop = 20
      const viewportPaddingBottom = keyboardOpen ? 128 : 42
      const visibleParentTop = currentScrollTop + viewportPaddingTop
      const visibleParentBottom = currentScrollTop + Math.max(120, visibleHeight - viewportPaddingBottom)

      let nextScrollTop = currentScrollTop
      if (fieldTop < visibleParentTop) {
        nextScrollTop = Math.max(0, fieldTop - 28)
      } else if (fieldBottom > visibleParentBottom) {
        nextScrollTop = Math.max(0, fieldBottom - Math.max(120, visibleHeight * 0.42))
      }

      if (Math.abs(nextScrollTop - currentScrollTop) < 4) {
        if (!isTouchInputMode) {
          activeElement.scrollIntoView({
            block: 'center',
            inline: 'nearest',
            behavior,
          })
        }
        restoreWindowHorizontalPosition()
        return
      }

      scrollParent.scrollTo({
        top: nextScrollTop,
        left: isTouchInputMode ? 0 : currentScrollLeft,
        behavior: isTouchInputMode ? 'auto' : behavior,
      })

      if (scrollParent.scrollLeft !== (isTouchInputMode ? 0 : currentScrollLeft)) {
        window.requestAnimationFrame(() => {
          scrollParent.scrollLeft = 0
        })
      }

      restoreWindowHorizontalPosition()
    }

    const scheduleFocusScroll = (behavior = 'smooth', delays = [56, 156, 320]) => {
      clearFocusScrollTimers()

      focusScrollTimersRef.current = delays.map((delay) => window.setTimeout(() => {
        window.requestAnimationFrame(() => {
          scrollActiveFieldIntoView(behavior)
        })
      }, delay))
    }

    const applyViewportSize = () => {
      viewportRafRef.current = null
      const visualViewport = window.visualViewport
      const nextHeight = Math.round(visualViewport?.height || window.innerHeight || 0)
      const nextWidth = Math.round(visualViewport?.width || window.innerWidth || 0)
      const viewportOffsetTop = Math.round(visualViewport?.offsetTop || 0)

      viewportStableHeightRef.current = Math.max(
        viewportStableHeightRef.current || 0,
        Math.round(window.innerHeight || 0),
        nextHeight + viewportOffsetTop
      )

      const stableHeight = Math.max(viewportStableHeightRef.current, nextHeight)
      const keyboardOffset = Math.max(0, stableHeight - nextHeight - viewportOffsetTop)

      document.documentElement.style.setProperty('--app-height', `${nextHeight}px`)
      document.documentElement.style.setProperty('--app-width', `${nextWidth}px`)
      document.documentElement.style.setProperty('--app-stable-height', `${stableHeight}px`)
      document.documentElement.style.setProperty('--app-keyboard-offset', `${keyboardOffset}px`)
      document.body.dataset.keyboardOpen = keyboardOffset > 0 ? 'true' : 'false'
    }

    const scheduleViewportSize = () => {
      if (viewportRafRef.current) {
        window.cancelAnimationFrame(viewportRafRef.current)
      }
      viewportRafRef.current = window.requestAnimationFrame(applyViewportSize)
    }

    const handleViewportResize = () => {
      scheduleViewportSize()
      scheduleFocusScroll('auto', [24, 120, 260, 420])
    }

    const handleOrientationChange = () => {
      viewportStableHeightRef.current = 0
      scheduleViewportSize()
      scheduleFocusScroll('auto', [120, 260, 520])
    }

    const handleFocusIn = (event) => {
      if (isEditableElement(event.target)) {
        scheduleFocusScroll(isTouchInputMode ? 'auto' : 'smooth', [40, 160, 320, 520])
      }
    }

    scheduleViewportSize()
    window.addEventListener('resize', handleViewportResize, { passive: true })
    window.addEventListener('orientationchange', handleOrientationChange)
    window.visualViewport?.addEventListener('resize', handleViewportResize)
    window.visualViewport?.addEventListener('scroll', handleViewportResize)
    document.addEventListener('focusin', handleFocusIn)

    return () => {
      if (viewportRafRef.current) {
        window.cancelAnimationFrame(viewportRafRef.current)
      }
      clearFocusScrollTimers()
      delete document.body.dataset.keyboardOpen
      window.removeEventListener('resize', handleViewportResize)
      window.removeEventListener('orientationchange', handleOrientationChange)
      window.visualViewport?.removeEventListener('resize', handleViewportResize)
      window.visualViewport?.removeEventListener('scroll', handleViewportResize)
      document.removeEventListener('focusin', handleFocusIn)
    }
  }, [])

  useEffect(() => {
    // Intentionally empty — client-side blocking (right-click, DevTools,
    // copy/paste) was removed because it provides zero real security and
    // only degrades user experience.
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

      await useGuildStore.getState().fetchGuilds({ force: true }).catch(() => [])
      await useBotStore.getState().fetchStatus().catch(() => {})
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

        <Route path="/email-fast" element={
          <RequireToken><Layout /></RequireToken>
        }>
          <Route index element={<PageTransition><EmailFastPage /></PageTransition>} />
        </Route>

        <Route path="/dashboard" element={
          <RequireToken><Layout /></RequireToken>
        }>
          <Route index element={<DashboardHome />} />
          <Route path="servers" element={<PageTransition><ServersPage /></PageTransition>} />
          <Route path="servers/:guildId" element={<Navigate to="/dashboard/servers" replace />} />
          <Route path="protection" element={<PageTransition><ProtectionPage /></PageTransition>} />
          <Route path="playbooks" element={<PageTransition><PlaybooksPage /></PageTransition>} />
          <Route path="onboarding" element={<PageTransition><RolesOnboardingPage /></PageTransition>} />
          <Route path="search" element={<PageTransition><SearchPage /></PageTransition>} />
          <Route path="scan" element={<PageTransition><ScanPage /></PageTransition>} />
          <Route path="rassican" element={<Navigate to="/dashboard/scan" replace />} />
          <Route path="logs" element={<PageTransition><LogsPage /></PageTransition>} />
          <Route path="incidents" element={<PageTransition><IncidentsPage /></PageTransition>} />
          <Route path="moderation" element={<Navigate to="/dashboard/search" replace />} />
          <Route path="messages" element={<PageTransition><MessagesPage /></PageTransition>} />
          <Route path="dm-center" element={<PageTransition><DMCenterPage /></PageTransition>} />
          <Route path="notifications" element={<PageTransition><NotificationsPage /></PageTransition>} />
          <Route path="blocked" element={<PageTransition><AccessControlPage /></PageTransition>} />
          <Route path="commands" element={<PageTransition><CommandsPage /></PageTransition>} />
          <Route path="analytics" element={<PageTransition><AnalyticsPage /></PageTransition>} />
          <Route path="reviews" element={<PageTransition><ReviewsPage /></PageTransition>} />
          <Route path="support" element={<PageTransition><SupportPage /></PageTransition>} />
          <Route path="team" element={<PageTransition><TeamPage /></PageTransition>} />
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
