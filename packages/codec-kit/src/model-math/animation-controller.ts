export type RenderAnimatorParameterType = 'float' | 'int' | 'bool' | 'trigger'

export interface RenderAnimatorParameter {
  id: number
  name: string
  type: RenderAnimatorParameterType
  defaultValue: number | boolean
}

export type RenderAnimatorConditionMode =
  'if' | 'if-not' | 'greater' | 'less' | 'equals' | 'not-equal'

export interface RenderAnimatorCondition {
  mode: RenderAnimatorConditionMode
  parameterId: number
  threshold: number
}

export interface RenderAnimatorTransition {
  destinationState: number
  conditions: readonly RenderAnimatorCondition[]
  duration: number
  offset: number
  exitTime: number
  hasExitTime: boolean
  hasFixedDuration: boolean
  canTransitionToSelf?: boolean
  interruptionSource?: number
  orderedInterruption?: boolean
}

export interface RenderAnimatorClipMotion {
  kind: 'clip'
  animationIndex: number
  speed?: number
  cycleOffset?: number
  mirror?: boolean
}

export interface RenderAnimatorBlendChild {
  motion: RenderAnimatorMotion
  threshold?: number
  position?: readonly [number, number]
  directParameterId?: number
  speed?: number
  cycleOffset?: number
  mirror?: boolean
}

export type RenderAnimatorBlendType =
  | 'simple-1d'
  | 'simple-directional-2d'
  | 'freeform-directional-2d'
  | 'freeform-cartesian-2d'
  | 'direct'

export interface RenderAnimatorBlendTreeMotion {
  kind: 'blend-tree'
  blendType: RenderAnimatorBlendType
  parameterId?: number
  parameterYId?: number
  normalizedBlendValues?: boolean
  /** Unity's precomputed 2D blend data, preserved for diagnostics and parity checks. */
  childMagnitudes?: readonly number[]
  childPairVectors?: readonly (readonly [number, number])[]
  childPairAverageMagnitudeInverses?: readonly number[]
  childNeighbors?: readonly (readonly number[])[]
  children: readonly RenderAnimatorBlendChild[]
}

export type RenderAnimatorMotion = RenderAnimatorClipMotion | RenderAnimatorBlendTreeMotion

export interface RenderAnimatorState {
  index: number
  id: number
  name: string
  speed: number
  cycleOffset: number
  loop: boolean
  mirror?: boolean
  ikOnFeet?: boolean
  speedParameterId?: number
  mirrorParameterId?: number
  cycleOffsetParameterId?: number
  timeParameterId?: number
  motion?: RenderAnimatorMotion
  transitions: readonly RenderAnimatorTransition[]
}

export interface RenderAnimatorSelectorTransition {
  destinationState: number
  conditions: readonly RenderAnimatorCondition[]
}

export interface RenderAnimatorSelectorState {
  fullPathId: number
  isEntry: boolean
  transitions: readonly RenderAnimatorSelectorTransition[]
}

export interface RenderAnimatorStateMachine {
  index: number
  defaultState: number
  states: readonly RenderAnimatorState[]
  anyStateTransitions: readonly RenderAnimatorTransition[]
  selectorStates?: readonly RenderAnimatorSelectorState[]
}

export interface RenderAnimatorLayer {
  index: number
  name: string
  stateMachineIndex: number
  defaultWeight: number
  blendingMode: 'override' | 'additive'
  ikPass: boolean
}

export interface RenderAnimatorController {
  name: string
  parameters: readonly RenderAnimatorParameter[]
  layers: readonly RenderAnimatorLayer[]
  stateMachines: readonly RenderAnimatorStateMachine[]
}

export interface RenderAnimatorClipSample {
  animationIndex: number
  weight: number
  timeSeconds: number
  layerIndex: number
  additive: boolean
  mirror?: boolean
}

export interface RenderAnimatorLayerEvaluation {
  layerIndex: number
  stateIndex: number
  stateName: string
  normalizedTime: number
  transitionProgress: number | null
}

export interface RenderAnimatorEvaluation {
  clips: RenderAnimatorClipSample[]
  layers: RenderAnimatorLayerEvaluation[]
}

export interface AnimatorControllerRuntimeOptions {
  /** Render-model sequence duration by animation index. */
  clipDurations?: readonly number[]
}

