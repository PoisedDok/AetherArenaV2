import {
  type Guru,
  type GuruBones,
  type GuruSoul,
  type StoredGuru,
  EYES,
  HATS,
  RARITIES,
  RARITY_WEIGHTS,
  type Rarity,
  SPECIES,
  STAT_NAMES,
  type StatName,
} from './types'

// ---------------------------------------------------------------------------
// Mulberry32 — tiny seeded PRNG, deterministic companion generation
// Ported exactly from buddy/companion.ts
// ---------------------------------------------------------------------------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// FNV-1a hash — pure JS, no Bun/Node deps
function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]!
}

function rollRarity(rng: () => number): Rarity {
  const total = Object.values(RARITY_WEIGHTS).reduce((a, b) => a + b, 0)
  let r = rng() * total
  for (const rarity of RARITIES) {
    r -= RARITY_WEIGHTS[rarity]
    if (r < 0) return rarity
  }
  return 'common'
}

const RARITY_FLOOR: Record<Rarity, number> = {
  common: 5,
  uncommon: 15,
  rare: 25,
  epic: 35,
  legendary: 50,
}

/**
 * One peak stat, one dump stat, rest scattered. Rarity bumps the floor.
 * Ported exactly from buddy/companion.ts to preserve stat personality system.
 */
function rollStats(rng: () => number, rarity: Rarity): Record<StatName, number> {
  const floor = RARITY_FLOOR[rarity]
  const peak = pick(rng, STAT_NAMES)
  let dump = pick(rng, STAT_NAMES)
  while (dump === peak) dump = pick(rng, STAT_NAMES)

  const stats = {} as Record<StatName, number>
  for (const name of STAT_NAMES) {
    if (name === peak) {
      stats[name] = Math.min(100, floor + 50 + Math.floor(rng() * 30))
    } else if (name === dump) {
      stats[name] = Math.max(1, floor - 10 + Math.floor(rng() * 15))
    } else {
      stats[name] = floor + Math.floor(rng() * 40)
    }
  }
  return stats
}

/** Must stay stable — salt is part of the identity hash */
const SALT = 'friend-2026-401'

export type GuruRoll = {
  bones: GuruBones
  inspirationSeed: number
}

function rollFrom(rng: () => number): GuruRoll {
  const rarity = rollRarity(rng)
  const bones: GuruBones = {
    rarity,
    species: pick(rng, SPECIES),
    eye: pick(rng, EYES),
    hat: rarity === 'common' ? 'none' : pick(rng, HATS),
    shiny: rng() < 0.01,
    stats: rollStats(rng, rarity),
  }
  return { bones, inspirationSeed: Math.floor(rng() * 1e9) }
}

// Cache to avoid recalculating on every tick (called from 500ms setInterval)
let rollCache: { key: string; value: GuruRoll } | undefined

export function roll(userId: string): GuruRoll {
  const key = userId + SALT
  if (rollCache?.key === key) return rollCache.value
  const value = rollFrom(mulberry32(hashString(key)))
  rollCache = { key, value }
  return value
}

export function rollWithSeed(seed: string): GuruRoll {
  return rollFrom(mulberry32(hashString(seed)))
}

// ---------------------------------------------------------------------------
// localStorage persistence keys
// ---------------------------------------------------------------------------
const USER_ID_KEY = 'aether.guru.userId'
const SOUL_KEY = 'aether.guru.soul'
const MUTED_KEY = 'aether.guru.muted'

export function getGuruUserId(): string {
  if (typeof window === 'undefined') return 'ssr'
  let id = localStorage.getItem(USER_ID_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(USER_ID_KEY, id)
  }
  return id
}

/**
 * Regenerate bones from userId, merge with stored soul.
 * Bones are never stored so appearance is always deterministic;
 * users can't edit their way to a legendary.
 */
export function getGuru(): Guru | null {
  if (typeof window === 'undefined') return null
  const raw = localStorage.getItem(SOUL_KEY)
  if (!raw) return null
  try {
    const stored = JSON.parse(raw) as StoredGuru
    const { bones } = roll(getGuruUserId())
    // bones LAST — overrides any stale bone fields that might be in stored data
    // name is always 'Guru' regardless of what legacy soul data stored
    return { ...stored, ...bones, name: 'Guru' }
  } catch {
    return null
  }
}

export function saveGuruSoul(soul: GuruSoul & { hatchedAt: number }): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(SOUL_KEY, JSON.stringify(soul))
  rollCache = undefined // invalidate cache so next getGuru re-merges
  window.dispatchEvent(new CustomEvent('guru:updated'))
}

export function clearGuru(): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(SOUL_KEY)
  window.dispatchEvent(new CustomEvent('guru:updated'))
}

export function getGuruMuted(): boolean {
  if (typeof window === 'undefined') return false
  return localStorage.getItem(MUTED_KEY) === '1'
}

export function setGuruMuted(muted: boolean): void {
  if (typeof window === 'undefined') return
  if (muted) {
    localStorage.setItem(MUTED_KEY, '1')
  } else {
    localStorage.removeItem(MUTED_KEY)
  }
  window.dispatchEvent(new CustomEvent('guru:updated'))
}
