import { useEffect, useRef } from 'react'
import * as THREE from 'three'

export default function SnowCanvas() {
  const mountRef = useRef(null)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount || typeof window === 'undefined') return
    if (!window.WebGLRenderingContext && !window.WebGL2RenderingContext) return

    let renderer = null
    let frameId = null
    let onMouseMove = null
    let onResize = null
    let scene = null
    let animationStopped = false
    const layers = []

    try {
      const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
      const qualityScale = prefersReducedMotion ? 0.45 : window.innerWidth < 768 ? 0.65 : 1
      const width = Math.max(mount.clientWidth || window.innerWidth || 1, 1)
      const height = Math.max(mount.clientHeight || window.innerHeight || 1, 1)

      scene = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 100)
      camera.position.z = 5

      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: false,
        powerPreference: 'low-power',
        failIfMajorPerformanceCaveat: false,
      })
      renderer.setSize(width, height)
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
      renderer.setClearColor(0x000000, 0)
      mount.appendChild(renderer.domElement)

      const layerConfigs = [
        { count: Math.max(80, Math.floor(250 * qualityScale)), size: 0.015, speed: 0.006, depth: 3, opacity: 0.7 },
        { count: Math.max(60, Math.floor(200 * qualityScale)), size: 0.01, speed: 0.004, depth: 6, opacity: 0.45 },
        { count: Math.max(40, Math.floor(150 * qualityScale)), size: 0.007, speed: 0.002, depth: 10, opacity: 0.25 },
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
          velocities[i * 3] = (Math.random() - 0.5) * 0.001
          velocities[i * 3 + 1] = -(cfg.speed + Math.random() * cfg.speed * 0.5)
          phases[i] = Math.random() * Math.PI * 2
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))

        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 32
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16)
        gradient.addColorStop(0, 'rgba(200,240,255,1)')
        gradient.addColorStop(0.4, 'rgba(180,220,255,0.8)')
        gradient.addColorStop(1, 'rgba(100,180,255,0)')
        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, 32, 32)

        const texture = new THREE.CanvasTexture(canvas)
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

      const mouse = { x: 0, targetX: 0 }
      onMouseMove = (event) => {
        mouse.targetX = (event.clientX / window.innerWidth - 0.5) * 0.3
      }
      window.addEventListener('mousemove', onMouseMove, { passive: true })

      let time = 0
      const animate = () => {
        if (animationStopped) return

        frameId = window.requestAnimationFrame(animate)
        time += 0.008
        mouse.x += (mouse.targetX - mouse.x) * 0.05

        layers.forEach(({ geometry, velocities, cfg, phases }) => {
          const positions = geometry.attributes.position.array
          const particleCount = positions.length / 3

          for (let i = 0; i < particleCount; i++) {
            const index = i * 3
            positions[index] += velocities[index] + Math.sin(time + phases[i]) * 0.003 + mouse.x * cfg.speed * 10
            positions[index + 1] += velocities[index + 1]

            if (positions[index + 1] < -8) {
              positions[index] = (Math.random() - 0.5) * 20
              positions[index + 1] = 8
              positions[index + 2] = (Math.random() - 0.5) * cfg.depth
            }
            if (positions[index] > 10) positions[index] = -10
            if (positions[index] < -10) positions[index] = 10
          }

          geometry.attributes.position.needsUpdate = true
        })

        renderer.render(scene, camera)
      }

      onResize = () => {
        const nextWidth = Math.max(mount.clientWidth || window.innerWidth || 1, 1)
        const nextHeight = Math.max(mount.clientHeight || window.innerHeight || 1, 1)
        camera.aspect = nextWidth / nextHeight
        camera.updateProjectionMatrix()
        renderer.setSize(nextWidth, nextHeight)
      }
      window.addEventListener('resize', onResize)

      animate()
    } catch (error) {
      console.warn('SnowCanvas disabled:', error)
    }

    return () => {
      animationStopped = true
      if (frameId !== null) window.cancelAnimationFrame(frameId)
      if (onMouseMove) window.removeEventListener('mousemove', onMouseMove)
      if (onResize) window.removeEventListener('resize', onResize)

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
  }, [])

  return (
    <div
      ref={mountRef}
      className="fixed inset-0 pointer-events-none z-0 overflow-hidden"
      style={{ opacity: 0.6 }}
    />
  )
}
