import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { aiAPI } from '../services/api'

const IDLE_BARS = [0.16, 0.24, 0.2, 0.3, 0.22, 0.28, 0.18, 0.24]
const RESTARTABLE_ERRORS = new Set(['no-speech', 'audio-capture'])
const ERROR_COOLDOWN_MS = 1800

function getRecognitionConstructor() {
  if (typeof window === 'undefined') return null
  return window.SpeechRecognition || window.webkitSpeechRecognition || null
}

function normalizeLocale(locale) {
  const key = String(locale || 'fr').toLowerCase()
  if (key.startsWith('fr')) return 'fr-FR'
  if (key.startsWith('es')) return 'es-ES'
  if (key.startsWith('en')) return 'en-US'
  return 'fr-FR'
}

function getRecordingLabel(locale) {
  const key = String(locale || 'fr').toLowerCase()
  if (key.startsWith('en')) return 'Recording in progress...'
  if (key.startsWith('es')) return 'Grabacion en curso...'
  return 'Enregistrement en cours...'
}

function mergeTranscript(...parts) {
  return parts
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function detectSpeechEngine() {
  if (typeof window === 'undefined') return 'unsupported'

  const recognition = getRecognitionConstructor()
  const hasRecorder = Boolean(window.MediaRecorder && navigator?.mediaDevices?.getUserMedia)
  if (recognition) return 'native'
  if (hasRecorder) return 'server'
  return 'unsupported'
}

function getPreferredMimeType() {
  if (typeof window === 'undefined' || !window.MediaRecorder?.isTypeSupported) return 'audio/webm'
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ]
  return candidates.find((candidate) => window.MediaRecorder.isTypeSupported(candidate)) || 'audio/webm'
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const result = String(reader.result || '')
      const [, base64 = ''] = result.split(',')
      resolve(base64)
    }
    reader.onerror = () => reject(new Error('audio_read_failed'))
    reader.readAsDataURL(blob)
  })
}

