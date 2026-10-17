/**
 * Wake phrase spotting for hands-free voice. Recognizers spell an unfamiliar
 * name many ways ("fino", "feeno", "phino", "vino", "fee no"), so the matcher
 * compares how words sound, not how they are spelled: a small phonetic key and
 * an edit distance budget. It is pure and cheap, so it runs on every interim
 * result while the console listens.
 */
export const WAKE_PHRASE = 'Hey Fino';

export interface WakeMatch {
  /** What the speaker said after the wake phrase, in their casing. Empty when only the phrase was heard. */
  command: string;
  /** Character index in the transcript where the wake phrase starts. */
  index: number;
}

const NAME_KEY = 'fino';
const GREETINGS = new Set(['hey', 'hay', 'hi', 'hello', 'ok', 'okay', 'a', 'eh']);
/** Everyday words one edit away from the name. With a greeting before them they are still not the name. */
const LOOKALIKES = new Set(['fine', 'find', 'fin', 'five']);
const LEADING_FILLER = /^[\s,.!?;:-]*(?:(?:please|um|uh)\b[\s,]*)*/i;

interface Token {
  word: string;
  start: number;
  end: number;
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const match of text.matchAll(/[A-Za-z']+/g)) {
    tokens.push({ word: match[0].toLowerCase().replace(/'/g, ''), start: match.index, end: match.index + match[0].length });
  }
  return tokens;
}

/** A rough sound key: ph and v sound like f, long e spellings collapse to i, doubled letters collapse. */
export function soundKey(word: string): string {
  return word
    .toLowerCase()
    .replace(/[^a-z]/g, '')
    .replace(/ph/g, 'f')
    .replace(/v/g, 'f')
    .replace(/ee|ea|ie|ey|y/g, 'i')
    .replace(/(?:oh|ow|oe)$/, 'o')
    .replace(/(.)\1+/g, '$1');
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length]!;
}

/** How far a spoken word (or two words run together) is from the product name, or Infinity when it is not the name. */
function nameDistance(word: string): number {
  if (word === 'finorchestrate') return 0;
  if (LOOKALIKES.has(word)) return Infinity;
  const key = soundKey(word);
  if (key.length < 3 || key.length > 6) return Infinity;
  return editDistance(key, NAME_KEY);
}

/**
 * Finds the wake phrase in a transcript. Accepted forms:
 * a greeting followed by the name heard approximately ("hey feeno", "okay vino"),
 * or the name heard exactly at the start ("Fino, approve it", "FinOrchestrate, any unusual charges").
 * Recognizers sometimes split the name ("fee no", "fin orchestrate"), so two words are also tried as one.
 */
export function matchWake(transcript: string): WakeMatch | null {
  const tokens = tokenize(transcript);
  for (let index = 0; index < tokens.length; index += 1) {
    const greeted = index > 0 && GREETINGS.has(tokens[index - 1]!.word);
    const atStart = index === 0 || (index === 1 && greeted);
    const budget = greeted ? 1 : atStart ? 0 : -1;
    if (budget < 0) continue;
    for (const span of [1, 2]) {
      const parts = tokens.slice(index, index + span);
      if (parts.length < span) break;
      const joined = parts.map((part) => part.word).join('');
      const distance = span === 2 && parts[1]!.word === 'orchestrate' && parts[0]!.word === 'fin' ? 0 : nameDistance(joined);
      if (distance <= budget) {
        const start = greeted ? tokens[index - 1]!.start : tokens[index]!.start;
        const rest = transcript.slice(parts[span - 1]!.end).replace(LEADING_FILLER, '').trim();
        return { command: rest, index: start };
      }
    }
  }
  return null;
}
