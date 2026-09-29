import { describe, expect, it } from 'vitest'
import { decodeUastcBlock, decodeUastcSurface } from '../src/texture/uastc.js'

const hex = (text: string) => Uint8Array.from(text.match(/../gu) ?? [], byte => Number.parseInt(byte, 16))

/**
 * Two random blocks of every UASTC mode and the 4×4 RGBA32 texels the Basis Universal transcoder
 * (the copy three.js ships) writes for them; the decoder also matched it bit for bit on Warzone
 * 2100's ground, water and backdrop textures (30 million bytes) when it was written.
 */
const VECTORS: readonly (readonly [number, string, string])[] = [
  [0, 'e13403862da8e71ab15c0bee75506f02', '5828d1ffccb1c1ffd9bfbfff8c65caffccb1c1ff5828d1ffedd7bdffedd7bdff8c65caffa07cc7ff5828d1ff8c65cafff6e2bbff9671c9ff6c3fcfff5828d1ff'],
  [0, '71841356bdf8f7ea41ac1bbe05a07fd2', '5678d1ff7783bdffbb9a93ffa9949effb19799ff5e7bcdffcb9f8affb19799ff7f86b8ff5678d1ff5678d1ffa9949effd2a285ff8e8bafff657dc8ffc39d8fff'],
  [1, 'f53403862da8e71ab15c0bee75506f02', '433fbdff583ea2ff3041d7ff6c3d88ff433fbdff433fbdff6c3d88ff583ea2ff3041d7ff3041d7ff583ea2ff6c3d88ff583ea2ff6c3d88ff433fbdff433fbdff'],
  [1, '75841356bdf8f7ea41ac1bbe05a07fd2', 'b0c557ffc3c33fffb0c557ffeabf0fffd7c126ffd7c126ffeabf0fffd7c126ffc3c33fffb0c557ffd7c126ffeabf0fffeabf0fffd7c126ffc3c33fffc3c33fff'],
  [2, 'fd3493872da8e71ab15c0bee75506f02', '5e4e6fff50b972ff46c57aff744285ff485a59ff33dd88ff778855ffb71dc8ff744285ff64a063ff50b972ff336644ff5e4e6fff64a063ff778855ffb71dc8ff'],
  [2, '9d1326bdf8f7ea41ac1bbe05a07fd209', 'd9d3b2ff9d0e98ff550066ffe71dcdff55ff77ff6af881ff850987ff550066ffeeccbbffeeccbbff80f18affff22ddff55ff77ffd9d3b2ffd9d3b2ff80f18aff'],
  [3, '2374a3c66de8275af19c4b2eb590af42', 'abd26cff00a35cff17d174ff3dd94eff54ba64ff54ba64ff00a35cff45e88bff54ba64ffffe874ff00a35cff16ba6bff54ba64ff00a35cff8be800ff65e126ff'],
  [3, 'c35346fd38372a81ec5bfe45e0bf1249', '458be8ff829bd9ff45babaffe81700ff829bd9ff458be8ff45babaff7a078cffffbabaffffbabaff2ea3a3ff4500d1ffc2abc9ffc2abc9ff45babaffb30f44ff'],
  [4, '73b45306ad28679a31dc8b6ef5d0ef82', '93b658ff2061d8ff0675ffff97cb27ff588a9aff67af6eff67af6eff97cb27ff93b658ff0675ffff67af6eff67af6eff97cb27ff97cb27ff3591b8ff97cb27ff'],
  [4, '1393863c78776ac12c9b3e8520ff5289', 'df067bffe84d66ffdf067bfff1984fffdf067bffdf067bfff1984fffdf067bfff9df3afff9df3afff9df3aff655f74ffe84d66ffe84d66ff6a645dff6a645dff'],
  [5, 'abf4c346ed68a7da711ccbae35102fc2', '98846eff7b8b96ffc67931ff7b8b96ffc67931ff898782ffc67931ffc67931ffb77d44ffc67931ff898782ff98846eff6c8eaaffa88058ff6c8eaaffd4761dff'],
  [5, '2b44d3167db8b7aa016cdb7ec5603f92', '6d87abff6d87abffc37d2effc37d2effc37d2effc37d2effc37d2effc37d2effd17b1affb57e43ff898482ffa78057ff7b8597ff6d87abff97826effd17b1aff'],
  [6, 'bbf4c346ed68a7da711ccbae35102fc2', '3b8e69ff42513eff508e69ff3b7a5bff49513eff508e69ff50654cff49654cff427a5bff3b513eff3b8e69ff3b7a5bff50513eff3b654cff3b654cff508e69ff'],
  [6, '3b44d3167db8b7aa016cdb7ec5603f92', 'e67c28ffe67c28ffe65e28ff9a7294ff7468c9ffc15e5dff9a5e94ff7472c9ffc1725dffe65e28ffe67c28ff9a7294ff745ec9ff747cc9ff9a7c94ffc1685dff'],
  [7, 'a7f4f346ed68a7da711ccbae35102fc2', '354df3ff97c5d8ffbed806ff8ebd2fff97c5d8ff678be5ff5ca05bff8ebd2fff0613ffff0613ffff5ca05bffbed806ff678be5ff2d8484ff8ebd2fff8ebd2fff'],
  [7, '47d3a67cb8b7aa016cdb7ec5603f92c9', 'b10d68ffc70a6affb10d68fff2066effb10d68ffb10d68ffdd086cffc70a6aff6a7799ff6e6eb8ff6e6eb8ffc70a6aff687b8aff6a7799ff6c72a9ffb10d68ff'],
  [8, 'f73403862da8e71ab15c0bee75506f02', 'a719306ca719306ca719306ca719306ca719306ca719306ca719306ca719306ca719306ca719306ca719306ca719306ca719306ca719306ca719306ca719306c'],
  [8, '77841356bdf8f7ea41ac1bbe05a07fd2', '239cb0ea239cb0ea239cb0ea239cb0ea239cb0ea239cb0ea239cb0ea239cb0ea239cb0ea239cb0ea239cb0ea239cb0ea239cb0ea239cb0ea239cb0ea239cb0ea'],
  [9, 'ef3403b62da8e71ab15c0bee75506f02', '88ee55774a7649c166c11cd311dd778888ee5577664433dd66c11cd32dab61a466c11cd311dd778877d839a411dd778888ee55774a7649c188ee5577664433dd'],
  [9, '8f1356edf8f7ea41ac1bbe05a07fd209', 'ccbb5500ccbb5500ef8dc716ef8dc7168d95f416dd00dd00dd00dd00dd00dd0066ddff228d95f416b648e90bb648e90bdd00dd0066ddff228d95f41666ddff22'],
  [10, '2a7443c66de8275af19c4b2eb590af42', '362bea9eef8efa51cd7bf75fa767f46fbe74f6656745ef8ae488f9564d37ec94734bf085be74f665362bea9ea767f46fef8efa51b26df56a4d37ec946745ef8a'],
  [10, 'bac45396fd38372a81ec5bfe45e0bf12', '7c6ca9d4aa99d6c2c0afebb9cab9f5b5b9a8e5bc9787c4c9cab9f5b5cfbefab39787c4c99282bfcc7c6ca9d4cab9f5b5cfbefab3b9a8e5bc8676b3d08171aed2'],
  [11, '287443c66de8275af19c4b2eb590af42', 'a35cbe36fa884cd9fa5cbe36de6a996bde884cd9c05cbe36fa7a71a4a37a71a4c06a996bde884cd9a35cbe36de6a996bfa884cd9de7a71a4a37a71a4c05cbe36'],
  [11, 'b8c45396fd38372a81ec5bfe45e0bf12', '8877935688775c5688774156c6684135e4615c26a6707846c6684135e4614126a67078468877785688779356c6684135e4614126e4615c26c6689335a6709346'],
  [12, '2e7443c66de8275af19c4b2eb590af42', '627098b0627098b0627098b02008459b575f8bac575f8bac352a60a2352a60a26d81a6b3575f8bac2a19529e2008459b575f8bac352a60a26d81a6b3575f8bac'],
  [12, 'bec45396fd38372a81ec5bfe45e0bf12', '837bb9528c567e63837bb9529f0c05859f0c05858c567e63837bb95287699b5a7e8dd64a91425d6c9f0c05859f0c05858c567e639630407491425d6c7e8dd64a'],
  [13, '3f7443c66de8275af19c4b2eb590af42', 'b79fc52eb79fc52eb76873b9b76873b9a16873b9a19fc52eb79fc52eb79fc52eb76873b9a19fc52ea16873b9a16873b9a19fc52ea19fc52ea19fc52eb79fc52e'],
  [13, 'bfc45396fd38372a81ec5bfe45e0bf12', 'f6dc046fe3a8b2f9e3dcb2f9e3dcb2f9f6dc046fe3dcb2f9f6dc046ff6dc046ff6a8046fe3a8b2f9e3a8b2f9e3a8b2f9e3a8b2f9f6a8046ff6a8046ff6dc046f'],
  [14, '2d7443c66de8275af19c4b2eb590af42', 'dc7e15b9c08a52c7a29692d6a29692d6a29692d6c08a52c7c08a52c7dc7e15b9a29692d6dc7e15b986a2cfe486a2cfe4c08a52c7c08a52c7c08a52c7c08a52c7'],
  [14, 'adc45396fd38372a81ec5bfe45e0bf12', 'c1834ecb8fa3c8e58fa3c8e5a7938cd9d97312bea7938cd9d97312bed97312bed97312be8fa3c8e58fa3c8e58fa3c8e58fa3c8e5c1834ecbc1834ecbc1834ecb'],
  [15, '057443c66de8275af19c4b2eb590af42', 'b0b0b08dababab81adadad86a3a3a36ba5a5a572b0b0b08db4b4b498adadad86aaaaaa7da8a8a87ab0b0b08dababab81a5a5a572adadad86b0b0b08db6b6b69c'],
  [15, '85c45396fd38372a81ec5bfe45e0bf12', 'f1f1f1cef6f6f6dcf1f1f1ceefefefc8e3e3e3a8e6e6e6aff4f4f4d6e3e3e3a8e3e3e3a8f4f4f4d6f4f4f4d6f6f6f6dce3e3e3a8e3e3e3a8f0f0f0cbebebebbd'],
  [16, '157443e66de8275af19c4b2eb590af42', '7474747bafafaf627474747b7474747b3c3c3c92afafaf623c3c3c92e7e7e74be7e7e74b7474747b7474747b7474747b646464781b1b1b891b1b1b8964646478'],
  [16, 'd553961d3b372a81ec5bfe45e0bf1249', 'fbfbfb7ffbfbfb7f9696961196969611b9b9b93c9696961196969611b7b7b735a2a2a22dfbfbfb7fdadada5bfbfbfb7fb9b9b93ca2a2a22dfbfbfb7fdadada5b'],
  [17, '65b48306ad28679a31dc8b6ef5d0ef82', '68686839454545395050506b686868a1454545a14545456b5c5c5c395c5c5cd35c5c5cd3505050a1505050d35c5c5c39505050a1454545d35c5c5cd35c5c5c6b'],
  [17, 'e50493d63d78776ac12c9b3e8520ff52', 'e0e0e099d0d0d0bbeeeeee75e0e0e075e0e0e099d0d0d099c1c1c1bbe0e0e053c1c1c199d0d0d075eeeeeebbe0e0e0bbeeeeee99d0d0d053c1c1c153e0e0e099'],
  [18, '69b48306ad28679a31dc8b6ef5d0ef82', '7c448dff505191ff74468eff7c448dff7c448dff604c90ff5d4d90ff554f91ff604c90ff674a8fff365894ff81438cff365894ff465492ff674a8fff584f90ff'],
  [18, 'f90493d63d78776ac12c9b3e8520ff52', '9f7698ffa978a8ffb07ab4ff967388ffa17699ffac79adffa17699ffa978a8ffb47bbbff9d7594ff957386ff957386ffa878a6ffb57bbdff9f7698ff9e7596ff'],
]

