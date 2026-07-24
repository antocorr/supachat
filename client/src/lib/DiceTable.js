import * as CANNON from 'cannon-es'
import * as THREE from 'three'

const MAX_VISIBLE_DICE = 28
const TABLE_Y = 0.43
const PHYSICS_STEP = 1 / 60
const PHYSICS_STEPS = 190
const ROLL_DURATION = PHYSICS_STEPS * PHYSICS_STEP * 1000
const CAMERA_DELAY_AFTER_PHYSICS = 0
const ARRANGE_DURATION = 1200

const DIE_COLORS = {
  4: 0x7c3aed,
  6: 0xf4ead5,
  8: 0x0ea5e9,
  10: 0xf97316,
  12: 0x10b981,
  20: 0xfbbf24,
  100: 0xec4899,
}

const D6_FACE_NORMALS = {
  1: new THREE.Vector3(0, 1, 0),
  2: new THREE.Vector3(0, 0, 1),
  3: new THREE.Vector3(1, 0, 0),
  4: new THREE.Vector3(-1, 0, 0),
  5: new THREE.Vector3(0, 0, -1),
  6: new THREE.Vector3(0, -1, 0),
}

const PIP_LAYOUTS = {
  1: [[.5, .5]],
  2: [[.28, .28], [.72, .72]],
  3: [[.28, .28], [.5, .5], [.72, .72]],
  4: [[.28, .28], [.72, .28], [.28, .72], [.72, .72]],
  5: [[.28, .28], [.72, .28], [.5, .5], [.28, .72], [.72, .72]],
  6: [[.28, .22], [.72, .22], [.28, .5], [.72, .5], [.28, .78], [.72, .78]],
}

function d10Geometry() {
  const vertices = [
    [0, 1.02, 0], [0, -1.02, 0],
    ...Array.from({ length: 5 }, (_, index) => {
      const angle = (index / 5) * Math.PI * 2 + Math.PI / 5
      return [Math.cos(angle) * .78, 0, Math.sin(angle) * .78]
    }),
  ]
  const positions = []
  const pushFace = (a, b, c) => positions.push(...vertices[a], ...vertices[b], ...vertices[c])
  for (let index = 0; index < 5; index += 1) {
    const next = 2 + (index + 1) % 5
    const current = 2 + index
    pushFace(0, current, next)
    pushFace(1, next, current)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  return geometry
}

function geometryFor(sides) {
  if (sides === 4) return new THREE.TetrahedronGeometry(.82)
  if (sides === 6) return new THREE.BoxGeometry(1.25, 1.25, 1.25)
  if (sides === 8) return new THREE.OctahedronGeometry(.9)
  if (sides === 10 || sides === 100) return d10Geometry()
  if (sides === 12) return new THREE.DodecahedronGeometry(.86)
  return new THREE.IcosahedronGeometry(.9)
}

function restHeight(sides) {
  return TABLE_Y + (sides === 6 ? 0.65 : 0.85)
}

function canvasTexture(draw, size = 512) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  draw(ctx, size)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function createPipTexture(value) {
  return canvasTexture((ctx, size) => {
    const gradient = ctx.createLinearGradient(0, 0, size, size)
    gradient.addColorStop(0, '#fffdf7')
    gradient.addColorStop(1, '#dbc9a9')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, size, size)
    ctx.fillStyle = 'rgba(120, 86, 47, .08)'
    for (let i = 0; i < 900; i += 1) ctx.fillRect(Math.random() * size, Math.random() * size, 1, 1)
    for (const point of PIP_LAYOUTS[value]) {
      const x = point[0]
      const y = point[1]
      ctx.beginPath()
      ctx.arc(x * size, y * size, size * .082, 0, Math.PI * 2)
      const pip = ctx.createRadialGradient(x * size - 8, y * size - 8, 2, x * size, y * size, size * .09)
      pip.addColorStop(0, '#4e596d')
      pip.addColorStop(1, '#111827')
      ctx.fillStyle = pip
      ctx.fill()
    }
  }, 256)
}