export function useSpeechToText({ value, onChange, locale, onError }) {
  const recognitionRef = useRef(null)
  const mediaRecorderRef = useRef(null)
  const recorderMimeTypeRef = useRef('audio/webm')
  const recordedChunksRef = useRef([])
  const restartTimeoutRef = useRef(null)
  const stopResolverRef = useRef(null)
  const animationFrameRef = useRef(null)
  const audioContextRef = useRef(null)
  const analyserRef = useRef(null)
  const sourceRef = useRef(null)
  const streamRef = useRef(null)
  const mountedRef = useRef(true)
  const shouldResumeRef = useRef(false)
  const baseValueRef = useRef('')
  const finalTranscriptRef = useRef('')
  const interimTranscriptRef = useRef('')
  const activeEngineRef = useRef('unsupported')
  const lastErrorRef = useRef({ code: '', at: 0 })

  const [isListening, setIsListening] = useState(false)
  const [isRequestingPermission, setIsRequestingPermission] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [finalTranscript, setFinalTranscript] = useState('')
  const [interimTranscript, setInterimTranscript] = useState('')
  const [audioBars, setAudioBars] = useState(IDLE_BARS)
  const [engine, setEngine] = useState(() => detectSpeechEngine())

  const isSupported = useMemo(() => engine !== 'unsupported', [engine])

  const emitError = useCallback((code) => {
    const normalizedCode = String(code || 'speech-error')
    const now = Date.now()
    if (
      lastErrorRef.current.code === normalizedCode
      && now - lastErrorRef.current.at < ERROR_COOLDOWN_MS
    ) {
      return
    }

    lastErrorRef.current = { code: normalizedCode, at: now }
    onError?.(normalizedCode)
  }, [onError])

  const clearRestartTimeout = useCallback(() => {
    if (restartTimeoutRef.current) {
      window.clearTimeout(restartTimeoutRef.current)
      restartTimeoutRef.current = null
    }
  }, [])

  const resolveStop = useCallback((nextValue) => {
    if (stopResolverRef.current) {
      stopResolverRef.current(nextValue)
      stopResolverRef.current = null
    }
  }, [])

  const stopAudioMeter = useCallback((stopTracks = true) => {
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

    if (stopTracks && streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }

    setAudioBars(IDLE_BARS)
  }, [])

  const resetTranscripts = useCallback(() => {
    finalTranscriptRef.current = ''
    interimTranscriptRef.current = ''
    setFinalTranscript('')
    setInterimTranscript('')
  }, [])

  const finalizeSession = useCallback((nextValue) => {
    clearRestartTimeout()
    shouldResumeRef.current = false
    recognitionRef.current = null
    mediaRecorderRef.current = null
    recordedChunksRef.current = []
    activeEngineRef.current = 'idle'
    stopAudioMeter(true)
    setIsListening(false)
    setIsRequestingPermission(false)
    setIsProcessing(false)
    resetTranscripts()
    onChange(nextValue)
    resolveStop(nextValue)
    return nextValue
  }, [clearRestartTimeout, onChange, resetTranscripts, resolveStop, stopAudioMeter])

  const startAudioMeter = useCallback(async (stream) => {
    if (typeof window === 'undefined' || !stream) return

    const AudioContextClass = window.AudioContext || window.webkitAudioContext
    if (!AudioContextClass) return

    stopAudioMeter(false)

    const context = new AudioContextClass()
    const analyser = context.createAnalyser()
    const source = context.createMediaStreamSource(stream)
    const frequencyData = new Uint8Array(256)

    analyser.fftSize = 512
    analyser.smoothingTimeConstant = 0.72
    source.connect(analyser)

    audioContextRef.current = context
    analyserRef.current = analyser
    sourceRef.current = source
    streamRef.current = stream

    if (context.state === 'suspended') {
      await context.resume().catch(() => {})
    }

    const tick = () => {
      if (!mountedRef.current || !analyserRef.current) return

      analyserRef.current.getByteFrequencyData(frequencyData)
      const bucketSize = Math.max(1, Math.floor(frequencyData.length / IDLE_BARS.length))
      const nextBars = Array.from({ length: IDLE_BARS.length }, (_, index) => {
        const start = index * bucketSize
        const end = Math.min(frequencyData.length, start + bucketSize)
        let peak = 0
        for (let cursor = start; cursor < end; cursor += 1) {
          peak = Math.max(peak, frequencyData[cursor])
        }
        const normalized = Math.max(0.12, Math.min(1.2, peak / 118))
        return normalized
      })

      setAudioBars(nextBars)
      animationFrameRef.current = window.requestAnimationFrame(tick)
    }

    animationFrameRef.current = window.requestAnimationFrame(tick)
  }, [stopAudioMeter])

  const createRecognition = useCallback(() => {
    const Recognition = getRecognitionConstructor()
    if (!Recognition) return null

    const recognition = new Recognition()
    recognition.lang = normalizeLocale(locale)
    recognition.continuous = true
    recognition.interimResults = true
    recognition.maxAlternatives = 3

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
      onChange(mergeTranscript(baseValueRef.current, finalTranscriptRef.current, nextInterim))
    }

    recognition.onerror = (event) => {
      const code = event?.error || 'speech-error'
      if (code === 'aborted') return

      if (code === 'not-allowed' || code === 'service-not-allowed') {
        shouldResumeRef.current = false
        emitError(code)
        finalizeSession(baseValueRef.current)
        return
      }

      if (!RESTARTABLE_ERRORS.has(code)) {
        emitError(code)
      }
    }

    recognition.onend = () => {
      recognitionRef.current = null

      if (shouldResumeRef.current && mountedRef.current && activeEngineRef.current === 'native') {
        clearRestartTimeout()
        restartTimeoutRef.current = window.setTimeout(() => {
          if (!shouldResumeRef.current || !mountedRef.current) return
          const nextRecognition = createRecognition()
          if (!nextRecognition) {
            finalizeSession(mergeTranscript(baseValueRef.current, finalTranscriptRef.current, interimTranscriptRef.current))
            return
          }
          recognitionRef.current = nextRecognition
          try {
            nextRecognition.start()
            setIsListening(true)
            setIsProcessing(false)
          } catch (error) {
            emitError(error?.message || 'speech-restart-error')
            finalizeSession(mergeTranscript(baseValueRef.current, finalTranscriptRef.current, interimTranscriptRef.current))
          }
        }, 160)
        return
      }

      finalizeSession(mergeTranscript(baseValueRef.current, finalTranscriptRef.current, interimTranscriptRef.current))
    }

    return recognition
  }, [clearRestartTimeout, emitError, finalizeSession, locale, onChange])

  const transcribeRecordedAudio = useCallback(async (blob) => {
    const audioBase64 = await blobToBase64(blob)
    const response = await aiAPI.transcribe({
      audio_base64: audioBase64,
      mime_type: blob.type || recorderMimeTypeRef.current || 'audio/webm',
      locale: normalizeLocale(locale),
    })
    return String(response?.data?.text || '').trim()
  }, [locale])

  const start = useCallback(async () => {
    if (isListening || isRequestingPermission || isProcessing) return

    const detectedEngine = detectSpeechEngine()
    setEngine(detectedEngine)
    activeEngineRef.current = detectedEngine

    if (detectedEngine === 'unsupported') {
      emitError('unsupported')
      return
    }

    setIsRequestingPermission(true)
    baseValueRef.current = String(value || '')
    resetTranscripts()

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })

      await startAudioMeter(stream)

      if (detectedEngine === 'server') {
        const mimeType = getPreferredMimeType()
        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
        recorderMimeTypeRef.current = recorder.mimeType || mimeType || 'audio/webm'
        recordedChunksRef.current = []

        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            recordedChunksRef.current.push(event.data)
          }
        }

        recorder.onstop = async () => {
          try {
            setIsListening(false)
            setIsProcessing(true)

            const blob = new Blob(recordedChunksRef.current, {
              type: recorderMimeTypeRef.current || 'audio/webm',
            })

            if (!blob.size) {
              finalizeSession(baseValueRef.current)
              return
            }

          const transcript = await transcribeRecordedAudio(blob)
          const nextValue = mergeTranscript(baseValueRef.current, transcript)
          finalTranscriptRef.current = transcript
          setFinalTranscript(transcript)
          finalizeSession(nextValue)
        } catch (error) {
          emitError(error?.response?.data?.error || error?.message || 'transcription-error')
          finalizeSession(baseValueRef.current)
        }
      }

        mediaRecorderRef.current = recorder
        recorder.start(250)
        setIsRequestingPermission(false)
        setIsListening(true)
        setIsProcessing(false)
        return
      }

      const recognition = createRecognition()
      if (!recognition) {
        throw new Error('unsupported')
      }

      shouldResumeRef.current = true
      recognitionRef.current = recognition
      recognition.start()
      setIsRequestingPermission(false)
      setIsListening(true)
      setIsProcessing(false)
    } catch (error) {
      const code = error?.name === 'NotAllowedError' ? 'not-allowed' : (error?.message || 'speech-start-error')
      stopAudioMeter(true)
      setIsRequestingPermission(false)
      setIsListening(false)
      setIsProcessing(false)
      emitError(code)
    }
  }, [createRecognition, emitError, finalizeSession, isListening, isProcessing, isRequestingPermission, resetTranscripts, startAudioMeter, stopAudioMeter, transcribeRecordedAudio, value])

  const stop = useCallback(() => {
    const currentValue = mergeTranscript(baseValueRef.current, finalTranscriptRef.current, interimTranscriptRef.current)
    if (!isListening && !isProcessing && !isRequestingPermission) {
      return Promise.resolve(currentValue || String(value || ''))
    }

    return new Promise((resolve) => {
      stopResolverRef.current = resolve

      if (activeEngineRef.current === 'server' && mediaRecorderRef.current) {
        setIsListening(false)
        setIsProcessing(true)
        try {
          mediaRecorderRef.current.stop()
        } catch {
          finalizeSession(baseValueRef.current)
        }
        return
      }

      if (recognitionRef.current) {
        shouldResumeRef.current = false
        setIsListening(false)
        setIsProcessing(true)
        try {
          recognitionRef.current.stop()
        } catch {
          finalizeSession(currentValue)
        }
        return
      }

      finalizeSession(currentValue)
    })
  }, [finalizeSession, isListening, isProcessing, isRequestingPermission, value])

  useEffect(() => {
    return () => {
      mountedRef.current = false
      clearRestartTimeout()
      shouldResumeRef.current = false
      try {
        recognitionRef.current?.abort?.()
      } catch {}
      try {
        mediaRecorderRef.current?.stop?.()
      } catch {}
      stopAudioMeter(true)
    }
  }, [clearRestartTimeout, stopAudioMeter])

  useEffect(() => {
    const nextEngine = detectSpeechEngine()
    setEngine(nextEngine)
  }, [])

  const liveTranscript = useMemo(() => {
    if (activeEngineRef.current === 'server' && isListening) {
      return getRecordingLabel(locale)
    }
    return mergeTranscript(finalTranscript, interimTranscript)
  }, [finalTranscript, interimTranscript, isListening, locale])

  return {
    isSupported,
    isListening,
    isRequestingPermission,
    isProcessing,
    audioBars,
    finalTranscript,
    interimTranscript,
    liveTranscript,
    engine,
    start,
    stop,
  }
}
