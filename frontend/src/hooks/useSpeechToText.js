import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { aiAPI } from '../services/api'

const IDLE_BARS = [0.18, 0.24, 0.2, 0.3, 0.22, 0.28, 0.2, 0.24]
const VOLUME_THRESHOLD = 0.038
const PEAK_THRESHOLD = 0.14
const DEFAULT_SILENCE_MS = 3000
const ERROR_COOLDOWN_MS = 1800

function detectEngine() {
  if (typeof window === 'undefined') return 'unsupported'
  if (window.MediaRecorder && navigator?.mediaDevices?.getUserMedia) return 'server'
  return 'unsupported'
}

function normalizeLocale(locale) {
  const key = String(locale || 'fr').toLowerCase()
  if (key.startsWith('fr')) return 'fr-FR'
  if (key.startsWith('es')) return 'es-ES'
  if (key.startsWith('en')) return 'en-US'
  return 'fr-FR'
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

function mergeTranscript(...parts) {
  return parts
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
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

export function useSpeechToText({
  value,
  onChange,
  locale,
  onError,
  silenceMs = DEFAULT_SILENCE_MS,
}) {
  const mountedRef = useRef(true)
  const mediaRecorderRef = useRef(null)
  const streamRef = useRef(null)
  const audioContextRef = useRef(null)
  const analyserRef = useRef(null)
  const sourceRef = useRef(null)
  const animationFrameRef = useRef(null)
  const recorderMimeTypeRef = useRef('audio/webm')
  const recordedChunksRef = useRef([])
  const baseValueRef = useRef('')
  const finalTranscriptRef = useRef('')
  const heardSpeechRef = useRef(false)
  const lastSpeechAtRef = useRef(0)
  const pendingPromiseRef = useRef(null)
  const lastErrorRef = useRef({ code: '', at: 0 })

  const [engine, setEngine] = useState(() => detectEngine())
  const [isListening, setIsListening] = useState(false)
  const [isRequestingPermission, setIsRequestingPermission] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [audioBars, setAudioBars] = useState(IDLE_BARS)
  const [finalTranscript, setFinalTranscript] = useState('')

  const isSupported = useMemo(() => engine !== 'unsupported', [engine])

  const emitError = useCallback((code) => {
    const normalizedCode = String(code || 'speech-error')
    const now = Date.now()
    if (
      lastErrorRef.current.code === normalizedCode &&
      now - lastErrorRef.current.at < ERROR_COOLDOWN_MS
    ) {
      return
    }

    lastErrorRef.current = { code: normalizedCode, at: now }
    onError?.(normalizedCode)
  }, [onError])

  const resetBars = useCallback(() => {
    setAudioBars(IDLE_BARS)
  }, [])

  const cleanupAudio = useCallback(() => {
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

    resetBars()
  }, [resetBars])

  const resolvePending = useCallback((nextValue) => {
    if (pendingPromiseRef.current?.resolve) {
      pendingPromiseRef.current.resolve(nextValue)
      pendingPromiseRef.current = null
    }
  }, [])

  const ensurePendingPromise = useCallback(() => {
    if (!pendingPromiseRef.current) {
      let resolve
      const promise = new Promise((nextResolve) => {
        resolve = nextResolve
      })
      pendingPromiseRef.current = { promise, resolve }
    }
    return pendingPromiseRef.current.promise
  }, [])

  const finalizeSession = useCallback((nextValue, transcript = '') => {
    mediaRecorderRef.current = null
    recordedChunksRef.current = []
    heardSpeechRef.current = false
    lastSpeechAtRef.current = 0
    finalTranscriptRef.current = transcript
    cleanupAudio()

    if (mountedRef.current) {
      setIsListening(false)
      setIsRequestingPermission(false)
      setIsProcessing(false)
      setFinalTranscript(transcript)
      onChange(nextValue)
    }

    resolvePending(nextValue)
    return nextValue
  }, [cleanupAudio, onChange, resolvePending])

  const stopRecorder = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      setIsListening(false)
      setIsProcessing(true)
      try {
        mediaRecorderRef.current.stop()
      } catch {
        finalizeSession(baseValueRef.current, '')
      }
    }
  }, [finalizeSession])

  const startAudioMonitor = useCallback(async (stream) => {
    if (typeof window === 'undefined' || !stream) return

    const AudioContextClass = window.AudioContext || window.webkitAudioContext
    if (!AudioContextClass) return

    const context = new AudioContextClass()
    const analyser = context.createAnalyser()
    const source = context.createMediaStreamSource(stream)
    const timeDomainData = new Uint8Array(256)

    analyser.fftSize = 512
    analyser.smoothingTimeConstant = 0.7
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

      analyserRef.current.getByteTimeDomainData(timeDomainData)

      let peak = 0
      const bucketSize = Math.max(1, Math.floor(timeDomainData.length / IDLE_BARS.length))
      const nextBars = Array.from({ length: IDLE_BARS.length }, (_, index) => {
        const start = index * bucketSize
        const end = Math.min(timeDomainData.length, start + bucketSize)
        let bucketPeak = 0

        for (let cursor = start; cursor < end; cursor += 1) {
          const delta = Math.abs((timeDomainData[cursor] - 128) / 128)
          bucketPeak = Math.max(bucketPeak, delta)
          peak = Math.max(peak, delta)
        }

        return Math.max(0.14, Math.min(1.05, bucketPeak * 3.4))
      })

      setAudioBars(nextBars)

      if (peak >= PEAK_THRESHOLD || nextBars.some((bar) => bar >= VOLUME_THRESHOLD * 3.2)) {
        heardSpeechRef.current = true
        lastSpeechAtRef.current = Date.now()
      }

      if (
        heardSpeechRef.current &&
        lastSpeechAtRef.current > 0 &&
        Date.now() - lastSpeechAtRef.current >= silenceMs
      ) {
        stopRecorder()
        return
      }

      animationFrameRef.current = window.requestAnimationFrame(tick)
    }

    animationFrameRef.current = window.requestAnimationFrame(tick)
  }, [silenceMs, stopRecorder])

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
    if (isListening || isProcessing || isRequestingPermission) return

    const nextEngine = detectEngine()
    setEngine(nextEngine)
    if (nextEngine === 'unsupported') {
      emitError('unsupported')
      return
    }

    setIsRequestingPermission(true)
    setFinalTranscript('')
    finalTranscriptRef.current = ''
    baseValueRef.current = String(value || '')
    recordedChunksRef.current = []
    heardSpeechRef.current = false
    lastSpeechAtRef.current = 0
    ensurePendingPromise()

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })

      await startAudioMonitor(stream)

      const mimeType = getPreferredMimeType()
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      recorderMimeTypeRef.current = recorder.mimeType || mimeType || 'audio/webm'
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data)
        }
      }

      recorder.onstop = async () => {
        try {
          const blob = new Blob(recordedChunksRef.current, {
            type: recorderMimeTypeRef.current || 'audio/webm',
          })

          if (!blob.size) {
            finalizeSession(baseValueRef.current, '')
            return
          }

          const transcript = await transcribeRecordedAudio(blob)
          const nextValue = mergeTranscript(baseValueRef.current, transcript)
          finalizeSession(nextValue, transcript)
        } catch (error) {
          emitError(error?.response?.data?.error || error?.message || 'transcription-error')
          finalizeSession(baseValueRef.current, '')
        }
      }

      recorder.start(250)
      setIsRequestingPermission(false)
      setIsListening(true)
      setIsProcessing(false)
    } catch (error) {
      cleanupAudio()
      setIsRequestingPermission(false)
      setIsListening(false)
      setIsProcessing(false)
      pendingPromiseRef.current = null
      emitError(error?.name === 'NotAllowedError' ? 'not-allowed' : (error?.message || 'speech-start-error'))
    }
  }, [
    cleanupAudio,
    emitError,
    ensurePendingPromise,
    finalizeSession,
    isListening,
    isProcessing,
    isRequestingPermission,
    startAudioMonitor,
    transcribeRecordedAudio,
    value,
  ])

  const stop = useCallback(() => {
    const currentValue = mergeTranscript(baseValueRef.current, finalTranscriptRef.current)

    if (isListening) {
      const promise = ensurePendingPromise()
      stopRecorder()
      return promise
    }

    if (isProcessing) {
      return ensurePendingPromise()
    }

    return Promise.resolve(currentValue || String(value || ''))
  }, [ensurePendingPromise, isListening, isProcessing, stopRecorder, value])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      try {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.stop()
        }
      } catch {}
      cleanupAudio()
    }
  }, [cleanupAudio])

  useEffect(() => {
    setEngine(detectEngine())
  }, [])

  return {
    engine,
    isSupported,
    isListening,
    isRequestingPermission,
    isProcessing,
    audioBars,
    finalTranscript,
    interimTranscript: '',
    liveTranscript: finalTranscript,
    start,
    stop,
  }
}
