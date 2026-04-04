'use client'

import { useEffect, useRef, useState } from 'react'

import type { Guru } from '@/core/guru/types'
import { RARITY_COLORS } from '@/core/guru/types'
import { cn } from '@/lib/utils'

import { renderFace, renderSprite, spriteFrameCount } from './guru-sprites'

// ---------------------------------------------------------------------------
// Animation constants — ported exactly from buddy/CompanionSprite.tsx
// ---------------------------------------------------------------------------
const TICK_MS = 500
/** 0=rest, 1=fidget, -1=blink, 2=fidget2 */
const IDLE_SEQUENCE = [0, 0, 0, 0, 1, 0, 0, 0, -1, 0, 0, 2, 0, 0, 0] as const
const PET_BURST_MS = 2500

const PET_HEARTS = [
  '   ♥    ♥   ',
  '  ♥  ♥   ♥  ',
  ' ♥   ♥  ♥   ',
  '♥  ♥      ♥ ',
  '·    ·   ·  ',
]

type Props = {
  guru: Guru
  /** When true: excited mode (fast frame cycling, used when reaction is showing) */
  excited?: boolean
  className?: string
}

export function GuruSprite({ guru, excited = false, className }: Props) {
  const [tick, setTick] = useState(0)
  const petAtRef = useRef<number | null>(null)

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), TICK_MS)
    return () => clearInterval(interval)
  }, [])

  // Listen for pet events
  useEffect(() => {
    const handler = () => {
      petAtRef.current = tick
    }
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

  const rarityTextClass = RARITY_COLORS[guru.rarity].split(' ').find((c) => c.startsWith('text')) ?? 'text-muted-foreground'

  // Subtle vertical bob — shifts 1px up/down every 2 ticks (~1s cycle)
  const bobOffset = excited ? 0 : tick % 4 < 2 ? -1 : 0

  return (
    <div
      className={cn('flex flex-col items-center select-none transition-transform duration-500', className)}
      onClick={() => window.dispatchEvent(new CustomEvent('guru:pet'))}
      title={`${guru.name} — click to pet`}
      style={{ cursor: 'pointer', transform: `translateY(${bobOffset}px)` }}
    >
      {lines.map((line, i) => (
        <pre
          key={i}
          className={cn(
            'font-mono text-[10px] leading-[1.3] whitespace-pre',
            i === 0 && heartLine ? 'text-red-400' : rarityTextClass,
          )}
        >
          {line}
        </pre>
      ))}
      {/* Name label */}
      <span
        className={cn(
          'mt-0.5 font-mono text-[9px] italic leading-none',
          rarityTextClass,
        )}
      >
        {guru.name}
      </span>
    </div>
  )
}

/** Compact single-line face for narrow contexts */
export function GuruFace({ guru }: { guru: Guru }) {
  const rarityTextClass = RARITY_COLORS[guru.rarity].split(' ').find((c) => c.startsWith('text')) ?? 'text-muted-foreground'
  return (
    <span
      className={cn('font-mono text-[11px] font-bold', rarityTextClass)}
      title={`${guru.name} — click to pet`}
      onClick={() => window.dispatchEvent(new CustomEvent('guru:pet'))}
      style={{ cursor: 'pointer' }}
    >
      {renderFace(guru)}
    </span>
  )
}
