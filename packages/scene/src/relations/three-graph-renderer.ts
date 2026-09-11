import type { GraphRenderer, GraphRendererFactory } from './contracts.js'
import type { RelationGraphNode as GraphNode } from '@modkit/sdk'
/**
 * Three.js relation-graph renderer owned by the built-in scene package.
 *
 * A `GraphRenderer` implementation, not a second widget: the sidebar, controls and footer stay in
 * `@modkit/ui`'s relation graph, and this backend owns only pixels. That is the doc 06 §19
 * rule — alternative Three/WebGL backends are provider offers of one render contract, never
 * hardcoded imports inside the shell.
 *
 * Ported in spirit from the MK2 relations webview, which used the same stack: an orbit camera and
 * an UnrealBloomPass so dense clusters read as glow rather than as a solid blob.
 *
 * Colour never comes from here. Every value arrives in `state.palette`, resolved by the host from
 * the active theme, so the graph follows `modkit-dark`, `modkit-light` and high contrast alike.
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'

const CATEGORICAL = 6
const NODE_RADIUS = 3.2

const colour = (palette: Readonly<Record<string, string>>, key: string, fallback: string) =>
  new THREE.Color(palette[key] ?? fallback)

/**
 * Deterministic spherical scatter. A real force simulation on 50 000 nodes would blow the frame
 * budget; a golden-angle sphere gives a stable, readable layout with no iteration cost.
 */
function place(count: number, radius: number) {
  const points = []
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let index = 0; index < count; index += 1) {
    const y = count === 1 ? 0 : 1 - (index / (count - 1)) * 2
    const ring = Math.sqrt(Math.max(0, 1 - y * y))
    const theta = golden * index
    points.push(
      new THREE.Vector3(
        Math.cos(theta) * ring * radius,
        y * radius,
        Math.sin(theta) * ring * radius,
      ),
    )
  }
  return points
}

export function createThreeGraphRenderer(
  host: HTMLElement,
  hooks: { onOpen?(node: GraphNode): void } = {},
): GraphRenderer {
  const document = host.ownerDocument
  const canvas = document.createElement('canvas')
  canvas.style.setProperty('display', 'block')
  canvas.style.setProperty('width', '100%')
  canvas.style.setProperty('height', '100%')
  host.replaceChildren(canvas)

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio ?? 1))

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 4000)
  camera.position.set(0, 0, 320)

  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.08

  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.9, 0.6, 0.15)
  composer.addPass(bloom)

  let nodeMesh: THREE.InstancedMesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> | undefined
  let edgeLines: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial> | undefined
  let placedPoints: THREE.Vector3[] = []
  let indexById = new Map()
  let drawn = 0
  let disposed = false
  let frame = 0

  const clear = () => {
    if (nodeMesh !== undefined) {
      scene.remove(nodeMesh)
      nodeMesh.geometry.dispose()
      nodeMesh.material.dispose()
      nodeMesh = undefined
    }
    if (edgeLines !== undefined) {
      scene.remove(edgeLines)
      edgeLines.geometry.dispose()
      edgeLines.material.dispose()
      edgeLines = undefined
    }
  }

  const loop = () => {
    if (disposed) return
    frame = requestAnimationFrame(loop)
    controls.update()
    composer.render()
  }

  /** Pick by ray so a double-click opens the subject under the cursor, as the 2D renderer does. */
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  let currentNodes: GraphNode[] = []
  canvas.addEventListener('dblclick', event => {
    if (nodeMesh === undefined || hooks.onOpen === undefined) return
    const box = canvas.getBoundingClientRect()
    pointer.x = ((event.clientX - box.left) / box.width) * 2 - 1
    pointer.y = -((event.clientY - box.top) / box.height) * 2 + 1
    raycaster.setFromCamera(pointer, camera)
    const hit = raycaster.intersectObject(nodeMesh, false)[0]
    if (hit?.instanceId !== undefined) {
      const node = currentNodes[hit.instanceId]
      if (node !== undefined) hooks.onOpen(node)
    }
  })

  return {
    render(state) {
      clear()
      currentNodes = [...state.nodes]
      const radius = 60 + Math.sqrt(currentNodes.length) * 9
      placedPoints = place(currentNodes.length, radius)
      indexById = new Map(currentNodes.map((node, index) => [node.id, index]))

      scene.background = colour(state.palette, 'background', '#141414')

      const toneOf = (type: string) => {
        const bucket = state.types.find(item => item.id === type)
        return ((bucket?.tone ?? 0) % CATEGORICAL) + 1
      }

      const geometry = new THREE.SphereGeometry(NODE_RADIUS, 10, 8)
      const material = new THREE.MeshBasicMaterial({ toneMapped: false })
      nodeMesh = new THREE.InstancedMesh(geometry, material, Math.max(1, currentNodes.length))
      const matrix = new THREE.Matrix4()
      currentNodes.forEach((node, index) => {
        matrix.setPosition(placedPoints[index] as THREE.Vector3)
        ;(nodeMesh as NonNullable<typeof nodeMesh>).setMatrixAt(index, matrix)
        ;(nodeMesh as NonNullable<typeof nodeMesh>).setColorAt(
          index,
          colour(state.palette, `categorical-${toneOf(node.type)}`, '#4daafc'),
        )
      })
      nodeMesh.instanceMatrix.needsUpdate = true
      if (nodeMesh.instanceColor !== null) nodeMesh.instanceColor.needsUpdate = true
      scene.add(nodeMesh)

      const positions = []
      const colours = []
      const live = colour(state.palette, 'edge', '#5a5a5a')
      const dead = colour(state.palette, 'edgeDead', '#f14c4c')
      drawn = 0
      for (const edge of state.edges) {
        const from = indexById.get(edge.from)
        const to = indexById.get(edge.to)
        if (from === undefined || to === undefined) continue
        const a = placedPoints[from] as THREE.Vector3
        const b = placedPoints[to] as THREE.Vector3
        positions.push(a.x, a.y, a.z, b.x, b.y, b.z)
        const tint = edge.dead === true ? dead : live
        colours.push(tint.r, tint.g, tint.b, tint.r, tint.g, tint.b)
        drawn += 1
      }
      const lineGeometry = new THREE.BufferGeometry()
      lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      lineGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3))
      edgeLines = new THREE.LineSegments(
        lineGeometry,
        new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.4 }),
      )
      scene.add(edgeLines)

      if (frame === 0) loop()
    },

    resize(width, height) {
      renderer.setSize(width, height, false)
      composer.setSize(width, height)
      bloom.setSize(width, height)
      camera.aspect = width / Math.max(1, height)
      camera.updateProjectionMatrix()
    },

    reset() {
      camera.position.set(0, 0, 320)
      controls.target.set(0, 0, 0)
      controls.update()
    },

    drawnEdges() {
      return drawn
    },

    destroy() {
      disposed = true
      if (frame !== 0) cancelAnimationFrame(frame)
      clear()
      controls.dispose()
      composer.dispose?.()
      renderer.dispose()
      host.replaceChildren()
    },
  }
}

/** Factory in the shape the relation graph expects. */
export const threeGraphRenderer: GraphRendererFactory = {
  id: 'three-3d',
  label: '3D (three.js)',
  create: (host, hooks) => createThreeGraphRenderer(host, hooks),
}
