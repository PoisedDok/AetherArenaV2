'use client'

import { useEffect, useRef, useState } from 'react'

import type { GuruMove } from '@/core/guru/hooks'
import type { Guru } from '@/core/guru/types'
import { RARITY_COLORS } from '@/core/guru/types'
import { cn } from '@/lib/utils'

import { renderSprite, spriteFrameCount } from './guru-sprites'

// ---------------------------------------------------------------------------
// Animation constants — ported + expanded from buddy/CompanionSprite.tsx
// ---------------------------------------------------------------------------
const TICK_MS = 600 // slightly slower than original 500ms — less jittery

/**
 * Idle sequence — 0=rest, 1=fidget, -1=blink, 2=fidget2
 * Extended with more rest frames so the sprite feels calm, not hyperactive.
 * Pattern: long rest → small fidget → long rest → blink → long rest → other fidget
 */
const IDLE_SEQUENCE = [
  0, 0, 0, 0, 0, 0, // rest
  1,                 // fidget
  0, 0, 0, 0,       // rest
  -1,                // blink
  0, 0, 0, 0, 0,    // rest
  2,                 // fidget2
  0, 0, 0,           // rest
] as const

const PET_BURST_MS = 2500
const PET_HEARTS = [
  '   ♥    ♥   ',
  '  ♥  ♥   ♥  ',
  ' ♥   ♥  ♥   ',
  '♥  ♥      ♥ ',
  '·    ·   ·  ',
]

// ---------------------------------------------------------------------------
// Move → CSS transform mapping
// Each move is a sequence of transform steps cycled at TICK_MS
// ---------------------------------------------------------------------------
type TransformStep = { x: number; y: number; rotate: number; scale: number }

const MOVE_TRANSFORMS: Record<GuruMove, TransformStep[]> = {
  idle: [
    { x: 0, y: 0, rotate: 0, scale: 1 },
    { x: 0, y: -1, rotate: 0, scale: 1 }, // gentle bob only
  ],
  'walk-left': [
    { x: -6, y: 0, rotate: -4, scale: 1 },
    { x: -3, y: -2, rotate: -2, scale: 1 },
    { x: 0, y: 0, rotate: 0, scale: 1 },
    { x: -3, y: -2, rotate: -2, scale: 1 },
  ],
  'walk-right': [
    { x: 6, y: 0, rotate: 4, scale: 1 },
    { x: 3, y: -2, rotate: 2, scale: 1 },
    { x: 0, y: 0, rotate: 0, scale: 1 },
    { x: 3, y: -2, rotate: 2, scale: 1 },
  ],
  jump: [
    { x: 0, y: -10, rotate: -5, scale: 1.1 },
    { x: 0, y: -16, rotate: 0, scale: 1.15 },
    { x: 0, y: -8, rotate: 5, scale: 1.05 },
    { x: 0, y: 0, rotate: 0, scale: 1 },
    { x: 0, y: -3, rotate: 0, scale: 1.02 }, // small bounce on landing
    { x: 0, y: 0, rotate: 0, scale: 1 },
  ],
  spin: [
    { x: 0, y: 0, rotate: 45, scale: 1 },
    { x: 0, y: -2, rotate: 135, scale: 0.95 },
    { x: 0, y: 0, rotate: 225, scale: 1 },
    { x: 0, y: -2, rotate: 315, scale: 0.95 },
    { x: 0, y: 0, rotate: 360, scale: 1 },
  ],
  shake: [
    { x: -5, y: 0, rotate: -6, scale: 1 },
    { x: 5, y: 0, rotate: 6, scale: 1 },
    { x: -4, y: 0, rotate: -4, scale: 1 },
    { x: 4, y: 0, rotate: 4, scale: 1 },
    { x: -2, y: 0, rotate: -2, scale: 1 },
    { x: 0, y: 0, rotate: 0, scale: 1 },
  ],
  bounce: [
    { x: 0, y: -6, rotate: 0, scale: 1.08 },
    { x: 0, y: 0, rotate: 0, scale: 0.95 },
    { x: 0, y: -4, rotate: 0, scale: 1.05 },
    { x: 0, y: 0, rotate: 0, scale: 0.98 },
    { x: 0, y: -2, rotate: 0, scale: 1.02 },
    { x: 0, y: 0, rotate: 0, scale: 1 },
  ],
  peek: [
    { x: 4, y: 0, rotate: 8, scale: 1 },
    { x: 6, y: -1, rotate: 10, scale: 1 },
    { x: 4, y: 0, rotate: 8, scale: 1 },
    { x: 2, y: 0, rotate: 4, scale: 1 },
    { x: 0, y: 0, rotate: 0, scale: 1 },
  ],
}