interface RuntimeTransition {
  definition: RenderAnimatorTransition
  sourceState: number
  sourceElapsed: number
  destinationState: number
  destinationElapsed: number
  elapsed: number
  duration: number
}

interface RuntimeLayer {
  stateIndex: number
  elapsed: number
  transition?: RuntimeTransition
}

/**
 * Stateful, renderer-neutral AnimatorController evaluator.
 *
 * It implements Unity's portable controller semantics: parameters and triggers,
 * Any State/current-state transitions, exit time, fixed/normalized transition
 * duration, crossfades, and nested 1D/2D/direct blend trees. Unity's native
 * interruption queue and StateMachineBehaviour callbacks are intentionally not
 * emulated because they require executable project code.
 */
export class AnimatorControllerRuntime {
  private readonly values = new Map<number, number | boolean>()
  private readonly parameterByName = new Map<string, RenderAnimatorParameter>()
  private readonly parameterById = new Map<number, RenderAnimatorParameter>()
  private readonly layers: RuntimeLayer[]
  private readonly layerWeights: number[]
  private readonly clipDurations: readonly number[]

  constructor(
    readonly controller: RenderAnimatorController,
    options: AnimatorControllerRuntimeOptions = {},
  ) {
    this.clipDurations = options.clipDurations ?? []
    for (const parameter of controller.parameters) {
      this.parameterByName.set(parameter.name, parameter)
      this.parameterById.set(parameter.id, parameter)
      this.values.set(parameter.id, parameter.defaultValue)
    }
    this.layers = controller.layers.map(() => ({ stateIndex: 0, elapsed: 0 }))
    this.layerWeights = controller.layers.map((layer, index) =>
      index === 0 ? 1 : clamp01(finiteOr(layer.defaultWeight, 1)),
    )
    this.resetLayers()
  }

  reset(): void {
    this.values.clear()
    for (const parameter of this.controller.parameters)
      this.values.set(parameter.id, parameter.defaultValue)
    for (let index = 0; index < this.layerWeights.length; index += 1)
      this.layerWeights[index] =
        index === 0 ? 1 : clamp01(finiteOr(this.controller.layers[index]?.defaultWeight, 1))
    this.resetLayers()
  }

  setFloat(parameter: string | number, value: number): void {
    this.setParameter(parameter, Number.isFinite(value) ? value : 0, 'float')
  }

  setInteger(parameter: string | number, value: number): void {
    this.setParameter(parameter, Math.trunc(Number.isFinite(value) ? value : 0), 'int')
  }

  setBool(parameter: string | number, value: boolean): void {
    this.setParameter(parameter, !!value, 'bool')
  }

  setTrigger(parameter: string | number): void {
    this.setParameter(parameter, true, 'trigger')
  }

  resetTrigger(parameter: string | number): void {
    this.setParameter(parameter, false, 'trigger')
  }

  getParameter(parameter: string | number): number | boolean | undefined {
    const definition = this.resolveParameter(parameter)
    return definition ? this.values.get(definition.id) : undefined
  }

  setLayerWeight(layerIndex: number, weight: number): void {
    this.assertLayerIndex(layerIndex)
    this.layerWeights[layerIndex] = clamp01(finiteOr(weight, 0))
  }

  getLayerWeight(layerIndex: number): number {
    this.assertLayerIndex(layerIndex)
    return this.layerWeights[layerIndex] ?? 0
  }

