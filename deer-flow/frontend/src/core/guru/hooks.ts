'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { getGuru, getGuruMuted, setGuruMuted } from './guru'
import type { GuruMove } from './observer'
import type { Guru } from './types'

export type { GuruMove }

/**
 * Thread processing states that drive pre-canned sprite animation.
 * Dispatched by threads/hooks.ts at lifecycle moments — no LLM calls needed.
 *
 *  'processing'  — submitted, waiting for first token (Guru paces: walk-left/right cycle)
 *  'streaming'   — tokens arriving (Guru bounces: active, engaged)
 *  'idle'        — finished or stopped (Guru returns to rest)
 */
export type GuruState = 'idle' | 'processing' | 'streaming'

const BUBBLE_SHOW_MS = 10_000 // 10s total visible
const FADE_START_MS = 7_000  // start fade at 7s (3s fade window matches original)

/**
 * Reads Guru from localStorage on mount and re-reads when 'guru:updated'
 * custom event fires (dispatched by saveGuruSoul / clearGuru / setGuruMuted).
 */
export function useGuru(): Guru | null {
  const [guru, setGuru] = useState<Guru | null>(() => {
    if (typeof window === 'undefined') return null
    return getGuru()
  })

  useEffect(() => {
    const handler = () => setGuru(getGuru())
    window.addEventListener('guru:updated', handler)
    return () => window.removeEventListener('guru:updated', handler)
  }, [])

  return guru
}

export type GuruReactionState = {
  reaction: string | null
  fading: boolean
  clearReaction: () => void
}

/**
 * Subscribes to the 'guru:reaction' window custom event (dispatched by
 * threads/hooks.ts after every AI turn). Handles 10s auto-clear with a 3s
 * fade-out window identical to the original BUBBLE_SHOW/FADE_WINDOW logic.
 */
export function useGuruReaction(): GuruReactionState {
  const [reaction, setReaction] = useState<string | null>(null)
  const [fading, setFading] = useState(false)
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearReaction = useCallback(() => {
    setReaction(null)
    setFading(false)
    if (showTimerRef.current) clearTimeout(showTimerRef.current)
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current)
  }, [])

  const scheduleHide = useCallback(() => {
    if (showTimerRef.current) clearTimeout(showTimerRef.current)
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current)

    // Start fading after FADE_START_MS
    fadeTimerRef.current = setTimeout(() => {
      setFading(true)
    }, FADE_START_MS)

    // Fully clear after BUBBLE_SHOW_MS
    showTimerRef.current = setTimeout(() => {
      setReaction(null)
      setFading(false)
    }, BUBBLE_SHOW_MS)
  }, [])

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail
      if (typeof detail === 'string' && detail.trim()) {
        setReaction(detail.trim())
        setFading(false)
        scheduleHide()
      }
    }
    window.addEventListener('guru:reaction', handler)
    return () => window.removeEventListener('guru:reaction', handler)
  }, [scheduleHide])

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (showTimerRef.current) clearTimeout(showTimerRef.current)
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current)
    }
  }, [])

  return { reaction, fading, clearReaction }
}

/**
 * Unified move resolver — combines two sources:
 *
 * 1. `guru:state` events (no LLM) — lifecycle-driven, auto-cycling moves:
 *    - 'processing' → alternates walk-left / walk-right every PACE_MS (Guru paces while thinking)
 *    - 'streaming'  → bounce (Guru is excited, something is happening)
 *    - 'idle'       → idle
 *
 * 2. `guru:move` events (LLM-chosen) — fired after each AI turn by the observer.
 *    These override the state-driven move for MOVE_HOLD_MS, then revert to
 *    whatever the current state dictates.
 *
 * Priority: LLM override > state-driven cycling > idle
 */
const PACE_MS = 2200      // how often the pacing direction flips
const MOVE_HOLD_MS = 4000 // how long an LLM-chosen move holds before reverting

export function useGuruMove(): GuruMove {
  const [stateMove, setStateMove] = useState<GuruMove>('idle')
  const [llmMove, setLlmMove] = useState<GuruMove | null>(null)

  const llmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const paceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const stateRef = useRef<GuruState>('idle')
  const paceToggleRef = useRef(false)

  // State-driven movement cycling
  const startStateMoves = useCallback((state: GuruState) => {
    // Clear any existing pacing interval
    if (paceTimerRef.current) { clearInterval(paceTimerRef.current); paceTimerRef.current = null }

    if (state === 'processing') {
      // Pace immediately then alternate direction every PACE_MS
      setStateMove('walk-left')
      paceToggleRef.current = false
      paceTimerRef.current = setInterval(() => {
        paceToggleRef.current = !paceToggleRef.current
        setStateMove(paceToggleRef.current ? 'walk-right' : 'walk-left')
      }, PACE_MS)
    } else if (state === 'streaming') {
      setStateMove('bounce')
    } else {
      setStateMove('idle')
    }
  }, [])

  // Listen for state events (dispatched from threads/hooks.ts)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<GuruState>).detail
      stateRef.current = detail
      startStateMoves(detail)
    }
    window.addEventListener('guru:state', handler)
    return () => {
      window.removeEventListener('guru:state', handler)
      if (paceTimerRef.current) clearInterval(paceTimerRef.current)
    }
  }, [startStateMoves])

  // Listen for LLM-chosen move events (dispatched from observer.ts)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<GuruMove>).detail
      setLlmMove(detail)
      if (llmTimerRef.current) clearTimeout(llmTimerRef.current)
      llmTimerRef.current = setTimeout(() => {
        setLlmMove(null)
        // Revert to whatever the current state dictates
        startStateMoves(stateRef.current)
      }, MOVE_HOLD_MS)
    }
    window.addEventListener('guru:move', handler)
    return () => {
      window.removeEventListener('guru:move', handler)
      if (llmTimerRef.current) clearTimeout(llmTimerRef.current)
    }
  }, [startStateMoves])

  // LLM move takes priority; fall back to state-driven
  return llmMove ?? stateMove
}

