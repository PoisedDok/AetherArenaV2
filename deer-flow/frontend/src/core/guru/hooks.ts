'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { getGuru, getGuruMuted, setGuruMuted } from './guru'
import type { Guru } from './types'

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
