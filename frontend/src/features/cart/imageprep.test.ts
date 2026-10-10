import { describe, expect, it } from 'vitest'
import { fitWithin, grayscaleStretch } from './imageprep'

describe('fitWithin', () => {
  it('scales the longer side down to the limit, keeping the aspect ratio', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1600, height: 1200 })
    expect(fitWithin(3000, 4000)).toEqual({ width: 1200, height: 1600 })
  })
  it('never scales up and never returns zero', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 })
    expect(fitWithin(100000, 1)).toEqual({ width: 1600, height: 1 })
  })
})

describe('grayscaleStretch', () => {
  const px = (v: number[]) => new Uint8ClampedArray(v.flatMap((g) => [g, g, g, 255]))

  it('stretches a dull image to the full range and leaves alpha alone', () => {
    const data = px([...Array(50).fill(100), ...Array(50).fill(150)])
    grayscaleStretch(data)
    expect(data[0]).toBe(0)
    expect(data[data.length - 4]).toBe(255)
    expect(data[3]).toBe(255)
  })
  it('turns colour into equal grey channels', () => {
    const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255, 0, 255, 0, 255])
    grayscaleStretch(data)
    for (let i = 0; i < data.length; i += 4) expect(data[i]).toBe(data[i + 1])
  })
  it('keeps a flat image flat instead of amplifying noise', () => {
    const data = px(Array(20).fill(120))
    grayscaleStretch(data)
    expect([...data].filter((_, i) => i % 4 === 0)).toEqual(Array(20).fill(120))
  })
})