describe('UASTC', () => {
  it('decodes every mode as the reference transcoder does', () => {
    for (const [mode, block, texels] of VECTORS) {
      const out = new Uint8Array(64)
      expect(decodeUastcBlock(hex(block), 0, out), `mode ${mode}`).toBe(true)
      expect(Buffer.from(out).toString('hex'), `mode ${mode} block ${block}`).toBe(texels)
    }
  })

  it('refuses the reserved mode code and leaves its texels alone', () => {
    const block = new Uint8Array(16)
    block[0] = 0x45
    const out = new Uint8Array(64).fill(7)
    expect(decodeUastcBlock(block, 0, out)).toBe(false)
    expect(out.every(value => value === 7)).toBe(true)
  })

  it('crops edge blocks to the surface and fills a reserved block with transparent black', () => {
    const solid = hex(VECTORS.find(([mode]) => mode === 8)![1])
    const reserved = new Uint8Array(16)
    reserved[0] = 0x45
    const data = new Uint8Array(32)
    data.set(solid, 0)
    data.set(reserved, 16)
    const pixels = decodeUastcSurface(data, 6, 3)
    expect(pixels).toHaveLength(6 * 3 * 4)
    const colour = [...pixels.subarray(0, 4)]
    expect([...pixels.subarray(3 * 4, 4 * 4)]).toEqual(colour)
    expect([...pixels.subarray(4 * 4, 6 * 4)]).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
    expect(() => decodeUastcSurface(data, 12, 4)).toThrow(RangeError)
  })
})
