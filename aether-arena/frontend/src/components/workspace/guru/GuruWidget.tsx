'use client'

import { BarChart2Icon, BookOpenIcon, RefreshCwIcon, SparklesIcon, Volume2Icon, VolumeXIcon } from 'lucide-react'
import { useCallback, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { clearGuru, getGuruUserId, roll, saveGuruSoul } from '@/core/guru/guru'
import { useGuru, useGuruIdleComments, useGuruMove, useGuruMuted, useGuruReaction, useGuruThinking, useGuruEnabled } from '@/core/guru/hooks'
import { RARITY_COLORS, RARITY_STARS, STAT_NAMES } from '@/core/guru/types'
import { cn } from '@/lib/utils'

import { renderFace } from './guru-sprites'
import { GuruBubble } from './GuruBubble'
import { GuruSprite } from './GuruSprite'

// ---------------------------------------------------------------------------
// Hatch dialog — shows rolled preview, confirms, saves soul
// ---------------------------------------------------------------------------
function HatchDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [hatching, setHatching] = useState(false)
  const [previewRoll] = useState(() => roll(getGuruUserId()))
  const { bones } = previewRoll
  const rarityText = RARITY_COLORS[bones.rarity].split(' ').find((c) => c.startsWith('text')) ?? 'text-muted-foreground'
  const face = renderFace(bones)

  const handleHatch = useCallback(async () => {
    setHatching(true)
    try {
      // Name is always Guru. Personality is seeded from userId bones.
      const PERSONALITIES = [
        'a quiet observer who notices what others miss',
        'patient and methodical, teacher at heart',
        'dry wit, warm underneath — asks the right questions',
        'calm under pressure, always grounding',
        'curious guide, finds the lesson in everything',
        'playfully skeptical, but deeply supportive',
        'precise and unhurried, speaks only when it counts',
        'chaotically creative, connects dots no one else sees',
      ]
      const seed = previewRoll.inspirationSeed
      const personality = PERSONALITIES[Math.floor(seed / 16) % PERSONALITIES.length]!
      saveGuruSoul({ name: 'Guru', personality, hatchedAt: Date.now() })
      onOpenChange(false)
    } finally {
      setHatching(false)
    }
  }, [previewRoll, onOpenChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xs">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpenIcon className="size-4" />
            Meet your Guru
          </DialogTitle>
          <DialogDescription>
            Your companion is determined by your identity — always the same.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-2 py-3">
          <span className={cn('font-mono text-2xl font-bold tracking-widest', rarityText)}>{face}</span>
          <span className={cn('text-sm font-semibold capitalize', rarityText)}>
            {RARITY_STARS[bones.rarity]} {bones.rarity} {bones.species}
          </span>
          {bones.shiny && <span className="text-amber-400 text-xs">✨ Shiny!</span>}
          <p className="text-muted-foreground text-center text-xs max-w-48">
            A new {bones.species} is ready to hatch. It will watch your conversations and occasionally share a thought.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Not yet</Button>
          <Button onClick={() => void handleHatch()} disabled={hatching}>
            {hatching ? 'Hatching…' : 'Hatch!'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Stats dialog
// ---------------------------------------------------------------------------
function StatsDialog({ open, onOpenChange, guru }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  guru: NonNullable<ReturnType<typeof useGuru>>
}) {
  const rarityText = RARITY_COLORS[guru.rarity].split(' ').find((c) => c.startsWith('text')) ?? 'text-muted-foreground'
  const face = renderFace(guru)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xs">
        <DialogHeader>
          <DialogTitle className={cn('font-mono font-bold', rarityText)}>{face} {guru.name}</DialogTitle>
          <DialogDescription className={cn('text-xs', rarityText)}>
            {RARITY_STARS[guru.rarity]} {guru.rarity}
            {guru.shiny ? ' · ✨ Shiny' : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          {STAT_NAMES.map((name) => {
            const val = guru.stats[name]
            return (
              <div key={name} className="flex items-center gap-2">
                <span className="text-muted-foreground w-20 font-mono text-[10px]">{name}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-accent-foreground/60 transition-all" style={{ width: `${val}%` }} />
                </div>
                <span className="text-muted-foreground w-6 text-right font-mono text-[10px]">{val}</span>
              </div>
            )
          })}
        </div>
        <p className="text-muted-foreground font-mono text-[10px] italic leading-snug">{guru.personality}</p>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Main GuruWidget — floats above the input bar
// ---------------------------------------------------------------------------

/**
 * Mounts as an absolutely-positioned overlay above the input box.
 * Layout: [bubble ─] [ASCII sprite + name]
 *
 * The parent (input-box.tsx) must have `position: relative` and
 * give this component `position: absolute bottom-full right-0` placement.
 */
export function GuruWidget() {
  const enabled = useGuruEnabled()
  const guru = useGuru()
  const { reaction, fading, clearReaction } = useGuruReaction()
  const [muted, setMuted] = useGuruMuted()
  const move = useGuruMove()
  const thinking = useGuruThinking()
  // Fires contextual hardcoded comments (greeting, idle, pet) — no LLM needed
  useGuruIdleComments(muted)
  const [hatchOpen, setHatchOpen] = useState(false)
  const [statsOpen, setStatsOpen] = useState(false)

  const handleReset = useCallback(() => {
    clearReaction()
    clearGuru()
  }, [clearReaction])

  // Disabled via settings — render nothing
  if (!enabled && guru) {
    return null
  }

  // No guru yet — show teaser pill
  if (!guru) {
    return (
      <>
        <button
          type="button"
          onClick={() => setHatchOpen(true)}
          className={cn(
            'flex items-center gap-1.5 rounded-full border border-white/10 px-2.5 py-1',
            'bg-black/30 backdrop-blur-sm',
            'text-muted-foreground hover:text-foreground cursor-pointer text-[11px] font-mono transition-colors',
          )}
          title="Meet your Guru companion"
        >
          <SparklesIcon className="size-3" />
          <span>guru?</span>
        </button>
        <HatchDialog open={hatchOpen} onOpenChange={setHatchOpen} />
      </>
    )
  }

  return (
    <div className="flex items-end gap-1 pb-1">
      {/* Context menu wraps the sprite */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <div className="relative cursor-pointer">
            <GuruSprite guru={guru} move={move} excited={!muted && !!reaction} />
            {/* Thinking ring — tiny spinner in top-right corner of sprite */}
            <span
              aria-hidden
              className={cn(
                'pointer-events-none absolute -top-0.5 -right-0.5 size-2.5 rounded-full border border-transparent',
                'border-t-current border-r-current',
                thinking ? 'animate-spin opacity-70' : 'opacity-0',
                RARITY_COLORS[guru.rarity].split(' ').find((c) => c.startsWith('text')) ?? 'text-muted-foreground',
                'transition-opacity duration-300',
              )}
            />
          </div>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end" className="w-44">
          <DropdownMenuLabel className="font-mono text-xs">{guru.name}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setMuted(!muted)} className="gap-2 text-xs">
            {muted ? <Volume2Icon className="size-3.5" /> : <VolumeXIcon className="size-3.5" />}
            {muted ? 'Unmute Guru' : 'Mute Guru'}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setStatsOpen(true)} className="gap-2 text-xs">
            <BarChart2Icon className="size-3.5" />
            View stats
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={handleReset} className="text-destructive gap-2 text-xs">
            <RefreshCwIcon className="size-3.5" />
            Reset Guru
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Speech bubble to the RIGHT of sprite, tail points left toward sprite */}
      {!muted && reaction && (
        <GuruBubble guru={guru} reaction={reaction} fading={fading} />
      )}

      <HatchDialog open={hatchOpen} onOpenChange={setHatchOpen} />
      {guru && <StatsDialog open={statsOpen} onOpenChange={setStatsOpen} guru={guru} />}
    </div>
  )
}
