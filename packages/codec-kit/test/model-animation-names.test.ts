import { expect, it } from 'vitest'
import {
  modelAnimationNameMatches,
  modelAnimationNameMatchScore,
} from '../src/model/animation.js'

it('matches native animation property sets without order, case or duplicate bias', () => {
  expect(modelAnimationNameMatchScore('Stand', 'Stand')).toBe(0)
  expect(modelAnimationNameMatchScore('Work Stand', 'stand WORK')).toBe(0)
  expect(modelAnimationNameMatchScore('Stand Work Work', 'STAND stand')).toBe(1)
  expect(modelAnimationNameMatchScore('Stand Work Alternate', 'Work')).toBe(2)
  expect(modelAnimationNameMatchScore('Stand', 'Work')).toBeUndefined()
  expect(modelAnimationNameMatchScore('Stand', '')).toBeUndefined()
  expect(modelAnimationNameMatches('Stand Work', 'Work')).toBe(true)
  expect(modelAnimationNameMatches('Stand', 'Work')).toBe(false)
})
