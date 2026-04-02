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

const IDLE_BARS = [0.18, 0.26, 0.22, 0.34, 0.28, 0.24, 0.3, 0.22, 0.16]

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
  const stopModeRef = useRef('commit')
  const stopResolverRef = useRef(null)
  const [isListening, setIsListening] = useState(false)
  const [isRequestingPermission, setIsRequestingPermission] = useState(false)
  const [interimTranscript, setInterimTranscript] = useState('')
  const [audioBars, setAudioBars] = useState(IDLE_BARS)

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

    setAudioBars(IDLE_BARS)
  }, [])

  const resolveStopPromise = useCallback((valueToResolve) => {
    if (stopResolverRef.current) {
      stopResolverRef.current(valueToResolve)
      stopResolverRef.current = null
    }
  }, [])

  const finalizeRecognition = useCallback((mode = 'commit') => {
    stopAudioMeter()
    setIsListening(false)

    const baseValue = String(baseValueRef.current || '').trim()
    const nextValue = mode === 'commit'
      ? mergeTranscript(baseValue, finalTranscriptRef.current, interimTranscriptRef.current)
      : baseValue

    finalTranscriptRef.current = ''
    interimTranscriptRef.current = ''
    setInterimTranscript('')
    onChange(nextValue)
    resolveStopPromise(nextValue)
    return nextValue
  }, [onChange, resolveStopPromise, stopAudioMeter])

  const startAudioMeter = useCallback(async (stream) => {
    if (typeof window === 'undefined') return
    const AudioContextClass = window.AudioContext || window.webkitAudioContext
    if (!AudioContextClass || !stream) return

    stopAudioMeter()

    const context = new AudioContextClass()
    const analyser = context.createAnalyser()
    const source = context.createMediaStreamSource(stream)
    const frequencyData = new Uint8Array(256)
    const timeDomainData = new Uint8Array(512)

    analyser.fftSize = 512
    analyser.smoothingTimeConstant = 0.64
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

      analyserRef.current.getByteFrequencyData(frequencyData)
      analyserRef.current.getByteTimeDomainData(timeDomainData)

      let rmsSum = 0
      for (let index = 0; index < timeDomainData.length; index += 1) {
        const sample = (timeDomainData[index] - 128) / 128
        rmsSum += sample * sample
      }

      const rms = Math.sqrt(rmsSum / timeDomainData.length)
      const bucketSize = Math.max(1, Math.floor(frequencyData.length / IDLE_BARS.length))
      const nextBars = Array.from({ length: IDLE_BARS.length }, (_, index) => {
        const start = index * bucketSize
        const end = Math.min(frequencyData.length, start + bucketSize)
        let peak = 0
        let sum = 0

        for (let cursor = start; cursor < end; cursor += 1) {
          const valueAtCursor = frequencyData[cursor]
          sum += valueAtCursor
          if (valueAtCursor > peak) peak = valueAtCursor
        }

        const average = end > start ? sum / (end - start) : 0
        const normalized = Math.min(1.1, (average / 95) + (peak / 255) * 0.38 + rms * 3.2)
        return Math.max(0.12, normalized)
      })

      setAudioBars(nextBars)
      animationFrameRef.current = window.requestAnimationFrame(tick)
    }

    animationFrameRef.current = window.requestAnimationFrame(tick)
  }, [stopAudioMeter])

  const stop = useCallback(() => {
    stopModeRef.current = 'commit'

    if (recognitionRef.current) {
      return new Promise((resolve) => {
        stopResolverRef.current = resolve
        recognitionRef.current.stop()
      })
    }

    const committed = mergeTranscript(baseValueRef.current, finalTranscriptRef.current, interimTranscriptRef.current)
    finalTranscriptRef.current = ''
    interimTranscriptRef.current = ''
    setInterimTranscript('')
    onChange(committed)
    stopAudioMeter()
    setIsListening(false)
    return Promise.resolve(committed)
  }, [onChange, stopAudioMeter])

  const cancel = useCallback(() => {
    stopModeRef.current = 'cancel'

    if (recognitionRef.current) {
      return new Promise((resolve) => {
        stopResolverRef.current = resolve
        recognitionRef.current.abort()
      })
    }

    const baseValue = String(baseValueRef.current || '').trim()
    finalTranscriptRef.current = ''
    interimTranscriptRef.current = ''
    setInterimTranscript('')
    onChange(baseValue)
    stopAudioMeter()
    setIsListening(false)
    return Promise.resolve(baseValue)
  }, [onChange, stopAudioMeter])

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
      recognition.maxAlternatives = 5

      baseValueRef.current = String(value || '').trim()
      finalTranscriptRef.current = ''
      interimTranscriptRef.current = ''
      stopModeRef.current = 'commit'
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
        finalizeRecognition(stopModeRef.current)
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
  }, [finalizeRecognition, isListening, isRequestingPermission, locale, onChange, onError, startAudioMeter, stopAudioMeter, value])

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
    cancel,
  }
}

export default useSpeechToText
