/**
 * Guru intro system text — injected into LangGraph context once per browser
 * session so the main LLM knows Guru exists as a separate watcher.
 *
 * Ported from buddy/prompt.ts — same "separate watcher" framing preserved.
 */
export function guruIntroText(name: string, species: string): string {
  return (
    `# Guru Companion\n` +
    `A small ${species} named ${name} sits beside the user's input box and occasionally comments in a speech bubble. ` +
    `You're not ${name} — it's a separate watcher.\n\n` +
    `When the user addresses ${name} directly (by name), its bubble will answer. ` +
    `Your job in that moment is to stay out of the way: respond in ONE line or less, ` +
    `or just answer any part of the message meant for you. ` +
    `Don't explain that you're not ${name} — they know. ` +
    `Don't narrate what ${name} might say — the bubble handles that.`
  )
}

const SESSION_KEY_PREFIX = 'aether.guru.intro.'

/**
 * Returns the guru intro context object to merge into LangGraph `context`,
 * or null if already injected this session for this companion name.
 *
 * Tracks per-name so that if the companion is reset and re-hatched with a
 * new name, the intro fires again.
 */
export function getGuruIntroContext(
  name: string,
  species: string,
): { guru_intro: { name: string; species: string; text: string } } | null {
  if (typeof window === 'undefined') return null

  const sessionKey = SESSION_KEY_PREFIX + name
  if (sessionStorage.getItem(sessionKey)) return null

  sessionStorage.setItem(sessionKey, '1')
  return {
    guru_intro: {
      name,
      species,
      text: guruIntroText(name, species),
    },
  }
}