function createD6Materials() {
  return [3, 4, 1, 6, 2, 5].map(value => new THREE.MeshStandardMaterial({
    map: createPipTexture(value), roughness: 0.42, metalness: 0.03,
  }))
}

function labelValuesFor(sides) {
  if (sides === 100) return Array.from({ length: 10 }, (_, index) => String(index * 10).padStart(2, '0'))
  return Array.from({ length: sides }, (_, index) => String(index + 1))
}

function faceDescriptors(geometry, sides) {
  if (sides === 6) return Object.entries(D6_FACE_NORMALS).map(([label, normal]) => ({ label, normal: normal.clone(), center: normal.clone().multiplyScalar(.626) }))
  const positions = geometry.getAttribute('position')
  const faces = []
  for (let index = 0; index < positions.count; index += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(positions, index)
    const b = new THREE.Vector3().fromBufferAttribute(positions, index + 1)
    const c = new THREE.Vector3().fromBufferAttribute(positions, index + 2)
    const normal = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize()
    const center = a.add(b).add(c).multiplyScalar(1 / 3)
    const existing = faces.find(face => face.normal.dot(normal) > .999)
    if (existing) { existing.center.add(center); existing.triangles += 1 }
    else { faces.push({ normal, center, triangles: 1 }) }
  }
  return faces.map((face, index) => ({
    label: labelValuesFor(sides)[index % labelValuesFor(sides).length],
    normal: face.normal,
    center: face.center.multiplyScalar(1 / face.triangles),
  }))
}

function createFaceLabel(label, sides) {
  const texture = canvasTexture((ctx, size) => {
    ctx.clearRect(0, 0, size, size)
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.font = `900 ${label.length > 1 ? 238 : 300}px ui-sans-serif, system-ui, sans-serif`
    ctx.lineWidth = 24; ctx.strokeStyle = 'rgba(20, 13, 7, .8)'
    ctx.strokeText(label, size / 2, size / 2 + 10)
    ctx.fillStyle = '#fff7db'; ctx.fillText(label, size / 2, size / 2 + 10)
  })
  const material = new THREE.MeshBasicMaterial({ map: texture, alphaTest: .01, side: THREE.FrontSide })
  const s = sides === 4 ? .54 : sides >= 20 ? .48 : .5
  return new THREE.Mesh(new THREE.PlaneGeometry(s, s), material)
}

function addFaceLabels(core, faces, sides) {
  if (sides === 6) return
  const outward = new THREE.Vector3(0, 0, 1)
  faces.forEach(face => {
    const label = createFaceLabel(face.label, sides)
    label.position.copy(face.center).addScaledVector(face.normal, .012)
    label.quaternion.setFromUnitVectors(outward, face.normal)
    core.add(label)
  })
}

function topFaceLabel(quaternion, faces) {
  const rotation = new THREE.Quaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w)
  return faces.map(face => ({ label: face.label, height: face.normal.clone().applyQuaternion(rotation).y }))
    .sort((a, b) => b.height - a.height)[0].label
}

function randomTarget(index, total, sides) {
  const columns = Math.ceil(Math.sqrt(total * 1.35))
  const row = Math.floor(index / columns)
  const col = index % columns
  const x = (col - (columns - 1) / 2) * 1.55 + (Math.random() - .5) * .28
  const z = (row - (Math.ceil(total / columns) - 1) / 2) * 1.45 + (Math.random() - .5) * .28
  return new THREE.Vector3(THREE.MathUtils.clamp(x, -7.2, 7.2), restHeight(sides), THREE.MathUtils.clamp(z, -4.4, 4.4))
}

function createPhysicsWorld() {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -20, 0) })
  world.defaultContactMaterial.friction = .58; world.defaultContactMaterial.restitution = .18
  world.solver.iterations = 10
  const floor = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() })
  floor.position.y = TABLE_Y; floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0); world.addBody(floor)
  const addRC = (pos, he) => { const r = new CANNON.Body({ mass: 0, shape: new CANNON.Box(he) }); r.position.copy(pos); world.addBody(r) }
  addRC(new CANNON.Vec3(-8.72, 1.06, 0), new CANNON.Vec3(.22, .65, 5.84))
  addRC(new CANNON.Vec3(8.72, 1.06, 0), new CANNON.Vec3(.22, .65, 5.84))
  addRC(new CANNON.Vec3(0, 1.06, -5.66), new CANNON.Vec3(8.98, .65, .22))
  addRC(new CANNON.Vec3(0, 1.06, 5.66), new CANNON.Vec3(8.98, .65, .22))
  return world
}

