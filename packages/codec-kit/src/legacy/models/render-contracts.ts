export interface Vec2 {
  x: number
  y: number
}

export interface Vec3 extends Vec2 {
  z: number
}

export interface Bounds {
  min: Vec3
  max: Vec3
  radius: number
}

export type RenderPrimitiveTopology = 'triangles' | 'lines' | 'line-strip' | 'points'

export interface RenderMorphTarget {
  name?: string
  positions?: Float32Array
  normals?: Float32Array
  tangents?: Float32Array
}
