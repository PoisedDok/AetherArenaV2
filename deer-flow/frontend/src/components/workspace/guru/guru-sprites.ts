import type { Eye, GuruBones, Hat, Species } from '@/core/guru/types'

// ---------------------------------------------------------------------------
// ASCII sprite bodies — 5 lines tall, 12 chars wide (after {E} substitution)
// Multiple frames per species: 0=rest, 1=fidget, 2=fidget2
// Line 0 is the hat slot (blank by default; hat or smoke uses it in frame 2)
// Ported verbatim from buddy/sprites.ts
// ---------------------------------------------------------------------------
const BODIES: Record<Species, string[][]> = {
  duck: [
    ['            ', '    __      ', '  <({E} )___  ', '   (  ._>   ', "    `--\u00b4    "],
    ['            ', '    __      ', '  <({E} )___  ', '   (  ._>   ', "    `--\u00b4~   "],
    ['            ', '    __      ', '  <({E} )___  ', '   (  .__>  ', "    `--\u00b4    "],
  ],
  goose: [
    ['            ', '     ({E}>    ', '     ||     ', '   _(__)_   ', '    ^^^^    '],
    ['            ', '    ({E}>     ', '     ||     ', '   _(__)_   ', '    ^^^^    '],
    ['            ', '     ({E}>>   ', '     ||     ', '   _(__)_   ', '    ^^^^    '],
  ],
  blob: [
    ['            ', '   .----.   ', '  ( {E}  {E} )  ', '  (      )  ', "   `----\u00b4   "],
    ['            ', '  .------.  ', ' (  {E}  {E}  ) ', ' (        ) ', "  `------\u00b4  "],
    ['            ', '    .--.    ', '   ({E}  {E})   ', '   (    )   ', "    `--\u00b4    "],
  ],
  cat: [
    ['            ', '   /\\_/\\    ', '  ( {E}   {E})  ', '  (  \u03c9  )   ', '  (")_(")   '],
    ['            ', '   /\\_/\\    ', '  ( {E}   {E})  ', '  (  \u03c9  )   ', '  (")_(")~  '],
    ['            ', '   /\\-/\\    ', '  ( {E}   {E})  ', '  (  \u03c9  )   ', '  (")_(")   '],
  ],
  dragon: [
    ['            ', '  /^\\  /^\\  ', ' <  {E}  {E}  > ', ' (   ~~   ) ', "  `-vvvv-\u00b4  "],
    ['            ', '  /^\\  /^\\  ', ' <  {E}  {E}  > ', ' (        ) ', "  `-vvvv-\u00b4  "],
    ['   ~    ~   ', '  /^\\  /^\\  ', ' <  {E}  {E}  > ', ' (   ~~   ) ', "  `-vvvv-\u00b4  "],
  ],
  octopus: [
    ['            ', '   .----.   ', '  ( {E}  {E} )  ', '  (______)  ', '  /\\/\\/\\/\\  '],
    ['            ', '   .----.   ', '  ( {E}  {E} )  ', '  (______)  ', '  \\/\\/\\/\\/  '],
    ['     o      ', '   .----.   ', '  ( {E}  {E} )  ', '  (______)  ', '  /\\/\\/\\/\\  '],
  ],
  owl: [
    ['            ', '   /\\  /\\   ', '  (({E})({E}))  ', '  (  ><  )  ', "   `----\u00b4   "],
    ['            ', '   /\\  /\\   ', '  (({E})({E}))  ', '  (  ><  )  ', '   .----.   '],
    ['            ', '   /\\  /\\   ', '  (({E})(-))  ', '  (  ><  )  ', "   `----\u00b4   "],
  ],
  penguin: [
    ['            ', '  .---.     ', '  ({E}>{E})     ', ' /(   )\\    ', "  `---\u00b4     "],
    ['            ', '  .---.     ', '  ({E}>{E})     ', ' |(   )|    ', "  `---\u00b4     "],
    ['  .---.     ', '  ({E}>{E})     ', ' /(   )\\    ', "  `---\u00b4     ", '   ~ ~      '],
  ],
  turtle: [
    ['            ', '   _,--._   ', '  ( {E}  {E} )  ', ' /[______]\\ ', "  ``    ``  "],
    ['            ', '   _,--._   ', '  ( {E}  {E} )  ', ' /[______]\\ ', "   ``  ``   "],
    ['            ', '   _,--._   ', '  ( {E}  {E} )  ', ' /[======]\\ ', "  ``    ``  "],
  ],
  snail: [
    ['            ', ' {E}    .--.  ', '  \\  ( @ )  ', "   \\_`--\u00b4   ", '  ~~~~~~~   '],
    ['            ', '  {E}   .--.  ', '  |  ( @ )  ', "   \\_`--\u00b4   ", '  ~~~~~~~   '],
    ['            ', ' {E}    .--.  ', '  \\  ( @  ) ', "   \\_`--\u00b4   ", '   ~~~~~~   '],
  ],
  ghost: [
    ['            ', '   .----.   ', '  / {E}  {E} \\  ', '  |      |  ', '  ~`~``~`~  '],
    ['            ', '   .----.   ', '  / {E}  {E} \\  ', '  |      |  ', "  `~`~~`~`  "],
    ['    ~  ~    ', '   .----.   ', '  / {E}  {E} \\  ', '  |      |  ', '  ~~`~~`~~  '],
  ],
  axolotl: [
    ['            ', '}~(______)~{', '}~({E} .. {E})~{', '  ( .--. )  ', "  (_/  \\_)  "],
    ['            ', '~}(______){~', '~}({E} .. {E}){~', '  ( .--. )  ', "  (_/  \\_)  "],
    ['            ', '}~(______)~{', '}~({E} .. {E})~{', '  (  --  )  ', "  ~_/  \\_~  "],
  ],
  capybara: [
    ['            ', '  n______n  ', ' ( {E}    {E} ) ', ' (   oo   ) ', "  `------\u00b4  "],
    ['            ', '  n______n  ', ' ( {E}    {E} ) ', ' (   Oo   ) ', "  `------\u00b4  "],
    ['    ~  ~    ', '  u______n  ', ' ( {E}    {E} ) ', ' (   oo   ) ', "  `------\u00b4  "],
  ],
  cactus: [
    ['            ', ' n  ____  n ', ' | |{E}  {E}| | ', ' |_|    |_| ', '   |    |   '],
    ['            ', '    ____    ', ' n |{E}  {E}| n ', ' |_|    |_| ', '   |    |   '],
    [' n        n ', ' |  ____  | ', ' | |{E}  {E}| | ', ' |_|    |_| ', '   |    |   '],
  ],
  robot: [
    ['            ', '   .[||].   ', '  [ {E}  {E} ]  ', '  [ ==== ]  ', "  `------\u00b4  "],
    ['            ', '   .[||].   ', '  [ {E}  {E} ]  ', '  [ -==- ]  ', "  `------\u00b4  "],
    ['     *      ', '   .[||].   ', '  [ {E}  {E} ]  ', '  [ ==== ]  ', "  `------\u00b4  "],
  ],
  rabbit: [
    ['            ', '   (\\__/)   ', '  ( {E}  {E} )  ', ' =(  ..  )= ', '  (")__(")  '],
    ['            ', '   (|__/)   ', '  ( {E}  {E} )  ', ' =(  ..  )= ', '  (")__(")  '],
    ['            ', '   (\\__/)   ', '  ( {E}  {E} )  ', ' =( .  . )= ', '  (")__(")  '],
  ],
  mushroom: [
    ['            ', ' .-o-OO-o-. ', '(__________)', '   |{E}  {E}|   ', '   |____|   '],
    ['            ', ' .-O-oo-O-. ', '(__________)', '   |{E}  {E}|   ', '   |____|   '],
    ['   . o  .   ', ' .-o-OO-o-. ', '(__________)', '   |{E}  {E}|   ', '   |____|   '],
  ],
  chonk: [
    ['            ', '  /\\    /\\  ', ' ( {E}    {E} ) ', ' (   ..   ) ', "  `------\u00b4  "],
    ['            ', '  /\\    /|  ', ' ( {E}    {E} ) ', ' (   ..   ) ', "  `------\u00b4  "],
    ['            ', '  /\\    /\\  ', ' ( {E}    {E} ) ', ' (   ..   ) ', "  `------\u00b4~ "],
  ],
}

