import { useEffect, useRef, useCallback } from 'react'

const IS_MOBILE = typeof window !== 'undefined' && window.innerWidth < 768
const IS_LOW_END = typeof window !== 'undefined' && (navigator.hardwareConcurrency || 4) <= 2
const PREFERS_REDUCED = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches

// Use CSS fallback when Three.js isn't available or on low-end devices
function CSSSnowFallback() {
  const count = IS_MOBILE ? 25 : 45
  const flakes = Array.from({ length: count }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    size: 1.5 + Math.random() * 3,
    delay: Math.random() * 12,
    duration: 10 + Math.random() * 15,
    drift: -20 + Math.random() * 40,
    opacity: 0.15 + Math.random() * 0.4,
  }))

  return (
    <div
      className="fixed inset-0 pointer-events-none z-[1] overflow-hidden"
      aria-hidden="true"
    >
      {flakes.map((f) => (
        <div
          key={f.id}
          className="snow-particle"
          style={{
            left: `${f.left}%`,
            width: f.size,
            height: f.size,
            opacity: f.opacity,
            animationDelay: `${f.delay}s`,
            animationDuration: `${f.duration}s`,
            '--drift': `${f.drift}px`,
          }}
        />
      ))}
    </div>
  )
}

// High-performance Three.js snow
function ThreeSnowCanvas() {
  const mountRef = useRef(null)
  const cleanupRef = useRef(null)

  const init = useCallback(async () => {
    const mount = mountRef.current
    if (!mount) return

    let THREE
    try {
      THREE = await import('three')
    } catch {
      return
    }

    if (!window.WebGLRenderingContext && !window.WebGL2RenderingContext) return

    let animationStopped = false
    let frameId = null
    let renderer = null
    const layers = []
    let scene = null

    try {
      const isMobile = window.innerWidth < 768
      const isTablet = window.innerWidth >= 768 && window.innerWidth < 1024
      const qualityScale = isMobile ? 0.35 : isTablet ? 0.6 : 1
      const width = Math.max(mount.clientWidth || window.innerWidth || 1, 1)
      const height = Math.max(mount.clientHeight || window.innerHeight || 1, 1)

      scene = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 100)
      camera.position.z = 5

      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: false,
        powerPreference: isMobile ? 'low-power' : 'default',
        failIfMajorPerformanceCaveat: true,
      })
      renderer.setSize(width, height)
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 1 : 1.5))
      renderer.setClearColor(0x000000, 0)
      mount.appendChild(renderer.domElement)

      // Create soft snowflake texture
      const createSnowTexture = (softness) => {
        const canvas = document.createElement('canvas')
        const res = isMobile ? 24 : 48
        canvas.width = canvas.height = res
        const ctx = canvas.getContext('2d')
        if (!ctx) return null
        const c = res / 2
        const gradient = ctx.createRadialGradient(c, c, 0, c, c, c)
        gradient.addColorStop(0, `rgba(220,240,255,${softness})`)
        gradient.addColorStop(0.25, `rgba(200,225,250,${softness * 0.8})`)
        gradient.addColorStop(0.55, `rgba(180,210,245,${softness * 0.35})`)
        gradient.addColorStop(1, 'rgba(150,195,240,0)')
        ctx.fillStyle = gradient
        ctx.beginPath()
        ctx.arc(c, c, c, 0, Math.PI * 2)
        ctx.fill()
        return new THREE.CanvasTexture(canvas)
      }

      const layerConfigs = [
        // Foreground — large, bright, fast
        { count: Math.max(40, Math.floor(200 * qualityScale)), size: 0.023, speed: 0.0065, depth: 3, opacity: 0.6, softness: 1 },
        // Mid — medium
        { count: Math.max(30, Math.floor(160 * qualityScale)), size: 0.015, speed: 0.004, depth: 6, opacity: 0.35, softness: 0.85 },
        // Background — small, slow, dim
        { count: Math.max(20, Math.floor(120 * qualityScale)), size: 0.009, speed: 0.002, depth: 10, opacity: 0.18, softness: 0.65 },
      ]

      layerConfigs.forEach((cfg) => {
        const geometry = new THREE.BufferGeometry()
        const positions = new Float32Array(cfg.count * 3)
        const velocities = new Float32Array(cfg.count * 3)
        const phases = new Float32Array(cfg.count)

        for (let i = 0; i < cfg.count; i++) {
          positions[i * 3] = (Math.random() - 0.5) * 20
          positions[i * 3 + 1] = (Math.random() - 0.5) * 15
          positions[i * 3 + 2] = (Math.random() - 0.5) * cfg.depth
          velocities[i * 3] = (Math.random() - 0.5) * 0.0008
          velocities[i * 3 + 1] = -(cfg.speed + Math.random() * cfg.speed * 0.6)
          phases[i] = Math.random() * Math.PI * 2
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))

        const texture = createSnowTexture(cfg.softness)
        if (!texture) return

        const material = new THREE.PointsMaterial({
          size: cfg.size,
          map: texture,
          transparent: true,
          opacity: cfg.opacity,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          sizeAttenuation: true,
        })

        const points = new THREE.Points(geometry, material)
        scene.add(points)
        layers.push({ geometry, material, texture, points, velocities, cfg, phases })
      })

      // Mouse parallax (desktop only)
      const mouse = { x: 0, targetX: 0 }
      let onMouseMove = null
      if (!isMobile) {
        onMouseMove = (event) => {
          mouse.targetX = (event.clientX / window.innerWidth - 0.5) * 0.25
        }
        window.addEventListener('mousemove', onMouseMove, { passive: true })
      }

      // Throttled animation for mobile
      let time = 0
      const frameSkip = isMobile ? 2 : 1
      let frameCount = 0

      const animate = () => {
        if (animationStopped) return
        frameId = window.requestAnimationFrame(animate)
        frameCount++
        if (frameCount % frameSkip !== 0) return

        time += 0.008
        mouse.x += (mouse.targetX - mouse.x) * 0.04

        layers.forEach(({ geometry, velocities, cfg, phases }) => {
          const positions = geometry.attributes.position.array
          const particleCount = positions.length / 3

          for (let i = 0; i < particleCount; i++) {
            const idx = i * 3
            // Gentle sine sway + mouse wind
            positions[idx] += velocities[idx] + Math.sin(time * 0.7 + phases[i]) * 0.002 + mouse.x * cfg.speed * 8
            positions[idx + 1] += velocities[idx + 1]

            // Recycle particles
            if (positions[idx + 1] < -8) {
              positions[idx] = (Math.random() - 0.5) * 20
              positions[idx + 1] = 8 + Math.random() * 2
              positions[idx + 2] = (Math.random() - 0.5) * cfg.depth
            }
            if (positions[idx] > 11) positions[idx] = -11
            if (positions[idx] < -11) positions[idx] = 11
          }

          geometry.attributes.position.needsUpdate = true
        })

        renderer.render(scene, camera)
      }

      // Resize handler
      let resizeTimer
      const onResize = () => {
        clearTimeout(resizeTimer)
        resizeTimer = setTimeout(() => {
          const w = Math.max(mount.clientWidth || window.innerWidth || 1, 1)
          const h = Math.max(mount.clientHeight || window.innerHeight || 1, 1)
          camera.aspect = w / h
          camera.updateProjectionMatrix()
          renderer.setSize(w, h)
        }, 150)
      }
      window.addEventListener('resize', onResize)

      animate()

      // Cleanup function
      cleanupRef.current = () => {
        animationStopped = true
        if (frameId) window.cancelAnimationFrame(frameId)
        if (onMouseMove) window.removeEventListener('mousemove', onMouseMove)
        window.removeEventListener('resize', onResize)
        clearTimeout(resizeTimer)

        layers.forEach(({ geometry, material, texture, points }) => {
          scene?.remove(points)
          geometry.dispose()
          material.dispose()
          texture.dispose()
        })

        if (renderer) {
          renderer.dispose()
          if (mount.contains(renderer.domElement)) {
            mount.removeChild(renderer.domElement)
          }
        }
      }
    } catch (error) {
      console.warn('SnowCanvas disabled:', error)
    }
  }, [])

  useEffect(() => {
    init()
    return () => {
      if (cleanupRef.current) cleanupRef.current()
    }
  }, [init])

  return (
    <div
      ref={mountRef}
      className="fixed inset-0 pointer-events-none z-[1] overflow-hidden"
      style={{ opacity: IS_MOBILE ? 0.48 : 0.7 }}
      aria-hidden="true"
    />
  )
}

export default function SnowCanvas() {
  if (PREFERS_REDUCED) return null

  // Use CSS fallback on very low-end mobile
  if (IS_LOW_END && IS_MOBILE) return <CSSSnowFallback />

  return <ThreeSnowCanvas />
}