function createPhysicsShape(sides) {
  return sides === 6 ? new CANNON.Box(new CANNON.Vec3(.625, .625, .625)) : new CANNON.Sphere(sides === 10 ? .72 : .84)
}

function simulateAll(diceList) {
  const world = createPhysicsWorld()
  const bodies = diceList.map(die => {
    const sides = die.sides
    const index = die.index
    const total = die.total
    const target = randomTarget(index, total, sides)
    const body = new CANNON.Body({
      mass: sides === 6 ? 1.15 : .95, shape: createPhysicsShape(sides),
      linearDamping: .13, angularDamping: .19, allowSleep: true, sleepSpeedLimit: .12, sleepTimeLimit: .45,
    })
    body.position.set(target.x + (Math.random() - .5) * 1.45, 4.8 + Math.random() * 2.4, target.z + (Math.random() - .5) * 1.2)
    body.velocity.set((Math.random() - .5) * 2.1, -.35, (Math.random() - .5) * 2.1)
    body.angularVelocity.set((Math.random() - .5) * 18, (Math.random() - .5) * 15, (Math.random() - .5) * 18)
    body.quaternion.setFromEuler(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI)
    world.addBody(body)
    return body
  })

  const allFrames = bodies.map(() => [])
  for (let step = 0; step < PHYSICS_STEPS; step += 1) {
    world.step(PHYSICS_STEP)
    bodies.forEach((body, i) => {
      allFrames[i].push({
        position: [body.position.x, body.position.y, body.position.z],
        quaternion: [body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w],
      })
    })
  }

  // De-overlap: push final positions apart if dice are intersecting
  const lastPositions = allFrames.map(frames => {
    const last = frames[frames.length - 1]
    return new THREE.Vector3(last.position[0], last.position[1], last.position[2])
  })

  for (let pass = 0; pass < 4; pass += 1) {
    for (let a = 0; a < lastPositions.length; a += 1) {
      for (let b = a + 1; b < lastPositions.length; b += 1) {
        const dx = lastPositions[a].x - lastPositions[b].x
        const dz = lastPositions[a].z - lastPositions[b].z
        const dist = Math.sqrt(dx * dx + dz * dz)
        const minDist = 1.15
        if (dist < minDist && dist > 0.001) {
          const push = (minDist - dist) / 2
          const nx = dx / dist
          const nz = dz / dist
          lastPositions[a].x += nx * push
          lastPositions[a].z += nz * push
          lastPositions[b].x -= nx * push
          lastPositions[b].z -= nz * push
        }
      }
    }
  }

  // Blend positions back in the last 20 frames to avoid a snap
  const blendStart = allFrames[0].length - 21
  for (let i = 0; i < allFrames.length; i += 1) {
    const frames = allFrames[i]
    const targetPos = lastPositions[i]
    for (let f = Math.max(0, blendStart); f < frames.length; f += 1) {
      const t = (f - blendStart) / (frames.length - 1 - blendStart)
      const eased = t * t * (3 - 2 * t)
      frames[f].position[0] += (targetPos.x - frames[f].position[0]) * eased
      frames[f].position[2] += (targetPos.z - frames[f].position[2]) * eased
    }
  }

  return allFrames
}

export class DiceTable {
  /** @param {HTMLElement} container */
  constructor(container) {
    this.container = container
    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(36, 1, .1, 100)

    this.dice = []
    this._previewDice = []
    this._stage = null
    this._stageTextures = []
    this._phase = { animating: false, startedAt: 0, duration: 0, settling: false, arranging: false }

    // Camera: spherical orbit around a lookAt pivot
    this._camPivot = new THREE.Vector3(0, .35, 0)
    this._camTheta = .86
    this._camPhi = .79
    this._camRadius = 18.2
    this._targetTheta = this._camTheta
    this._targetPhi = this._camPhi
    this._targetRadius = this._camRadius
    this._cameraAnimating = false

    this._render = this.render.bind(this)

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    container.appendChild(this.renderer.domElement)

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)

