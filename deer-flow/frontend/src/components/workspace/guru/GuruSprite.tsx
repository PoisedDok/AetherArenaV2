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
//
// RULES:
//  - NO scale or scaleX — any scaling warps monospace ASCII rendering
//  - walk-left/right = pure translation (no flip), sprite never faces wrong way
//  - streaming = calm walk, not aggressive bounce
// ---------------------------------------------------------------------------
type TransformStep = { x: number; y: number; rotate: number }

const MOVE_TRANSFORMS: Record<GuruMove, TransformStep[]> = {
  idle: [
    { x: 0, y: 0, rotate: 0 },
    { x: 0, y: -1, rotate: 0 }, // gentle bob
  ],
  'walk-left': [
    { x: -10, y: 0, rotate: -2 },
    { x: -7, y: -1, rotate: -1 },
    { x: -4, y: 0, rotate: 0 },
    { x: -7, y: -1, rotate: -1 },
  ],
  'walk-right': [
    { x: 10, y: 0, rotate: 2 },
    { x: 7, y: -1, rotate: 1 },
    { x: 4, y: 0, rotate: 0 },
    { x: 7, y: -1, rotate: 1 },
  ],
  jump: [
    { x: 0, y: -10, rotate: -2 },
    { x: 0, y: -14, rotate: 0 },
    { x: 0, y: -6, rotate: 2 },
    { x: 0, y: 0, rotate: 0 },
    { x: 0, y: -2, rotate: 0 },
    { x: 0, y: 0, rotate: 0 },
  ],
  spin: [
    { x: 0, y: 0, rotate: 0 },
    { x: 0, y: -3, rotate: 60 },
    { x: 0, y: -1, rotate: 120 },
    { x: 0, y: -3, rotate: 180 },
    { x: 0, y: -1, rotate: 240 },
    { x: 0, y: -3, rotate: 300 },
    { x: 0, y: 0, rotate: 360 },
  ],
  shake: [
    { x: -4, y: 0, rotate: -3 },
    { x: 4, y: 0, rotate: 3 },
    { x: -3, y: 0, rotate: -2 },
    { x: 3, y: 0, rotate: 2 },
    { x: 0, y: 0, rotate: 0 },
  ],
  bounce: [
    // Calm walk during streaming — no scale oscillation
    { x: 5, y: 0, rotate: 1 },
    { x: 5, y: -2, rotate: 0 },
    { x: 5, y: 0, rotate: 1 },
    { x: 0, y: -1, rotate: 0 },
  ],
  peek: [
    { x: 5, y: 0, rotate: 4 },
    { x: 7, y: -1, rotate: 5 },
    { x: 5, y: 0, rotate: 4 },
    { x: 2, y: 0, rotate: 1 },
    { x: 0, y: 0, rotate: 0 },
  ],
}

// Transition duration per move — linear feel for walking, snappy for effects
const MOVE_TRANSITION_MS: Record<GuruMove, number> = {
  idle: 1200,
  'walk-left': 500,
  'walk-right': 500,
  jump: 180,
  spin: 300,
  shake: 120,
  bounce: 500,
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

  // Use spring easing only for jump/spin/shake — linear for walking/idle
  const isDynamic = move === 'jump' || move === 'spin' || move === 'shake'
  const easing = isDynamic
    ? 'cubic-bezier(0.34, 1.56, 0.64, 1)'
    : 'ease-out'

  const transform =
    `translateX(${step.x}px) translateY(${step.y}px) rotate(${step.rotate}deg)`

  return (
    <div
      className={cn('flex flex-col items-center select-none', className)}
      onClick={() => window.dispatchEvent(new CustomEvent('guru:pet'))}
      title={`${guru.name} — click to pet`}
      style={{
        cursor: 'pointer',
        transform,
        transition: `transform ${transitionMs}ms ${easing}`,
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
