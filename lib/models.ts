import type { Direction } from './prompts';

export type ModelOption = { id: string; label: string };

export const MODELS: Record<Direction, ModelOption[]> = {
  en_to_linkedin: [
    { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6 (default)' },
    { id: 'claude-opus-4-7', label: 'Opus 4.7' },
    { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
  ],
  linkedin_to_en: [
    { id: 'claude-opus-4-7', label: 'Opus 4.7 (default)' },
    { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
    { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
  ],
};

export const DEFAULT_MODELS: Record<Direction, string> = {
  en_to_linkedin: 'claude-sonnet-4-6',
  linkedin_to_en: 'claude-opus-4-7',
};
