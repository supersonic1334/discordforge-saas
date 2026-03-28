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
const RESTARTABLE_ERRORS = new Set(['no-speech', 'audio-capture'])

export function useSpeechToText({ value, onChange, locale, onError }) {
  const recognitionRef = useRef(null)
  const baseValueRef = useRef('')
  const finalTranscriptRef = useRef('')
  const interimTranscriptRef = useRef('')
  const audioContextRef = useRef(null)
  const analyserRef = useRef(null)
  const sourceRef = useRef(null)
  const streamRef = useRef(null)
  const animationFrameRef = useRef(null)
  const stopResolverRef = useRef(null)
  const stopTimeoutRef = useRef(null)
  const restartTimeoutRef = useRef(null)
  const sessionModeRef = useRef('idle')
  const shouldResumeRef = useRef(false)
  const lastSpeechErrorRef = useRef(null)
  const mountedRef = useRef(true)
  const [isListening, setIsListening] = useState(false)
  const [isRequestingPermission, setIsRequestingPermission] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [finalTranscript, setFinalTranscript] = useState('')
  const [interimTranscript, setInterimTranscript] = useState('')
  const [audioBars, setAudioBars] = useState(IDLE_BARS)

  const isSupported = useMemo(() => !!getRecognitionConstructor(), [])

  const clearStopTimeout = useCallback(() => {
    if (stopTimeoutRef.current) {
      window.clearTimeout(stopTimeoutRef.current)
      stopTimeoutRef.current = null
    }
  }, [])

  const clearRestartTimeout = useCallback(() => {
    if (restartTimeoutRef.current) {
      window.clearTimeout(restartTimeoutRef.current)
      restartTimeoutRef.current = null
    }
  }, [])

  const resolveStopPromise = useCallback((valueToResolve) => {
    if (stopResolverRef.current) {
      stopResolverRef.current(valueToResolve)
      stopResolverRef.current = null
    }
  }, [])

  const stopAudioMeter = useCallback(() => {
    if (typeof window !== 'undefined' && animationFrameRef.current) {
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

  const startAudioMeter = useCallback(async (stream) => {
    if (typeof window === 'undefined' || !stream) return
    const AudioContextClass = window.AudioContext || window.webkitAudioContext
    if (!AudioContextClass) return

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
      if (!analyserRef.current || !mountedRef.current) return

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
        const normalized = Math.min(1.18, (average / 92) + (peak / 255) * 0.44 + rms * 3.6)
        return Math.max(0.12, normalized)
      })

      setAudioBars(nextBars)
      animationFrameRef.current = window.requestAnimationFrame(tick)
    }

    animationFrameRef.current = window.requestAnimationFrame(tick)
  }, [stopAudioMeter])

  const finalizeRecognition = useCallback((mode = 'commit') => {
    clearStopTimeout()
    clearRestartTimeout()
    shouldResumeRef.current = false
    sessionModeRef.current = 'idle'
    lastSpeechErrorRef.current = null
    stopAudioMeter()
    setIsListening(false)
    setIsRequestingPermission(false)
    setIsProcessing(false)

    const baseValue = String(baseValueRef.current || '')
    const nextValue = mode === 'commit'
      ? mergeTranscript(baseValue, finalTranscriptRef.current, interimTranscriptRef.current)
      : baseValue

    finalTranscriptRef.current = ''
    interimTranscriptRef.current = ''
    setFinalTranscript('')
    setInterimTranscript('')
    onChange(nextValue)
    resolveStopPromise(nextValue)
    return nextValue
  }, [clearRestartTimeout, clearStopTimeout, onChange, resolveStopPromise, stopAudioMeter])

  const scheduleForcedFinalize = useCallback((mode) => {
    clearStopTimeout()
    stopTimeoutRef.current = window.setTimeout(() => {
      if (!recognitionRef.current) return
      recognitionRef.current.onend = null
      recognitionRef.current = null
      finalizeRecognition(mode)
    }, 900)
  }, [clearStopTimeout, finalizeRecognition])

  const createRecognition = useCallback(() => {
    const Recognition = getRecognitionConstructor()
    if (!Recognition) return null

    const recognition = new Recognition()
    recognition.lang = normalizeLocale(locale)
    recognition.continuous = true
    recognition.interimResults = true
    recognition.maxAlternatives = 5

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
        setFinalTranscript(finalTranscriptRef.current)
      }

      interimTranscriptRef.current = nextInterim
      setInterimTranscript(nextInterim)
      lastSpeechErrorRef.current = null
      onChange(mergeTranscript(baseValueRef.current, finalTranscriptRef.current, nextInterim))
    }

    recognition.onerror = (event) => {
      const code = event?.error || 'speech-error'
      lastSpeechErrorRef.current = code

      if (code === 'aborted') return

      if (code === 'not-allowed' || code === 'service-not-allowed') {
        shouldResumeRef.current = false
        sessionModeRef.current = 'cancel'
        onError?.(code)
        return
      }

      if (!RESTARTABLE_ERRORS.has(code)) {
        onError?.(code)
      }
    }

    recognition.onend = () => {
      clearStopTimeout()
      recognitionRef.current = null

      if (shouldResumeRef.current && sessionModeRef.current === 'listening') {
        clearRestartTimeout()
        restartTimeoutRef.current = window.setTimeout(() => {
          if (!shouldResumeRef.current || sessionModeRef.current !== 'listening' || !mountedRef.current) return
          try {
            const nextRecognition = createRecognition()
            if (!nextRecognition) {
              finalizeRecognition('commit')
              return
            }
            recognitionRef.current = nextRecognition
            nextRecognition.start()
            setIsListening(true)
            setIsProcessing(false)
          } catch (error) {
            shouldResumeRef.current = false
            onError?.(lastSpeechErrorRef.current || error?.name || 'speech-restart-error')
            finalizeRecognition('commit')
          }
        }, 120)
        return
      }

      finalizeRecognition(sessionModeRef.current === 'cancel' ? 'cancel' : 'commit')
    }

    return recognition
  }, [clearRestartTimeout, clearStopTimeout, finalizeRecognition, locale, onChange, onError])

  const start = useCallback(async () => {
    const Recognition = getRecognitionConstructor()
    if (!Recognition) {
      onError?.('unsupported')
      return false
    }

    if (isListening || isRequestingPermission || isProcessing || recognitionRef.current) return true

    clearRestartTimeout()
    clearStopTimeout()
    setIsRequestingPermission(true)
    setIsProcessing(false)
    shouldResumeRef.current = true
    sessionModeRef.current = 'listening'
    lastSpeechErrorRef.current = null

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
        await startAudioMeter(stream)
      }

      baseValueRef.current = String(value || '')
      finalTranscriptRef.current = ''
      interimTranscriptRef.current = ''
      setFinalTranscript('')
      setInterimTranscript('')

      const recognition = createRecognition()
      if (!recognition) {
        onError?.('unsupported')
        return false
      }

      recognitionRef.current = recognition
      recognition.start()
      setIsListening(true)
      return true
    } catch (error) {
      shouldResumeRef.current = false
      sessionModeRef.current = 'idle'
      setIsListening(false)
      setIsProcessing(false)
      stopAudioMeter()

      if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
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
      if (mountedRef.current) {
        setIsRequestingPermission(false)
      }
    }
  }, [clearRestartTimeout, clearStopTimeout, createRecognition, isListening, isProcessing, isRequestingPermission, onError, startAudioMeter, stopAudioMeter, value])

  const stop = useCallback(() => {
    shouldResumeRef.current = false
    sessionModeRef.current = 'commit'
    clearRestartTimeout()

    if (recognitionRef.current) {
      setIsProcessing(true)
      return new Promise((resolve) => {
        stopResolverRef.current = resolve
        scheduleForcedFinalize('commit')
        recognitionRef.current.stop()
      })
    }

    return Promise.resolve(finalizeRecognition('commit'))
  }, [clearRestartTimeout, finalizeRecognition, scheduleForcedFinalize])

  const cancel = useCallback(() => {
    shouldResumeRef.current = false
    sessionModeRef.current = 'cancel'
    clearRestartTimeout()

    if (recognitionRef.current) {
      setIsProcessing(true)
      return new Promise((resolve) => {
        stopResolverRef.current = resolve
        scheduleForcedFinalize('cancel')
        recognitionRef.current.abort()
      })
    }

    return Promise.resolve(finalizeRecognition('cancel'))
  }, [clearRestartTimeout, finalizeRecognition, scheduleForcedFinalize])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearStopTimeout()
      clearRestartTimeout()
      if (recognitionRef.current) {
        recognitionRef.current.onend = null
        recognitionRef.current.abort()
        recognitionRef.current = null
      }
      stopAudioMeter()
    }
  }, [clearRestartTimeout, clearStopTimeout, stopAudioMeter])

  const liveTranscript = mergeTranscript(finalTranscript, interimTranscript)
  const phase = isRequestingPermission || isProcessing
    ? 'processing'
    : isListening
      ? 'listening'
      : 'idle'

  return {
    isSupported,
    isListening,
    isRequestingPermission,
    isProcessing,
    phase,
    hasTranscript: !!liveTranscript.trim(),
    liveTranscript,
    interimTranscript,
    audioBars,
    start,
    stop,
    cancel,
  }
}

export default useSpeechToText
