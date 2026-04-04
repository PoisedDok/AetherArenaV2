'use client'

import { useEffect, useRef, useState } from 'react'

import type { Guru } from '@/core/guru/types'
import { RARITY_COLORS } from '@/core/guru/types'
import { cn } from '@/lib/utils'

// Typewriter speed — fast enough to feel alive, slow enough to read
const CHAR_MS = 28

type Props = {
  guru: Guru
  reaction: string
  fading?: boolean
  className?: string
}

/**
 * Speech bubble to the RIGHT of the sprite. Tail (◂) points left toward sprite.
 * Types the reaction char-by-char when `reaction` changes.
 */
export function GuruBubble({ guru, reaction, fading = false, className }: Props) {
  const rarityBorder =
    RARITY_COLORS[guru.rarity].split(' ').find((c) => c.startsWith('border')) ?? 'border-white/20'
  const rarityText =
    RARITY_COLORS[guru.rarity].split(' ').find((c) => c.startsWith('text')) ?? 'text-foreground/90'

  const [displayed, setDisplayed] = useState('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Re-run typewriter whenever reaction text changes
  useEffect(() => {
    if (!reaction) { setDisplayed(''); return }

    setDisplayed('')
    let pos = 0

    function tick() {
      pos++
      setDisplayed(reaction.slice(0, pos))
      if (pos < reaction.length) {
        timerRef.current = setTimeout(tick, CHAR_MS)
      }
    }

    timerRef.current = setTimeout(tick, CHAR_MS)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [reaction])

  if (!reaction) return null

  return (
    <div
      className={cn(
        'flex items-center gap-0',
        'transition-opacity duration-[2500ms]',
        fading ? 'opacity-0' : 'opacity-100',
        className,
      )}
    >
      {/* Tail pointing LEFT toward sprite */}
      <span className={cn('font-mono text-[12px] leading-none select-none', rarityText)}>◂</span>

      {/* Bubble body */}
      <div
        className={cn(
          'rounded-lg border px-2.5 py-1.5',
          'backdrop-blur-sm bg-black/50',
          rarityBorder,
        )}
      >
        <p className={cn('font-mono text-[11px] italic leading-[1.4] whitespace-nowrap', rarityText)}>
          {displayed}
          {/* Blinking cursor while typing */}
          {displayed.length < reaction.length && (
            <span className="animate-pulse">▍</span>
          )}
        </p>
      </div>
    </div>
  )
}
