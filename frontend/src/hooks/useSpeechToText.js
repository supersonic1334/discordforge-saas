import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

function getRecognitionConstructor() {
  if (typeof window === 'undefined') return null
  return window.SpeechRecognition || window.webkitSpeechRecognition || null
}

function normalizeLocale(locale) {
  const key = String(locale || 'fr').toLowerCase()
  if (key.startsWith('fr')) return 'fr-FR'
  if (key.startsWith('es')) return 'es-ES'
  if (key.startsWith('en')) return 'en-US'
  return locale || 'fr-FR'
}

function mergeTranscript(...parts) {
  return parts
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function useSpeechToText({ value, onChange, locale, onError }) {
  const recognitionRef = useRef(null)
  const baseValueRef = useRef('')
  const finalTranscriptRef = useRef('')
  const [isListening, setIsListening] = useState(false)
  const [interimTranscript, setInterimTranscript] = useState('')

  const isSupported = useMemo(() => !!getRecognitionConstructor(), [])

  const stop = useCallback(() => {
    if (!recognitionRef.current) return
    recognitionRef.current.stop()
  }, [])

  const start = useCallback(() => {
    const Recognition = getRecognitionConstructor()
    if (!Recognition) {
      onError?.('unsupported')
      return false
    }

    if (isListening) return true

    const recognition = new Recognition()
    recognition.lang = normalizeLocale(locale)
    recognition.continuous = true
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    baseValueRef.current = String(value || '').trim()
    finalTranscriptRef.current = ''
    setInterimTranscript('')

    recognition.onresult = (event) => {
      let nextFinal = ''
      let nextInterim = ''

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const chunk = String(event.results[index]?.[0]?.transcript || '').trim()
        if (!chunk) continue

        if (event.results[index].isFinal) {
          nextFinal = mergeTranscript(nextFinal, chunk)
        } else {
          nextInterim = mergeTranscript(nextInterim, chunk)
        }
      }

      if (nextFinal) {
        finalTranscriptRef.current = mergeTranscript(finalTranscriptRef.current, nextFinal)
      }

      setInterimTranscript(nextInterim)
      onChange(mergeTranscript(baseValueRef.current, finalTranscriptRef.current, nextInterim))
    }

    recognition.onerror = (event) => {
      if (event?.error && event.error !== 'aborted') {
        onError?.(event.error)
      }
    }

    recognition.onend = () => {
      recognitionRef.current = null
      setIsListening(false)
      setInterimTranscript('')
      const committed = mergeTranscript(baseValueRef.current, finalTranscriptRef.current)
      if (committed) {
        onChange(committed)
      }
    }

    recognitionRef.current = recognition
    recognition.start()
    setIsListening(true)
    return true
  }, [isListening, locale, onChange, onError, value])

  useEffect(() => () => {
    if (recognitionRef.current) {
      recognitionRef.current.onend = null
      recognitionRef.current.abort()
      recognitionRef.current = null
    }
  }, [])

  return {
    isSupported,
    isListening,
    interimTranscript,
    start,
    stop,
  }
}

export default useSpeechToText
