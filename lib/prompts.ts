import { readFileSync } from 'fs';
import { join } from 'path';

const PROMPT_FILES = {
  en_to_linkedin: 'prompt_en_to_linkedin.md',
  linkedin_to_en: 'prompt_linkedin_to_en.md',
} as const;

export type Direction = keyof typeof PROMPT_FILES;

const cache = new Map<Direction, string>();

export function loadPrompt(direction: Direction): string {
  const cached = cache.get(direction);
  if (cached) return cached;
  const text = readFileSync(join(process.cwd(), PROMPT_FILES[direction]), 'utf-8');
  cache.set(direction, text);
  return text;
}
