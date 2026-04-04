export const RARITIES = [
  'common',
  'uncommon',
  'rare',
  'epic',
  'legendary',
] as const
export type Rarity = (typeof RARITIES)[number]

export const SPECIES = [
  'duck',
  'goose',
  'blob',
  'cat',
  'dragon',
  'octopus',
  'owl',
  'penguin',
  'turtle',
  'snail',
  'ghost',
  'axolotl',
  'capybara',
  'cactus',
  'robot',
  'rabbit',
  'mushroom',
  'chonk',
] as const
export type Species = (typeof SPECIES)[number]

export const EYES = ['o', 'O', '◕', '●', '◦', '^'] as const
export type Eye = (typeof EYES)[number]

export const HATS = [
  'none',
  'crown',
  'tophat',
  'propeller',
  'halo',
  'wizard',
  'beanie',
  'tinyduck',
] as const
export type Hat = (typeof HATS)[number]

export const STAT_NAMES = [
  'DEBUGGING',
  'PATIENCE',
  'CHAOS',
  'WISDOM',
  'SNARK',
] as const
export type StatName = (typeof STAT_NAMES)[number]

/** Deterministic parts — derived from hash(userId). Never stored. */
export type GuruBones = {
  rarity: Rarity
  species: Species
  eye: Eye
  hat: Hat
  shiny: boolean
  stats: Record<StatName, number>
}

/** Model-generated soul — stored in localStorage after first hatch */
export type GuruSoul = {
  name: string
  personality: string
}

export type Guru = GuruBones &
  GuruSoul & {
    hatchedAt: number
  }

/**
 * What actually persists in localStorage. Bones are regenerated from
 * hash(userId) on every read so users can't edit their way to a legendary.
 */
export type StoredGuru = GuruSoul & { hatchedAt: number }

export const RARITY_WEIGHTS = {
  common: 60,
  uncommon: 25,
  rare: 10,
  epic: 4,
  legendary: 1,
} as const satisfies Record<Rarity, number>

export const RARITY_STARS = {
  common: '★',
  uncommon: '★★',
  rare: '★★★',
  epic: '★★★★',
  legendary: '★★★★★',
} as const satisfies Record<Rarity, string>

/** Tailwind class strings for each rarity (text + border) */
export const RARITY_COLORS: Record<Rarity, string> = {
  common: 'text-foreground/90 border-white/20',
  uncommon: 'text-emerald-300 border-emerald-400/40',
  rare: 'text-sky-300 border-sky-400/40',
  epic: 'text-violet-300 border-violet-400/40',
  legendary: 'text-amber-300 border-amber-400/40',
}

/** Tailwind ring/glow class for rarity borders */
export const RARITY_RING: Record<Rarity, string> = {
  common: 'ring-muted-foreground/30',
  uncommon: 'ring-green-400/50',
  rare: 'ring-blue-400/50',
  epic: 'ring-purple-400/50',
  legendary: 'ring-amber-400/60',
}
