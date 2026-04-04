'use client'

import { AnimatePresence, motion } from 'motion/react'

import type { Guru } from '@/core/guru/types'
import { RARITY_COLORS } from '@/core/guru/types'
import { cn } from '@/lib/utils'

/**
 * Word-wrap to fit within maxWidth characters per line.
 * Ported from buddy/CompanionSprite.tsx wrap().
 */
function wrap(text: string, width: number): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    if (cur.length + w.length + 1 > width && cur) {
      lines.push(cur)
      cur = w
    } else {
      cur = cur ? `${cur} ${w}` : w
    }
  }
  if (cur) lines.push(cur)
  return lines
}

type Props = {
  guru: Guru
  reaction: string
  /** When true, fade toward opacity-0 (3s window before clearing) */
  fading?: boolean
  className?: string
}

/**
 * ASCII-style speech bubble that sits to the LEFT of the sprite.
 * The tail points RIGHT toward the sprite (─ connector).
 * Uses glassmorphism surface + rarity border color.
 */
export function GuruBubble({ guru, reaction, fading = false, className }: Props) {
  const rarityBorder = RARITY_COLORS[guru.rarity].split(' ').find((c) => c.startsWith('border')) ?? 'border-white/20'
  const rarityText = RARITY_COLORS[guru.rarity].split(' ').find((c) => c.startsWith('text')) ?? 'text-muted-foreground'
  const lines = wrap(reaction, 28)

  return (
    <AnimatePresence>
      {reaction && (
        <motion.div
          key={reaction}
          className={cn('flex items-center', className)}
          initial={{ opacity: 0, x: 8, scale: 0.92 }}
          animate={{ opacity: fading ? 0 : 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: 8, scale: 0.92 }}
          transition={{ duration: fading ? 2.5 : 0.12, ease: 'easeOut' }}
        >
          {/* Bubble body */}
          <div
            className={cn(
              'rounded-lg border px-2.5 py-1.5',
              'backdrop-blur-sm bg-black/40',
              rarityBorder,
            )}
          >
            {lines.map((line, i) => (
              <p
                key={i}
                className={cn(
                  'font-mono text-[10px] italic leading-[1.35] whitespace-pre',
                  fading ? 'text-muted-foreground/50' : rarityText,
                )}
              >
                {line}
              </p>
            ))}
          </div>

          {/* Tail connector ─ pointing right toward sprite */}
          <span
            className={cn(
              'font-mono text-[11px] leading-none',
              fading ? 'text-muted-foreground/30' : rarityText,
            )}
          >
            ─
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