/**
 * Returns true while the Guru LLM call is in-flight.
 * Driven by 'guru:thinking' custom events dispatched in observer.ts.
 * Used to show a small thinking indicator on the sprite.
 */
export function useGuruThinking(): boolean {
  const [thinking, setThinking] = useState(false)

  useEffect(() => {
    const handler = (e: Event) => {
      setThinking((e as CustomEvent<boolean>).detail)
    }
    window.addEventListener('guru:thinking', handler)
    return () => window.removeEventListener('guru:thinking', handler)
  }, [])

  return thinking
}

// ---------------------------------------------------------------------------
// Contextual idle comments — fire hardcoded lines when no LLM reaction is
// in play. Mirrors buddy/useBuddyNotification concept. No LLM calls.
// ---------------------------------------------------------------------------

/** Lines fired once when Guru's thread/session first becomes active */
const SESSION_OPEN_LINES = [
  "Back again.",
  "Ready when you are.",
  "Pick up where you left off.",
  "What are we solving?",
  "Still here.",
  "Watching.",
]

/** Lines shown when user has been idle for a while (no new messages) */
const IDLE_LINES = [
  "Still thinking?",
  "Take your time.",
  "No rush.",
  "Whenever you're ready.",
  "I'll wait.",
  "Thinking is good.",
  "Quiet mode.",
  "Nothing? That's fine.",
]

/** Lines fired when user pets Guru */
const PET_LINES = [
  "Oh. Thanks.",
  "Appreciated.",
  "That was unexpected.",
  "...okay.",
  "You're weird. I like it.",
  "Noted.",
]

const IDLE_COMMENT_AFTER_MS = 45_000  // fire an idle line after 45s of no activity
const SESSION_OPEN_DELAY_MS = 2_500   // wait 2.5s after mount before greeting

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!
}

/**
 * Fires contextual hardcoded lines at the right moments — no LLM needed.
 * Meant to be called once in GuruWidget. Requires guru to be hatched.
 */
export function useGuruIdleComments(muted: boolean): void {
  const hasFiredOpenRef = useRef(false)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Reset idle timer on any activity event
  const resetIdle = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    idleTimerRef.current = setTimeout(() => {
      if (!muted) {
        window.dispatchEvent(
          new CustomEvent('guru:reaction', { detail: pickRandom(IDLE_LINES) }),
        )
      }
    }, IDLE_COMMENT_AFTER_MS)
  }, [muted])

  // Session-open greeting — fires once per mount, after a short settle delay
  useEffect(() => {
    if (muted || hasFiredOpenRef.current) return
    const t = setTimeout(() => {
      if (!hasFiredOpenRef.current) {
        hasFiredOpenRef.current = true
        window.dispatchEvent(
          new CustomEvent('guru:reaction', { detail: pickRandom(SESSION_OPEN_LINES) }),
        )
      }
      // Start idle timer after greeting
      resetIdle()
    }, SESSION_OPEN_DELAY_MS)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // intentionally only on mount

  // Reset idle timer whenever a real reaction arrives (LLM or state-driven)
  useEffect(() => {
    const handler = () => resetIdle()
    window.addEventListener('guru:reaction', handler)
    window.addEventListener('guru:move', handler)
    return () => {
      window.removeEventListener('guru:reaction', handler)
      window.removeEventListener('guru:move', handler)
    }
  }, [resetIdle])

  // Pet reaction
  useEffect(() => {
    const handler = () => {
      if (!muted) {
        window.dispatchEvent(
          new CustomEvent('guru:reaction', { detail: pickRandom(PET_LINES) }),
        )
      }
    }
    window.addEventListener('guru:pet', handler)
    return () => window.removeEventListener('guru:pet', handler)
  }, [muted])

  // Cleanup
  useEffect(() => {
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    }
  }, [])
}

export function useGuruMuted(): [boolean, (muted: boolean) => void] {
  const [muted, setMutedState] = useState(() => {
    if (typeof window === 'undefined') return false
    return getGuruMuted()
  })

  const setMuted = useCallback((value: boolean) => {
    setGuruMuted(value)
    setMutedState(value)
  }, [])

  useEffect(() => {
    const handler = () => setMutedState(getGuruMuted())
    window.addEventListener('guru:updated', handler)
    return () => window.removeEventListener('guru:updated', handler)
  }, [])

  return [muted, setMuted]
}
