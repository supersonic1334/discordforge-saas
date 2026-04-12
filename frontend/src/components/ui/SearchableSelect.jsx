import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, Search, X } from 'lucide-react'

export default function SearchableSelect({
  label = 'Selection',
  value = '',
  onChange,
  options = [],
  disabled = false,
  loading = false,
  placeholder = 'Selectionner',
  emptyLabel = 'Aucune option disponible',
  emptySearchLabel = 'Aucun resultat',
  renderValue,
  renderOption,
  getOptionKey = (option) => option?.id ?? option?.value ?? String(option),
  getOptionLabel = (option) => option?.label ?? option?.name ?? String(option),
  countSuffix = 'elements',
  showCount = true,
  compact = false,
  buttonClassName = '',
  panelClassName = '',
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef(null)
  const buttonRef = useRef(null)
  const panelRef = useRef(null)
  const searchInputRef = useRef(null)
  const [panelStyle, setPanelStyle] = useState(null)

  const selectedOption = useMemo(
    () => options.find((option) => String(getOptionKey(option)) === String(value)) || null,
    [getOptionKey, options, value]
  )

  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) return options

    return options.filter((option) => (
      String(getOptionLabel(option) || '')
        .toLowerCase()
        .includes(normalizedQuery)
    ))
  }, [getOptionLabel, options, query])

  useEffect(() => {
    if (!open) return undefined

    const handlePointerDown = (event) => {
      if (rootRef.current?.contains(event.target)) return
      if (panelRef.current?.contains(event.target)) return
      setOpen(false)
    }

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  useEffect(() => {
    if (!open) {
      setQuery('')
      setPanelStyle(null)
      return
    }

    const timerId = window.setTimeout(() => {
      searchInputRef.current?.focus()
    }, 40)

    return () => window.clearTimeout(timerId)
  }, [open])

  useEffect(() => {
    if (!open) return undefined

    const updatePosition = () => {
      const anchor = buttonRef.current || rootRef.current
      if (!anchor) return

      const rect = anchor.getBoundingClientRect()
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      const desiredWidth = Math.max(rect.width, compact ? 220 : 260)
      const maxWidth = Math.min(desiredWidth, viewportWidth - 16)
      const estimatedHeight = Math.min(compact ? 320 : 380, viewportHeight - 24)
      const canOpenDown = rect.bottom + 10 + estimatedHeight <= viewportHeight - 8
      const canOpenUp = rect.top - 10 - estimatedHeight >= 8
      const top = canOpenDown || !canOpenUp
        ? Math.min(rect.bottom + 10, viewportHeight - estimatedHeight - 8)
        : Math.max(8, rect.top - estimatedHeight - 10)
      const left = Math.min(Math.max(8, rect.left), viewportWidth - maxWidth - 8)

      setPanelStyle({
        position: 'fixed',
        top,
        left,
        width: maxWidth,
      })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)

    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [compact, open])

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          if (disabled) return
          setOpen((current) => !current)
        }}
        disabled={disabled}
        className={`group flex w-full items-center justify-between gap-3 border border-white/[0.08] bg-slate-950/60 text-left text-white outline-none transition-colors hover:border-neon-cyan/24 focus-visible:border-neon-cyan/30 disabled:cursor-not-allowed disabled:opacity-45 ${compact ? 'rounded-xl px-3 py-2.5' : 'rounded-2xl px-4 py-3'} ${buttonClassName}`}
      >
        <span className="min-w-0 flex-1">
          {!compact && (
            <span className="block text-[11px] font-mono uppercase tracking-[0.22em] text-white/28">
              {loading ? 'Chargement' : label}
            </span>
          )}
          <span className={`block truncate font-display font-700 text-white ${compact ? 'text-sm' : 'mt-1 text-base'}`}>
            {selectedOption
              ? (renderValue ? renderValue(selectedOption) : getOptionLabel(selectedOption))
              : (loading ? 'Chargement...' : placeholder)}
          </span>
        </span>
        <span className="flex items-center gap-3">
          {showCount && options.length > 0 && (
            <span className="hidden rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-[11px] font-mono text-white/42 sm:inline-flex">
              {options.length} {countSuffix}
            </span>
          )}
          <ChevronDown className={`shrink-0 text-white/55 transition-transform duration-200 ${compact ? 'h-4 w-4' : 'h-4.5 w-4.5'} ${open ? 'rotate-180 text-neon-cyan' : ''}`} />
        </span>
      </button>

      <AnimatePresence>
        {open && !disabled && panelStyle && createPortal(
          <motion.div
            ref={panelRef}
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.985 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            style={panelStyle}
            className={`z-[240] overflow-hidden border border-white/[0.08] bg-[linear-gradient(180deg,rgba(8,12,24,0.98),rgba(5,9,19,0.99))] p-2 shadow-[0_28px_80px_rgba(0,0,0,0.46),0_0_0_1px_rgba(255,255,255,0.02)] backdrop-blur-2xl ${compact ? 'rounded-2xl' : 'rounded-[24px]'} ${panelClassName}`}
          >
            <div className="mb-2 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-3 py-2.5">
              <div className="flex items-center gap-2">
                <Search className="h-4 w-4 shrink-0 text-white/35" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Rechercher..."
                  className="w-full border-0 bg-transparent text-sm text-white outline-none ring-0 focus:border-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 placeholder:text-white/24"
                />
                {query ? (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    className="flex h-6 w-6 items-center justify-center rounded-full text-white/35 transition-colors hover:bg-white/[0.06] hover:text-white/70"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
            </div>

            <div className="max-h-[min(18rem,calc(100vh-12rem))] space-y-1 overflow-y-auto pr-1 scrollbar-none">
              {filteredOptions.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] px-4 py-6 text-center text-sm text-white/42">
                  {query ? emptySearchLabel : emptyLabel}
                </div>
              ) : (
                filteredOptions.map((option, index) => {
                  const optionKey = String(getOptionKey(option))
                  const active = optionKey === String(value)

                  return (
                    <motion.button
                      key={optionKey}
                      type="button"
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.012, duration: 0.14 }}
                      onClick={() => {
                        onChange?.(option)
                        setOpen(false)
                      }}
                      className={`group flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-all duration-150 ${
                        active
                          ? 'border border-neon-cyan/20 bg-[linear-gradient(90deg,rgba(34,211,238,0.12),rgba(168,85,247,0.08))] shadow-[0_12px_32px_rgba(0,229,255,0.08)]'
                          : 'border border-transparent bg-white/[0.02] hover:border-white/[0.08] hover:bg-white/[0.04]'
                      }`}
                    >
                      {renderOption ? renderOption(option, active) : (
                        <span className={`block truncate font-display text-sm font-700 ${active ? 'text-white' : 'text-white/82'}`}>
                          {getOptionLabel(option)}
                        </span>
                      )}
                    </motion.button>
                  )
                })
              )}
            </div>
          </motion.div>,
          document.body
        )}
      </AnimatePresence>
    </div>
  )
}
