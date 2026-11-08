// 可复现随机数：同一种子得到完全一致的序列（mulberry32）

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** [min, max] 区间整数 */
export function randInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/** [min, max] 区间浮点数 */
export function randRange(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

/** 以 base 为中心、±ratio 比例抖动，四舍五入为整数 */
export function jitter(rng: Rng, base: number, ratio: number): number {
  return Math.round(base * randRange(rng, 1 - ratio, 1 + ratio));
}
