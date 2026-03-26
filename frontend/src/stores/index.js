import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { authAPI, botAPI } from '../services/api'
import { wsService } from '../services/websocket'

const NO_SELECTED_GUILD = '__none__'
let fetchMePromise = null
let guildsRequestPromise = null
let lastGuildFetchAt = 0

// Helper to extract the most useful error message from any error shape
function extractError(err) {
  // Backend validation errors: { error: "Validation failed", errors: [{field, message}] }
  if (err?.response?.data?.errors?.length) {
    return err.response.data.errors.map(e => e.message).join(' · ')
  }
  // Backend simple error: { error: "Email already in use" }
  if (err?.response?.data?.error) {
    return err.response.data.error
  }
  // Network error (backend not running, CORS, etc.)
  if (err?.code === 'ERR_NETWORK' || !err?.response) {
    return 'Impossible de joindre le serveur. Vérifiez que le backend tourne sur le port 4000.'
  }
  // Axios message or plain message
  return err?.message || 'Une erreur inattendue est survenue'
}

function getGuildSelectionOwner() {
  const user = useAuthStore.getState().user
  return user?.id ? String(user.id) : null
}

function resolveSelectedGuildId(guilds = [], preferredGuildId = null, fallbackGuildId = null) {
  if (preferredGuildId === NO_SELECTED_GUILD) return null
  if (fallbackGuildId === NO_SELECTED_GUILD) return null
  if (!Array.isArray(guilds) || guilds.length === 0) return null
  if (preferredGuildId && guilds.some((guild) => guild.id === preferredGuildId)) return preferredGuildId
  if (fallbackGuildId && guilds.some((guild) => guild.id === fallbackGuildId)) return fallbackGuildId
  if (guilds.length === 1) return guilds[0].id
  return null
}

function sanitizePersistedUser(user) {
  if (!user) return user
  if (typeof user.avatar_url === 'string' && user.avatar_url.startsWith('data:image/')) {
    return { ...user, avatar_url: null }
  }
  return user
}

export const useAuthStore = create(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      hasBotToken: false,
      hasOwnBotToken: false,
      accessibleGuildCount: 0,
      sharedGuildCount: 0,
      botStatus: null,
      isLoading: false,

      setToken: (token) => {
        set({ token })
        if (token) localStorage.setItem('token', token)
        else {
          localStorage.removeItem('token')
          wsService.disconnect()
        }
      },

      setUser: (user) => set({ user }),

      login: async (data) => {
        set({ isLoading: true })
        try {
          const res = await authAPI.login(data)
          const { token, user } = res.data
          localStorage.setItem('token', token)
          set({ token, user, isLoading: false })
          await get().fetchMe()
          return { success: true }
        } catch (err) {
          set({ isLoading: false })
          return { success: false, error: extractError(err) }
        }
      },

      register: async (data) => {
        set({ isLoading: true })
        try {
          const res = await authAPI.register(data)
          const { token, user } = res.data
          localStorage.setItem('token', token)
          set({ token, user, hasBotToken: false, isLoading: false })
          return { success: true }
        } catch (err) {
          set({ isLoading: false })
          return { success: false, error: extractError(err) }
        }
      },

      fetchMe: async () => {
        if (fetchMePromise) return fetchMePromise

        fetchMePromise = (async () => {
          try {
            const res = await authAPI.me()
            const { user, hasBotToken, hasOwnBotToken, accessibleGuildCount, sharedGuildCount, botStatus } = res.data
            set({
              user,
              hasBotToken: !!hasBotToken,
              hasOwnBotToken: !!hasOwnBotToken,
              accessibleGuildCount: Number(accessibleGuildCount || 0),
              sharedGuildCount: Number(sharedGuildCount || 0),
              botStatus,
            })
            return true
          } catch {
            return false
          } finally {
            fetchMePromise = null
          }
        })()

        return fetchMePromise
      },

      logout: () => {
        localStorage.removeItem('token')
        wsService.disconnect()
        useGuildStore.getState().resetSession()
        set({
          token: null,
          user: null,
          hasBotToken: false,
          hasOwnBotToken: false,
          accessibleGuildCount: 0,
          sharedGuildCount: 0,
          botStatus: null,
        })
      },

      updateBotStatus: (status) => set((s) => ({ botStatus: { ...s.botStatus, status } })),
    }),
    {
      name: 'auth-store',
      partialize: (s) => ({
        token: s.token,
        user: sanitizePersistedUser(s.user),
        hasBotToken: s.hasBotToken,
        hasOwnBotToken: s.hasOwnBotToken,
        accessibleGuildCount: s.accessibleGuildCount,
        sharedGuildCount: s.sharedGuildCount,
      }),
    }
  )
)

