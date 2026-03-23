import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import './ProtectionShowcase3D.css'

gsap.registerPlugin(ScrollTrigger)

const MODEL_URL = ''
// 🔧 INSERER ICI L'URL DU MODELE .GLB

const ANIMATION_TUNING = {
  idleRotationSpeed: 0.18,
  shellSpread: 1.55,
  moduleSpread: 2.35,
  glowBoost: 1,
}
// 🔧 AJUSTER ICI LA VITESSE ET L'INTENSITE DES ANIMATIONS

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value))
const easeOutCubic = (value) => 1 - Math.pow(1 - value, 3)

const disposeMaterial = (material) => {
  if (!material) {
    return
  }

  Object.values(material).forEach((entry) => {
    if (entry && typeof entry === 'object' && typeof entry.dispose === 'function' && entry !== material) {
      entry.dispose()
    }
  })

  material.dispose()
}

export default function ProtectionShowcase3D() {
  const sectionRef = useRef(null)
  const stageRef = useRef(null)
  const canvasRef = useRef(null)
  const calloutRefs = useRef([])

  const features = useMemo(() => ([
    {
      title: 'Anti-Raid',
      text: 'Bloque les arrives massives et verrouille le serveur avant la casse.',
      accent: '#00e5ff',
      position: { top: '22%', left: '18%' },
      threshold: 0.24,
    },
    {
      title: 'Anti-Spam',
      text: 'Repere les rafales de messages et coupe la nuisance en temps reel.',
      accent: '#6effba',
      position: { top: '19%', left: '80%' },
      threshold: 0.4,
    },
    {
      title: 'AutoMod',
      text: 'Filtre les liens, mentions et signaux toxiques sans ralentir le staff.',
      accent: '#b04eff',
      position: { top: '74%', left: '22%' },
      threshold: 0.56,
    },
    {
      title: 'Moderation Live',
      text: 'Warnings, logs et reponses rapides gardent tout le systeme sous controle.',
      accent: '#ffb357',
      position: { top: '73%', left: '82%' },
      threshold: 0.7,
    },
  ]), [])

  useEffect(() => {
    if (!sectionRef.current || !stageRef.current || !canvasRef.current) {
      return undefined
    }

    const section = sectionRef.current
    const stage = stageRef.current
    const canvas = canvasRef.current
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100)
    camera.position.set(0, 0.25, 7.5)

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    })

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75))
    renderer.setClearColor(0x000000, 0)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.18

    const root = new THREE.Group()
    scene.add(root)

    const ambientLight = new THREE.AmbientLight(0x9ab7ff, 1.15)
    scene.add(ambientLight)

    const keyLight = new THREE.PointLight(0x00e5ff, 24, 18, 2)
    keyLight.position.set(3.6, 2.7, 4.4)
    scene.add(keyLight)

    const fillLight = new THREE.PointLight(0xb04eff, 18, 20, 2)
    fillLight.position.set(-4.2, -2.2, 4)
    scene.add(fillLight)

    const rimLight = new THREE.SpotLight(0xffffff, 18, 18, 0.7, 0.55, 1.1)
    rimLight.position.set(0, 5.5, 5)
    rimLight.target.position.set(0, 0, 0)
    scene.add(rimLight)
    scene.add(rimLight.target)

    const rootPivot = new THREE.Group()
    root.add(rootPivot)

    const heroShell = new THREE.Group()
    const innerAssembly = new THREE.Group()
    rootPivot.add(heroShell)
    rootPivot.add(innerAssembly)

    const glassMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xd8faff,
      emissive: 0x1bdcff,
      emissiveIntensity: 0.28,
      roughness: 0.12,
      metalness: 0.08,
      transmission: 0.16,
      thickness: 0.55,
      transparent: true,
      opacity: 0.84,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
    })

    const darkMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x111827,
      emissive: 0x381866,
      emissiveIntensity: 0.55,
      roughness: 0.28,
      metalness: 0.72,
      transparent: true,
      opacity: 0.96,
      clearcoat: 0.8,
      clearcoatRoughness: 0.16,
    })

    const highlightMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xb8fff4,
      emissive: 0x00e5ff,
      emissiveIntensity: 0.95 * ANIMATION_TUNING.glowBoost,
      roughness: 0.08,
      metalness: 0.26,
      transparent: true,
      opacity: 0.96,
      clearcoat: 1,
      clearcoatRoughness: 0.1,
    })

    const shellGeometry = new THREE.BoxGeometry(2.15, 0.62, 0.26)
    const shellBlueprints = [
      { base: new THREE.Vector3(0, 1.1, 0), direction: new THREE.Vector3(0, 1, 0), rotation: [0.22, 0, 0.12], open: [0.25, 0.08, 0.2] },
      { base: new THREE.Vector3(0, -1.1, 0), direction: new THREE.Vector3(0, -1, 0), rotation: [-0.22, 0, -0.12], open: [-0.25, -0.08, -0.18] },
      { base: new THREE.Vector3(-1.1, 0.04, 0), direction: new THREE.Vector3(-1, 0.1, 0), rotation: [0, 0.1, 1.52], open: [-0.08, -0.35, 0.22] },
      { base: new THREE.Vector3(1.1, -0.04, 0), direction: new THREE.Vector3(1, -0.1, 0), rotation: [0, -0.1, 1.52], open: [0.08, 0.35, -0.22] },
    ]

    const shellPieces = shellBlueprints.map((blueprint, index) => {
      const mesh = new THREE.Mesh(shellGeometry, glassMaterial.clone())
      mesh.position.copy(blueprint.base)
      mesh.rotation.set(...blueprint.rotation)
      mesh.userData = {
        base: blueprint.base.clone(),
        direction: blueprint.direction.clone().normalize(),
        restingRotation: new THREE.Euler(...blueprint.rotation),
        openRotation: blueprint.open,
        drift: index * 0.2,
      }
      heroShell.add(mesh)
      return mesh
    })

    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.8, 2),
      darkMaterial.clone()
    )
    innerAssembly.add(core)

    const coreHalo = new THREE.Mesh(
      new THREE.TorusGeometry(1.1, 0.055, 20, 120),
      new THREE.MeshBasicMaterial({
        color: 0x7fdcff,
        transparent: true,
        opacity: 0.78,
      })
    )
    coreHalo.rotation.x = 1.04
    innerAssembly.add(coreHalo)

    const orbitRing = new THREE.Mesh(
      new THREE.TorusGeometry(1.65, 0.042, 20, 140),
      new THREE.MeshBasicMaterial({
        color: 0xc69cff,
        transparent: true,
        opacity: 0.54,
      })
    )
    orbitRing.rotation.set(0.75, 0.15, 0.4)
    innerAssembly.add(orbitRing)

    const nucleus = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.38, 1),
      highlightMaterial.clone()
    )
    innerAssembly.add(nucleus)

    const moduleNodes = []
    const moduleBlueprints = [
      { base: new THREE.Vector3(-0.62, 0.46, 0.2), target: new THREE.Vector3(-2.15, 1.38, 0.5), color: 0x00e5ff },
      { base: new THREE.Vector3(0.72, 0.4, 0.15), target: new THREE.Vector3(2.2, 1.28, 0.6), color: 0x73ffbd },
      { base: new THREE.Vector3(-0.56, -0.52, 0.15), target: new THREE.Vector3(-1.95, -1.46, 0.35), color: 0xb04eff },
      { base: new THREE.Vector3(0.64, -0.62, 0.18), target: new THREE.Vector3(2.1, -1.4, 0.45), color: 0xffb357 },
    ]

    moduleBlueprints.forEach((blueprint, index) => {
      const shell = new THREE.Mesh(
        new THREE.BoxGeometry(0.66, 0.18, 0.42),
        new THREE.MeshPhysicalMaterial({
          color: 0x151922,
          emissive: blueprint.color,
          emissiveIntensity: 0.26,
          roughness: 0.3,
          metalness: 0.68,
          clearcoat: 1,
          clearcoatRoughness: 0.14,
        })
      )

      const line = new THREE.Mesh(
        new THREE.BoxGeometry(0.42, 0.03, 0.03),
        new THREE.MeshBasicMaterial({
          color: blueprint.color,
          transparent: true,
          opacity: 0.92,
        })
      )
      line.position.z = 0.23
      shell.add(line)

      shell.position.copy(blueprint.base)
      shell.rotation.z = index % 2 === 0 ? 0.12 : -0.12
      shell.userData = {
        base: blueprint.base.clone(),
        target: blueprint.target.clone(),
      }
      innerAssembly.add(shell)
      moduleNodes.push(shell)
    })

    const particleGeometry = new THREE.BufferGeometry()
    const particleCount = 240
    const particlePositions = new Float32Array(particleCount * 3)
    for (let index = 0; index < particleCount; index += 1) {
      const radius = 2.8 + Math.random() * 2.4
      const angle = Math.random() * Math.PI * 2
      const spread = (Math.random() - 0.5) * 3.6
      particlePositions[index * 3] = Math.cos(angle) * radius
      particlePositions[(index * 3) + 1] = Math.sin(angle * 1.7) * 1.8 + spread * 0.2
      particlePositions[(index * 3) + 2] = Math.sin(angle) * radius * 0.4
    }
    particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3))

    const particles = new THREE.Points(
      particleGeometry,
      new THREE.PointsMaterial({
        color: 0x8ce9ff,
        size: 0.034,
        transparent: true,
        opacity: 0.82,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    )
    scene.add(particles)

    const underGlow = new THREE.Mesh(
      new THREE.CircleGeometry(2.65, 64),
      new THREE.MeshBasicMaterial({
        color: 0x00d4ff,
        transparent: true,
        opacity: 0.12,
        depthWrite: false,
      })
    )
    underGlow.rotation.x = -Math.PI / 2
    underGlow.position.y = -2.45
    rootPivot.add(underGlow)

    let gltfModel = null
    if (MODEL_URL) {
      const loader = new GLTFLoader()
      loader.load(
        MODEL_URL,
        (gltf) => {
          gltfModel = gltf.scene
          gltfModel.scale.setScalar(1.34)
          gltfModel.position.set(0, 0, 0)
          gltfModel.traverse((node) => {
            if (node.isMesh) {
              node.castShadow = false
              node.receiveShadow = false
            }
          })
          innerAssembly.add(gltfModel)
        },
        undefined,
        () => {}
      )
    }

    const motion = { progress: 0 }

    const resize = () => {
      const width = stage.clientWidth
      const height = stage.clientHeight
      renderer.setSize(width, height, false)
      camera.aspect = width / Math.max(height, 1)
      camera.updateProjectionMatrix()
    }

    resize()
    window.addEventListener('resize', resize)

    const context = gsap.context(() => {
      gsap.fromTo(
        section.querySelectorAll('[data-showcase-copy]'),
        { opacity: 0, y: 32 },
        {
          opacity: 1,
          y: 0,
          stagger: 0.08,
          duration: 0.9,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: section,
            start: 'top 78%',
            once: true,
          },
        }
      )

      gsap.to(motion, {
        progress: 1,
        ease: 'none',
        scrollTrigger: {
          trigger: section,
          start: 'top top',
          end: 'bottom bottom',
          scrub: prefersReducedMotion ? false : 1,
        },
      })
    }, section)

    let frameId = 0
    const clock = new THREE.Clock()

    const animate = () => {
      const elapsed = clock.getElapsedTime()
      const progress = prefersReducedMotion ? 1 : motion.progress
      const intro = easeOutCubic(clamp(progress / 0.18))
      const open = easeOutCubic(clamp((progress - 0.18) / 0.28))
      const explode = easeOutCubic(clamp((progress - 0.44) / 0.28))
      const reveal = easeOutCubic(clamp((progress - 0.62) / 0.22))

      rootPivot.position.y = 0.62 - (intro * 0.62) + Math.sin(elapsed * 1.3) * 0.04
      rootPivot.rotation.y = elapsed * ANIMATION_TUNING.idleRotationSpeed + progress * 1.35
      rootPivot.rotation.x = -0.24 + (intro * 0.2)
      rootPivot.scale.setScalar(0.72 + (intro * 0.28))

      shellPieces.forEach((piece, index) => {
        const depthLift = open * 0.5
        piece.position.copy(piece.userData.base)
        piece.position.addScaledVector(piece.userData.direction, (open * 0.55) + (explode * ANIMATION_TUNING.shellSpread))
        piece.position.z += depthLift
        piece.rotation.x = piece.userData.restingRotation.x + piece.userData.openRotation[0] * open
        piece.rotation.y = piece.userData.restingRotation.y + piece.userData.openRotation[1] * open + (explode * 0.2 * (index % 2 === 0 ? 1 : -1))
        piece.rotation.z = piece.userData.restingRotation.z + piece.userData.openRotation[2] * open
        piece.material.opacity = 0.84 - (reveal * 0.16)
      })

      core.rotation.x = elapsed * 0.35
      core.rotation.y = elapsed * 0.6 + progress * 1.6
      core.scale.setScalar(1 + (reveal * 0.1))
      nucleus.rotation.x = elapsed * 0.92
      nucleus.rotation.y = elapsed * 1.15
      nucleus.scale.setScalar(1 + (explode * 0.12))
      coreHalo.rotation.z = elapsed * 0.75 + progress * 2.6
      coreHalo.scale.setScalar(1 + (reveal * 0.16))
      orbitRing.rotation.y = 0.15 + elapsed * 0.35 + progress * 1.5
      orbitRing.rotation.z = 0.4 + elapsed * 0.12
      orbitRing.material.opacity = 0.4 + (reveal * 0.22)
      underGlow.material.opacity = (0.08 + reveal * 0.12) * ANIMATION_TUNING.glowBoost

      moduleNodes.forEach((node, index) => {
        node.position.copy(node.userData.base).lerp(node.userData.target, explode * ANIMATION_TUNING.moduleSpread / 2.35)
        node.rotation.y = elapsed * 0.45 + index * 0.8
        node.rotation.x = Math.sin(elapsed * 0.7 + index) * 0.18
        const scale = 0.84 + (intro * 0.16) + (reveal * 0.08)
        node.scale.setScalar(scale)
      })

      particles.rotation.y = elapsed * 0.03 + progress * 0.35
      particles.rotation.x = Math.sin(elapsed * 0.1) * 0.04

      if (gltfModel) {
        gltfModel.rotation.y = elapsed * 0.38 + progress * 1.1
        gltfModel.position.y = Math.sin(elapsed * 1.2) * 0.03
        gltfModel.scale.setScalar(1.22 + intro * 0.12)
      }

      calloutRefs.current.forEach((element, index) => {
        if (!element) {
          return
        }

        const visibility = easeOutCubic(clamp((progress - features[index].threshold) / 0.12))
        element.style.opacity = String(visibility)
        element.style.transform = `translate(-50%, -50%) scale(${0.92 + (visibility * 0.08)})`
        element.style.filter = `blur(${(1 - visibility) * 6}px)`
      })

      camera.position.x = Math.sin(progress * Math.PI) * 0.56
      camera.position.y = 0.24 - (reveal * 0.14)
      camera.lookAt(0, 0, 0)

      renderer.render(scene, camera)
      frameId = window.requestAnimationFrame(animate)
    }

    animate()
    ScrollTrigger.refresh()

    return () => {
      window.cancelAnimationFrame(frameId)
      window.removeEventListener('resize', resize)
      context.revert()
      renderer.dispose()
      scene.traverse((node) => {
        if (node.isMesh || node.isPoints) {
          if (node.geometry) {
            node.geometry.dispose()
          }

          if (Array.isArray(node.material)) {
            node.material.forEach(disposeMaterial)
          } else {
            disposeMaterial(node.material)
          }
        }
      })
    }
  }, [features])

  return (
    <section ref={sectionRef} className="product-showcase w-full" aria-label="Demonstration 3D de la protection DiscordForge">
      <div className="product-showcase__sticky">
        <div className="product-showcase__copy">
          <div className="product-showcase__eyebrow" data-showcase-copy>
            Protection cinematique
          </div>

          <h2 className="product-showcase__title" data-showcase-copy>
            Le systeme s&apos;ouvre.
            <span>La puissance se revele.</span>
          </h2>

          <p className="product-showcase__subtitle" data-showcase-copy>
            Une mise en scene premium qui montre la defense du bot comme un produit haut de gamme:
            chaque couche se deploie, chaque module prend sa place, chaque fonction devient evidente au scroll.
          </p>

          <div className="product-showcase__rail" data-showcase-copy>
            <div className="product-showcase__rail-item">
              <span className="product-showcase__rail-chip" style={{ color: '#00e5ff', background: '#00e5ff' }} />
              <div>
                <div className="product-showcase__rail-title">Intro cinematique</div>
                <div className="product-showcase__rail-text">Fade, zoom, rotation lente et lumiere premium des les premiers pixels.</div>
              </div>
            </div>

            <div className="product-showcase__rail-item">
              <span className="product-showcase__rail-chip" style={{ color: '#b04eff', background: '#b04eff' }} />
              <div>
                <div className="product-showcase__rail-title">Ouverture style Apple</div>
                <div className="product-showcase__rail-text">Le noyau de protection s&apos;ouvre comme un produit demonte avec precision.</div>
              </div>
            </div>

            <div className="product-showcase__rail-item">
              <span className="product-showcase__rail-chip" style={{ color: '#6effba', background: '#6effba' }} />
              <div>
                <div className="product-showcase__rail-title">Scroll synchronise</div>
                <div className="product-showcase__rail-text">Le mouvement suit le geste, donc la puissance du produit se comprend sans lire un tuto.</div>
              </div>
            </div>
          </div>

          <div className="product-showcase__footer" data-showcase-copy>
            <span className="product-showcase__tag">Three.js</span>
            <span className="product-showcase__tag">GSAP ScrollTrigger</span>
            <span className="product-showcase__tag">Module autonome</span>
            <span className="product-showcase__tag">Desktop + mobile</span>
          </div>
        </div>

        <div ref={stageRef} className="product-showcase__stage">
          <canvas ref={canvasRef} className="product-showcase__canvas" />

          <div className="product-showcase__overlay" aria-hidden="true">
            {features.map((feature, index) => (
              <div
                key={feature.title}
                ref={(element) => { calloutRefs.current[index] = element }}
                className="product-showcase__callout"
                style={{ top: feature.position.top, left: feature.position.left, color: feature.accent }}
              >
                <div className="product-showcase__callout-title">{feature.title}</div>
                <div className="product-showcase__callout-text">{feature.text}</div>
              </div>
            ))}
          </div>

          <div className="product-showcase__mobile-list">
            {features.map((feature) => (
              <div key={feature.title} className="product-showcase__mobile-card">
                <h4>{feature.title}</h4>
                <p>{feature.text}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