  update(deltaSeconds: number): RenderAnimatorEvaluation {
    const delta = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0
    const clips: RenderAnimatorClipSample[] = []
    const layers: RenderAnimatorLayerEvaluation[] = []

    for (let layerIndex = 0; layerIndex < this.controller.layers.length; layerIndex += 1) {
      const layer = this.controller.layers[layerIndex]
      const runtime = this.layers[layerIndex]
      if (!layer || !runtime) continue
      const machine = this.stateMachine(layer)
      if (!machine || machine.states.length === 0) continue

      if (runtime.transition) {
        this.advanceTransition(runtime, machine, delta)
      } else {
        const state = stateAt(machine, runtime.stateIndex)
        const previousElapsed = runtime.elapsed
        runtime.elapsed += delta * this.stateSpeed(state)
        const transition = state
          ? this.selectTransition(machine, state, previousElapsed, runtime.elapsed)
          : undefined
        if (state && transition) this.beginTransition(runtime, machine, state, transition)
      }

      const layerWeight = this.layerWeights[layerIndex] ?? 0
      if (runtime.transition) {
        const transition = runtime.transition
        const progress =
          transition.duration > 0 ? clamp01(transition.elapsed / transition.duration) : 1
        const source = stateAt(machine, transition.sourceState)
        const destination = stateAt(machine, transition.destinationState)
        if (source)
          this.sampleState(
            source,
            transition.sourceElapsed,
            layer,
            layerWeight * (1 - progress),
            clips,
          )
        if (destination)
          this.sampleState(
            destination,
            transition.destinationElapsed,
            layer,
            layerWeight * progress,
            clips,
          )
        layers.push({
          layerIndex,
          stateIndex: destination?.index ?? runtime.stateIndex,
          stateName: destination?.name ?? source?.name ?? '',
          normalizedTime: destination
            ? this.normalizedStateTime(
                destination,
                this.stateSampleTime(destination, transition.destinationElapsed),
              )
            : 0,
          transitionProgress: progress,
        })
      } else {
        const state = stateAt(machine, runtime.stateIndex)
        if (!state) continue
        this.sampleState(state, runtime.elapsed, layer, layerWeight, clips)
        layers.push({
          layerIndex,
          stateIndex: state.index,
          stateName: state.name,
          normalizedTime: this.normalizedStateTime(
            state,
            this.stateSampleTime(state, runtime.elapsed),
          ),
          transitionProgress: null,
        })
      }
    }

    return { clips: mergeClipSamples(clips), layers }
  }

  private setParameter(
    parameter: string | number,
    value: number | boolean,
    expected: RenderAnimatorParameterType,
  ): void {
    const definition = this.resolveParameter(parameter)
    if (!definition) throw new Error(`Unknown AnimatorController parameter: ${String(parameter)}`)
    if (definition.type !== expected) {
      throw new Error(
        `AnimatorController parameter ${definition.name} is ${definition.type}, not ${expected}`,
      )
    }
    this.values.set(definition.id, value)
  }

  private resolveParameter(parameter: string | number): RenderAnimatorParameter | undefined {
    return typeof parameter === 'string'
      ? this.parameterByName.get(parameter)
      : this.parameterById.get(parameter >>> 0)
  }

  private stateMachine(layer: RenderAnimatorLayer): RenderAnimatorStateMachine | undefined {
    return this.controller.stateMachines.find(machine => machine.index === layer.stateMachineIndex)
  }

  private resetLayers(): void {
    for (let index = 0; index < this.layers.length; index += 1) {
      const layer = this.controller.layers[index]
      const runtime = this.layers[index]
      if (!layer || !runtime) continue
      const machine = this.stateMachine(layer)
      runtime.stateIndex = machine ? this.initialState(machine) : 0
      runtime.elapsed = 0
      delete runtime.transition
    }
  }

  private initialState(machine: RenderAnimatorStateMachine): number {
    for (const selector of machine.selectorStates ?? []) {
      if (!selector.isEntry) continue
      const transition = selector.transitions.find(
        candidate =>
          stateAt(machine, candidate.destinationState) !== undefined &&
          candidate.conditions.every(condition => this.conditionMatches(condition)),
      )
      if (transition) return transition.destinationState
    }
    return stateAt(machine, machine.defaultState)?.index ?? machine.states[0]?.index ?? 0
  }

  private assertLayerIndex(layerIndex: number): void {
    if (!Number.isInteger(layerIndex) || layerIndex < 0 || layerIndex >= this.layers.length)
      throw new RangeError(`AnimatorController layer index out of range: ${layerIndex}`)
  }

  private advanceTransition(
    runtime: RuntimeLayer,
    machine: RenderAnimatorStateMachine,
    delta: number,
  ): void {
    const transition = runtime.transition
    if (!transition) return
    const source = stateAt(machine, transition.sourceState)
    const destination = stateAt(machine, transition.destinationState)
    transition.elapsed += delta
    transition.sourceElapsed += delta * this.stateSpeed(source)
    transition.destinationElapsed += delta * this.stateSpeed(destination)
    if (transition.duration > 0 && transition.elapsed < transition.duration) return
    runtime.stateIndex = transition.destinationState
    runtime.elapsed = transition.destinationElapsed
    delete runtime.transition
  }