    this.createStage()
    this.resize()
    this._applyCamera()
    this.renderer.setAnimationLoop(this._render)
  }

  _applyCamera() {
    this.camera.position.set(
      this._camPivot.x + this._camRadius * Math.sin(this._camPhi) * Math.sin(this._camTheta),
      this._camPivot.y + this._camRadius * Math.cos(this._camPhi),
      this._camPivot.z + this._camRadius * Math.sin(this._camPhi) * Math.cos(this._camTheta),
    )
    this.camera.lookAt(this._camPivot)
  }

  // ── Preview ────────────────────────────────────────────────

  setPreview(groups) {
    this._clearPreview()
    if (!groups.length) return
    const allDice = []
    groups.forEach(g => {
      for (let i = 0; i < g.count; i++) allDice.push({ sides: g.sides })
    })
    const visible = allDice.slice(0, MAX_VISIBLE_DICE)

    // Place dice right in front of the camera
    const camPos = new THREE.Vector3(
      this._camPivot.x + this._camRadius * Math.sin(this._camPhi) * Math.sin(this._camTheta),
      this._camPivot.y + this._camRadius * Math.cos(this._camPhi),
      this._camPivot.z + this._camRadius * Math.sin(this._camPhi) * Math.cos(this._camTheta),
    )
    const dir = new THREE.Vector3().subVectors(this._camPivot, camPos).normalize()
    const center = camPos.clone().add(dir.clone().multiplyScalar(10.5))
    center.y += .8

    // Group by type, arranged in rows one behind the other
    const grouped = new Map()
    visible.forEach(d => {
      if (!grouped.has(d.sides)) grouped.set(d.sides, [])
      grouped.get(d.sides).push(d)
    })
    const entries = [...grouped.entries()]

    entries.forEach((entry, rowIndex) => {
      const sides = entry[0]
      const diceInGroup = entry[1]
      const zOff = rowIndex * 1.4 - (entries.length - 1) * .7
      const count = diceInGroup.length
      const spacing = Math.min(1.1, 3.2 / Math.max(count, 1))
      const startX = -((count - 1) * spacing) / 2
      diceInGroup.forEach((d, i) => {
        const pos = new THREE.Vector3(
          center.x + startX + i * spacing + (Math.random() - .5) * .15,
          center.y + (Math.random() - .5) * .2,
          center.z + zOff + (Math.random() - .5) * .12,
        )
        const preview = this._buildDieMesh(sides)
        preview.group.position.copy(pos)
        // Face the camera
        const camPos = new THREE.Vector3(
          this._camPivot.x + this._camRadius * Math.sin(this._camPhi) * Math.sin(this._camTheta),
          this._camPivot.y + this._camRadius * Math.cos(this._camPhi),
          this._camPivot.z + this._camRadius * Math.sin(this._camPhi) * Math.cos(this._camTheta),
        )
        preview.core.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 0, 1),
          new THREE.Vector3().subVectors(camPos, pos).normalize(),
        )
        // Add a slight random tilt for visual variety
        const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(
          (Math.random() - .5) * .08,
          0,
          (Math.random() - .5) * .08,
        ))
        preview.core.quaternion.multiply(tilt)
        this.scene.add(preview.group)
        this._previewDice.push(preview)
      })
    })
  }

  _createDieMesh(sides, geometry, faces) {
    const group = new THREE.Group()
    const core = new THREE.Group()
    const material = sides === 6
      ? createD6Materials()
      : new THREE.MeshStandardMaterial({ color: DIE_COLORS[sides] || DIE_COLORS[20], roughness: .3, metalness: .2 })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.castShadow = true; mesh.receiveShadow = true
    core.add(mesh)
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry, 22),
      new THREE.LineBasicMaterial({ color: sides === 6 ? 0x513b2b : 0x111827, transparent: true, opacity: .52 }),
    )
    core.add(edges)
    addFaceLabels(core, faces, sides)
    group.add(core)
    return { group, core, faces }
  }

  _buildDieMesh(sides) {
    const geometry = geometryFor(sides)
    const faces = faceDescriptors(geometry, sides)
    return this._createDieMesh(sides, geometry, faces)
  }

  _buildDieMeshWithFrames(sides, faces, frames) {
    const geometry = geometryFor(sides)
    const entry = this._createDieMesh(sides, geometry, faces)

    // Teleport to physics start position
    entry.group.position.fromArray(frames[0].position)
    entry.core.quaternion.fromArray(frames[0].quaternion)
    this.scene.add(entry.group)
    return {
      ...entry, sides,
      frames,
      nextPosition: new THREE.Vector3(),
      nextQuaternion: new THREE.Quaternion(),
    }
  }

  _clearPreview() {
    this._previewDice.forEach(p => {
      p.group.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose()
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material]
        materials.filter(Boolean).forEach(m => {
          if (m.map) m.map.dispose()
          m.dispose()
        })
      })
      this.scene.remove(p.group)
    })
    this._previewDice = []
  }

  // ── Roll ────────────────────────────────────────────────────

  roll(sceneDice) {
    this.clearDice()

    const visible = sceneDice.slice(0, MAX_VISIBLE_DICE)

    // Physics simulation (all dice in one world — mutual collisions)
    const diceWithMeta = visible.map((die, index) => {
      const temporaryGeometry = geometryFor(die.sides)
      const faces = faceDescriptors(temporaryGeometry, die.sides)
      temporaryGeometry.dispose()
      return { ...die, faces, index, total: visible.length }
    })
    const allFrames = simulateAll(diceWithMeta)

    diceWithMeta.forEach((die, i) => {
      const entry = this._buildDieMeshWithFrames(die.sides, die.faces, allFrames[i])
      entry.rollValue = die.rollValue
      this.dice.push(entry)
    })

    // Clear preview
    this._clearPreview()

    // Start physics animation — camera stays frozen
    this._phase = { animating: true, startedAt: performance.now(), duration: ROLL_DURATION, settling: false }
    this._cameraAnimating = false

    return ROLL_DURATION + CAMERA_DELAY_AFTER_PHYSICS + ARRANGE_DURATION
  }

  // ── Grid arrange (final polish) ─────────────────────────────

  _startArrange() {
    const count = this.dice.length
    const columns = Math.ceil(Math.sqrt(count * 1.4))
    const rows = Math.ceil(count / columns)
    const gap = .75
    const spacing = 1.25 + gap
    const gridW = (columns - 1) * spacing
    const gridD = (rows - 1) * spacing

    // Compute centroid of current positions
    const centroid = new THREE.Vector3()
    this.dice.forEach(d => centroid.add(d.group.position))
    centroid.divideScalar(count)

    // Store start state and compute target grid positions
    this.dice.forEach((entry, index) => {
      const col = index % columns
      const row = Math.floor(index / columns)
      const gx = centroid.x - gridW / 2 + col * spacing
      const gz = centroid.z - gridD / 2 + row * spacing

      entry._arrangeTargetPos = new THREE.Vector3(gx, centroid.y, gz)
      entry._arrangeStartPos = entry.group.position.clone()
      entry._arrangeStartQuat = entry.core.quaternion.clone()

      const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI * 2)
      if (entry.rollValue) {
        const face = entry.faces[entry.rollValue - 1]
        const up = new THREE.Quaternion().setFromUnitVectors(face.normal, new THREE.Vector3(0, 1, 0))
        entry._arrangeTargetQuat = yaw.multiply(up)
      } else if (entry.sides === 6) {
        // Keep the same top face value from physics, make cube upright.
        const currentLabel = topFaceLabel(entry._arrangeStartQuat, entry.faces)
        const topNormal = D6_FACE_NORMALS[parseInt(currentLabel, 10)] || new THREE.Vector3(0, 1, 0)
        const up = new THREE.Quaternion().setFromUnitVectors(topNormal, new THREE.Vector3(0, 1, 0))
        entry._arrangeTargetQuat = yaw.multiply(up)
      } else {
        entry._arrangeTargetQuat = yaw
      }
    })

    // Camera framing for the grid
    const maxDistSq = this.dice.reduce((max, entry) => {
      const d = entry._arrangeTargetPos.distanceToSquared(centroid)
      return Math.max(max, d)
    }, 0)
    const boundRadius = Math.max(Math.sqrt(maxDistSq), 1.5)
    const vFov = this.camera.fov * Math.PI / 180
    const hFov = 2 * Math.atan(this.camera.aspect * Math.tan(vFov / 2))
    const arrangeRadius = Math.max(boundRadius / Math.tan(vFov / 2), boundRadius / Math.tan(hFov / 2)) * 1.45

    // Stop physics, start simultaneous arrange + camera animation
    this._phase.animating = false
    this._phase.arranging = true
    this._phase.arrangeStart = performance.now()
    this._phase.arrangeDuration = ARRANGE_DURATION

    this._camPivot.copy(centroid)
    this._targetTheta = 0
    this._targetPhi = .12
    this._targetRadius = arrangeRadius
    this._cameraAnimating = true
  }

  clearDice() {
    this.dice.forEach(entry => {
      entry.group.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose()
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material]
        materials.filter(Boolean).forEach(m => {
          if (m.map) m.map.dispose()
          m.dispose()
        })
      })
      this.scene.remove(entry.group)
      delete entry._arrangeTargetPos
      delete entry._arrangeStartPos
      delete entry._arrangeTargetQuat
      delete entry._arrangeStartQuat
    })
    this.dice = []
    this._phase.arranging = false
  }

  // ── Reset ────────────────────────────────────────────────────

  resetAll() {
    this.clearDice()
    this._clearPreview()
    this._phase = { animating: false, startedAt: 0, duration: 0, settling: false, arranging: false }
    this._camPivot.set(0, .35, 0)
    this._targetTheta = .86
    this._targetPhi = .79
    this._targetRadius = 18.2
    this._cameraAnimating = true
  }

  resize() {
    const { width, height } = this.container.getBoundingClientRect()
    if (!width || !height) return
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height, false)
  }

  // ── Render loop ─────────────────────────────────────────────

  render(now) {
    // Camera: spherical lerp (arrange or reset)
    if (this._cameraAnimating) {
      this._camTheta += (this._targetTheta - this._camTheta) * .055
      this._camPhi += (this._targetPhi - this._camPhi) * .055
      this._camRadius += (this._targetRadius - this._camRadius) * .055
      const dTheta = Math.abs(this._camTheta - this._targetTheta)
      const dPhi = Math.abs(this._camPhi - this._targetPhi)
      if (dTheta + dPhi < .0005) {
        this._camTheta = this._targetTheta
        this._camPhi = this._targetPhi
        this._camRadius = this._targetRadius
        this._cameraAnimating = false
      }
    }
    this._applyCamera()

    // Physics playback
    if (this._phase.animating) {
      const elapsed = now - this._phase.startedAt

      this.dice.forEach(die => {
        const fp = Math.max(0, elapsed / (PHYSICS_STEP * 1000))
        const fi = Math.min(Math.floor(fp), die.frames.length - 1)
        const ni = Math.min(fi + 1, die.frames.length - 1)
        const interp = fp - Math.floor(fp)
        const cur = die.frames[fi]
        const nxt = die.frames[ni]
        die.group.position.fromArray(cur.position).lerp(die.nextPosition.fromArray(nxt.position), interp)
        die.core.quaternion.fromArray(cur.quaternion).slerp(die.nextQuaternion.fromArray(nxt.quaternion), interp)
      })

      // Wait for dice to fully settle, then arrange grid + camera in one shot
      if (!this._phase.settling && elapsed > this._phase.duration + CAMERA_DELAY_AFTER_PHYSICS) {
        this._phase.settling = true
        this._startArrange()
      }
    }

    // Grid arrange animation (after physics + camera reveal)
    if (this._phase.arranging) {
      const t = Math.min((now - this._phase.arrangeStart) / this._phase.arrangeDuration, 1)
      const eased = t < .5 ? 2 * t * t : -1 + (4 - 2 * t) * t  // easeInOutQuad
      this.dice.forEach(die => {
        if (die._arrangeTargetPos) {
          die.group.position.lerpVectors(die._arrangeStartPos, die._arrangeTargetPos, eased)
          die.core.quaternion.slerpQuaternions(die._arrangeStartQuat, die._arrangeTargetQuat, eased)
        }
      })
      if (t >= 1) {
        this._phase.arranging = false
      }
    }

    this.renderer.render(this.scene, this.camera)
  }

  createStage() {
    this.scene.add(new THREE.HemisphereLight(0xffe8bd, 0x07101c, 2.7))
    const key = new THREE.DirectionalLight(0xffd797, 4.5)
    key.position.set(-5, 9, 5); key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    key.shadow.camera.left = -12; key.shadow.camera.right = 12
    key.shadow.camera.top = 12; key.shadow.camera.bottom = -12
    this.scene.add(key)
    const hearth = new THREE.PointLight(0xff7a31, 20, 13, 2)
    hearth.position.set(-4, 3, -2); this.scene.add(hearth)
    const rim = new THREE.PointLight(0x7c3aed, 18, 16, 2)
    rim.position.set(5, 4, -4); this.scene.add(rim)

    const loader = new THREE.TextureLoader()
    const tavernMap = loader.load('/tavern-wood.jpg')
    tavernMap.colorSpace = THREE.SRGBColorSpace
    tavernMap.wrapS = tavernMap.wrapT = THREE.RepeatWrapping
    tavernMap.repeat.set(1.4, 1); tavernMap.anisotropy = 4
    const plankMap = loader.load('/tavern-planks.jpg')
    plankMap.colorSpace = THREE.SRGBColorSpace
    plankMap.wrapS = plankMap.wrapT = THREE.RepeatWrapping
    plankMap.repeat.set(2.2, 1.6); plankMap.anisotropy = 4

    const table = new THREE.Group()
    const tw = new THREE.MeshStandardMaterial({ map: tavernMap, roughness: .55, metalness: .06 })
    const pw = new THREE.MeshStandardMaterial({ map: plankMap, roughness: .6, metalness: .04 })

    const base = new THREE.Mesh(new THREE.BoxGeometry(18.8, .64, 12.8), tw)
    base.position.y = .02; base.castShadow = true; base.receiveShadow = true; table.add(base)
    const surface = new THREE.Mesh(new THREE.BoxGeometry(17.6, .12, 11.6), pw)
    surface.position.y = .39; surface.receiveShadow = true; table.add(surface)

    const rg = new THREE.BoxGeometry(18.8, .5, .56)
    for (const z of [-5.98, 5.98]) { const r = new THREE.Mesh(rg, tw); r.position.set(0, .49, z); r.castShadow = true; table.add(r) }
    const srg = new THREE.BoxGeometry(.56, .5, 11.68)
    for (const x of [-9.08, 9.08]) { const r = new THREE.Mesh(srg, tw); r.position.set(x, .49, 0); r.castShadow = true; table.add(r) }
    this._stage = table
    this._stageTextures = [tavernMap, plankMap]
    this.scene.add(table)
  }

  destroy() {
    this.renderer.setAnimationLoop(null)
    this.resizeObserver.disconnect()
    this.clearDice()
    this._clearPreview()
    if (this._stage) {
      const materials = new Set()
      this._stage.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose()
        const objectMaterials = Array.isArray(obj.material) ? obj.material : [obj.material]
        objectMaterials.filter(Boolean).forEach(material => materials.add(material))
      })
      materials.forEach(material => material.dispose())
      this.scene.remove(this._stage)
      this._stage = null
    }
    this._stageTextures.forEach(texture => texture.dispose())
    this._stageTextures = []
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}

export { MAX_VISIBLE_DICE }