// Transition duration per move — snappy for jump/shake, smooth for walk/bounce
const MOVE_TRANSITION_MS: Record<GuruMove, number> = {
  idle: 1200,
  'walk-left': 350,
  'walk-right': 350,
  jump: 180,
  spin: 250,
  shake: 100,
  bounce: 200,
  peek: 400,
}

type Props = {
  guru: Guru
  /** Current move from LLM — drives transform animation */
  move?: GuruMove
  /** When true: excited mode (fast frame cycling, used when reaction is showing) */
  excited?: boolean
  className?: string
}

export function GuruSprite({ guru, move = 'idle', excited = false, className }: Props) {
  const [tick, setTick] = useState(0)
  const petAtRef = useRef<number | null>(null)

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), TICK_MS)
    return () => clearInterval(interval)
  }, [])

  // Listen for pet events
  useEffect(() => {
    const handler = () => { petAtRef.current = tick }
    window.addEventListener('guru:pet', handler)
    return () => window.removeEventListener('guru:pet', handler)
  }, [tick])

  const frameCount = spriteFrameCount(guru.species)
  const petAge = petAtRef.current !== null ? tick - petAtRef.current : Infinity
  const petting = petAge * TICK_MS < PET_BURST_MS
  const heartLine = petting ? (PET_HEARTS[petAge % PET_HEARTS.length] ?? null) : null

  // Determine animation frame
  let spriteFrame: number
  let blink = false
  if (excited || petting) {
    spriteFrame = tick % frameCount
  } else {
    const step = IDLE_SEQUENCE[tick % IDLE_SEQUENCE.length] ?? 0
    if (step === -1) {
      spriteFrame = 0
      blink = true
    } else {
      spriteFrame = step % frameCount
    }
  }

  const bodyLines = renderSprite(guru, spriteFrame).map((line) =>
    blink ? line.replaceAll(guru.eye, '-') : line,
  )
  const lines = heartLine ? [heartLine, ...bodyLines] : bodyLines

  const rarityTextClass =
    RARITY_COLORS[guru.rarity].split(' ').find((c) => c.startsWith('text')) ?? 'text-muted-foreground'

  // Resolve current transform step from move
  const steps = MOVE_TRANSFORMS[move]
  const step = steps[tick % steps.length]!
  const transitionMs = MOVE_TRANSITION_MS[move]

  const transform =
    `translateX(${step.x}px) translateY(${step.y}px) rotate(${step.rotate}deg) scale(${step.scale})`

  return (
    <div
      className={cn('flex flex-col items-center select-none', className)}
      onClick={() => window.dispatchEvent(new CustomEvent('guru:pet'))}
      title={`${guru.name} — click to pet`}
      style={{
        cursor: 'pointer',
        transform,
        transition: `transform ${transitionMs}ms cubic-bezier(0.34, 1.56, 0.64, 1)`,
        willChange: 'transform',
      }}
    >
      {lines.map((line, i) => (
        <pre
          key={i}
          className={cn(
            'font-mono text-[13px] leading-[1.35] whitespace-pre',
            i === 0 && heartLine ? 'text-red-400' : rarityTextClass,
          )}
        >
          {line}
        </pre>
      ))}
      {/* Name label */}
      <span className={cn('mt-0.5 font-mono text-[10px] italic leading-none opacity-70', rarityTextClass)}>
        {guru.name}
      </span>
    </div>
  )
}

/** Compact single-line face for narrow contexts */
export function GuruFace({ guru }: { guru: Guru }) {
  const rarityTextClass =
    RARITY_COLORS[guru.rarity].split(' ').find((c) => c.startsWith('text')) ?? 'text-muted-foreground'
  return (
    <span
      className={cn('font-mono text-[11px] font-bold', rarityTextClass)}
      title={`${guru.name} — click to pet`}
      onClick={() => window.dispatchEvent(new CustomEvent('guru:pet'))}
      style={{ cursor: 'pointer' }}
    >
      {guru.eye}{guru.eye}
    </span>
  )
}
