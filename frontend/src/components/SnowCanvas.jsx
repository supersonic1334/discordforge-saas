import { useEffect, useRef } from 'react'
import * as THREE from 'three'

const PARTICLE_COUNT = 600
const DEPTH_LAYERS = 3

export default function SnowCanvas() {
  const mountRef = useRef(null)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    // ── Scene setup ───────────────────────────────────────────────────────────
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(75, mount.clientWidth / mount.clientHeight, 0.1, 100)
    camera.position.z = 5

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false })
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearColor(0x000000, 0)
    mount.appendChild(renderer.domElement)

    // ── Particles ─────────────────────────────────────────────────────────────
    const layers = []
    const layerConfigs = [
      { count: 250, size: 0.015, speed: 0.006, depth: 3,  opacity: 0.7  }, // near
      { count: 200, size: 0.01,  speed: 0.004, depth: 6,  opacity: 0.45 }, // mid
      { count: 150, size: 0.007, speed: 0.002, depth: 10, opacity: 0.25 }, // far
    ]

    layerConfigs.forEach((cfg) => {
      const geometry = new THREE.BufferGeometry()
      const positions = new Float32Array(cfg.count * 3)
      const velocities = new Float32Array(cfg.count * 3)
      const phases = new Float32Array(cfg.count) // horizontal sway offset

      for (let i = 0; i < cfg.count; i++) {
        positions[i * 3]     = (Math.random() - 0.5) * 20
        positions[i * 3 + 1] = (Math.random() - 0.5) * 15
        positions[i * 3 + 2] = (Math.random() - 0.5) * cfg.depth
        velocities[i * 3]     = (Math.random() - 0.5) * 0.001 // initial x drift
        velocities[i * 3 + 1] = -(cfg.speed + Math.random() * cfg.speed * 0.5)
        phases[i] = Math.random() * Math.PI * 2
      }

      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      geometry.setAttribute('phase', new THREE.BufferAttribute(phases, 1))

      // Circular particle texture
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 32
      const ctx = canvas.getContext('2d')
      const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16)
      grad.addColorStop(0, 'rgba(200,240,255,1)')
      grad.addColorStop(0.4, 'rgba(180,220,255,0.8)')
      grad.addColorStop(1, 'rgba(100,180,255,0)')
      ctx.fillStyle = grad
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
      layers.push({ points, geometry, velocities, cfg, phases })
    })

    // ── Mouse tracking ────────────────────────────────────────────────────────
    const mouse = { x: 0, y: 0, targetX: 0, targetY: 0 }
    const onMouseMove = (e) => {
      mouse.targetX = (e.clientX / window.innerWidth - 0.5) * 0.3
      mouse.targetY = (e.clientY / window.innerHeight - 0.5) * 0.1
    }
    window.addEventListener('mousemove', onMouseMove)

    // ── Animation ─────────────────────────────────────────────────────────────
    let frameId
    let time = 0

    const animate = () => {
      frameId = requestAnimationFrame(animate)
      time += 0.008

      // Smooth mouse follow
      mouse.x += (mouse.targetX - mouse.x) * 0.05
      mouse.y += (mouse.targetY - mouse.y) * 0.05

      layers.forEach(({ points, geometry, velocities, cfg, phases }) => {
        const pos = geometry.attributes.position.array
        const n = pos.length / 3

        for (let i = 0; i < n; i++) {
          const idx = i * 3
          // Wind sway
          pos[idx]     += velocities[idx] + Math.sin(time + phases[i]) * 0.003 + mouse.x * cfg.speed * 10
          pos[idx + 1] += velocities[idx + 1]
          pos[idx + 2] += 0

          // Reset when out of bounds
          if (pos[idx + 1] < -8) {
            pos[idx]     = (Math.random() - 0.5) * 20
            pos[idx + 1] = 8
            pos[idx + 2] = (Math.random() - 0.5) * cfg.depth
          }
          if (pos[idx] > 10)  pos[idx] = -10
          if (pos[idx] < -10) pos[idx] = 10
        }
        geometry.attributes.position.needsUpdate = true
      })

      renderer.render(scene, camera)
    }
    animate()

    // ── Resize ────────────────────────────────────────────────────────────────
    const onResize = () => {
      if (!mount) return
      camera.aspect = mount.clientWidth / mount.clientHeight
      camera.updateProjectionMatrix()
      renderer.setSize(mount.clientWidth, mount.clientHeight)
    }
    window.addEventListener('resize', onResize)

    // ── Cleanup ───────────────────────────────────────────────────────────────
    return () => {
      cancelAnimationFrame(frameId)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('resize', onResize)
      renderer.dispose()
      if (mount.contains(renderer.domElement)) {
        mount.removeChild(renderer.domElement)
      }
    }
  }, [])

  return (
    <div
      ref={mountRef}
      className="fixed inset-0 pointer-events-none z-0"
      style={{ opacity: 0.6 }}
    />
  )
}
