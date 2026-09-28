// packages/codec-kit/dist/model-math/effects-sim.js
var EFFECT_COLLISION_TERRAIN = 1;
var EFFECT_COLLISION_OBJECTS = 2;
function combineEffectCollisionProviders(first, second) {
  if (!first)
    return second ?? null;
  if (!second)
    return first;
  const alternate = {
    position: new Float32Array(3),
    normal: new Float32Array(3)
  };
  const primaryPosition = new Float32Array(3);
  const primaryNormal = new Float32Array(3);
  return (query, out) => {
    const hitFirst = first(query, out);
    if (hitFirst) {
      primaryPosition.set(out.position);
      primaryNormal.set(out.normal);
    }
    const hitSecond = second(query, alternate);
    if (!hitFirst && !hitSecond)
      return false;
    if (!hitFirst) {
      out.position.set(alternate.position);
      out.normal.set(alternate.normal);
      return true;
    }
    if (hitSecond && squaredDistance3(query.startPosition, alternate.position) < squaredDistance3(query.startPosition, primaryPosition)) {
      out.position.set(alternate.position);
      out.normal.set(alternate.normal);
    } else {
      out.position.set(primaryPosition);
      out.normal.set(primaryNormal);
    }
    return true;
  };
}
function createEffectCollisionShapeProvider(shapes, anchorProvider) {
  const anchor = {
    position: new Float32Array(3),
    xAxis: new Float32Array(3),
    yAxis: new Float32Array(3),
    zAxis: new Float32Array(3)
  };
  const matrix = new Float32Array(16);
  const inverse = new Float32Array(16);
  const localStart = new Float32Array(3);
  const localEnd = new Float32Array(3);
  const localHit = new Float32Array(3);
  const localNormal = new Float32Array(3);
  const worldHit = new Float32Array(3);
  const worldNormal = new Float32Array(3);
  const vertexBounds = shapes.map(effectCollisionVertexBounds);
  let bestDistance = Number.POSITIVE_INFINITY;
  return (query, out) => {
    if ((query.collisionMask & EFFECT_COLLISION_OBJECTS) === 0)
      return false;
    bestDistance = Number.POSITIVE_INFINITY;
    let hit = false;
    for (let shapeIndex = 0; shapeIndex < shapes.length; shapeIndex += 1) {
      const shape = shapes[shapeIndex];
      const shapeMask = shape.collisionMask ?? EFFECT_COLLISION_OBJECTS;
      if ((query.collisionMask & shapeMask) === 0)
        continue;
      resetEffectCollisionAnchor(anchor);
      anchorProvider?.("projector", shapeIndex, shape.boneIndex, query.sequenceTimeSeconds, anchor);
      composeEffectCollisionMatrix(matrix, anchor, shape.matrix);
      if (!invertEffectCollisionMatrix(inverse, matrix))
        continue;
      transformEffectCollisionPoint(localStart, inverse, query.startPosition);
      transformEffectCollisionPoint(localEnd, inverse, query.endPosition);
      if (!intersectEffectCollisionShape(shape, vertexBounds[shapeIndex] ?? null, localStart, localEnd, localHit, localNormal)) {
        continue;
      }
      transformEffectCollisionPoint(worldHit, matrix, localHit);
      const distance = squaredDistance3(query.startPosition, worldHit);
      if (distance >= bestDistance)
        continue;
      bestDistance = distance;
      transformEffectCollisionNormal(worldNormal, inverse, localNormal);
      out.position.set(worldHit);
      out.normal.set(worldNormal);
      hit = true;
    }
    return hit;
  };
}
var DEFAULT_EFFECT_SIMULATION_OPTIONS = Object.freeze({
  seed: 1831565813,
  maxParticles: 2048,
  maxRibbons: 512,
  maxParticlesPerEmitter: 512,
  maxRibbonsPerEmitter: 256,
  maxProjectorSplats: 128,
  maxSpawnPerStep: 256,
  fixedStepSeconds: 1 / 60,
  maxSeekSteps: 36e3
});
var MAX_EFFECT_RIBBON_SIDES = 32;
var MAX_EFFECT_SPLINE_DIVISIONS = 128;
function effectRibbonRingVertexCount(ribbonType, sides) {
  if (ribbonType !== "cylinder" && ribbonType !== "star")
    return 2;
  const edgeCount = boundedInteger(sides, 3, 3, MAX_EFFECT_RIBBON_SIDES);
  return (ribbonType === "star" ? edgeCount * 2 : edgeCount) + 1;
}
function writeEffectRibbonRingPositions(out, vertexOffset, stride, center, tangent, planarUp, cameraDirection, halfWidth, ribbonType, sides, starRatio) {
  let tangentX = finiteNumber(tangent[0], 1);
  let tangentY = finiteNumber(tangent[1], 0);
  let tangentZ = finiteNumber(tangent[2], 0);
  let tangentLength = Math.hypot(tangentX, tangentY, tangentZ);
  if (!(tangentLength > 1e-8)) {
    tangentX = 1;
    tangentY = 0;
    tangentZ = 0;
    tangentLength = 1;
  }
  tangentX /= tangentLength;
  tangentY /= tangentLength;
  tangentZ /= tangentLength;
  let binormalX;
  let binormalY;
  let binormalZ;
  if (ribbonType === "billboard" || ribbonType === void 0) {
    const cameraX = finiteNumber(cameraDirection[0], 0);
    const cameraY = finiteNumber(cameraDirection[1], 0);
    const cameraZ = finiteNumber(cameraDirection[2], 1);
    binormalX = cameraY * tangentZ - cameraZ * tangentY;
    binormalY = cameraZ * tangentX - cameraX * tangentZ;
    binormalZ = cameraX * tangentY - cameraY * tangentX;
  } else {
    const upX = finiteNumber(planarUp[0], 0);
    const upY = finiteNumber(planarUp[1], 1);
    const upZ = finiteNumber(planarUp[2], 0);
    const alongTangent = upX * tangentX + upY * tangentY + upZ * tangentZ;
    binormalX = upX - tangentX * alongTangent;
    binormalY = upY - tangentY * alongTangent;
    binormalZ = upZ - tangentZ * alongTangent;
  }
  let binormalLength = Math.hypot(binormalX, binormalY, binormalZ);
  if (!(binormalLength > 1e-8)) {
    const useZAxis = Math.abs(tangentZ) < 0.9;
    const upX = 0;
    const upY = useZAxis ? 0 : 1;
    const upZ = useZAxis ? 1 : 0;
    const alongTangent = upX * tangentX + upY * tangentY + upZ * tangentZ;
    binormalX = upX - tangentX * alongTangent;
    binormalY = upY - tangentY * alongTangent;
    binormalZ = upZ - tangentZ * alongTangent;
    binormalLength = Math.hypot(binormalX, binormalY, binormalZ) || 1;
  }
  binormalX /= binormalLength;
  binormalY /= binormalLength;
  binormalZ /= binormalLength;
  let normalX = tangentY * binormalZ - tangentZ * binormalY;
  let normalY = tangentZ * binormalX - tangentX * binormalZ;
  let normalZ = tangentX * binormalY - tangentY * binormalX;
  const normalLength = Math.hypot(normalX, normalY, normalZ) || 1;
  normalX /= normalLength;
  normalY /= normalLength;
  normalZ /= normalLength;
  const centerX = finiteNumber(center[0], 0);
  const centerY = finiteNumber(center[1], 0);
  const centerZ = finiteNumber(center[2], 0);
  const radius = Math.max(0, finiteNumber(halfWidth, 0));
  const vertexCount = effectRibbonRingVertexCount(ribbonType, sides);
  if (vertexCount === 2) {
    writeRibbonPosition(out, vertexOffset, stride, centerX, centerY, centerZ, binormalX, binormalY, binormalZ, radius);
    writeRibbonPosition(out, vertexOffset + 1, stride, centerX, centerY, centerZ, binormalX, binormalY, binormalZ, -radius);
    return vertexCount;
  }
  const segments = vertexCount - 1;
  const innerRadius = clamp01(finiteNumber(starRatio, 0.5));
  for (let index = 0; index <= segments; index += 1) {
    const angle = index / segments * Math.PI * 2;
    const scale = ribbonType === "star" && index % 2 === 1 ? innerRadius : 1;
    const offsetX = (normalX * Math.cos(angle) + binormalX * Math.sin(angle)) * radius * scale;
    const offsetY = (normalY * Math.cos(angle) + binormalY * Math.sin(angle)) * radius * scale;
    const offsetZ = (normalZ * Math.cos(angle) + binormalZ * Math.sin(angle)) * radius * scale;
    const offset = (vertexOffset + index) * stride;
    out[offset] = centerX + offsetX;
    out[offset + 1] = centerY + offsetY;
    out[offset + 2] = centerZ + offsetZ;
  }
  return vertexCount;
}
function writeRibbonPosition(out, vertex, stride, centerX, centerY, centerZ, axisX, axisY, axisZ, scale) {
  const offset = vertex * stride;
  out[offset] = centerX + axisX * scale;
  out[offset + 1] = centerY + axisY * scale;
  out[offset + 2] = centerZ + axisZ * scale;
}
var HARD_MAX_PARTICLES = 65536;
var HARD_MAX_RIBBONS = 16384;
var HARD_MAX_PROJECTOR_SPLATS = 4096;
var HARD_MAX_SPAWN_PER_STEP = 4096;
var HARD_MAX_SEEK_STEPS = 216e3;
var TIME_EPSILON = 1e-7;
var EMISSION_EPSILON = 1e-9;
var ModelEffectSimulation = class {
  effects;
  particles;
  ribbons;
  projectorSplats;
  particlePool;
  ribbonPool;
  projectorSplatPool;
  particleEmission;
  ribbonEmission;
  lastSquirtKeys;
  particleLimits;
  ribbonLimits;
  particleShapeCodes;
  particleMeshSamplers;
  particleSplinePoints;
  forceAnchors;
  warpAnchors;
  collisionProvider;
  anchor = {
    position: new Float32Array(3),
    xAxis: new Float32Array(3),
    yAxis: new Float32Array(3),
    zAxis: new Float32Array(3)
  };
  splineAnchor0 = createEffectAnchor();
  splineAnchor1 = createEffectAnchor();
  splinePoint0 = new Float32Array(3);
  splinePoint1 = new Float32Array(3);
  splineTangent0 = new Float32Array(3);
  splineTangent1 = new Float32Array(3);
  splineUp0 = new Float32Array(3);
  splineUp1 = new Float32Array(3);
  inheritedVelocity = new Float32Array(3);
  particleAnchorPositions;
  particleAnchorTimes;
  particleAnchorValid;
  ribbonAnchorPositions;
  ribbonAnchorTimes;
  ribbonAnchorValid;
  collisionQuery = {
    emitterKind: "particle",
    emitterIndex: 0,
    slot: 0,
    collisionMask: 0,
    space: 0,
    sequenceTimeSeconds: 0,
    startPosition: new Float32Array(3),
    endPosition: new Float32Array(3),
    velocity: new Float32Array(3)
  };
  collisionResult = {
    position: new Float32Array(3),
    normal: new Float32Array(3)
  };
  /** Collision child emission is deferred until particle integration completes. */
  collisionSpawnEmitterIndices;
  collisionSpawnTypes;
  collisionSpawnPositions;
  collisionSpawnEnergy;
  /** Particle-bounce ribbon emission is deferred until normal ribbon integration completes. */
  bounceRibbonEmitterIndices;
  bounceRibbonPositions;
  spawnPosition = new Float32Array(3);
  randomSource = () => this.random();
  seekFrame = {
    sequenceId: null,
    sequenceTimeSeconds: 0,
    animationTime: 0,
    allowSpawn: true,
    anchorProvider: null
  };
  stats = {
    timeSeconds: 0,
    activeParticles: 0,
    activeRibbons: 0,
    activeProjectorSplats: 0,
    spawnedParticles: 0,
    spawnedRibbons: 0,
    spawnedProjectorSplats: 0,
    killedParticles: 0,
    collidedParticles: 0,
    killedRibbons: 0,
    killedProjectorSplats: 0,
    droppedParticles: 0,
    droppedRibbons: 0,
    droppedProjectorSplats: 0,
    seekClamped: false
  };
  initialSeed;
  maxSpawnPerStep;
  fixedStepSeconds;
  maxSeekSteps;
  randomState;
  sequenceId = null;
  timeSeconds = 0;
  collisionSpawnCount = 0;
  bounceRibbonSpawnCount = 0;
  constructor(effects, options = {}) {
    this.effects = effects;
    const particleCapacity = boundedInteger(options.maxParticles, DEFAULT_EFFECT_SIMULATION_OPTIONS.maxParticles, 0, HARD_MAX_PARTICLES);
    const ribbonCapacity = boundedInteger(options.maxRibbons, DEFAULT_EFFECT_SIMULATION_OPTIONS.maxRibbons, 0, HARD_MAX_RIBBONS);
    const projectorSplatCapacity = boundedInteger(options.maxProjectorSplats, DEFAULT_EFFECT_SIMULATION_OPTIONS.maxProjectorSplats, 0, HARD_MAX_PROJECTOR_SPLATS);
    const particlePerEmitter = boundedInteger(options.maxParticlesPerEmitter, DEFAULT_EFFECT_SIMULATION_OPTIONS.maxParticlesPerEmitter, 0, particleCapacity);
    const ribbonPerEmitter = boundedInteger(options.maxRibbonsPerEmitter, DEFAULT_EFFECT_SIMULATION_OPTIONS.maxRibbonsPerEmitter, 0, ribbonCapacity);
    this.initialSeed = normalizeSeed(options.seed ?? DEFAULT_EFFECT_SIMULATION_OPTIONS.seed);
    this.randomState = this.initialSeed;
    this.collisionProvider = combineEffectCollisionProviders(options.collisionProvider, options.collisionShapes && options.collisionShapes.length > 0 ? createEffectCollisionShapeProvider(options.collisionShapes, options.collisionAnchorProvider) : null);
    this.maxSpawnPerStep = boundedInteger(options.maxSpawnPerStep, DEFAULT_EFFECT_SIMULATION_OPTIONS.maxSpawnPerStep, 1, HARD_MAX_SPAWN_PER_STEP);
    this.fixedStepSeconds = boundedPositive(options.fixedStepSeconds, DEFAULT_EFFECT_SIMULATION_OPTIONS.fixedStepSeconds, 1);
    this.maxSeekSteps = boundedInteger(options.maxSeekSteps, DEFAULT_EFFECT_SIMULATION_OPTIONS.maxSeekSteps, 1, HARD_MAX_SEEK_STEPS);
    this.collisionSpawnEmitterIndices = new Uint32Array(this.maxSpawnPerStep);
    this.collisionSpawnTypes = new Uint8Array(this.maxSpawnPerStep);
    this.collisionSpawnPositions = new Float32Array(this.maxSpawnPerStep * 3);
    this.collisionSpawnEnergy = new Float32Array(this.maxSpawnPerStep);
    this.bounceRibbonEmitterIndices = new Uint32Array(this.maxSpawnPerStep);
    this.bounceRibbonPositions = new Float32Array(this.maxSpawnPerStep * 3);
    this.particlePool = createSlotPool(particleCapacity);
    this.ribbonPool = createSlotPool(ribbonCapacity);
    this.projectorSplatPool = createSlotPool(projectorSplatCapacity);
    this.particles = createParticleState(particleCapacity, effects.particles.length, this.particlePool);
    this.ribbons = createRibbonState(ribbonCapacity, effects.ribbons.length, this.ribbonPool);
    this.projectorSplats = createProjectorSplatState(projectorSplatCapacity, this.projectorSplatPool);
    this.particleEmission = new Float64Array(effects.particles.length);
    this.ribbonEmission = new Float64Array(effects.ribbons.length);
    this.particleAnchorPositions = new Float32Array(effects.particles.length * 3);
    this.particleAnchorTimes = new Float64Array(effects.particles.length);
    this.particleAnchorValid = new Uint8Array(effects.particles.length);
    this.ribbonAnchorPositions = new Float32Array(effects.ribbons.length * 3);
    this.ribbonAnchorTimes = new Float64Array(effects.ribbons.length);
    this.ribbonAnchorValid = new Uint8Array(effects.ribbons.length);
    this.lastSquirtKeys = new Int32Array(effects.particles.length);
    this.particleLimits = new Uint32Array(effects.particles.length);
    this.ribbonLimits = new Uint32Array(effects.ribbons.length);
    this.particleShapeCodes = new Uint8Array(effects.particles.length);
    this.particleMeshSamplers = effects.particles.map((emitter) => createParticleMeshSampler(emitter.emitShapeMeshes));
    this.particleSplinePoints = effects.particles.map((emitter) => emitter.emitShapePoints?.map((point) => [point[0], point[1], point[2]]) ?? null);
    this.forceAnchors = (effects.forces ?? []).map(createEffectAnchor);
    this.warpAnchors = (effects.warps ?? []).map(createEffectAnchor);
    for (let index = 0; index < effects.particles.length; index += 1) {
      const emitter = effects.particles[index];
      const emitterLimit = finiteNonNegativeInteger(emitter.maxParticles);
      this.particleLimits[index] = Math.min(particlePerEmitter, emitterLimit ?? particlePerEmitter);
      this.particleShapeCodes[index] = particleShapeCode(emitter.emitShape);
    }
    this.ribbonLimits.fill(ribbonPerEmitter);
    this.reset();
  }
  /** Clears live state and restarts the seeded random stream. */
  reset(sequenceId = this.sequenceId, seed = this.initialSeed) {
    resetSlotPool(this.particlePool);
    resetSlotPool(this.ribbonPool);
    resetSlotPool(this.projectorSplatPool);
    this.particles.activeCount = 0;
    this.particles.emitterCounts.fill(0);
    this.ribbons.activeCount = 0;
    this.projectorSplats.activeCount = 0;
    this.ribbons.emitterCounts.fill(0);
    this.ribbons.previousSlots.fill(-1);
    this.ribbons.nextSlots.fill(-1);
    this.ribbons.firstSlots.fill(-1);
    this.ribbons.lastSlots.fill(-1);
    this.particleEmission.fill(0);
    this.ribbonEmission.fill(0);
    this.particleAnchorValid.fill(0);
    this.ribbonAnchorValid.fill(0);
    this.lastSquirtKeys.fill(-2);
    this.randomState = normalizeSeed(seed);
    this.sequenceId = sequenceId;
    this.timeSeconds = 0;
    this.clearStepStats();
    this.updateStats(false);
  }
  /**
   * Advances live state. A changed sequence id or backwards absolute time
   * resets first so objects from one timeline can never leak into another.
   */
  update(deltaSeconds, frame) {
    const delta = finiteNonNegative(deltaSeconds);
    const nextSequence = frame?.sequenceId === void 0 ? this.sequenceId : frame.sequenceId;
    const requestedTime = frame?.sequenceTimeSeconds === void 0 ? this.timeSeconds + delta : finiteNonNegative(frame.sequenceTimeSeconds);
    if (nextSequence !== this.sequenceId || requestedTime + TIME_EPSILON < this.timeSeconds) {
      this.reset(nextSequence);
    }
    this.clearStepStats();
    this.advance(delta, requestedTime, frame?.animationTime === void 0 ? requestedTime : finiteNumber(frame.animationTime, requestedTime), frame?.allowSpawn ?? true, frame?.anchorProvider ?? null);
    this.updateStats(false);
    return this.stats;
  }
  /**
   * Deterministically rebuilds live state from sequence time zero. Long seeks
   * are bounded by maxSeekSteps; when clamped, the target interval is divided
   * evenly across that budget and `stats.seekClamped` is set.
   */
  seek(targetSeconds, sampler, sequenceId = this.sequenceId) {
    const target = finiteNonNegative(targetSeconds);
    this.reset(sequenceId);
    this.clearStepStats();
    if (target === 0) {
      this.updateStats(false);
      return this.stats;
    }
    const desiredSteps = Math.max(1, Math.ceil(target / this.fixedStepSeconds));
    const stepCount = Math.min(desiredSteps, this.maxSeekSteps);
    const step = target / stepCount;
    for (let index = 0; index < stepCount; index += 1) {
      const time = index === stepCount - 1 ? target : (index + 1) * step;
      const frame = this.seekFrame;
      frame.sequenceId = sequenceId;
      frame.sequenceTimeSeconds = time;
      frame.animationTime = time;
      frame.allowSpawn = true;
      frame.anchorProvider = null;
      sampler?.(time, frame);
      this.advance(step, time, finiteNumber(frame.animationTime, time), frame.allowSpawn, frame.anchorProvider);
    }
    this.updateStats(desiredSteps > this.maxSeekSteps);
    return this.stats;
  }
  advance(delta, sequenceTime, animationTime, allowSpawn, anchorProvider) {
    this.updateEffectFieldAnchors(sequenceTime, anchorProvider);
    this.updateProjectorSplats(delta);
    this.updateParticles(delta, sequenceTime, animationTime);
    this.updateRibbons(delta, animationTime);
    this.flushBounceRibbons(animationTime);
    this.updateSplineRibbons(sequenceTime, animationTime, anchorProvider);
    if (allowSpawn && delta > 0) {
      this.spawnParticles(delta, sequenceTime, animationTime, anchorProvider);
      this.spawnRibbons(delta, sequenceTime, animationTime, anchorProvider);
    }
    this.timeSeconds = sequenceTime;
  }
  updateParticles(delta, sequenceTime, animationTime) {
    const state = this.particles;
    let activeIndex = 0;
    while (activeIndex < this.particlePool.activeCount) {
      const slot = state.activeSlots[activeIndex];
      const age = state.ages[slot] + delta;
      if (age + TIME_EPSILON >= state.lifeSpans[slot]) {
        this.killParticle(slot);
        this.stats.killedParticles += 1;
        continue;
      }
      state.ages[slot] = age;
      const offset = slot * 3;
      const collisionMask = state.collisionMasks[slot];
      const checksCollision = this.collisionProvider !== null && collisionMask !== 0;
      if (checksCollision) {
        const start = this.collisionQuery.startPosition;
        start[0] = state.positions[offset];
        start[1] = state.positions[offset + 1];
        start[2] = state.positions[offset + 2];
      }
      const gravity = state.gravities[slot];
      const drag = state.drags[slot];
      this.applyParticleFields(slot, offset, delta);
      applyEffectNoise(state.positions, state.velocities, offset, emitterNoise(this.effects.particles[state.emitterIndices[slot]]), state.randomSeeds[slot], sequenceTime, delta);
      if (drag >= 0) {
        integrateAnalyticDrag(state.positions, state.velocities, offset, gravity, drag, delta);
      } else {
        state.velocities[offset + 2] = state.velocities[offset + 2] - gravity * delta;
        state.positions[offset] = state.positions[offset] + state.velocities[offset] * delta;
        state.positions[offset + 1] = state.positions[offset + 1] + state.velocities[offset + 1] * delta;
        state.positions[offset + 2] = state.positions[offset + 2] + state.velocities[offset + 2] * delta;
      }
      if (checksCollision && this.resolveParticleCollision(slot, offset, collisionMask, sequenceTime)) {
        this.stats.killedParticles += 1;
        continue;
      }
      this.queueParticleTrails(slot, offset, delta);
      activeIndex += 1;
    }
    this.flushCollisionChildren(animationTime);
    state.activeCount = this.particlePool.activeCount;
  }
  updateEffectFieldAnchors(sequenceTime, anchorProvider) {
    const forces = this.effects.forces ?? [];
    for (let index = 0; index < forces.length; index += 1) {
      const anchor = this.forceAnchors[index];
      prepareAnchor(anchor);
      anchorProvider?.("force", index, forces[index].boneIndex, sequenceTime, anchor);
    }
    const warps = this.effects.warps ?? [];
    for (let index = 0; index < warps.length; index += 1) {
      const anchor = this.warpAnchors[index];
      prepareAnchor(anchor);
      anchorProvider?.("warp", index, warps[index].boneIndex, sequenceTime, anchor);
    }
  }
  applyParticleFields(slot, offset, delta) {
    if (!(delta > 0))
      return;
    const state = this.particles;
    const emitter = this.effects.particles[state.emitterIndices[slot]];
    const channels = state.spaces[slot] === 0 ? (finiteNonNegativeInteger(emitter.worldForceChannels) ?? 0) | (finiteNonNegativeInteger(emitter.feedbackWorldForceChannels) ?? 0) : (finiteNonNegativeInteger(emitter.localForceChannels) ?? 0) | (finiteNonNegativeInteger(emitter.feedbackLocalForceChannels) ?? 0);
    const inverseMass = 1 / Math.max(1e-6, state.masses[slot]);
    const worldMassScale = state.spaces[slot] === 0 ? Math.max(0, finiteNumber(emitter.worldForceMassMultiplier, 1)) : 1;
    const forces = this.effects.forces ?? [];
    let explosionMask = state.explosionMasks[slot];
    for (let index = 0; index < forces.length; index += 1) {
      const force = forces[index];
      if (force.channels !== 0 && (channels & force.channels) === 0)
        continue;
      const anchor = this.forceAnchors[index];
      const influence = effectFieldInfluence(force, anchor, state.positions, offset);
      const bit = index < 32 ? 1 << index >>> 0 : 0;
      if (!(influence > 0)) {
        if (bit)
          explosionMask &= ~bit;
        continue;
      }
      if (force.type === "explosion" && bit && (explosionMask & bit) !== 0)
        continue;
      applyEffectForce(force, anchor, state.positions, state.velocities, offset, influence, force.type === "explosion" ? 1 : delta, inverseMass * worldMassScale * (force.type === "wind" ? Math.max(0, finiteNumber(emitter.windMultiplier, 1)) : 1));
      if (force.type === "explosion" && bit)
        explosionMask |= bit;
    }
    state.explosionMasks[slot] = explosionMask;
    const warps = this.effects.warps ?? [];
    for (let index = 0; index < warps.length; index += 1) {
      applyEffectWarp(warps[index], this.warpAnchors[index], state.positions, state.velocities, offset, delta);
    }
  }
  /** Returns true when collision-event culling killed the particle. */
  resolveParticleCollision(slot, offset, collisionMask, sequenceTime) {
    const provider = this.collisionProvider;
    if (!provider)
      return false;
    const state = this.particles;
    const query = this.collisionQuery;
    query.emitterKind = "particle";
    query.emitterIndex = state.emitterIndices[slot];
    query.slot = slot;
    query.collisionMask = collisionMask;
    query.space = state.spaces[slot];
    query.sequenceTimeSeconds = sequenceTime;
    copyVector3(query.endPosition, state.positions, offset);
    copyVector3(query.velocity, state.velocities, offset);
    const result = this.collisionResult;
    copyVector3(result.position, state.positions, offset);
    result.normal[0] = 0;
    result.normal[1] = 0;
    result.normal[2] = 1;
    if (!provider(query, result))
      return false;
    const normalLength = Math.hypot(result.normal[0], result.normal[1], result.normal[2]);
    if (!(Number.isFinite(normalLength) && normalLength > 1e-8))
      return false;
    const inverseNormalLength = 1 / normalLength;
    const normalX = result.normal[0] * inverseNormalLength;
    const normalY = result.normal[1] * inverseNormalLength;
    const normalZ = result.normal[2] * inverseNormalLength;
    const velocityX = state.velocities[offset];
    const velocityY = state.velocities[offset + 1];
    const velocityZ = state.velocities[offset + 2];
    const normalVelocity = velocityX * normalX + velocityY * normalY + velocityZ * normalZ;
    if (finiteVector3(result.position)) {
      copyVector3(state.positions, result.position, 0, offset);
    }
    if (!(normalVelocity < -TIME_EPSILON))
      return false;
    const tangentRetention = Math.max(0, 1 - state.frictions[slot]);
    const bounce = state.bounces[slot];
    const tangentX = velocityX - normalVelocity * normalX;
    const tangentY = velocityY - normalVelocity * normalY;
    const tangentZ = velocityZ - normalVelocity * normalZ;
    const reflectedNormalSpeed = -normalVelocity * bounce;
    state.velocities[offset] = tangentX * tangentRetention + normalX * reflectedNormalSpeed;
    state.velocities[offset + 1] = tangentY * tangentRetention + normalY * reflectedNormalSpeed;
    state.velocities[offset + 2] = tangentZ * tangentRetention + normalZ * reflectedNormalSpeed;
    const collisionCount = state.collisionCounts[slot] + 1;
    state.collisionCounts[slot] = collisionCount;
    this.stats.collidedParticles += 1;
    this.spawnCollisionProjector(slot, offset, normalX, normalY, normalZ);
    this.queueCollisionChildren(slot, offset);
    this.queueBounceRibbon(slot, offset);
    const maxEvents = state.maxCollisionEvents[slot];
    if (maxEvents > 0 && collisionCount >= maxEvents) {
      this.killParticle(slot);
      return true;
    }
    return false;
  }
  applyRibbonFields(slot, offset, delta) {
    if (!(delta > 0))
      return;
    const state = this.ribbons;
    const emitter = this.effects.ribbons[state.emitterIndices[slot]];
    const channels = state.spaces[slot] === 0 ? (finiteNonNegativeInteger(emitter.worldForceChannels) ?? 0) | (finiteNonNegativeInteger(emitter.feedbackWorldForceChannels) ?? 0) : (finiteNonNegativeInteger(emitter.localForceChannels) ?? 0) | (finiteNonNegativeInteger(emitter.feedbackLocalForceChannels) ?? 0);
    const inverseMass = 1 / Math.max(1e-6, state.masses[slot]);
    const worldMassScale = state.spaces[slot] === 0 ? Math.max(0, finiteNumber(emitter.worldForceMassMultiplier, 1)) : 1;
    let explosionMask = state.explosionMasks[slot];
    const forces = this.effects.forces ?? [];
    for (let index = 0; index < forces.length; index += 1) {
      const force = forces[index];
      if (force.channels !== 0 && (channels & force.channels) === 0)
        continue;
      const anchor = this.forceAnchors[index];
      const influence = effectFieldInfluence(force, anchor, state.positions, offset);
      const bit = index < 32 ? 1 << index >>> 0 : 0;
      if (!(influence > 0)) {
        if (bit)
          explosionMask &= ~bit;
        continue;
      }
      if (force.type === "explosion" && bit && (explosionMask & bit) !== 0)
        continue;
      applyEffectForce(force, anchor, state.positions, state.velocities, offset, influence, force.type === "explosion" ? 1 : delta, inverseMass * worldMassScale);
      if (force.type === "explosion" && bit)
        explosionMask |= bit;
    }
    state.explosionMasks[slot] = explosionMask;
    const warps = this.effects.warps ?? [];
    for (let index = 0; index < warps.length; index += 1) {
      applyEffectWarp(warps[index], this.warpAnchors[index], state.positions, state.velocities, offset, delta);
    }
  }
  resolveRibbonCollision(slot, offset, emitter, startX, startY, startZ) {
    const provider = this.collisionProvider;
    const state = this.ribbons;
    const collisionMask = state.collisionMasks[slot];
    if (!provider || collisionMask === 0)
      return;
    const query = this.collisionQuery;
    query.emitterKind = "ribbon";
    query.emitterIndex = state.emitterIndices[slot];
    query.slot = slot;
    query.collisionMask = collisionMask;
    query.space = state.spaces[slot];
    query.sequenceTimeSeconds = this.timeSeconds;
    query.startPosition[0] = startX;
    query.startPosition[1] = startY;
    query.startPosition[2] = startZ;
    copyVector3(query.endPosition, state.positions, offset);
    copyVector3(query.velocity, state.velocities, offset);
    const result = this.collisionResult;
    copyVector3(result.position, state.positions, offset);
    result.normal[0] = 0;
    result.normal[1] = 0;
    result.normal[2] = 1;
    if (!provider(query, result))
      return;
    const normalLength = Math.hypot(result.normal[0], result.normal[1], result.normal[2]);
    if (!(normalLength > 1e-8))
      return;
    const nx = result.normal[0] / normalLength;
    const ny = result.normal[1] / normalLength;
    const nz = result.normal[2] / normalLength;
    const vx = state.velocities[offset];
    const vy = state.velocities[offset + 1];
    const vz = state.velocities[offset + 2];
    const normalVelocity = vx * nx + vy * ny + vz * nz;
    if (finiteVector3(result.position))
      copyVector3(state.positions, result.position, 0, offset);
    if (!(normalVelocity < -TIME_EPSILON))
      return;
    const retention = Math.max(0, 1 - state.frictions[slot]);
    const reflected = -normalVelocity * state.bounces[slot];
    state.velocities[offset] = (vx - normalVelocity * nx) * retention + nx * reflected;
    state.velocities[offset + 1] = (vy - normalVelocity * ny) * retention + ny * reflected;
    state.velocities[offset + 2] = (vz - normalVelocity * nz) * retention + nz * reflected;
    this.stats.collidedParticles += 1;
    void emitter;
  }
  enforceRibbonLength(emitterIndex) {
    const emitter = this.effects.ribbons[emitterIndex];
    if (!emitter)
      return;
    const baseLimit = Math.max(0, sampleEffectSequenceScalar(emitter.sequenceAnimation?.maxLength, void 0, this.sequenceId, this.timeSeconds, finiteNumber(emitter.maxLength, 0)));
    if (!(baseLimit > 0))
      return;
    const state = this.ribbons;
    let current = state.lastSlots[emitterIndex];
    if (current < 0)
      return;
    const limit = baseLimit * Math.max(0, 1 + effectVariationValue(emitter.lengthVariation, state.ages[current], state.randomSeeds[current]));
    let accumulated = 0;
    while (current >= 0) {
      const previous = state.previousSlots[current];
      if (previous < 0)
        break;
      const currentOffset = current * 3;
      const previousOffset = previous * 3;
      const segment = Math.hypot(state.positions[currentOffset] - state.positions[previousOffset], state.positions[currentOffset + 1] - state.positions[previousOffset + 1], state.positions[currentOffset + 2] - state.positions[previousOffset + 2]);
      if (accumulated + segment > limit) {
        let doomed = previous;
        while (doomed >= 0) {
          const nextDoomed = state.previousSlots[doomed];
          this.killRibbon(doomed);
          this.stats.killedRibbons += 1;
          doomed = nextDoomed;
        }
        break;
      }
      accumulated += segment;
      current = previous;
    }
  }
  queueCollisionChildren(slot, offset) {
    const state = this.particles;
    const sourceEmitter = this.effects.particles[state.emitterIndices[slot]];
    if (!sourceEmitter)
      return;
    const targetIndex = finiteNonNegativeInteger(sourceEmitter.collisionEmitterIndex);
    if (targetIndex === null || targetIndex >= this.effects.particles.length)
      return;
    const rawChance = Math.max(0, finiteNumber(sourceEmitter.collisionEmitChance, 0));
    const chance = clamp01(rawChance > 1 ? rawChance / 100 : rawChance);
    if (!(chance > 0) || this.random() >= chance)
      return;
    const minimum = finiteNonNegativeInteger(sourceEmitter.collisionEmitMin) ?? 0;
    const maximum = Math.max(minimum, finiteNonNegativeInteger(sourceEmitter.collisionEmitMax) ?? minimum);
    const groups = minimum + Math.floor(this.random() * (maximum - minimum + 1));
    if (groups <= 0)
      return;
    const targetEmitter = this.effects.particles[targetIndex];
    const drawsHead = targetEmitter.head === true || targetEmitter.tail !== true;
    const drawsTail = targetEmitter.tail === true;
    const particlesPerGroup = (drawsHead ? 1 : 0) + (drawsTail ? 1 : 0);
    if (particlesPerGroup === 0)
      return;
    const requested = groups * particlesPerGroup;
    const available = this.maxSpawnPerStep - this.collisionSpawnCount;
    const queuedGroups = Math.min(groups, Math.floor(Math.max(0, available) / particlesPerGroup));
    const energy = Math.max(0, finiteNumber(sourceEmitter.collisionEmitEnergy, 1));
    for (let group = 0; group < queuedGroups; group += 1) {
      if (drawsHead)
        this.queueCollisionChild(targetIndex, 0, state.positions, offset, energy);
      if (drawsTail)
        this.queueCollisionChild(targetIndex, 1, state.positions, offset, energy);
    }
    this.stats.droppedParticles += requested - queuedGroups * particlesPerGroup;
  }
  spawnCollisionProjector(particleSlot, positionOffset, normalX, normalY, normalZ) {
    const source = this.effects.particles[this.particles.emitterIndices[particleSlot]];
    const projectorIndex = finiteNonNegativeInteger(source?.collisionProjectorIndex);
    const projector = projectorIndex === null ? void 0 : this.effects.projectors?.[projectorIndex];
    if (!source || projectorIndex === null || !projector)
      return;
    const rawChance = Math.max(0, finiteNumber(source.collisionProjectorChance, 0));
    const chance = clamp01(rawChance > 1 ? rawChance / 100 : rawChance);
    if (!(chance > 0) || this.random() >= chance)
      return;
    const slot = allocateSlot(this.projectorSplatPool);
    if (slot < 0) {
      this.stats.droppedProjectorSplats += 1;
      return;
    }
    const state = this.projectorSplats;
    state.projectorIndices[slot] = projectorIndex;
    state.ages[slot] = 0;
    state.attackTimes[slot] = randomProjectorStage(projector.lifetimeAttack, projector.lifetimeAttackTo, this.randomSource);
    state.holdTimes[slot] = randomProjectorStage(projector.lifetimeHold, projector.lifetimeHoldTo, this.randomSource);
    state.decayTimes[slot] = randomProjectorStage(projector.lifetimeDecay, projector.lifetimeDecayTo, this.randomSource);
    const authoredLife = state.attackTimes[slot] + state.holdTimes[slot] + state.decayTimes[slot];
    state.lifeSpans[slot] = authoredLife > TIME_EPSILON ? authoredLife : 1;
    state.alphas[slot] = clamp01(normalizeEffectAlpha(projector.alphaInit));
    const offset = slot * 3;
    state.positions[offset] = this.particles.positions[positionOffset];
    state.positions[offset + 1] = this.particles.positions[positionOffset + 1];
    state.positions[offset + 2] = this.particles.positions[positionOffset + 2];
    state.normals[offset] = normalX;
    state.normals[offset + 1] = normalY;
    state.normals[offset + 2] = normalZ;
    this.stats.spawnedProjectorSplats += 1;
  }
  queueBounceRibbon(slot, positionOffset) {
    const source = this.effects.particles[this.particles.emitterIndices[slot]];
    const emitterIndex = finiteNonNegativeInteger(source?.bounceRibbonEmitterIndex);
    if (emitterIndex === null || emitterIndex >= this.effects.ribbons.length)
      return;
    const emitter = this.effects.ribbons[emitterIndex];
    if ((emitter.splineEndpoints?.length ?? 0) > 0)
      return;
    const rawChance = Math.max(0, finiteNumber(source?.bounceRibbonChance, 0));
    const chance = clamp01(rawChance > 1 ? rawChance / 100 : rawChance);
    if (!(chance > 0) || this.random() >= chance)
      return;
    const index = this.bounceRibbonSpawnCount;
    if (index >= this.maxSpawnPerStep) {
      this.stats.droppedRibbons += 1;
      return;
    }
    this.bounceRibbonEmitterIndices[index] = emitterIndex;
    const offset = index * 3;
    this.bounceRibbonPositions[offset] = this.particles.positions[positionOffset];
    this.bounceRibbonPositions[offset + 1] = this.particles.positions[positionOffset + 1];
    this.bounceRibbonPositions[offset + 2] = this.particles.positions[positionOffset + 2];
    this.bounceRibbonSpawnCount += 1;
  }
  flushBounceRibbons(animationTime) {
    for (let index = 0; index < this.bounceRibbonSpawnCount; index += 1) {
      const emitterIndex = this.bounceRibbonEmitterIndices[index];
      if (this.ribbonPool.freeCount === 0 || this.ribbons.emitterCounts[emitterIndex] >= this.ribbonLimits[emitterIndex]) {
        this.stats.droppedRibbons += 1;
        continue;
      }
      prepareAnchor(this.anchor);
      const offset = index * 3;
      this.anchor.position[0] = this.bounceRibbonPositions[offset];
      this.anchor.position[1] = this.bounceRibbonPositions[offset + 1];
      this.anchor.position[2] = this.bounceRibbonPositions[offset + 2];
      this.inheritedVelocity.fill(0);
      this.spawnRibbon(emitterIndex, this.effects.ribbons[emitterIndex], animationTime);
    }
    this.bounceRibbonSpawnCount = 0;
    this.ribbons.activeCount = this.ribbonPool.activeCount;
  }
  updateProjectorSplats(delta) {
    const state = this.projectorSplats;
    let activeIndex = 0;
    while (activeIndex < this.projectorSplatPool.activeCount) {
      const slot = state.activeSlots[activeIndex];
      const age = state.ages[slot] + delta;
      if (age + TIME_EPSILON >= state.lifeSpans[slot]) {
        releaseSlot(this.projectorSplatPool, slot);
        this.stats.killedProjectorSplats += 1;
        continue;
      }
      state.ages[slot] = age;
      const projector = this.effects.projectors?.[state.projectorIndices[slot]];
      if (projector) {
        const attack = state.attackTimes[slot];
        const hold = state.holdTimes[slot];
        const decay = state.decayTimes[slot];
        const alphaStart = normalizeEffectAlpha(projector.alphaInit);
        const alphaMiddle = normalizeEffectAlpha(projector.alphaMid);
        const alphaEnd = normalizeEffectAlpha(projector.alphaEnd);
        state.alphas[slot] = clamp01(age < attack ? lerpEffectValue(alphaStart, alphaMiddle, attack > 0 ? age / attack : 1) : age < attack + hold ? alphaMiddle : lerpEffectValue(alphaMiddle, alphaEnd, decay > 0 ? (age - attack - hold) / decay : 1));
      }
      activeIndex += 1;
    }
  }
  queueParticleTrails(slot, offset, delta) {
    const state = this.particles;
    const sourceEmitter = this.effects.particles[state.emitterIndices[slot]];
    if (!sourceEmitter)
      return;
    const targetIndex = finiteNonNegativeInteger(sourceEmitter.trailEmitterIndex);
    if (targetIndex === null || targetIndex >= this.effects.particles.length)
      return;
    const rate = Math.max(0, finiteNumber(sourceEmitter.trailEmitRate, 0));
    if (!(rate > 0))
      return;
    const chanceValue = Math.max(0, finiteNumber(sourceEmitter.trailEmitChance, 1));
    const chance = clamp01(chanceValue > 1 ? chanceValue / 100 : chanceValue);
    let debt = state.trailEmission[slot] + rate * delta;
    let groups = Math.floor(debt + EMISSION_EPSILON);
    debt -= groups;
    const target = this.effects.particles[targetIndex];
    while (groups-- > 0) {
      if (this.random() > chance)
        continue;
      if (target.head === true || target.tail !== true) {
        this.queueCollisionChild(targetIndex, 0, state.positions, offset, 1);
      }
      if (target.tail === true)
        this.queueCollisionChild(targetIndex, 1, state.positions, offset, 1);
    }
    state.trailEmission[slot] = debt;
  }
  queueCollisionChild(emitterIndex, type, position, positionOffset, energy) {
    const index = this.collisionSpawnCount;
    if (index >= this.maxSpawnPerStep)
      return;
    this.collisionSpawnEmitterIndices[index] = emitterIndex;
    this.collisionSpawnTypes[index] = type;
    const offset = index * 3;
    this.collisionSpawnPositions[offset] = position[positionOffset];
    this.collisionSpawnPositions[offset + 1] = position[positionOffset + 1];
    this.collisionSpawnPositions[offset + 2] = position[positionOffset + 2];
    this.collisionSpawnEnergy[index] = energy;
    this.collisionSpawnCount += 1;
  }
  flushCollisionChildren(animationTime) {
    for (let index = 0; index < this.collisionSpawnCount; index += 1) {
      const emitterIndex = this.collisionSpawnEmitterIndices[index];
      if (this.particlePool.freeCount === 0 || this.particles.emitterCounts[emitterIndex] >= this.particleLimits[emitterIndex]) {
        this.stats.droppedParticles += 1;
        continue;
      }
      prepareAnchor(this.anchor);
      const offset = index * 3;
      this.anchor.position[0] = this.collisionSpawnPositions[offset];
      this.anchor.position[1] = this.collisionSpawnPositions[offset + 1];
      this.anchor.position[2] = this.collisionSpawnPositions[offset + 2];
      this.spawnParticle(emitterIndex, this.effects.particles[emitterIndex], this.collisionSpawnTypes[index] === 1 ? 1 : 0, animationTime, this.collisionSpawnEnergy[index]);
    }
    this.collisionSpawnCount = 0;
  }
  updateRibbons(delta, animationTime) {
    const state = this.ribbons;
    let activeIndex = 0;
    while (activeIndex < this.ribbonPool.activeCount) {
      const slot = state.activeSlots[activeIndex];
      const emitter = this.effects.ribbons[state.emitterIndices[slot]];
      if ((emitter.splineEndpoints?.length ?? 0) > 0) {
        activeIndex += 1;
        continue;
      }
      const age = state.ages[slot] + delta;
      const usesTimeLimit = emitter.lengthAndTime || !(finiteNumber(emitter.maxLength, 0) > 0);
      if (usesTimeLimit && age + TIME_EPSILON >= state.lifeSpans[slot]) {
        this.killRibbon(slot);
        this.stats.killedRibbons += 1;
        continue;
      }
      state.ages[slot] = age;
      const positionOffset = slot * 3;
      const vertexOffset = slot * 6;
      const oldX = state.positions[positionOffset];
      const oldY = state.positions[positionOffset + 1];
      const oldZ = state.positions[positionOffset + 2];
      this.applyRibbonFields(slot, positionOffset, delta);
      applyEffectNoise(state.positions, state.velocities, positionOffset, emitterNoise(emitter), state.randomSeeds[slot], this.timeSeconds + delta, delta);
      integrateVectorDrag(state.positions, state.velocities, positionOffset, state.gravities, positionOffset, state.drags[slot], delta);
      this.resolveRibbonCollision(slot, positionOffset, emitter, oldX, oldY, oldZ);
      const dx = state.positions[positionOffset] - oldX;
      const dy = state.positions[positionOffset + 1] - oldY;
      const dz = state.positions[positionOffset + 2] - oldZ;
      state.vertices[vertexOffset] = state.vertices[vertexOffset] + dx;
      state.vertices[vertexOffset + 1] = state.vertices[vertexOffset + 1] + dy;
      state.vertices[vertexOffset + 2] = state.vertices[vertexOffset + 2] + dz;
      state.vertices[vertexOffset + 3] = state.vertices[vertexOffset + 3] + dx;
      state.vertices[vertexOffset + 4] = state.vertices[vertexOffset + 4] + dy;
      state.vertices[vertexOffset + 5] = state.vertices[vertexOffset + 5] + dz;
      state.alphas[slot] = clamp01(sampleEffectSequenceScalar(emitter.sequenceAnimation?.alpha, emitter.animation?.alpha, this.sequenceId, animationTime, finiteNumber(emitter.alpha, 1) * (1 + effectVariationValue(emitter.alphaVariation, age, state.randomSeeds[slot]))));
      state.textureSlots[slot] = Math.max(0, Math.floor(sampleEffectSequenceScalar(emitter.sequenceAnimation?.textureSlot, emitter.animation?.textureSlot, this.sequenceId, animationTime, finiteNumber(emitter.textureSlot, 0))));
      activeIndex += 1;
    }
    state.activeCount = this.ribbonPool.activeCount;
    for (let emitterIndex = 0; emitterIndex < this.effects.ribbons.length; emitterIndex += 1) {
      this.enforceRibbonLength(emitterIndex);
    }
  }
  /** Rebuilds SRIB Bezier chains in place; spline rings are spatial, not time-emitted. */
  updateSplineRibbons(sequenceTime, animationTime, anchorProvider) {
    const state = this.ribbons;
    for (let emitterIndex = 0; emitterIndex < this.effects.ribbons.length; emitterIndex += 1) {
      const emitter = this.effects.ribbons[emitterIndex];
      const endpoints = emitter.splineEndpoints;
      if (!endpoints || endpoints.length === 0)
        continue;
      const visibility = sampleEffectSequenceScalar(emitter.sequenceAnimation?.visibility, emitter.animation?.visibility, this.sequenceId, animationTime, finiteNumber(emitter.visibility, 1));
      if (!(visibility > 0)) {
        this.clearRibbonEmitter(emitterIndex);
        continue;
      }
      const divisions = boundedInteger(Math.ceil(finiteNumber(emitter.divisions, 1)), 1, 1, MAX_EFFECT_SPLINE_DIVISIONS);
      const requestedCount = endpoints.length * divisions + 1;
      const targetCount = Math.min(requestedCount, this.ribbonLimits[emitterIndex]);
      const count = this.resizeSplineRibbon(emitterIndex, targetCount);
      if (count === 0)
        continue;
      const above = sampleEffectSequenceScalar(emitter.sequenceAnimation?.heightAbove, emitter.animation?.heightAbove, this.sequenceId, animationTime, finiteNumber(emitter.heightAbove, 0));
      const below = sampleEffectSequenceScalar(emitter.sequenceAnimation?.heightBelow, emitter.animation?.heightBelow, this.sequenceId, animationTime, finiteNumber(emitter.heightBelow, 0));
      const alpha = clamp01(sampleEffectSequenceScalar(emitter.sequenceAnimation?.alpha, emitter.animation?.alpha, this.sequenceId, animationTime, finiteNumber(emitter.alpha, 1)));
      const textureSlot = Math.max(0, Math.floor(sampleEffectSequenceScalar(emitter.sequenceAnimation?.textureSlot, emitter.animation?.textureSlot, this.sequenceId, animationTime, finiteNumber(emitter.textureSlot, 0))));
      let slot = state.firstSlots[emitterIndex];
      for (let ringIndex = 0; ringIndex < count && slot >= 0; ringIndex += 1) {
        const curvePhase = count <= 1 ? 0 : ringIndex / (count - 1);
        const scaledPhase = curvePhase * endpoints.length;
        const segmentIndex = Math.min(endpoints.length - 1, Math.floor(scaledPhase));
        const segmentPhase = segmentIndex === endpoints.length - 1 && curvePhase === 1 ? 1 : scaledPhase - segmentIndex;
        this.writeSplineControlPoint(emitterIndex, emitter, segmentIndex, true, sequenceTime, animationTime, anchorProvider, this.splineAnchor0, this.splinePoint0, this.splineTangent0, this.splineUp0);
        this.writeSplineControlPoint(emitterIndex, emitter, segmentIndex + 1, false, sequenceTime, animationTime, anchorProvider, this.splineAnchor1, this.splinePoint1, this.splineTangent1, this.splineUp1);
        const inversePhase = 1 - segmentPhase;
        const b0 = inversePhase * inversePhase * inversePhase;
        const b1 = 3 * inversePhase * inversePhase * segmentPhase;
        const b2 = 3 * inversePhase * segmentPhase * segmentPhase;
        const b3 = segmentPhase * segmentPhase * segmentPhase;
        const positionOffset = slot * 3;
        for (let component = 0; component < 3; component += 1) {
          const p0 = this.splinePoint0[component];
          const p1 = this.splinePoint1[component];
          state.positions[positionOffset + component] = b0 * p0 + b1 * (p0 + this.splineTangent0[component]) + b2 * (p1 - this.splineTangent1[component]) + b3 * p1;
        }
        this.applySplineNoise(state.positions, positionOffset, emitter, curvePhase, sequenceTime);
        let upX = this.splineUp0[0] * inversePhase + this.splineUp1[0] * segmentPhase;
        let upY = this.splineUp0[1] * inversePhase + this.splineUp1[1] * segmentPhase;
        let upZ = this.splineUp0[2] * inversePhase + this.splineUp1[2] * segmentPhase;
        const upLength = Math.hypot(upX, upY, upZ);
        if (upLength > 1e-8) {
          upX /= upLength;
          upY /= upLength;
          upZ /= upLength;
        } else {
          upX = 0;
          upY = 1;
          upZ = 0;
        }
        const vertexOffset = slot * 6;
        state.vertices[vertexOffset] = state.positions[positionOffset] + upX * above;
        state.vertices[vertexOffset + 1] = state.positions[positionOffset + 1] + upY * above;
        state.vertices[vertexOffset + 2] = state.positions[positionOffset + 2] + upZ * above;
        state.vertices[vertexOffset + 3] = state.positions[positionOffset] - upX * below;
        state.vertices[vertexOffset + 4] = state.positions[positionOffset + 1] - upY * below;
        state.vertices[vertexOffset + 5] = state.positions[positionOffset + 2] - upZ * below;
        state.ages[slot] = curvePhase;
        state.lifeSpans[slot] = 1;
        state.alphas[slot] = alpha;
        state.textureSlots[slot] = textureSlot;
        state.velocities.fill(0, positionOffset, positionOffset + 3);
        state.gravities.fill(0, positionOffset, positionOffset + 3);
        state.drags[slot] = 0;
        state.frictions[slot] = 0;
        state.bounces[slot] = 0;
        state.masses[slot] = 1;
        state.randomSeeds[slot] = curvePhase;
        state.explosionMasks[slot] = 0;
        state.collisionMasks[slot] = 0;
        state.spaces[slot] = emitter.modelSpace ? 1 : 0;
        slot = state.nextSlots[slot];
      }
    }
    state.activeCount = this.ribbonPool.activeCount;
  }
  resizeSplineRibbon(emitterIndex, targetCount) {
    const state = this.ribbons;
    while (state.emitterCounts[emitterIndex] > targetCount) {
      const slot = state.lastSlots[emitterIndex];
      if (slot < 0)
        break;
      this.killRibbon(slot);
      this.stats.killedRibbons += 1;
    }
    while (state.emitterCounts[emitterIndex] < targetCount && this.ribbonPool.freeCount > 0) {
      const slot = allocateSlot(this.ribbonPool);
      if (slot < 0)
        break;
      const previous = state.lastSlots[emitterIndex];
      state.emitterIndices[slot] = emitterIndex;
      state.previousSlots[slot] = previous;
      state.nextSlots[slot] = -1;
      if (previous >= 0)
        state.nextSlots[previous] = slot;
      else
        state.firstSlots[emitterIndex] = slot;
      state.lastSlots[emitterIndex] = slot;
      state.emitterCounts[emitterIndex] = state.emitterCounts[emitterIndex] + 1;
      this.stats.spawnedRibbons += 1;
    }
    return state.emitterCounts[emitterIndex];
  }
  clearRibbonEmitter(emitterIndex) {
    while (this.ribbons.firstSlots[emitterIndex] >= 0) {
      this.killRibbon(this.ribbons.firstSlots[emitterIndex]);
      this.stats.killedRibbons += 1;
    }
  }
  writeSplineControlPoint(emitterIndex, emitter, controlIndex, isSegmentStart, sequenceTime, animationTime, anchorProvider, anchor, point, tangent, up) {
    const endpoint = controlIndex > 0 ? emitter.splineEndpoints?.[controlIndex - 1] : void 0;
    const boneIndex = endpoint?.boneIndex ?? emitter.boneIndex;
    prepareAnchor(anchor);
    anchorProvider?.("ribbon", emitterIndex, boneIndex, sequenceTime, anchor);
    const emissionOffset = endpoint?.emissionOffset ?? emitter.emissionOffset ?? [0, 0, 0];
    writeBasisPoint(point, 0, anchor, finiteNumber(emissionOffset[0], 0), finiteNumber(emissionOffset[1], 0), finiteNumber(emissionOffset[2], 0));
    up.set(anchor.yAxis);
    const emissionVector = endpoint?.emissionVector ?? emitter.emissionVector ?? [0, 0, 1];
    const seed = (controlIndex + 1) * 0.61803398875;
    const endpointAnimation = endpoint?.sequenceAnimation;
    const yaw = endpoint ? sampleEffectSequenceScalar(endpointAnimation?.yaw, void 0, this.sequenceId, animationTime, finiteNumber(endpoint.yaw, 0)) + effectVariationValue(endpoint.yawVariation, sequenceTime, seed) : sampleEffectSequenceScalar(emitter.sequenceAnimation?.yaw, void 0, this.sequenceId, animationTime, finiteNumber(emitter.yaw, 0)) + effectVariationValue(emitter.yawVariation, sequenceTime, seed);
    const pitch = endpoint ? sampleEffectSequenceScalar(endpointAnimation?.pitch, void 0, this.sequenceId, animationTime, finiteNumber(endpoint.pitch, 0)) + effectVariationValue(endpoint.pitchVariation, sequenceTime, seed) : sampleEffectSequenceScalar(emitter.sequenceAnimation?.pitch, void 0, this.sequenceId, animationTime, finiteNumber(emitter.pitch, 0)) + effectVariationValue(emitter.pitchVariation, sequenceTime, seed);
    const yawRadians = yaw * Math.PI / 180;
    const pitchRadians = pitch * Math.PI / 180;
    const cosYaw = Math.cos(yawRadians);
    const sinYaw = Math.sin(yawRadians);
    const cosPitch = Math.cos(pitchRadians);
    const sinPitch = Math.sin(pitchRadians);
    const localX = finiteNumber(emissionVector[0], 0);
    const yawY = finiteNumber(emissionVector[1], 0) * cosYaw - finiteNumber(emissionVector[2], 1) * sinYaw;
    const yawZ = finiteNumber(emissionVector[1], 0) * sinYaw + finiteNumber(emissionVector[2], 1) * cosYaw;
    const rotatedX = localX * cosPitch + yawZ * sinPitch;
    const rotatedZ = -localX * sinPitch + yawZ * cosPitch;
    const authoredSpeed = endpoint ? sampleEffectSequenceScalar(endpointAnimation?.velocity, void 0, this.sequenceId, animationTime, finiteNumber(endpoint.velocity, 0)) : sampleEffectSequenceScalar(emitter.sequenceAnimation?.speed, void 0, this.sequenceId, animationTime, finiteNumber(emitter.speed, 0));
    const endpointFactor = endpoint ? sampleEffectSequenceScalar(isSegmentStart ? endpointAnimation?.velocityBaseFactor : endpointAnimation?.velocityEndFactor, void 0, this.sequenceId, animationTime, finiteNumber(isSegmentStart ? endpoint.velocityBaseFactor : endpoint.velocityEndFactor, 1)) : 1;
    const speedVariation = endpoint?.velocityVariation ?? emitter.speedVariation;
    const speed = authoredSpeed * endpointFactor * (1 + effectVariationValue(speedVariation, sequenceTime, seed));
    tangent[0] = (anchor.xAxis[0] * rotatedX + anchor.yAxis[0] * yawY + anchor.zAxis[0] * rotatedZ) * speed;
    tangent[1] = (anchor.xAxis[1] * rotatedX + anchor.yAxis[1] * yawY + anchor.zAxis[1] * rotatedZ) * speed;
    tangent[2] = (anchor.xAxis[2] * rotatedX + anchor.yAxis[2] * yawY + anchor.zAxis[2] * rotatedZ) * speed;
  }
  applySplineNoise(positions, offset, emitter, curvePhase, sequenceTime) {
    const amplitude = finiteNumber(emitter.noiseAmplitude, 0);
    const frequency = Math.abs(finiteNumber(emitter.noiseFrequency, 0));
    if (!(Math.abs(amplitude) > 1e-12 && frequency > 1e-12))
      return;
    const edge = Math.max(0, finiteNumber(emitter.noiseEdge, 0));
    const edgeScale = edge > 0 ? Math.min(1, curvePhase * edge) : 1;
    const phase = (curvePhase * frequency + sequenceTime * finiteNumber(emitter.noiseCohesion, 1)) * Math.PI * 2;
    positions[offset] = positions[offset] + Math.sin(phase + 0.17) * amplitude * edgeScale;
    positions[offset + 1] = positions[offset + 1] + Math.sin(phase * 1.31 + 2.27) * amplitude * edgeScale;
    positions[offset + 2] = positions[offset + 2] + Math.sin(phase * 0.73 + 4.11) * amplitude * edgeScale;
  }
  spawnParticles(delta, sequenceTime, animationTime, anchorProvider) {
    let remainingStepBudget = Math.max(0, this.maxSpawnPerStep - this.stats.spawnedParticles);
    for (let emitterIndex = 0; emitterIndex < this.effects.particles.length; emitterIndex += 1) {
      if (remainingStepBudget <= 0)
        break;
      const emitter = this.effects.particles[emitterIndex];
      const visibility = sampleEffectSequenceScalar(emitter.sequenceAnimation?.visibility, emitter.animation?.visibility, this.sequenceId, animationTime, finiteNumber(emitter.visibility, 1));
      if (!(visibility > 0))
        continue;
      const emissionRate = Math.max(0, sampleEffectSequenceScalar(emitter.sequenceAnimation?.emissionRate, emitter.animation?.emissionRate, this.sequenceId, animationTime, finiteNumber(emitter.emissionRate, 0)));
      if (emitter.squirt) {
        const hasEmitCount = emitter.emitCount !== void 0 || emitter.sequenceAnimation?.emitCount !== void 0;
        const squirtTracks = hasEmitCount ? emitter.sequenceAnimation?.emitCount : emitter.sequenceAnimation?.emissionRate;
        const squirtLegacyTrack = hasEmitCount ? void 0 : emitter.animation?.emissionRate;
        const squirtCount = Math.max(0, hasEmitCount ? sampleEffectSequenceScalar(squirtTracks, void 0, this.sequenceId, animationTime, finiteNumber(emitter.emitCount, 0)) : emissionRate);
        if (!(squirtCount > 0))
          continue;
        const key = effectScalarKeyIndex(squirtTracks, squirtLegacyTrack, this.sequenceId, animationTime);
        if (key !== this.lastSquirtKeys[emitterIndex]) {
          this.particleEmission[emitterIndex] = this.particleEmission[emitterIndex] + squirtCount;
          this.lastSquirtKeys[emitterIndex] = key;
        }
      } else {
        if (!(emissionRate > 0))
          continue;
        this.particleEmission[emitterIndex] = this.particleEmission[emitterIndex] + emissionRate * delta;
      }
      let groups = Math.floor(this.particleEmission[emitterIndex] + EMISSION_EPSILON);
      if (groups > 0) {
        prepareAnchor(this.anchor);
        anchorProvider?.("particle", emitterIndex, emitter.boneIndex, sequenceTime, this.anchor);
        this.sampleInheritedVelocity("particle", emitterIndex, sequenceTime);
      }
      while (groups > 0 && remainingStepBudget > 0) {
        const drawsHead = emitter.head === true || emitter.tail !== true;
        const drawsTail = emitter.tail === true;
        const required = (drawsHead ? 1 : 0) + (drawsTail ? 1 : 0);
        if (required > remainingStepBudget) {
          this.stats.droppedParticles += required;
          this.particleEmission[emitterIndex] = Math.max(0, this.particleEmission[emitterIndex] - 1);
          remainingStepBudget = 0;
          break;
        }
        if (required === 0 || this.particlePool.freeCount < required || this.particles.emitterCounts[emitterIndex] + required > this.particleLimits[emitterIndex]) {
          this.stats.droppedParticles += Math.max(1, required) * groups;
          this.particleEmission[emitterIndex] = this.particleEmission[emitterIndex] % 1;
          break;
        }
        if (drawsHead)
          this.spawnParticle(emitterIndex, emitter, 0, animationTime);
        if (drawsTail)
          this.spawnParticle(emitterIndex, emitter, 1, animationTime);
        this.particleEmission[emitterIndex] = this.particleEmission[emitterIndex] - 1;
        remainingStepBudget -= required;
        groups -= 1;
      }
    }
    if (remainingStepBudget <= 0) {
      for (let index = 0; index < this.particleEmission.length; index += 1) {
        if (this.particleEmission[index] >= 1) {
          this.stats.droppedParticles += Math.floor(this.particleEmission[index]);
          this.particleEmission[index] = this.particleEmission[index] % 1;
        }
      }
    }
    this.particles.activeCount = this.particlePool.activeCount;
  }
  spawnParticle(emitterIndex, emitter, type, animationTime, speedScale = 1) {
    const slot = allocateSlot(this.particlePool);
    if (slot < 0)
      return;
    const state = this.particles;
    const randomSeed = this.random();
    const width = Math.max(0, sampleEffectSequenceScalar(emitter.sequenceAnimation?.width, emitter.animation?.width, this.sequenceId, animationTime, finiteNumber(emitter.width, 0)));
    const length = Math.max(0, sampleEffectSequenceScalar(emitter.sequenceAnimation?.length, emitter.animation?.length, this.sequenceId, animationTime, finiteNumber(emitter.length, 0)));
    const authoredLifeSpan = Math.max(1e-6, sampleEffectSequenceScalar(emitter.sequenceAnimation?.lifeSpan, emitter.animation?.lifeSpan, this.sequenceId, animationTime, finiteNumber(emitter.lifeSpan, 1)));
    const randomLifeSpan = Math.max(1e-6, finiteNumber(emitter.lifeSpanRandom, authoredLifeSpan));
    const lifeSpan = emitter.randomizeLifeSpan ? authoredLifeSpan + (randomLifeSpan - authoredLifeSpan) * this.random() : authoredLifeSpan;
    const latitude = sampleEffectSequenceScalar(emitter.sequenceAnimation?.latitude, emitter.animation?.latitude, this.sequenceId, animationTime, finiteNumber(emitter.latitude, 0)) * Math.PI / 180;
    const variation = Math.max(0, sampleEffectSequenceScalar(emitter.sequenceAnimation?.variation, emitter.animation?.variation, this.sequenceId, animationTime, finiteNumber(emitter.variation, 0)));
    const authoredSpeed = sampleEffectSequenceScalar(emitter.sequenceAnimation?.speed, emitter.animation?.speed, this.sequenceId, animationTime, finiteNumber(emitter.speed, 0));
    const randomSpeed = finiteNumber(emitter.speedRandom, authoredSpeed);
    const speed = (emitter.randomizeSpeed ? authoredSpeed + (randomSpeed - authoredSpeed) * this.random() : authoredSpeed) * (1 + effectVariationValue(emitter.speedVariation, 0, randomSeed));
    const gravity = sampleEffectSequenceScalar(emitter.sequenceAnimation?.gravity, emitter.animation?.gravity, this.sequenceId, animationTime, finiteNumber(emitter.gravity, 0));
    const shapeSize = emitter.emitShapeSize;
    const shapeSizeX = sampleEffectVectorComponent(emitter.sequenceAnimation?.emitShapeSize, this.sequenceId, animationTime, 0, finiteNumber(shapeSize?.[0], width));
    const shapeSizeY = sampleEffectVectorComponent(emitter.sequenceAnimation?.emitShapeSize, this.sequenceId, animationTime, 1, finiteNumber(shapeSize?.[1], length));
    const shapeSizeZ = sampleEffectVectorComponent(emitter.sequenceAnimation?.emitShapeSize, this.sequenceId, animationTime, 2, finiteNumber(shapeSize?.[2], 0));
    const shapeRadius = sampleEffectSequenceScalar(emitter.sequenceAnimation?.emitShapeRadius, void 0, this.sequenceId, animationTime, finiteNumber(emitter.emitShapeRadius, Math.max(width, length) * 0.5));
    const emitShapePoints = this.sampleParticleSplinePoints(emitterIndex, emitter, animationTime);
    particleSpawnPosition(this.spawnPosition, this.particleShapeCodes[emitterIndex], shapeSizeX, shapeSizeY, shapeSizeZ, shapeRadius, emitShapePoints, this.particleMeshSamplers[emitterIndex] ?? null, emitter.emitShapeCutout === true, emitter.emitShapeCutoutSize, emitter.emitShapeCutoutRadius, this.randomSource);
    const usesM3Angles = emitter.emitAngleX !== void 0 || emitter.emitAngleY !== void 0 || emitter.emitSpreadX !== void 0 || emitter.emitSpreadY !== void 0;
    const spreadXVariation = effectVariationValue(emitter.spreadXVariation, 0, randomSeed);
    const spreadYVariation = effectVariationValue(emitter.spreadYVariation, 0, randomSeed);
    const m3SpreadX = Math.abs(sampleEffectSequenceScalar(emitter.sequenceAnimation?.emitSpreadX, void 0, this.sequenceId, animationTime, finiteNumber(emitter.emitSpreadX, 0)) * Math.max(0, 1 + spreadXVariation));
    const m3SpreadY = Math.abs(sampleEffectSequenceScalar(emitter.sequenceAnimation?.emitSpreadY, void 0, this.sequenceId, animationTime, finiteNumber(emitter.emitSpreadY, 0)) * Math.max(0, 1 + spreadYVariation));
    const angleX = (usesM3Angles ? sampleEffectSequenceScalar(emitter.sequenceAnimation?.emitAngleX, void 0, this.sequenceId, animationTime, finiteNumber(emitter.emitAngleX, 0)) + this.randomRange(-m3SpreadX, m3SpreadX) : emitter.lineEmitter ? 0 : this.randomRange(-latitude, latitude)) + effectVariationValue(emitter.pitchVariation, 0, randomSeed);
    const angleY = (usesM3Angles ? sampleEffectSequenceScalar(emitter.sequenceAnimation?.emitAngleY, void 0, this.sequenceId, animationTime, finiteNumber(emitter.emitAngleY, 0)) + this.randomRange(-m3SpreadY, m3SpreadY) : this.randomRange(-latitude, latitude)) + effectVariationValue(emitter.yawVariation, 0, randomSeed);
    const cosX = Math.cos(angleX);
    const directionX = Math.sin(angleX);
    const directionY = Math.sin(angleY) * cosX;
    const directionZ = Math.cos(angleY) * cosX;
    const variedSpeed = speed * speedScale * (1 + this.randomRange(-variation, variation));
    const offset = slot * 3;
    writeBasisPoint(state.positions, offset, this.anchor, this.spawnPosition[0], this.spawnPosition[1], this.spawnPosition[2]);
    copyVector3(state.spawnPositions, state.positions, offset, offset);
    writeBasisVector(state.velocities, offset, this.anchor, directionX * variedSpeed, directionY * variedSpeed, directionZ * variedSpeed);
    const parentVelocity = finiteNumber(emitter.parentVelocity, 0);
    state.velocities[offset] = state.velocities[offset] + this.inheritedVelocity[0] * parentVelocity;
    state.velocities[offset + 1] = state.velocities[offset + 1] + this.inheritedVelocity[1] * parentVelocity;
    state.velocities[offset + 2] = state.velocities[offset + 2] + this.inheritedVelocity[2] * parentVelocity;
    state.emitterIndices[slot] = emitterIndex;
    state.ages[slot] = 0;
    state.lifeSpans[slot] = lifeSpan;
    state.gravities[slot] = gravity;
    state.drags[slot] = emitter.drag === void 0 ? -1 : Math.max(0, finiteNumber(emitter.drag, 0));
    state.frictions[slot] = Math.max(0, finiteNumber(emitter.friction, 0));
    state.bounces[slot] = Math.max(0, finiteNumber(emitter.bounce, 0));
    const authoredMass = Math.max(1e-6, finiteNumber(emitter.mass, 1));
    const randomMass = Math.max(1e-6, finiteNumber(emitter.massRandom, authoredMass));
    state.masses[slot] = emitter.randomizeMass ? authoredMass + (randomMass - authoredMass) * this.random() : authoredMass;
    state.explosionMasks[slot] = 0;
    state.collisionMasks[slot] = (emitter.collideTerrain ? EFFECT_COLLISION_TERRAIN : 0) | (emitter.collideObjects ? EFFECT_COLLISION_OBJECTS : 0);
    state.collisionCounts[slot] = 0;
    state.maxCollisionEvents[slot] = finiteNonNegativeInteger(emitter.maxCollisionEvents) ?? 0;
    state.spaces[slot] = emitter.modelSpace ? emitter.boneAnchored ? 2 : 1 : 0;
    state.types[slot] = type;
    state.sizeRandomFactors[slot] = emitter.randomizeSize ? this.randomSource() : 0;
    state.colorRandomFactors[slot] = emitter.randomizeColor ? this.randomSource() : 0;
    state.alphaRandomFactors[slot] = emitter.randomizeAlpha ? this.randomSource() : 0;
    state.rotationRandomFactors[slot] = emitter.randomizeRotation ? this.randomSource() : 0;
    state.randomSeeds[slot] = randomSeed;
    state.trailEmission[slot] = 0;
    state.facings[slot] = emitter.xyQuad ? Math.atan2(state.velocities[offset + 1], state.velocities[offset]) - Math.PI + Math.PI / 8 : 0;
    state.emitterCounts[emitterIndex] = state.emitterCounts[emitterIndex] + 1;
    this.stats.spawnedParticles += 1;
  }
  sampleParticleSplinePoints(emitterIndex, emitter, animationTime) {
    const points = emitter.emitShapePoints;
    const animations = emitter.emitShapePointSequenceAnimations;
    const sampled = this.particleSplinePoints[emitterIndex];
    if (!points || !sampled || !animations?.some((tracks) => tracks.length > 0))
      return points;
    for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
      const point = points[pointIndex] ?? [0, 0, 0];
      const out = sampled[pointIndex];
      const tracks = animations[pointIndex];
      for (let component = 0; component < 3; component += 1) {
        out[component] = sampleEffectVectorComponent(tracks, this.sequenceId, animationTime, component, finiteNumber(point[component], 0));
      }
    }
    return sampled;
  }
  spawnRibbons(delta, sequenceTime, animationTime, anchorProvider) {
    let remainingStepBudget = this.maxSpawnPerStep;
    for (let emitterIndex = 0; emitterIndex < this.effects.ribbons.length; emitterIndex += 1) {
      if (remainingStepBudget <= 0)
        break;
      const emitter = this.effects.ribbons[emitterIndex];
      if ((emitter.splineEndpoints?.length ?? 0) > 0)
        continue;
      const visibility = sampleEffectSequenceScalar(emitter.sequenceAnimation?.visibility, emitter.animation?.visibility, this.sequenceId, animationTime, finiteNumber(emitter.visibility, 1));
      if (!(visibility > 0))
        continue;
      const rate = Math.max(0, sampleEffectSequenceScalar(emitter.sequenceAnimation?.emissionRate, emitter.animation?.emissionRate, this.sequenceId, animationTime, finiteNumber(emitter.emissionRate, 0)));
      this.ribbonEmission[emitterIndex] = this.ribbonEmission[emitterIndex] + rate * delta;
      let count = Math.floor(this.ribbonEmission[emitterIndex] + EMISSION_EPSILON);
      if (count > 0) {
        prepareAnchor(this.anchor);
        anchorProvider?.("ribbon", emitterIndex, emitter.boneIndex, sequenceTime, this.anchor);
        this.sampleInheritedVelocity("ribbon", emitterIndex, sequenceTime);
      }
      while (count > 0 && remainingStepBudget > 0) {
        if (this.ribbonPool.freeCount === 0 || this.ribbons.emitterCounts[emitterIndex] >= this.ribbonLimits[emitterIndex]) {
          this.stats.droppedRibbons += count;
          this.ribbonEmission[emitterIndex] = this.ribbonEmission[emitterIndex] % 1;
          break;
        }
        this.spawnRibbon(emitterIndex, emitter, animationTime);
        this.ribbonEmission[emitterIndex] = this.ribbonEmission[emitterIndex] - 1;
        remainingStepBudget -= 1;
        count -= 1;
      }
    }
    if (remainingStepBudget <= 0) {
      for (let index = 0; index < this.ribbonEmission.length; index += 1) {
        if (this.ribbonEmission[index] >= 1) {
          this.stats.droppedRibbons += Math.floor(this.ribbonEmission[index]);
          this.ribbonEmission[index] = this.ribbonEmission[index] % 1;
        }
      }
    }
    this.ribbons.activeCount = this.ribbonPool.activeCount;
  }
  spawnRibbon(emitterIndex, emitter, animationTime) {
    const slot = allocateSlot(this.ribbonPool);
    if (slot < 0)
      return;
    const state = this.ribbons;
    const randomSeed = this.random();
    const above = sampleEffectSequenceScalar(emitter.sequenceAnimation?.heightAbove, emitter.animation?.heightAbove, this.sequenceId, animationTime, finiteNumber(emitter.heightAbove, 0));
    const below = sampleEffectSequenceScalar(emitter.sequenceAnimation?.heightBelow, emitter.animation?.heightBelow, this.sequenceId, animationTime, finiteNumber(emitter.heightBelow, 0));
    const emissionOffset = emitter.emissionOffset ?? [0, 0, 0];
    const offset = slot * 6;
    writeBasisPoint(state.vertices, offset, this.anchor, finiteNumber(emissionOffset[0], 0), finiteNumber(emissionOffset[1], 0) + above, finiteNumber(emissionOffset[2], 0));
    writeBasisPoint(state.vertices, offset + 3, this.anchor, finiteNumber(emissionOffset[0], 0), finiteNumber(emissionOffset[1], 0) - below, finiteNumber(emissionOffset[2], 0));
    const positionOffset = slot * 3;
    writeBasisPoint(state.positions, positionOffset, this.anchor, finiteNumber(emissionOffset[0], 0), finiteNumber(emissionOffset[1], 0), finiteNumber(emissionOffset[2], 0));
    state.emitterIndices[slot] = emitterIndex;
    state.ages[slot] = 0;
    const authoredLifeSpan = Math.max(1e-6, sampleEffectSequenceScalar(emitter.sequenceAnimation?.lifeSpan, emitter.animation?.lifeSpan, this.sequenceId, animationTime, finiteNumber(emitter.lifeSpan, 1)));
    const randomLifeSpan = Math.max(1e-6, finiteNumber(emitter.lifeSpanRandom, authoredLifeSpan));
    state.lifeSpans[slot] = emitter.randomizeLifeSpan ? authoredLifeSpan + (randomLifeSpan - authoredLifeSpan) * this.random() : authoredLifeSpan;
    const authoredSpeed = sampleEffectSequenceScalar(emitter.sequenceAnimation?.speed, void 0, this.sequenceId, animationTime, finiteNumber(emitter.speed, 0));
    const randomSpeed = finiteNumber(emitter.speedRandom, authoredSpeed);
    const speed = (emitter.randomizeSpeed ? authoredSpeed + (randomSpeed - authoredSpeed) * this.random() : authoredSpeed) * (1 + effectVariationValue(emitter.speedVariation, 0, randomSeed));
    const spreadX = Math.abs(sampleEffectSequenceScalar(emitter.sequenceAnimation?.spreadX, void 0, this.sequenceId, animationTime, finiteNumber(emitter.spreadX, 0)));
    const spreadY = Math.abs(sampleEffectSequenceScalar(emitter.sequenceAnimation?.spreadY, void 0, this.sequenceId, animationTime, finiteNumber(emitter.spreadY, 0)));
    const pitch = sampleEffectSequenceScalar(emitter.sequenceAnimation?.pitch, void 0, this.sequenceId, animationTime, finiteNumber(emitter.pitch, 0)) + this.randomRange(-spreadX, spreadX) + effectVariationValue(emitter.pitchVariation, 0, randomSeed);
    const yaw = sampleEffectSequenceScalar(emitter.sequenceAnimation?.yaw, void 0, this.sequenceId, animationTime, finiteNumber(emitter.yaw, 0)) + this.randomRange(-spreadY, spreadY) + effectVariationValue(emitter.yawVariation, 0, randomSeed);
    const cosPitch = Math.cos(pitch);
    const authoredVector = emitter.emissionVector;
    if (authoredVector && Math.hypot(authoredVector[0], authoredVector[1], authoredVector[2]) > 1e-8) {
      const vectorLength = Math.hypot(authoredVector[0], authoredVector[1], authoredVector[2]);
      writeBasisVector(state.velocities, positionOffset, this.anchor, authoredVector[0] / vectorLength * speed, authoredVector[1] / vectorLength * speed, authoredVector[2] / vectorLength * speed);
    } else {
      writeBasisVector(state.velocities, positionOffset, this.anchor, Math.sin(pitch) * speed, Math.sin(yaw) * cosPitch * speed, Math.cos(yaw) * cosPitch * speed);
    }
    const parentVelocity = finiteNumber(emitter.parentVelocity, 0);
    state.velocities[positionOffset] = state.velocities[positionOffset] + this.inheritedVelocity[0] * parentVelocity;
    state.velocities[positionOffset + 1] = state.velocities[positionOffset + 1] + this.inheritedVelocity[1] * parentVelocity;
    state.velocities[positionOffset + 2] = state.velocities[positionOffset + 2] + this.inheritedVelocity[2] * parentVelocity;
    const gravity = emitter.gravity ?? [0, 0, 0];
    state.gravities[positionOffset] = finiteNumber(gravity[0], 0);
    state.gravities[positionOffset + 1] = finiteNumber(gravity[1], 0);
    state.gravities[positionOffset + 2] = finiteNumber(gravity[2], 0);
    state.drags[slot] = Math.max(0, finiteNumber(emitter.drag, 0));
    state.frictions[slot] = Math.max(0, finiteNumber(emitter.friction, 0));
    state.bounces[slot] = Math.max(0, finiteNumber(emitter.bounce, 0));
    const authoredMass = Math.max(1e-6, finiteNumber(emitter.mass, 1));
    const randomMass = Math.max(1e-6, finiteNumber(emitter.massRandom, authoredMass));
    state.masses[slot] = emitter.randomizeMass ? authoredMass + (randomMass - authoredMass) * this.random() : authoredMass;
    state.randomSeeds[slot] = randomSeed;
    state.explosionMasks[slot] = 0;
    state.collisionMasks[slot] = (emitter.collideTerrain ? EFFECT_COLLISION_TERRAIN : 0) | (emitter.collideObjects ? EFFECT_COLLISION_OBJECTS : 0);
    state.spaces[slot] = emitter.modelSpace ? 1 : 0;
    state.alphas[slot] = clamp01(sampleEffectSequenceScalar(emitter.sequenceAnimation?.alpha, emitter.animation?.alpha, this.sequenceId, animationTime, finiteNumber(emitter.alpha, 1)));
    state.textureSlots[slot] = Math.max(0, Math.floor(sampleEffectSequenceScalar(emitter.sequenceAnimation?.textureSlot, emitter.animation?.textureSlot, this.sequenceId, animationTime, finiteNumber(emitter.textureSlot, 0))));
    const previous = state.lastSlots[emitterIndex];
    state.previousSlots[slot] = previous;
    state.nextSlots[slot] = -1;
    if (previous >= 0)
      state.nextSlots[previous] = slot;
    else
      state.firstSlots[emitterIndex] = slot;
    state.lastSlots[emitterIndex] = slot;
    state.emitterCounts[emitterIndex] = state.emitterCounts[emitterIndex] + 1;
    this.stats.spawnedRibbons += 1;
  }
  killParticle(slot) {
    const emitterIndex = this.particles.emitterIndices[slot];
    this.particles.emitterCounts[emitterIndex] = this.particles.emitterCounts[emitterIndex] - 1;
    releaseSlot(this.particlePool, slot);
  }
  sampleInheritedVelocity(kind, emitterIndex, sequenceTime) {
    const positions = kind === "particle" ? this.particleAnchorPositions : this.ribbonAnchorPositions;
    const times = kind === "particle" ? this.particleAnchorTimes : this.ribbonAnchorTimes;
    const valid = kind === "particle" ? this.particleAnchorValid : this.ribbonAnchorValid;
    const offset = emitterIndex * 3;
    const elapsed = sequenceTime - times[emitterIndex];
    if (valid[emitterIndex] !== 0 && elapsed > TIME_EPSILON) {
      this.inheritedVelocity[0] = (this.anchor.position[0] - positions[offset]) / elapsed;
      this.inheritedVelocity[1] = (this.anchor.position[1] - positions[offset + 1]) / elapsed;
      this.inheritedVelocity[2] = (this.anchor.position[2] - positions[offset + 2]) / elapsed;
    } else {
      this.inheritedVelocity.fill(0);
    }
    positions[offset] = this.anchor.position[0];
    positions[offset + 1] = this.anchor.position[1];
    positions[offset + 2] = this.anchor.position[2];
    times[emitterIndex] = sequenceTime;
    valid[emitterIndex] = 1;
  }
  killRibbon(slot) {
    const state = this.ribbons;
    const emitterIndex = state.emitterIndices[slot];
    const previous = state.previousSlots[slot];
    const next = state.nextSlots[slot];
    if (previous >= 0)
      state.nextSlots[previous] = next;
    else
      state.firstSlots[emitterIndex] = next;
    if (next >= 0)
      state.previousSlots[next] = previous;
    else
      state.lastSlots[emitterIndex] = previous;
    state.previousSlots[slot] = -1;
    state.nextSlots[slot] = -1;
    state.emitterCounts[emitterIndex] = state.emitterCounts[emitterIndex] - 1;
    releaseSlot(this.ribbonPool, slot);
  }
  random() {
    let value = this.randomState;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.randomState = value >>> 0;
    return this.randomState / 4294967296;
  }
  randomRange(min, max) {
    return min + (max - min) * this.random();
  }
  clearStepStats() {
    this.collisionSpawnCount = 0;
    this.bounceRibbonSpawnCount = 0;
    this.stats.spawnedParticles = 0;
    this.stats.spawnedRibbons = 0;
    this.stats.spawnedProjectorSplats = 0;
    this.stats.killedParticles = 0;
    this.stats.collidedParticles = 0;
    this.stats.killedRibbons = 0;
    this.stats.killedProjectorSplats = 0;
    this.stats.droppedParticles = 0;
    this.stats.droppedRibbons = 0;
    this.stats.droppedProjectorSplats = 0;
    this.stats.seekClamped = false;
  }
  updateStats(seekClamped) {
    this.particles.activeCount = this.particlePool.activeCount;
    this.ribbons.activeCount = this.ribbonPool.activeCount;
    this.projectorSplats.activeCount = this.projectorSplatPool.activeCount;
    this.stats.timeSeconds = this.timeSeconds;
    this.stats.activeParticles = this.particlePool.activeCount;
    this.stats.activeRibbons = this.ribbonPool.activeCount;
    this.stats.activeProjectorSplats = this.projectorSplatPool.activeCount;
    this.stats.seekClamped = seekClamped;
  }
};
function createSlotPool(capacity) {
  return {
    activeSlots: new Int32Array(capacity),
    slotToActive: new Int32Array(capacity),
    freeSlots: new Int32Array(capacity),
    activeCount: 0,
    freeCount: capacity
  };
}
function resetSlotPool(pool) {
  pool.activeCount = 0;
  pool.freeCount = pool.freeSlots.length;
  pool.slotToActive.fill(-1);
  for (let index = 0; index < pool.freeSlots.length; index += 1) {
    pool.freeSlots[index] = pool.freeSlots.length - index - 1;
  }
}
function allocateSlot(pool) {
  if (pool.freeCount === 0)
    return -1;
  const slot = pool.freeSlots[--pool.freeCount];
  pool.slotToActive[slot] = pool.activeCount;
  pool.activeSlots[pool.activeCount++] = slot;
  return slot;
}
function releaseSlot(pool, slot) {
  const activeIndex = pool.slotToActive[slot];
  if (activeIndex < 0)
    return;
  const lastIndex = --pool.activeCount;
  const lastSlot = pool.activeSlots[lastIndex];
  if (activeIndex !== lastIndex) {
    pool.activeSlots[activeIndex] = lastSlot;
    pool.slotToActive[lastSlot] = activeIndex;
  }
  pool.slotToActive[slot] = -1;
  pool.freeSlots[pool.freeCount++] = slot;
}
function createParticleState(capacity, emitterCount, pool) {
  return {
    capacity,
    activeCount: 0,
    activeSlots: pool.activeSlots,
    emitterIndices: new Uint32Array(capacity),
    ages: new Float32Array(capacity),
    lifeSpans: new Float32Array(capacity),
    positions: new Float32Array(capacity * 3),
    spawnPositions: new Float32Array(capacity * 3),
    velocities: new Float32Array(capacity * 3),
    gravities: new Float32Array(capacity),
    drags: new Float32Array(capacity),
    frictions: new Float32Array(capacity),
    bounces: new Float32Array(capacity),
    explosionMasks: new Uint32Array(capacity),
    collisionMasks: new Uint8Array(capacity),
    collisionCounts: new Uint32Array(capacity),
    maxCollisionEvents: new Uint32Array(capacity),
    spaces: new Uint8Array(capacity),
    facings: new Float32Array(capacity),
    sizeRandomFactors: new Float32Array(capacity),
    colorRandomFactors: new Float32Array(capacity),
    alphaRandomFactors: new Float32Array(capacity),
    rotationRandomFactors: new Float32Array(capacity),
    randomSeeds: new Float32Array(capacity),
    masses: new Float32Array(capacity),
    trailEmission: new Float64Array(capacity),
    types: new Uint8Array(capacity),
    emitterCounts: new Uint32Array(emitterCount)
  };
}
function createRibbonState(capacity, emitterCount, pool) {
  return {
    capacity,
    activeCount: 0,
    activeSlots: pool.activeSlots,
    emitterIndices: new Uint32Array(capacity),
    ages: new Float32Array(capacity),
    lifeSpans: new Float32Array(capacity),
    vertices: new Float32Array(capacity * 6),
    positions: new Float32Array(capacity * 3),
    velocities: new Float32Array(capacity * 3),
    gravities: new Float32Array(capacity * 3),
    drags: new Float32Array(capacity),
    frictions: new Float32Array(capacity),
    bounces: new Float32Array(capacity),
    masses: new Float32Array(capacity),
    randomSeeds: new Float32Array(capacity),
    explosionMasks: new Uint32Array(capacity),
    collisionMasks: new Uint8Array(capacity),
    spaces: new Uint8Array(capacity),
    alphas: new Float32Array(capacity),
    textureSlots: new Uint32Array(capacity),
    previousSlots: new Int32Array(capacity),
    nextSlots: new Int32Array(capacity),
    firstSlots: new Int32Array(emitterCount),
    lastSlots: new Int32Array(emitterCount),
    emitterCounts: new Uint32Array(emitterCount)
  };
}
function createProjectorSplatState(capacity, pool) {
  return {
    capacity,
    activeCount: 0,
    activeSlots: pool.activeSlots,
    projectorIndices: new Uint32Array(capacity),
    ages: new Float32Array(capacity),
    attackTimes: new Float32Array(capacity),
    holdTimes: new Float32Array(capacity),
    decayTimes: new Float32Array(capacity),
    lifeSpans: new Float32Array(capacity),
    positions: new Float32Array(capacity * 3),
    normals: new Float32Array(capacity * 3),
    alphas: new Float32Array(capacity)
  };
}
function createEffectAnchor() {
  return {
    position: new Float32Array(3),
    xAxis: new Float32Array([1, 0, 0]),
    yAxis: new Float32Array([0, 1, 0]),
    zAxis: new Float32Array([0, 0, 1])
  };
}
function effectFieldInfluence(force, anchor, positions, offset) {
  if (force.unbounded)
    return 1;
  const dx = positions[offset] - anchor.position[0];
  const dy = positions[offset + 1] - anchor.position[1];
  const dz = positions[offset + 2] - anchor.position[2];
  const xLength = Math.hypot(anchor.xAxis[0], anchor.xAxis[1], anchor.xAxis[2]) || 1;
  const yLength = Math.hypot(anchor.yAxis[0], anchor.yAxis[1], anchor.yAxis[2]) || 1;
  const zLength = Math.hypot(anchor.zAxis[0], anchor.zAxis[1], anchor.zAxis[2]) || 1;
  const x = (dx * anchor.xAxis[0] + dy * anchor.xAxis[1] + dz * anchor.xAxis[2]) / xLength;
  const y = (dx * anchor.yAxis[0] + dy * anchor.yAxis[1] + dz * anchor.yAxis[2]) / yLength;
  const z = (dx * anchor.zAxis[0] + dy * anchor.zAxis[1] + dz * anchor.zAxis[2]) / zLength;
  const halfWidth = Math.max(1e-6, Math.abs(finiteNumber(force.width, 0)) * 0.5);
  const halfLength = Math.max(1e-6, Math.abs(finiteNumber(force.length, force.width)) * 0.5);
  const halfHeight = Math.max(1e-6, Math.abs(finiteNumber(force.height, force.width)) * 0.5);
  let normalizedDistance = 0;
  if (force.shape === "box") {
    normalizedDistance = Math.max(Math.abs(x) / halfWidth, Math.abs(y) / halfLength, Math.abs(z) / halfHeight);
  } else if (force.shape === "cylinder") {
    normalizedDistance = Math.max(Math.hypot(x / halfWidth, y / halfLength), Math.abs(z) / halfHeight);
  } else {
    if (force.shape === "hemisphere" && z < 0)
      return 0;
    normalizedDistance = Math.hypot(x / halfWidth, y / halfLength, z / halfHeight);
  }
  if (!(normalizedDistance <= 1))
    return 0;
  let influence = force.falloff ? 1 - normalizedDistance : 1;
  if (force.heightGradient)
    influence *= clamp01((z / halfHeight + 1) * 0.5);
  return Math.max(0, influence);
}
function applyEffectForce(force, anchor, positions, velocities, offset, influence, timeScale, amountScale = 1) {
  let directionX;
  let directionY;
  let directionZ;
  if (force.type === "wind") {
    directionX = anchor.zAxis[0];
    directionY = anchor.zAxis[1];
    directionZ = anchor.zAxis[2];
  } else {
    directionX = positions[offset] - anchor.position[0];
    directionY = positions[offset + 1] - anchor.position[1];
    directionZ = positions[offset + 2] - anchor.position[2];
  }
  const directionLength = Math.hypot(directionX, directionY, directionZ) || 1;
  const amount = finiteNumber(force.strength, 0) * influence * timeScale * amountScale / directionLength;
  velocities[offset] = velocities[offset] + directionX * amount;
  velocities[offset + 1] = velocities[offset + 1] + directionY * amount;
  velocities[offset + 2] = velocities[offset + 2] + directionZ * amount;
}
function emitterNoise(emitter) {
  return emitter;
}
function effectVariationValue(variation, ageSeconds, seed) {
  if (!variation)
    return 0;
  const amplitude = finiteNumber(variation.amplitude, 0);
  const frequency = finiteNumber(variation.frequency, 0);
  if (!(Math.abs(amplitude) > 1e-12) || !(Math.abs(frequency) > 1e-12))
    return 0;
  const phase = finiteNumber(variation.phase, 0) + finiteNonNegative(ageSeconds) * frequency + seed;
  const cycle = phase - Math.floor(phase);
  const shape = variation.shape;
  let value;
  if (shape === "sine" || shape === 1)
    value = Math.sin(cycle * Math.PI * 2);
  else if (shape === "triangle" || shape === 2)
    value = 1 - 4 * Math.abs(cycle - 0.5);
  else if (shape === "square" || shape === 3)
    value = cycle < 0.5 ? 1 : -1;
  else if (shape === "saw" || shape === 4)
    value = cycle * 2 - 1;
  else if (shape === "noise" || shape === 5) {
    const cell = Math.floor(phase * 32);
    value = hashSigned(cell + Math.floor(seed * 65535));
  } else
    value = 0;
  return value * amplitude;
}
function applyEffectNoise(positions, velocities, offset, source, seed, timeSeconds, delta) {
  const amplitude = finiteNumber(source.noiseAmplitude, 0);
  const frequency = Math.abs(finiteNumber(source.noiseFrequency, 0));
  if (!(Math.abs(amplitude) > 1e-12 && frequency > 1e-12 && delta > 0))
    return;
  const cohesion = finiteNumber(source.noiseCohesion, 0);
  const spatialPhase = (positions[offset] + positions[offset + 1] * 1.37 + positions[offset + 2] * 2.11) * cohesion;
  const phase = (timeSeconds * frequency + seed * 17.17 + spatialPhase) * Math.PI * 2;
  const edge = Math.max(0, finiteNumber(source.noiseEdge, 0));
  const edgeScale = edge > 0 ? Math.pow(Math.min(1, Math.abs(Math.sin(phase * 0.5))), edge) : 1;
  const amount = amplitude * edgeScale * delta;
  velocities[offset] = velocities[offset] + Math.sin(phase + 0.17) * amount;
  velocities[offset + 1] = velocities[offset + 1] + Math.sin(phase * 1.31 + 2.27) * amount;
  velocities[offset + 2] = velocities[offset + 2] + Math.sin(phase * 0.73 + 4.11) * amount;
}
function hashSigned(value) {
  const sine = Math.sin(value * 12.9898 + 78.233) * 43758.5453;
  return (sine - Math.floor(sine)) * 2 - 1;
}
function integrateVectorDrag(positions, velocities, offset, accelerations, accelerationOffset, drag, delta) {
  if (!(drag > 1e-8)) {
    for (let component = 0; component < 3; component += 1) {
      const index = offset + component;
      const acceleration = accelerations[accelerationOffset + component];
      positions[index] = positions[index] + velocities[index] * delta + 0.5 * acceleration * delta * delta;
      velocities[index] = velocities[index] + acceleration * delta;
    }
    return;
  }
  const decay = Math.exp(-drag * delta);
  const displacementFactor = (1 - decay) / drag;
  for (let component = 0; component < 3; component += 1) {
    const index = offset + component;
    const terminal = accelerations[accelerationOffset + component] / drag;
    positions[index] = positions[index] + (velocities[index] - terminal) * displacementFactor + terminal * delta;
    velocities[index] = (velocities[index] - terminal) * decay + terminal;
  }
}
function applyEffectWarp(warp, anchor, positions, velocities, offset, delta) {
  const radius = Math.abs(finiteNumber(warp.radius, 0));
  if (!(radius > 1e-6))
    return;
  const axisX = anchor.zAxis[0];
  const axisY = anchor.zAxis[1];
  const axisZ = anchor.zAxis[2];
  const axisLength = Math.hypot(axisX, axisY, axisZ) || 1;
  const zx = axisX / axisLength;
  const zy = axisY / axisLength;
  const zz = axisZ / axisLength;
  const dx = positions[offset] - anchor.position[0];
  const dy = positions[offset + 1] - anchor.position[1];
  const dz = positions[offset + 2] - anchor.position[2];
  const axialDistance = dx * zx + dy * zy + dz * zz;
  const halfHeight = Math.abs(finiteNumber(warp.height, 0)) * 0.5;
  if (halfHeight > 1e-6 && Math.abs(axialDistance) > halfHeight)
    return;
  let radialX = dx - zx * axialDistance;
  let radialY = dy - zy * axialDistance;
  let radialZ = dz - zz * axialDistance;
  const radialDistance = Math.hypot(radialX, radialY, radialZ);
  if (radialDistance > radius)
    return;
  if (radialDistance > 1e-8) {
    radialX /= radialDistance;
    radialY /= radialDistance;
    radialZ /= radialDistance;
  } else {
    const xLength = Math.hypot(anchor.xAxis[0], anchor.xAxis[1], anchor.xAxis[2]) || 1;
    radialX = anchor.xAxis[0] / xLength;
    radialY = anchor.xAxis[1] / xLength;
    radialZ = anchor.xAxis[2] / xLength;
  }
  const tangentX = zy * radialZ - zz * radialY;
  const tangentY = zz * radialX - zx * radialZ;
  const tangentZ = zx * radialY - zy * radialX;
  const falloff = 1 - radialDistance / radius;
  const amount = finiteNumber(warp.strength, 0) * falloff * delta;
  const radial = finiteNumber(warp.radial, 0);
  const angular = finiteNumber(warp.angular, 0);
  const axial = finiteNumber(warp.axial, 0);
  velocities[offset] = velocities[offset] + (radialX * radial + tangentX * angular + zx * axial) * amount;
  velocities[offset + 1] = velocities[offset + 1] + (radialY * radial + tangentY * angular + zy * axial) * amount;
  velocities[offset + 2] = velocities[offset + 2] + (radialZ * radial + tangentZ * angular + zz * axial) * amount;
}
function prepareAnchor(anchor) {
  anchor.position.fill(0);
  anchor.xAxis[0] = 1;
  anchor.xAxis[1] = 0;
  anchor.xAxis[2] = 0;
  anchor.yAxis[0] = 0;
  anchor.yAxis[1] = 1;
  anchor.yAxis[2] = 0;
  anchor.zAxis[0] = 0;
  anchor.zAxis[1] = 0;
  anchor.zAxis[2] = 1;
}
function writeBasisPoint(out, offset, anchor, x, y, z) {
  out[offset] = anchor.position[0] + anchor.xAxis[0] * x + anchor.yAxis[0] * y + anchor.zAxis[0] * z;
  out[offset + 1] = anchor.position[1] + anchor.xAxis[1] * x + anchor.yAxis[1] * y + anchor.zAxis[1] * z;
  out[offset + 2] = anchor.position[2] + anchor.xAxis[2] * x + anchor.yAxis[2] * y + anchor.zAxis[2] * z;
}
function writeBasisVector(out, offset, anchor, x, y, z) {
  out[offset] = anchor.xAxis[0] * x + anchor.yAxis[0] * y + anchor.zAxis[0] * z;
  out[offset + 1] = anchor.xAxis[1] * x + anchor.yAxis[1] * y + anchor.zAxis[1] * z;
  out[offset + 2] = anchor.xAxis[2] * x + anchor.yAxis[2] * y + anchor.zAxis[2] * z;
}
function writeEffectParticleRenderPosition(out, outOffset, state, slot, currentAnchor) {
  const offset = slot * 3;
  if (state.spaces[slot] === 0) {
    out[outOffset] = state.positions[offset];
    out[outOffset + 1] = state.positions[offset + 1];
    out[outOffset + 2] = state.positions[offset + 2];
    return;
  }
  writeBasisPoint(out, outOffset, currentAnchor, state.positions[offset], state.positions[offset + 1], state.positions[offset + 2]);
}
function writeEffectParticleRenderOrigin(out, outOffset, state, slot, currentAnchor) {
  const offset = slot * 3;
  if (state.spaces[slot] === 0) {
    copyVector3(out, state.spawnPositions, offset, outOffset);
    return;
  }
  writeBasisPoint(out, outOffset, currentAnchor, state.spawnPositions[offset], state.spawnPositions[offset + 1], state.spawnPositions[offset + 2]);
}
function copyVector3(out, source, sourceOffset = 0, outOffset = 0) {
  out[outOffset] = source[sourceOffset];
  out[outOffset + 1] = source[sourceOffset + 1];
  out[outOffset + 2] = source[sourceOffset + 2];
}
function finiteVector3(value) {
  return Number.isFinite(value[0]) && Number.isFinite(value[1]) && Number.isFinite(value[2]);
}
function integrateAnalyticDrag(positions, velocities, offset, gravity, drag, delta) {
  if (!(drag > 1e-8)) {
    positions[offset] = positions[offset] + velocities[offset] * delta;
    positions[offset + 1] = positions[offset + 1] + velocities[offset + 1] * delta;
    positions[offset + 2] = positions[offset + 2] + velocities[offset + 2] * delta - 0.5 * gravity * delta * delta;
    velocities[offset + 2] = velocities[offset + 2] - gravity * delta;
    return;
  }
  const decay = Math.exp(-drag * delta);
  const displacementFactor = (1 - decay) / drag;
  const terminal = gravity / drag;
  positions[offset] = positions[offset] + velocities[offset] * displacementFactor;
  positions[offset + 1] = positions[offset + 1] + velocities[offset + 1] * displacementFactor;
  positions[offset + 2] = positions[offset + 2] + (velocities[offset + 2] + terminal) * displacementFactor - terminal * delta;
  velocities[offset] = velocities[offset] * decay;
  velocities[offset + 1] = velocities[offset + 1] * decay;
  velocities[offset + 2] = (velocities[offset + 2] + terminal) * decay - terminal;
}
function particleSpawnPosition(out, shape, authoredSizeX, authoredSizeY, authoredSizeZ, authoredRadius, points, meshSampler, cutout, cutoutSize, cutoutRadius, random) {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    sampleParticleSpawnPosition(out, shape, authoredSizeX, authoredSizeY, authoredSizeZ, authoredRadius, points, meshSampler, random);
    if (!cutout || !insideParticleEmissionCutout(out, shape, cutoutSize, cutoutRadius))
      return;
  }
}
function sampleParticleSpawnPosition(out, shape, authoredSizeX, authoredSizeY, authoredSizeZ, authoredRadius, points, meshSampler, random) {
  const sizeX = Math.max(0, authoredSizeX);
  const sizeY = Math.max(0, authoredSizeY);
  const sizeZ = Math.max(0, authoredSizeZ);
  const radius = Math.max(0, authoredRadius);
  if (shape === 0) {
    out.fill(0);
    return;
  }
  if (shape === 2) {
    const z = random() * 2 - 1;
    const angle = random() * Math.PI * 2;
    const radial = Math.cbrt(random()) * radius;
    const planar = Math.sqrt(Math.max(0, 1 - z * z)) * radial;
    out[0] = Math.cos(angle) * planar;
    out[1] = Math.sin(angle) * planar;
    out[2] = z * radial;
    return;
  }
  if (shape === 3) {
    out[0] = (random() - 0.5) * sizeX;
    out[1] = (random() - 0.5) * sizeY;
    out[2] = (random() - 0.5) * sizeZ;
    return;
  }
  if (shape === 4 || shape === 5) {
    const angle = random() * Math.PI * 2;
    const radial = Math.sqrt(random()) * radius;
    const z = shape === 4 ? (random() - 0.5) * sizeZ : 0;
    out[0] = Math.cos(angle) * radial;
    out[1] = Math.sin(angle) * radial;
    out[2] = z;
    return;
  }
  if (shape === 6 && points && points.length > 0) {
    if (points.length === 1) {
      out[0] = finiteNumber(points[0]?.[0], 0);
      out[1] = finiteNumber(points[0]?.[1], 0);
      out[2] = finiteNumber(points[0]?.[2], 0);
      return;
    }
    let totalLength = 0;
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const next = points[index];
      totalLength += Math.hypot(finiteNumber(next[0], 0) - finiteNumber(previous[0], 0), finiteNumber(next[1], 0) - finiteNumber(previous[1], 0), finiteNumber(next[2], 0) - finiteNumber(previous[2], 0));
    }
    let target = random() * totalLength;
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const next = points[index];
      const dx = finiteNumber(next[0], 0) - finiteNumber(previous[0], 0);
      const dy = finiteNumber(next[1], 0) - finiteNumber(previous[1], 0);
      const dz = finiteNumber(next[2], 0) - finiteNumber(previous[2], 0);
      const segmentLength = Math.hypot(dx, dy, dz);
      if (target <= segmentLength || index === points.length - 1) {
        const factor = segmentLength > 1e-8 ? Math.min(1, target / segmentLength) : 0;
        out[0] = finiteNumber(previous[0], 0) + dx * factor;
        out[1] = finiteNumber(previous[1], 0) + dy * factor;
        out[2] = finiteNumber(previous[2], 0) + dz * factor;
        return;
      }
      target -= segmentLength;
    }
  }
  if (shape === 7 && meshSampler && sampleParticleMeshPosition(out, meshSampler, random))
    return;
  out[0] = (random() - 0.5) * sizeX;
  out[1] = (random() - 0.5) * sizeY;
  out[2] = 0;
}
function createParticleMeshSampler(meshes) {
  if (!meshes || meshes.length === 0)
    return null;
  const entries = [];
  let totalArea = 0;
  for (const mesh of meshes) {
    const triangleCount = Math.floor(mesh.indices.length / 3);
    if (triangleCount === 0)
      continue;
    const cumulativeAreas = new Float64Array(triangleCount);
    let meshArea = 0;
    for (let triangle = 0; triangle < triangleCount; triangle += 1) {
      const indexOffset = triangle * 3;
      const a = mesh.indices[indexOffset];
      const b = mesh.indices[indexOffset + 1];
      const c = mesh.indices[indexOffset + 2];
      const aOffset = a * 3;
      const bOffset = b * 3;
      const cOffset = c * 3;
      if (aOffset + 2 < mesh.positions.length && bOffset + 2 < mesh.positions.length && cOffset + 2 < mesh.positions.length) {
        const abX = mesh.positions[bOffset] - mesh.positions[aOffset];
        const abY = mesh.positions[bOffset + 1] - mesh.positions[aOffset + 1];
        const abZ = mesh.positions[bOffset + 2] - mesh.positions[aOffset + 2];
        const acX = mesh.positions[cOffset] - mesh.positions[aOffset];
        const acY = mesh.positions[cOffset + 1] - mesh.positions[aOffset + 1];
        const acZ = mesh.positions[cOffset + 2] - mesh.positions[aOffset + 2];
        const crossX = abY * acZ - abZ * acY;
        const crossY = abZ * acX - abX * acZ;
        const crossZ = abX * acY - abY * acX;
        const area = Math.hypot(crossX, crossY, crossZ) * 0.5;
        if (Number.isFinite(area))
          meshArea += area;
      }
      cumulativeAreas[triangle] = meshArea;
    }
    if (!(meshArea > 1e-12))
      continue;
    entries.push({
      mesh,
      cumulativeAreas,
      areaStart: totalArea,
      areaEnd: totalArea + meshArea
    });
    totalArea += meshArea;
  }
  return totalArea > 0 ? { entries, totalArea } : null;
}
function sampleParticleMeshPosition(out, sampler, random) {
  const target = random() * sampler.totalArea;
  let entry = sampler.entries[sampler.entries.length - 1];
  for (const candidate of sampler.entries) {
    if (target < candidate.areaEnd) {
      entry = candidate;
      break;
    }
  }
  if (!entry)
    return false;
  const localTarget = target - entry.areaStart;
  let low = 0;
  let high = entry.cumulativeAreas.length;
  while (low < high) {
    const middle = low + high >>> 1;
    if (entry.cumulativeAreas[middle] <= localTarget)
      low = middle + 1;
    else
      high = middle;
  }
  const triangle = Math.min(low, entry.cumulativeAreas.length - 1);
  const indexOffset = triangle * 3;
  const aOffset = entry.mesh.indices[indexOffset] * 3;
  const bOffset = entry.mesh.indices[indexOffset + 1] * 3;
  const cOffset = entry.mesh.indices[indexOffset + 2] * 3;
  if (aOffset + 2 >= entry.mesh.positions.length || bOffset + 2 >= entry.mesh.positions.length || cOffset + 2 >= entry.mesh.positions.length)
    return false;
  const root = Math.sqrt(random());
  const blend = random();
  const aWeight = 1 - root;
  const bWeight = root * (1 - blend);
  const cWeight = root * blend;
  out[0] = entry.mesh.positions[aOffset] * aWeight + entry.mesh.positions[bOffset] * bWeight + entry.mesh.positions[cOffset] * cWeight;
  out[1] = entry.mesh.positions[aOffset + 1] * aWeight + entry.mesh.positions[bOffset + 1] * bWeight + entry.mesh.positions[cOffset + 1] * cWeight;
  out[2] = entry.mesh.positions[aOffset + 2] * aWeight + entry.mesh.positions[bOffset + 2] * bWeight + entry.mesh.positions[cOffset + 2] * cWeight;
  return true;
}
function insideParticleEmissionCutout(position, shape, size, authoredRadius) {
  const radius = Math.abs(finiteNumber(authoredRadius, 0));
  const sizeX = Math.abs(finiteNumber(size?.[0], 0));
  const sizeY = Math.abs(finiteNumber(size?.[1], 0));
  const sizeZ = Math.abs(finiteNumber(size?.[2], 0));
  if (shape === 2) {
    return radius > 1e-8 && Math.hypot(position[0], position[1], position[2]) < radius;
  }
  if (shape === 3) {
    return sizeX > 1e-8 && sizeY > 1e-8 && sizeZ > 1e-8 && Math.abs(position[0]) < sizeX * 0.5 && Math.abs(position[1]) < sizeY * 0.5 && Math.abs(position[2]) < sizeZ * 0.5;
  }
  if (shape === 4) {
    return radius > 1e-8 && sizeZ > 1e-8 && Math.hypot(position[0], position[1]) < radius && Math.abs(position[2]) < sizeZ * 0.5;
  }
  if (shape === 5) {
    return radius > 1e-8 && Math.hypot(position[0], position[1]) < radius;
  }
  if (shape === 1) {
    return sizeX > 1e-8 && sizeY > 1e-8 && Math.abs(position[0]) < sizeX * 0.5 && Math.abs(position[1]) < sizeY * 0.5;
  }
  return false;
}
function particleShapeCode(value) {
  switch (value?.toLowerCase()) {
    case "0":
    case "point":
      return 0;
    case "2":
    case "sphere":
      return 2;
    case "3":
    case "box":
    case "cube":
      return 3;
    case "4":
    case "cylinder":
      return 4;
    case "5":
    case "disc":
      return 5;
    case "6":
    case "spline":
      return 6;
    case "7":
    case "mesh":
      return 7;
    default:
      return 1;
  }
}
function sampleScalar(track, time, fallback) {
  return track ? sampleTrackComponent(track, time, 0, fallback) : fallback;
}
function effectSequenceTrack(tracks, sequenceId) {
  if (typeof sequenceId !== "number" || !Number.isInteger(sequenceId))
    return void 0;
  return tracks?.find((entry) => entry.sequenceIndex === sequenceId);
}
function effectTrackTime(entry, time) {
  const wrap = entry?.concurrent ? entry.wrapSeconds : void 0;
  return typeof wrap === "number" && Number.isFinite(wrap) && wrap > 0 ? (time % wrap + wrap) % wrap : time;
}
function sampleEffectSequenceScalar(sequenceTracks, legacyTrack, sequenceId, time, fallback) {
  const entry = effectSequenceTrack(sequenceTracks, sequenceId);
  return entry ? sampleScalar(entry.track, effectTrackTime(entry, time), fallback) : sampleScalar(legacyTrack, time, fallback);
}
function sampleEffectSequenceVector(sequenceTracks, sequenceId, time, fallback, out = new Float32Array(fallback.length)) {
  const entry = effectSequenceTrack(sequenceTracks, sequenceId);
  const sampleTime = effectTrackTime(entry, time);
  for (let component = 0; component < fallback.length && component < out.length; component += 1) {
    out[component] = entry ? sampleTrackComponent(entry.track, sampleTime, component, fallback[component] ?? 0) : fallback[component] ?? 0;
  }
  return out;
}
function sampleEffectVectorComponent(sequenceTracks, sequenceId, time, component, fallback) {
  const entry = effectSequenceTrack(sequenceTracks, sequenceId);
  if (!entry)
    return fallback;
  return sampleTrackComponent(entry.track, effectTrackTime(entry, time), component, fallback);
}
function sampleTrackComponent(track, time, component, fallback) {
  const keys = track.keys;
  if (keys.length === 0)
    return fallback;
  const first = keys[0];
  if (keys.length === 1 || time <= first.frame)
    return finiteNumber(first.vector[component], fallback);
  const last = keys[keys.length - 1];
  if (time >= last.frame)
    return finiteNumber(last.vector[component], fallback);
  let rightIndex = 1;
  while (rightIndex < keys.length - 1 && time > keys[rightIndex].frame)
    rightIndex += 1;
  const left = keys[rightIndex - 1];
  const right = keys[rightIndex];
  const leftValue = finiteNumber(left.vector[component], fallback);
  if (track.lineType === 0)
    return leftValue;
  const rightValue = finiteNumber(right.vector[component], leftValue);
  const span = right.frame - left.frame;
  if (!(span > 0))
    return leftValue;
  const factor = Math.min(1, Math.max(0, (time - left.frame) / span));
  const outTangent = left.outTan?.[component];
  const inTangent = right.inTan?.[component];
  if (Number.isFinite(outTangent) && Number.isFinite(inTangent)) {
    const t = factor;
    const t2 = t * t;
    if (track.lineType === 2) {
      return leftValue * (t2 * (2 * t - 3) + 1) + outTangent * (t2 * (t - 2) + t) + inTangent * (t2 * (t - 1)) + rightValue * (t2 * (3 - 2 * t));
    }
    if (track.lineType === 3) {
      const inverse = 1 - t;
      const inverse2 = inverse * inverse;
      return leftValue * inverse2 * inverse + outTangent * 3 * t * inverse2 + inTangent * 3 * t2 * inverse + rightValue * t2 * t;
    }
  }
  return leftValue + (rightValue - leftValue) * factor;
}
function scalarKeyIndex(track, time) {
  const keys = track?.keys;
  if (!keys || keys.length === 0)
    return 0;
  let index = 0;
  while (index < keys.length - 1 && time >= keys[index + 1].frame)
    index += 1;
  return index;
}
function effectCollisionVertexBounds(shape) {
  const vertices = shape.vertices;
  if (!vertices || vertices.length === 0)
    return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const vertex of vertices) {
    const x = Number(vertex[0]);
    const y = Number(vertex[1]);
    const z = Number(vertex[2]);
    if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)))
      continue;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }
  return Number.isFinite(minX) ? [minX, minY, minZ, maxX, maxY, maxZ] : null;
}
function resetEffectCollisionAnchor(anchor) {
  anchor.position.fill(0);
  anchor.xAxis[0] = 1;
  anchor.xAxis[1] = 0;
  anchor.xAxis[2] = 0;
  anchor.yAxis[0] = 0;
  anchor.yAxis[1] = 1;
  anchor.yAxis[2] = 0;
  anchor.zAxis[0] = 0;
  anchor.zAxis[1] = 0;
  anchor.zAxis[2] = 1;
}
function composeEffectCollisionMatrix(out, anchor, local) {
  const xAxis = anchor.xAxis;
  const yAxis = anchor.yAxis;
  const zAxis = anchor.zAxis;
  for (let column = 0; column < 3; column += 1) {
    const offset = column * 4;
    const x = finiteMatrixComponent(local[offset], column === 0 ? 1 : 0);
    const y = finiteMatrixComponent(local[offset + 1], column === 1 ? 1 : 0);
    const z = finiteMatrixComponent(local[offset + 2], column === 2 ? 1 : 0);
    out[offset] = xAxis[0] * x + yAxis[0] * y + zAxis[0] * z;
    out[offset + 1] = xAxis[1] * x + yAxis[1] * y + zAxis[1] * z;
    out[offset + 2] = xAxis[2] * x + yAxis[2] * y + zAxis[2] * z;
    out[offset + 3] = 0;
  }
  const tx = finiteMatrixComponent(local[12], 0);
  const ty = finiteMatrixComponent(local[13], 0);
  const tz = finiteMatrixComponent(local[14], 0);
  out[12] = anchor.position[0] + xAxis[0] * tx + yAxis[0] * ty + zAxis[0] * tz;
  out[13] = anchor.position[1] + xAxis[1] * tx + yAxis[1] * ty + zAxis[1] * tz;
  out[14] = anchor.position[2] + xAxis[2] * tx + yAxis[2] * ty + zAxis[2] * tz;
  out[15] = 1;
}
function finiteMatrixComponent(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function invertEffectCollisionMatrix(out, matrix) {
  const a00 = matrix[0];
  const a01 = matrix[4];
  const a02 = matrix[8];
  const a10 = matrix[1];
  const a11 = matrix[5];
  const a12 = matrix[9];
  const a20 = matrix[2];
  const a21 = matrix[6];
  const a22 = matrix[10];
  const b01 = a22 * a11 - a12 * a21;
  const b11 = -a22 * a10 + a12 * a20;
  const b21 = a21 * a10 - a11 * a20;
  const determinant = a00 * b01 + a01 * b11 + a02 * b21;
  if (!(Number.isFinite(determinant) && Math.abs(determinant) > 1e-10))
    return false;
  const inverseDeterminant = 1 / determinant;
  out[0] = b01 * inverseDeterminant;
  out[4] = (-a22 * a01 + a02 * a21) * inverseDeterminant;
  out[8] = (a12 * a01 - a02 * a11) * inverseDeterminant;
  out[1] = b11 * inverseDeterminant;
  out[5] = (a22 * a00 - a02 * a20) * inverseDeterminant;
  out[9] = (-a12 * a00 + a02 * a10) * inverseDeterminant;
  out[2] = b21 * inverseDeterminant;
  out[6] = (-a21 * a00 + a01 * a20) * inverseDeterminant;
  out[10] = (a11 * a00 - a01 * a10) * inverseDeterminant;
  out[3] = 0;
  out[7] = 0;
  out[11] = 0;
  const tx = matrix[12];
  const ty = matrix[13];
  const tz = matrix[14];
  out[12] = -(out[0] * tx + out[4] * ty + out[8] * tz);
  out[13] = -(out[1] * tx + out[5] * ty + out[9] * tz);
  out[14] = -(out[2] * tx + out[6] * ty + out[10] * tz);
  out[15] = 1;
  return true;
}
function transformEffectCollisionPoint(out, matrix, point) {
  const x = point[0];
  const y = point[1];
  const z = point[2];
  out[0] = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
  out[1] = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
  out[2] = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
}
function transformEffectCollisionNormal(out, inverseMatrix, normal) {
  const x = inverseMatrix[0] * normal[0] + inverseMatrix[1] * normal[1] + inverseMatrix[2] * normal[2];
  const y = inverseMatrix[4] * normal[0] + inverseMatrix[5] * normal[1] + inverseMatrix[6] * normal[2];
  const z = inverseMatrix[8] * normal[0] + inverseMatrix[9] * normal[1] + inverseMatrix[10] * normal[2];
  const length = Math.hypot(x, y, z) || 1;
  out[0] = x / length;
  out[1] = y / length;
  out[2] = z / length;
}
function intersectEffectCollisionShape(shape, vertexBounds, start, end, hit, normal) {
  const sizeX = Math.max(1e-6, Math.abs(Number(shape.size[0]) || 0));
  const sizeY = Math.max(1e-6, Math.abs(Number(shape.size[1]) || 0));
  const sizeZ = Math.max(1e-6, Math.abs(Number(shape.size[2]) || 0));
  if (shape.kind === "sphere")
    return intersectEffectSphere(start, end, 0, 0, 0, sizeX, hit, normal);
  if (shape.kind === "cylinder") {
    return intersectEffectCylinder(start, end, sizeX, sizeY * 0.5, hit, normal);
  }
  if (shape.kind === "capsule") {
    return intersectEffectCapsule(start, end, sizeX, sizeY * 0.5, hit, normal);
  }
  if ((shape.kind === "convex-hull" || shape.kind === "mesh") && vertexBounds) {
    return intersectEffectAabb(start, end, vertexBounds, hit, normal);
  }
  return intersectEffectAabb(start, end, [-sizeX * 0.5, -sizeY * 0.5, -sizeZ * 0.5, sizeX * 0.5, sizeY * 0.5, sizeZ * 0.5], hit, normal);
}
function intersectEffectAabb(start, end, bounds, hit, normal) {
  if (start[0] > bounds[0] && start[0] < bounds[3] && start[1] > bounds[1] && start[1] < bounds[4] && start[2] > bounds[2] && start[2] < bounds[5]) {
    return false;
  }
  let near = 0;
  let far = 1;
  let normalAxis = -1;
  let normalSign = 0;
  for (let axis = 0; axis < 3; axis += 1) {
    const direction = end[axis] - start[axis];
    if (Math.abs(direction) < 1e-12) {
      if (start[axis] < bounds[axis] || start[axis] > bounds[axis + 3])
        return false;
      continue;
    }
    const inverseDirection = 1 / direction;
    let first = (bounds[axis] - start[axis]) * inverseDirection;
    let second = (bounds[axis + 3] - start[axis]) * inverseDirection;
    let sign = -1;
    if (first > second) {
      const swap = first;
      first = second;
      second = swap;
      sign = 1;
    }
    if (first > near) {
      near = first;
      normalAxis = axis;
      normalSign = sign;
    }
    far = Math.min(far, second);
    if (near > far)
      return false;
  }
  if (!(near >= 0 && near <= 1) || normalAxis < 0)
    return false;
  writeEffectCollisionHit(hit, start, end, near);
  normal.fill(0);
  normal[normalAxis] = normalSign;
  return true;
}
function intersectEffectSphere(start, end, centerX, centerY, centerZ, radius, hit, normal) {
  const factor = effectSphereIntersectionFactor(start, end, centerX, centerY, centerZ, radius);
  if (factor < 0)
    return false;
  writeEffectCollisionHit(hit, start, end, factor);
  writeNormalizedCollisionVector(normal, hit[0] - centerX, hit[1] - centerY, hit[2] - centerZ);
  return true;
}
function effectSphereIntersectionFactor(start, end, centerX, centerY, centerZ, radius) {
  const ox = start[0] - centerX;
  const oy = start[1] - centerY;
  const oz = start[2] - centerZ;
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const dz = end[2] - start[2];
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  if (c <= 0)
    return -1;
  const a = dx * dx + dy * dy + dz * dz;
  if (a <= 1e-16)
    return -1;
  const b = ox * dx + oy * dy + oz * dz;
  const discriminant = b * b - a * c;
  if (discriminant < 0)
    return -1;
  const factor = (-b - Math.sqrt(discriminant)) / a;
  return factor >= 0 && factor <= 1 ? factor : -1;
}
function intersectEffectCylinder(start, end, radius, halfLength, hit, normal) {
  const sx = start[0];
  const sy = start[1];
  const sz = start[2];
  if (sx * sx + sz * sz < radius * radius && Math.abs(sy) < halfLength)
    return false;
  const dx = end[0] - sx;
  const dy = end[1] - sy;
  const dz = end[2] - sz;
  let best = Number.POSITIVE_INFINITY;
  let kind = 0;
  const a = dx * dx + dz * dz;
  if (a > 1e-16) {
    const b = sx * dx + sz * dz;
    const c = sx * sx + sz * sz - radius * radius;
    const discriminant = b * b - a * c;
    if (discriminant >= 0) {
      const root = Math.sqrt(discriminant);
      const first = (-b - root) / a;
      const second = (-b + root) / a;
      if (first >= 0 && first <= 1 && Math.abs(sy + dy * first) <= halfLength)
        best = first;
      else if (second >= 0 && second <= 1 && Math.abs(sy + dy * second) <= halfLength) {
        best = second;
      }
      if (Number.isFinite(best))
        kind = 1;
    }
  }
  if (Math.abs(dy) > 1e-12) {
    for (const sign of [-1, 1]) {
      const factor = (sign * halfLength - sy) / dy;
      const x = sx + dx * factor;
      const z = sz + dz * factor;
      if (factor >= 0 && factor <= 1 && factor < best && x * x + z * z <= radius * radius) {
        best = factor;
        kind = sign < 0 ? 2 : 3;
      }
    }
  }
  if (!Number.isFinite(best))
    return false;
  writeEffectCollisionHit(hit, start, end, best);
  if (kind === 1)
    writeNormalizedCollisionVector(normal, hit[0], 0, hit[2]);
  else {
    normal[0] = 0;
    normal[1] = kind === 2 ? -1 : 1;
    normal[2] = 0;
  }
  return true;
}
function intersectEffectCapsule(start, end, radius, halfLength, hit, normal) {
  let best = Number.POSITIVE_INFINITY;
  let centerY = 0;
  if (intersectEffectCylinder(start, end, radius, halfLength, hit, normal)) {
    best = effectSegmentFactor(start, end, hit);
  }
  const lower = effectSphereIntersectionFactor(start, end, 0, -halfLength, 0, radius);
  if (lower >= 0 && lower < best) {
    best = lower;
    centerY = -halfLength;
  }
  const upper = effectSphereIntersectionFactor(start, end, 0, halfLength, 0, radius);
  if (upper >= 0 && upper < best) {
    best = upper;
    centerY = halfLength;
  }
  if (!Number.isFinite(best))
    return false;
  if (centerY !== 0) {
    writeEffectCollisionHit(hit, start, end, best);
    writeNormalizedCollisionVector(normal, hit[0], hit[1] - centerY, hit[2]);
  }
  return true;
}
function effectSegmentFactor(start, end, point) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const dz = end[2] - start[2];
  const denominator = dx * dx + dy * dy + dz * dz;
  return denominator > 1e-16 ? ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy + (point[2] - start[2]) * dz) / denominator : 0;
}
function writeEffectCollisionHit(out, start, end, factor) {
  out[0] = start[0] + (end[0] - start[0]) * factor;
  out[1] = start[1] + (end[1] - start[1]) * factor;
  out[2] = start[2] + (end[2] - start[2]) * factor;
}
function writeNormalizedCollisionVector(out, x, y, z) {
  const length = Math.hypot(x, y, z) || 1;
  out[0] = x / length;
  out[1] = y / length;
  out[2] = z / length;
}
function squaredDistance3(first, second) {
  const x = first[0] - second[0];
  const y = first[1] - second[1];
  const z = first[2] - second[2];
  return x * x + y * y + z * z;
}
function effectScalarKeyIndex(sequenceTracks, legacyTrack, sequenceId, time) {
  const entry = effectSequenceTrack(sequenceTracks, sequenceId);
  return entry ? scalarKeyIndex(entry.track, effectTrackTime(entry, time)) : scalarKeyIndex(legacyTrack, time);
}
function boundedInteger(value, fallback, min, max) {
  const candidate = Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(max, Math.max(min, candidate));
}
function boundedPositive(value, fallback, max) {
  if (!(typeof value === "number" && Number.isFinite(value) && value > 0))
    return fallback;
  return Math.min(max, value);
}
function finiteNonNegativeInteger(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}
function finiteNumber(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function finiteNonNegative(value) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}
function randomProjectorStage(first, second, random) {
  const start = Math.max(0, finiteNumber(first, 0));
  const end = Math.max(0, finiteNumber(second, start));
  return start + (end - start) * random();
}
function normalizeEffectAlpha(value) {
  const alpha = finiteNumber(value, 1);
  return alpha > 1 ? alpha / 255 : alpha;
}
function lerpEffectValue(first, second, factor) {
  return first + (second - first) * clamp01(factor);
}
function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}
function normalizeSeed(seed) {
  const normalized = Number.isFinite(seed) ? Math.floor(seed) >>> 0 : DEFAULT_EFFECT_SIMULATION_OPTIONS.seed;
  return normalized === 0 ? 2654435769 : normalized;
}

export {
  EFFECT_COLLISION_TERRAIN,
  EFFECT_COLLISION_OBJECTS,
  combineEffectCollisionProviders,
  createEffectCollisionShapeProvider,
  DEFAULT_EFFECT_SIMULATION_OPTIONS,
  MAX_EFFECT_RIBBON_SIDES,
  MAX_EFFECT_SPLINE_DIVISIONS,
  effectRibbonRingVertexCount,
  writeEffectRibbonRingPositions,
  ModelEffectSimulation,
  effectVariationValue,
  writeEffectParticleRenderPosition,
  writeEffectParticleRenderOrigin,
  sampleEffectSequenceScalar,
  sampleEffectSequenceVector
};
