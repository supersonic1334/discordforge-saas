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
  const permissionStateRef = useRef('unknown')
  const baseValueRef = useRef('')
  const finalTranscriptRef = useRef('')
  const interimTranscriptRef = useRef('')
  const audioContextRef = useRef(null)
  const analyserRef = useRef(null)
  const sourceRef = useRef(null)
  const streamRef = useRef(null)
  const animationFrameRef = useRef(null)
  const [isListening, setIsListening] = useState(false)
  const [isRequestingPermission, setIsRequestingPermission] = useState(false)
  const [interimTranscript, setInterimTranscript] = useState('')
  const [audioBars, setAudioBars] = useState([0.12, 0.18, 0.14, 0.22, 0.16, 0.2, 0.13])

  const isSupported = useMemo(() => !!getRecognitionConstructor(), [])

  const stopAudioMeter = useCallback(() => {
    if (animationFrameRef.current) {
      window.cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }

    if (sourceRef.current) {
      sourceRef.current.disconnect()
      sourceRef.current = null
    }

    if (analyserRef.current) {
      analyserRef.current.disconnect?.()
      analyserRef.current = null
    }

    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {})
      audioContextRef.current = null
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }

    setAudioBars([0.12, 0.18, 0.14, 0.22, 0.16, 0.2, 0.13])
  }, [])

  const startAudioMeter = useCallback(async (stream) => {
    if (typeof window === 'undefined') return
    const AudioContextClass = window.AudioContext || window.webkitAudioContext
    if (!AudioContextClass || !stream) return

    stopAudioMeter()

    const context = new AudioContextClass()
    const analyser = context.createAnalyser()
    const source = context.createMediaStreamSource(stream)
    const dataArray = new Uint8Array(analyser.frequencyBinCount)

    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.82
    source.connect(analyser)

    audioContextRef.current = context
    analyserRef.current = analyser
    sourceRef.current = source
    streamRef.current = stream

    if (context.state === 'suspended') {
      await context.resume().catch(() => {})
    }

    const tick = () => {
      if (!analyserRef.current) return

      analyserRef.current.getByteFrequencyData(dataArray)
      const bucketSize = Math.max(1, Math.floor(dataArray.length / 7))
      const nextBars = Array.from({ length: 7 }, (_, index) => {
        const start = index * bucketSize
        const end = Math.min(dataArray.length, start + bucketSize)
        let sum = 0
        for (let cursor = start; cursor < end; cursor += 1) {
          sum += dataArray[cursor]
        }
        const average = end > start ? sum / (end - start) : 0
        return Math.max(0.08, Math.min(1, average / 180))
      })

      setAudioBars(nextBars)
      animationFrameRef.current = window.requestAnimationFrame(tick)
    }

    animationFrameRef.current = window.requestAnimationFrame(tick)
  }, [stopAudioMeter])

  const stop = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop()
      return
    }

    stopAudioMeter()
    setIsListening(false)
    setInterimTranscript('')
    interimTranscriptRef.current = ''
  }, [stopAudioMeter])

  const start = useCallback(async () => {
    const Recognition = getRecognitionConstructor()
    if (!Recognition) {
      onError?.('unsupported')
      return false
    }

    if (isListening || isRequestingPermission) return true

    setIsRequestingPermission(true)

    try {
      let stream = null
      if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        })
        permissionStateRef.current = 'granted'
        await startAudioMeter(stream)
      }

      const recognition = new Recognition()
      recognition.lang = normalizeLocale(locale)
      recognition.continuous = true
      recognition.interimResults = true
      recognition.maxAlternatives = 3

      baseValueRef.current = String(value || '').trim()
      finalTranscriptRef.current = ''
      interimTranscriptRef.current = ''
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

        interimTranscriptRef.current = nextInterim
        setInterimTranscript(nextInterim)
        onChange(mergeTranscript(baseValueRef.current, finalTranscriptRef.current, nextInterim))
      }

      recognition.onerror = (event) => {
        if (event?.error && event.error !== 'aborted') {
          if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
            permissionStateRef.current = 'denied'
          }
          onError?.(event.error)
        }
      }

      recognition.onend = () => {
        recognitionRef.current = null
        stopAudioMeter()
        setIsListening(false)
        const pendingInterim = interimTranscriptRef.current
        setInterimTranscript('')
        interimTranscriptRef.current = ''
        const committed = mergeTranscript(baseValueRef.current, finalTranscriptRef.current, pendingInterim)
        if (committed) {
          onChange(committed)
        }
      }

      recognitionRef.current = recognition
      recognition.start()
      setIsListening(true)
      return true
    } catch (error) {
      stopAudioMeter()
      if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
        permissionStateRef.current = 'denied'
        onError?.('not-allowed')
      } else if (error?.name === 'NotFoundError') {
        onError?.('not-found')
      } else if (error?.name === 'AbortError') {
        onError?.('aborted')
      } else {
        onError?.(error?.name || 'permission-error')
      }
      return false
    } finally {
      setIsRequestingPermission(false)
    }
  }, [isListening, isRequestingPermission, locale, onChange, onError, startAudioMeter, stopAudioMeter, value])

  useEffect(() => () => {
    if (recognitionRef.current) {
      recognitionRef.current.onend = null
      recognitionRef.current.abort()
      recognitionRef.current = null
    }
    stopAudioMeter()
  }, [stopAudioMeter])

  return {
    isSupported,
    isListening,
    isRequestingPermission,
    interimTranscript,
    audioBars,
    start,
    stop,
  }
}

export default useSpeechToText