  private beginTransition(
    runtime: RuntimeLayer,
    machine: RenderAnimatorStateMachine,
    source: RenderAnimatorState,
    transition: RenderAnimatorTransition,
  ): void {
    const destination = stateAt(machine, transition.destinationState)
    if (!destination) return
    if (destination.index === source.index && transition.canTransitionToSelf === false) return
    const sourceDuration = this.stateDuration(source)
    const destinationDuration = this.stateDuration(destination)
    const duration = Math.max(
      0,
      transition.hasFixedDuration ? transition.duration : transition.duration * sourceDuration,
    )
    runtime.transition = {
      definition: transition,
      sourceState: source.index,
      sourceElapsed: runtime.elapsed,
      destinationState: destination.index,
      destinationElapsed: Math.max(0, transition.offset) * destinationDuration,
      elapsed: 0,
      duration,
    }
    this.consumeTransitionTriggers(transition)
    if (duration === 0) this.advanceTransition(runtime, machine, 0)
  }

  private selectTransition(
    machine: RenderAnimatorStateMachine,
    state: RenderAnimatorState,
    previousElapsed: number,
    elapsed: number,
  ): RenderAnimatorTransition | undefined {
    return [...machine.anyStateTransitions, ...state.transitions].find(transition => {
      if (transition.destinationState < 0) return false
      if (transition.destinationState === state.index && transition.canTransitionToSelf === false)
        return false
      if (
        transition.hasExitTime &&
        !this.exitTimeReached(state, transition.exitTime, previousElapsed, elapsed)
      )
        return false
      return transition.conditions.every(condition => this.conditionMatches(condition))
    })
  }

  private exitTimeReached(
    state: RenderAnimatorState,
    exitTime: number,
    previousElapsed: number,
    elapsed: number,
  ): boolean {
    const previous = this.normalizedStateTime(state, this.stateSampleTime(state, previousElapsed))
    const current = this.normalizedStateTime(state, this.stateSampleTime(state, elapsed))
    const threshold = Math.max(0, finiteOr(exitTime, 0))
    if (!state.loop || threshold >= 1) return current + 1e-8 >= threshold

    const phaseThreshold = threshold % 1
    const previousLoop = Math.floor(Math.max(0, previous))
    const currentLoop = Math.floor(Math.max(0, current))
    const previousPhase = positiveModulo(previous, 1)
    const currentPhase = positiveModulo(current, 1)
    if (current < previous) return currentPhase + 1e-8 >= phaseThreshold
    if (currentLoop === previousLoop) return currentPhase + 1e-8 >= phaseThreshold
    return (
      previousPhase + 1e-8 >= phaseThreshold ||
      currentLoop - previousLoop > 1 ||
      currentPhase + 1e-8 >= phaseThreshold
    )
  }

  private conditionMatches(condition: RenderAnimatorCondition): boolean {
    const parameter = this.parameterById.get(condition.parameterId)
    const value = this.values.get(condition.parameterId) ?? parameter?.defaultValue ?? 0
    const numeric = typeof value === 'boolean' ? (value ? 1 : 0) : value
    switch (condition.mode) {
      case 'if':
        return !!value
      case 'if-not':
        return !value
      case 'greater':
        return numeric > condition.threshold
      case 'less':
        return numeric < condition.threshold
      case 'equals':
        return numeric === condition.threshold
      case 'not-equal':
        return numeric !== condition.threshold
    }
  }

  private consumeTransitionTriggers(transition: RenderAnimatorTransition): void {
    for (const condition of transition.conditions) {
      if (this.parameterById.get(condition.parameterId)?.type === 'trigger')
        this.values.set(condition.parameterId, false)
    }
  }

  private normalizedStateTime(state: RenderAnimatorState, elapsed: number): number {
    const duration = this.stateDuration(state)
    return duration > 0 ? elapsed / duration : 0
  }

  private stateSpeed(state: RenderAnimatorState | undefined): number {
    if (!state) return 1
    const parameter = state.speedParameterId
    const multiplier = parameter === undefined ? 1 : numericParameter(this.values, parameter)
    return Math.max(0, Math.abs(state.speed * multiplier))
  }