export const useGuildStore = create(
  persist(
    (set, get) => ({
      guilds: [],
      selectedGuildId: null,
      selectedGuildByUser: {},
      isLoading: false,

      applyGuilds: (guilds = []) => set((state) => {
        const owner = getGuildSelectionOwner()
        const ownerSelection = owner ? state.selectedGuildByUser[owner] : null
        const nextSelectedGuildId = resolveSelectedGuildId(guilds, ownerSelection, state.selectedGuildId)

        return {
          guilds,
          selectedGuildId: nextSelectedGuildId,
          isLoading: false,
          selectedGuildByUser: owner
            ? { ...state.selectedGuildByUser, [owner]: nextSelectedGuildId }
            : state.selectedGuildByUser,
        }
      }),

      hydrateSelectedGuild: () => set((state) => {
        const owner = getGuildSelectionOwner()
        const ownerSelection = owner ? state.selectedGuildByUser[owner] : null

        return {
          selectedGuildId: resolveSelectedGuildId(state.guilds, ownerSelection, null),
        }
      }),

      fetchGuilds: async () => {
        if (guildsRequestPromise) return guildsRequestPromise
        if (get().guilds.length > 0 && Date.now() - lastGuildFetchAt < 1500) return get().guilds

        set({ isLoading: true })

        guildsRequestPromise = (async () => {
          try {
            const res = await botAPI.guilds()
            const guilds = res.data.guilds || []
            if (guilds.length > 0) {
              lastGuildFetchAt = Date.now()
              get().applyGuilds(guilds)
              return guilds
            }

            if (!useAuthStore.getState().hasOwnBotToken) {
              lastGuildFetchAt = Date.now()
              get().applyGuilds(guilds)
              return guilds
            }

            try {
              const syncRes = await botAPI.syncGuilds()
              const syncedGuilds = syncRes.data.guilds || []
              lastGuildFetchAt = Date.now()
              get().applyGuilds(syncedGuilds)
              return syncedGuilds
            } catch {
              lastGuildFetchAt = Date.now()
              get().applyGuilds(guilds)
              return guilds
            }
          } catch {
            set({ isLoading: false })
            return []
          } finally {
            guildsRequestPromise = null
          }
        })()

        return guildsRequestPromise
      },

      syncGuilds: async () => {
        if (guildsRequestPromise) return guildsRequestPromise

        set({ isLoading: true })

        guildsRequestPromise = (async () => {
          try {
            const res = await botAPI.syncGuilds()
            const guilds = res.data.guilds || []
            lastGuildFetchAt = Date.now()
            get().applyGuilds(guilds)
            return guilds
          } catch {
            set({ isLoading: false })
            return []
          } finally {
            guildsRequestPromise = null
          }
        })()

        return guildsRequestPromise
      },

      selectGuild: (guildId) => set((state) => {
        const owner = getGuildSelectionOwner()
        return {
          selectedGuildId: guildId,
          selectedGuildByUser: owner
            ? { ...state.selectedGuildByUser, [owner]: guildId || null }
            : state.selectedGuildByUser,
        }
      }),

      clearSelectedGuild: () => set((state) => {
        const owner = getGuildSelectionOwner()
        return {
          selectedGuildId: null,
          selectedGuildByUser: owner
            ? { ...state.selectedGuildByUser, [owner]: NO_SELECTED_GUILD }
            : state.selectedGuildByUser,
        }
      }),

      selectedGuild: () => get().guilds.find((guild) => guild.id === get().selectedGuildId) ?? null,

      removeGuild: (guildId) => set((state) => {
        const guilds = state.guilds.filter((guild) => guild.id !== guildId)
        const owner = getGuildSelectionOwner()
        const nextSelectedGuildId = state.selectedGuildId === guildId
          ? resolveSelectedGuildId(guilds, null, null)
          : state.selectedGuildId

        return {
          guilds,
          selectedGuildId: nextSelectedGuildId,
          selectedGuildByUser: owner
            ? { ...state.selectedGuildByUser, [owner]: nextSelectedGuildId }
            : state.selectedGuildByUser,
        }
      }),

      resetSession: () => set({ guilds: [], selectedGuildId: null, isLoading: false }),
    }),
    {
      name: 'guild-store',
      partialize: (state) => ({
        selectedGuildId: state.selectedGuildId,
        selectedGuildByUser: state.selectedGuildByUser,
      }),
    }
  )
)

export const useBotStore = create((set) => ({
  status: 'stopped',
  ping: -1,
  guildCount: 0,
  startedAt: null,
  restartCount: 0,
  lastError: null,
  bot: null,

  setStatus: (data) => set(data),
  fetchStatus: async () => {
    try { const res = await botAPI.status(); set(res.data) } catch { /* no token */ }
  },
}))

export const useUIStore = create((set) => ({
  sidebarCollapsed: false,
  toggleSidebar: () => set(s => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  activeModal: null,
  openModal: (name, data = {}) => set({ activeModal: { name, data } }),
  closeModal: () => set({ activeModal: null }),
}))