const HAT_LINES: Record<Hat, string> = {
  none: '',
  crown: '   \\^^^/    ',
  tophat: '   [___]    ',
  propeller: '    -+-     ',
  halo: '   (   )    ',
  wizard: '    /^\\     ',
  beanie: '   (___)    ',
  tinyduck: '    ,>      ',
}

/** Render ASCII sprite lines with eye substitution and hat overlay */
export function renderSprite(bones: GuruBones, frame = 0): string[] {
  const frames = BODIES[bones.species]
  const body = frames[frame % frames.length]!.map((line) =>
    line.replaceAll('{E}', bones.eye as string),
  )
  const lines = [...body]
  // Replace blank hat slot with hat line (some fidget frames use it for smoke etc)
  if (bones.hat !== 'none' && !lines[0]!.trim()) {
    lines[0] = HAT_LINES[bones.hat]
  }
  // Drop blank hat slot if ALL frames have blank line 0 (no height oscillation)
  if (!lines[0]!.trim() && frames.every((f) => !f[0]!.trim())) lines.shift()
  return lines
}

export function spriteFrameCount(species: Species): number {
  return BODIES[species].length
}

/** Render the compact face string used in narrow mode */
export function renderFace(bones: GuruBones): string {
  const eye: Eye = bones.eye
  switch (bones.species) {
    case 'duck':
    case 'goose':
      return `(${eye}>`
    case 'blob':
      return `(${eye}${eye})`
    case 'cat':
      return `=${eye}\u03c9${eye}=`
    case 'dragon':
      return `<${eye}~${eye}>`
    case 'octopus':
      return `~(${eye}${eye})~`
    case 'owl':
      return `(${eye})(${eye})`
    case 'penguin':
      return `(${eye}>)`
    case 'turtle':
      return `[${eye}_${eye}]`
    case 'snail':
      return `${eye}(@)`
    case 'ghost':
      return `/${eye}${eye}\\`
    case 'axolotl':
      return `}${eye}.${eye}{`
    case 'capybara':
      return `(${eye}oo${eye})`
    case 'cactus':
      return `|${eye}  ${eye}|`
    case 'robot':
      return `[${eye}${eye}]`
    case 'rabbit':
      return `(${eye}..${eye})`
    case 'mushroom':
      return `|${eye}  ${eye}|`
    case 'chonk':
      return `(${eye}.${eye})`
  }
}