  private stateSampleTime(state: RenderAnimatorState, elapsed: number): number {
    if (state.timeParameterId === undefined) return elapsed
    return (
      Math.max(0, numericParameter(this.values, state.timeParameterId)) * this.stateDuration(state)
    )
  }

  private stateDuration(state: RenderAnimatorState): number {
    return Math.max(0.000001, motionDuration(state.motion, this.clipDurations))
  }

  private sampleState(
    state: RenderAnimatorState,
    elapsed: number,
    layer: RenderAnimatorLayer,
    weight: number,
    out: RenderAnimatorClipSample[],
  ): void {
    if (!state.motion || weight <= 0) return
    sampleMotion(
      state.motion,
      this.stateSampleTime(state, elapsed),
      state.loop,
      state.cycleOffset +
        (state.cycleOffsetParameterId === undefined
          ? 0
          : numericParameter(this.values, state.cycleOffsetParameterId)),
      weight,
      layer.index,
      layer.blendingMode === 'additive',
      this.values,
      this.clipDurations,
      out,
      1,
      0,
      !!state.mirror !==
        (state.mirrorParameterId === undefined
          ? false
          : !!this.values.get(state.mirrorParameterId)),
    )
  }
}

function stateAt(
  machine: RenderAnimatorStateMachine,
  stateIndex: number,
): RenderAnimatorState | undefined {
  return machine.states.find(state => state.index === stateIndex)
}

function motionDuration(
  motion: RenderAnimatorMotion | undefined,
  clipDurations: readonly number[],
): number {
  if (!motion) return 0
  if (motion.kind === 'clip') {
    const speed = Math.max(0.000001, Math.abs(motion.speed ?? 1))
    return Math.max(0, clipDurations[motion.animationIndex] ?? 0) / speed
  }
  let duration = 0
  for (const child of motion.children) {
    const speed = Math.max(0.000001, Math.abs(child.speed ?? 1))
    duration = Math.max(duration, motionDuration(child.motion, clipDurations) / speed)
  }
  return duration
}

function sampleMotion(
  motion: RenderAnimatorMotion,
  elapsed: number,
  loop: boolean,
  stateCycleOffset: number,
  weight: number,
  layerIndex: number,
  additive: boolean,
  values: ReadonlyMap<number, number | boolean>,
  clipDurations: readonly number[],
  out: RenderAnimatorClipSample[],
  inheritedSpeed = 1,
  inheritedCycleOffset = 0,
  inheritedMirror = false,
): void {
  if (motion.kind === 'clip') {
    const duration = Math.max(0, clipDurations[motion.animationIndex] ?? 0)
    const speed = inheritedSpeed * (motion.speed ?? 1)
    const offset = stateCycleOffset + inheritedCycleOffset + (motion.cycleOffset ?? 0)
    let timeSeconds = elapsed * speed + offset * duration
    if (duration > 0) {
      timeSeconds = loop
        ? positiveModulo(timeSeconds, duration)
        : Math.min(Math.max(timeSeconds, 0), duration)
    }
    out.push({
      animationIndex: motion.animationIndex,
      weight,
      timeSeconds,
      layerIndex,
      additive,
      ...(inheritedMirror || motion.mirror ? { mirror: true } : {}),
    })
    return
  }

  const childWeights = blendWeights(motion, values)
  for (let index = 0; index < motion.children.length; index += 1) {
    const child = motion.children[index]
    const childWeight = childWeights[index] ?? 0
    if (!child || childWeight <= 0) continue
    sampleMotion(
      child.motion,
      elapsed,
      loop,
      stateCycleOffset,
      weight * childWeight,
      layerIndex,
      additive,
      values,
      clipDurations,
      out,
      inheritedSpeed * (child.speed ?? 1),
      inheritedCycleOffset + (child.cycleOffset ?? 0),
      inheritedMirror !== !!child.mirror,
    )
  }
}

