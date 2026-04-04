import { getBackendBaseURL } from '../config'

import type { Guru } from './types'

export type GuruMove =
  | 'idle'
  | 'walk-left'
  | 'walk-right'
  | 'jump'
  | 'spin'
  | 'shake'
  | 'bounce'
  | 'peek'

const VALID_MOVES: ReadonlySet<string> = new Set([
  'idle', 'walk-left', 'walk-right', 'jump', 'spin', 'shake', 'bounce', 'peek',
])

/**
 * Calls the backend /api/guru/react endpoint which proxies to a small LLM.
 * Returns a reaction string + a movement cue for the sprite.
 *
 * This is the re-implementation of the private `fireCompanionObserver` from
 * Claude Code's buddy system. Called after every AI turn; generates a 1-sentence
 * reaction from Guru's perspective using its personality stats, plus a move
 * that the backend LLM picks based on the emotional tone of the reaction.
 */
export async function fireGuruObserver(
  lastAiText: string,
  guru: Guru,
  onReaction: (reaction: string) => void,
  signal?: AbortSignal,
  /** Optional model config key to use for the reaction call (overrides default) */
  modelName?: string,
): Promise<void> {
  if (!lastAiText.trim()) return

  // Tune tone from stats — same logic as original buddy observer
  const { WISDOM, SNARK, CHAOS, PATIENCE } = guru.stats
  let tone: string
  if (WISDOM >= 70) {
    tone = 'wise and precise'
  } else if (SNARK >= 70) {
    tone = 'dry and sardonic'
  } else if (CHAOS >= 70) {
    tone = 'unpredictable and playful'
  } else if (PATIENCE <= 20) {
    tone = 'mildly impatient'
  } else {
    tone = 'quietly encouraging'
  }

  const systemPrompt =
    `You are Guru, a ${guru.species} companion. Personality: ${guru.personality}.\n` +
    `A user just got an AI response. Write ONE short reaction — 3 to 8 words max. No punctuation flourish. No emoji.\n` +
    `Tone: ${tone}. Sound like a brief scribble in the margin, not a review.\n` +
    `Good examples: "Interesting approach." / "That'll bite you later." / "Classic." / "Hmm, not bad." / "Bold choice." / "Saw that coming." / "Check the edge cases."\n` +
    `Bad examples (too long, too explanatory): "That's a really elegant solution to the problem!" / "I notice this uses recursion which is interesting."`

  // Signal that Guru is making an LLM call — shows thinking ring on sprite
  window.dispatchEvent(new CustomEvent('guru:thinking', { detail: true }))

  try {
    const res = await fetch(`${getBackendBaseURL()}/api/guru/react`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        last_ai_text: lastAiText.slice(0, 1200), // cap context sent
        system: systemPrompt,
        model_name: modelName ?? null,
      }),
      signal,
    })

    if (!res.ok) return

    const data = (await res.json()) as { reaction?: string; move?: string }

    if (data.reaction && typeof data.reaction === 'string' && data.reaction.trim()) {
      onReaction(data.reaction.trim())
    }

    // Dispatch move event — sprite picks it up independently
    if (data.move && typeof data.move === 'string' && VALID_MOVES.has(data.move)) {
      window.dispatchEvent(
        new CustomEvent<GuruMove>('guru:move', { detail: data.move as GuruMove }),
      )
    }
  } catch {
    // Silently swallow — Guru is decorative, never block UX
  } finally {
    // Always clear thinking ring
    window.dispatchEvent(new CustomEvent('guru:thinking', { detail: false }))
  }
}