function blendWeights(
  motion: RenderAnimatorBlendTreeMotion,
  values: ReadonlyMap<number, number | boolean>,
): number[] {
  if (motion.children.length === 0) return []
  if (motion.children.length === 1) return [1]
  if (motion.blendType === 'direct') {
    const weights = motion.children.map(child =>
      Math.max(0, numericParameter(values, child.directParameterId)),
    )
    return motion.normalizedBlendValues === false ? weights : normalizeWeights(weights)
  }
  if (motion.blendType === 'simple-1d') {
    const value = numericParameter(values, motion.parameterId)
    const ordered = motion.children
      .map((child, index) => ({ index, threshold: child.threshold ?? index }))
      .sort((left, right) => left.threshold - right.threshold)
    const weights = new Array<number>(motion.children.length).fill(0)
    if (value <= ordered[0]!.threshold) {
      weights[ordered[0]!.index] = 1
      return weights
    }
    if (value >= ordered[ordered.length - 1]!.threshold) {
      weights[ordered[ordered.length - 1]!.index] = 1
      return weights
    }
    for (let index = 1; index < ordered.length; index += 1) {
      const right = ordered[index]!
      const left = ordered[index - 1]!
      if (value > right.threshold) continue
      const span = right.threshold - left.threshold
      const alpha = span > 0 ? clamp01((value - left.threshold) / span) : 0
      weights[left.index] = 1 - alpha
      weights[right.index] = alpha
      return weights
    }
    return weights
  }

  const x = numericParameter(values, motion.parameterId)
  const y = numericParameter(values, motion.parameterYId)
  const positions = motion.children.map(
    (child, index) => child.position ?? ([child.threshold ?? index, 0] as const),
  )
  const exact = exactPositionWeights(positions, [x, y])
  if (exact) return exact
  if (motion.blendType === 'simple-directional-2d')
    return simpleDirectionalWeights(positions, [x, y])
  if (motion.blendType === 'freeform-directional-2d')
    return gradientBandWeights(positions, [x, y], true)
  return gradientBandWeights(positions, [x, y], false)
}

function exactPositionWeights(
  positions: readonly (readonly [number, number])[],
  query: readonly [number, number],
): number[] | undefined {
  const matches = positions.flatMap((position, index) =>
    squaredDistance2(position, query) <= 1e-12 ? [index] : [],
  )
  if (matches.length === 0) return undefined
  const matchSet = new Set(matches)
  return positions.map((_, index) => (matchSet.has(index) ? 1 / matches.length : 0))
}

function simpleDirectionalWeights(
  positions: readonly (readonly [number, number])[],
  query: readonly [number, number],
): number[] {
  const weights = positions.map(() => 0)
  const centers = positions.flatMap((position, index) => (length2(position) <= 1e-8 ? [index] : []))
  const directions = positions
    .map((position, index) => ({
      index,
      angle: Math.atan2(position[1], position[0]),
      magnitude: length2(position),
    }))
    .filter(entry => entry.magnitude > 1e-8)
    .sort((left, right) => left.angle - right.angle)
  if (directions.length === 0) {
    const centerWeight = centers.length > 0 ? 1 / centers.length : 1 / positions.length
    for (const index of centers.length > 0 ? centers : positions.map((_, index) => index))
      weights[index] = centerWeight
    return weights
  }

  const queryMagnitude = length2(query)
  const angular = angularDirectionalWeights(directions, Math.atan2(query[1], query[0]))
  const edgeMagnitude = angular.reduce(
    (sum, item) => sum + item.weight * directions[item.directionIndex]!.magnitude,
    0,
  )
  const edgeWeight = edgeMagnitude > 1e-8 ? clamp01(queryMagnitude / edgeMagnitude) : 1
  for (const item of angular) {
    const direction = directions[item.directionIndex]!
    weights[direction.index] = (weights[direction.index] ?? 0) + item.weight * edgeWeight
  }

  const centerWeight = 1 - edgeWeight
  if (centerWeight > 0) {
    const recipients = centers.length > 0 ? centers : directions.map(direction => direction.index)
    for (const index of recipients)
      weights[index] = (weights[index] ?? 0) + centerWeight / recipients.length
  }
  return normalizeWeights(weights)
}

function angularDirectionalWeights(
  directions: readonly { angle: number }[],
  queryAngle: number,
): Array<{ directionIndex: number; weight: number }> {
  if (directions.length === 1) return [{ directionIndex: 0, weight: 1 }]
  let right = directions.findIndex(direction => direction.angle >= queryAngle)
  if (right < 0) right = 0
  const left = (right - 1 + directions.length) % directions.length
  const leftAngle = directions[left]!.angle
  const rightAngle = directions[right]!.angle
  const span = positiveModulo(rightAngle - leftAngle, Math.PI * 2)
  if (span <= 1e-8) return [{ directionIndex: left, weight: 1 }]
  const alpha = clamp01(positiveModulo(queryAngle - leftAngle, Math.PI * 2) / span)
  return [
    { directionIndex: left, weight: 1 - alpha },
    { directionIndex: right, weight: alpha },
  ]
}

function gradientBandWeights(
  positions: readonly (readonly [number, number])[],
  query: readonly [number, number],
  polar: boolean,
): number[] {
  const queryMagnitude = length2(query)
  const weights = positions.map((position, index) => {
    const positionMagnitude = length2(position)
    let minimum = Number.POSITIVE_INFINITY
    for (let otherIndex = 0; otherIndex < positions.length; otherIndex += 1) {
      if (otherIndex === index) continue
      const other = positions[otherIndex]!
      const otherMagnitude = length2(other)
      const polarScale = (positionMagnitude + otherMagnitude) * 0.5
      const reference = polar
        ? polarGradientVector(position, positionMagnitude, other, otherMagnitude, polarScale)
        : subtract2(other, position)
      const denominator = dot2(reference, reference)
      if (denominator <= 1e-12) continue
      const parametric = polar
        ? polarGradientVector(position, positionMagnitude, query, queryMagnitude, polarScale)
        : subtract2(query, position)
      minimum = Math.min(minimum, Math.max(0, 1 - dot2(parametric, reference) / denominator))
    }
    return Number.isFinite(minimum) ? minimum : 1
  })
  return normalizeWeights(weights)
}

function polarGradientVector(
  origin: readonly [number, number],
  originMagnitude: number,
  target: readonly [number, number],
  targetMagnitude: number,
  magnitudeScale: number,
): readonly [number, number] {
  const magnitudeDelta =
    magnitudeScale > 1e-8 ? (targetMagnitude - originMagnitude) / magnitudeScale : 0
  return [magnitudeDelta, 2 * signedAngle2(origin, target)]
}

function signedAngle2(from: readonly [number, number], to: readonly [number, number]): number {
  if (length2(from) <= 1e-8 || length2(to) <= 1e-8) return 0
  return Math.atan2(from[0] * to[1] - from[1] * to[0], dot2(from, to))
}

function subtract2(
  left: readonly [number, number],
  right: readonly [number, number],
): readonly [number, number] {
  return [left[0] - right[0], left[1] - right[1]]
}

function dot2(left: readonly [number, number], right: readonly [number, number]): number {
  return left[0] * right[0] + left[1] * right[1]
}

function length2(value: readonly [number, number]): number {
  return Math.hypot(value[0], value[1])
}

function squaredDistance2(
  left: readonly [number, number],
  right: readonly [number, number],
): number {
  return (left[0] - right[0]) ** 2 + (left[1] - right[1]) ** 2
}

function numericParameter(
  values: ReadonlyMap<number, number | boolean>,
  parameterId: number | undefined,
): number {
  if (parameterId === undefined) return 0
  const value = values.get(parameterId) ?? 0
  return typeof value === 'boolean' ? (value ? 1 : 0) : value
}

function normalizeWeights(weights: readonly number[]): number[] {
  const total = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0)
  if (total <= 0) return weights.map((_, index) => (index === 0 ? 1 : 0))
  return weights.map(weight => Math.max(0, weight) / total)
}

function mergeClipSamples(
  samples: readonly RenderAnimatorClipSample[],
): RenderAnimatorClipSample[] {
  const merged = new Map<string, RenderAnimatorClipSample>()
  for (const sample of samples) {
    if (sample.weight <= 0 || sample.animationIndex < 0) continue
    const key = `${sample.layerIndex}:${sample.additive ? 1 : 0}:${sample.animationIndex}:${sample.mirror ? 1 : 0}`
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, { ...sample })
      continue
    }
    const weight = existing.weight + sample.weight
    existing.timeSeconds =
      weight > 0
        ? (existing.timeSeconds * existing.weight + sample.timeSeconds * sample.weight) / weight
        : existing.timeSeconds
    existing.weight = weight
  }
  return [...merged.values()]
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function finiteOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback
}
