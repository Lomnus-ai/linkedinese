'use client';

import { useEffect, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import * as Select from '@radix-ui/react-select';
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import { DEFAULT_MODELS, MODELS } from '@/lib/models';
import type { Direction } from '@/lib/prompts';

const DIRECTION_LABELS: Record<Direction, string> = {
  en_to_linkedin: 'English → LinkedIn Speak',
  linkedin_to_en: 'LinkedIn Speak → English',
};

export default function Page() {
  const [direction, setDirection] = useState<Direction>('en_to_linkedin');
  const [model, setModel] = useState<string>(DEFAULT_MODELS.en_to_linkedin);
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // When direction changes, reset model to that direction's default
  useEffect(() => {
    setModel(DEFAULT_MODELS[direction]);
  }, [direction]);

  async function translate() {
    if (!input.trim() || loading) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setOutput('');
    setError(null);
    setElapsed(null);
    setLoading(true);
    const start = performance.now();

    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ direction, text: input, model }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const msg = await res.text();
        setError(msg || `Error ${res.status}`);
        setLoading(false);
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let result = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        result += decoder.decode(value, { stream: true });
        setOutput(result);
      }
      setElapsed((performance.now() - start) / 1000);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  async function copyOutput() {
    if (!output) return;
    await navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <Header />

      <Card className="mb-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-2">
            <Label>Direction</Label>
            <ToggleGroup.Root
              type="single"
              value={direction}
              onValueChange={(v) => v && setDirection(v as Direction)}
              className="inline-flex rounded-lg bg-slate-100 p-1 ring-1 ring-inset ring-slate-200 dark:bg-zinc-950 dark:ring-zinc-800"
            >
              {(Object.keys(DIRECTION_LABELS) as Direction[]).map((d) => (
                <ToggleGroup.Item
                  key={d}
                  value={d}
                  className="rounded-md px-4 py-1.5 text-sm font-medium text-slate-600 transition-all hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0A66C2]/40 data-[state=on]:bg-white data-[state=on]:text-[#0A66C2] data-[state=on]:shadow-sm dark:text-zinc-400 dark:hover:text-zinc-100 dark:data-[state=on]:bg-zinc-800 dark:data-[state=on]:text-white dark:focus-visible:ring-[#0A4F92]/50"
                >
                  {DIRECTION_LABELS[d]}
                </ToggleGroup.Item>
              ))}
            </ToggleGroup.Root>
          </div>

          <div className="flex flex-col gap-2 sm:items-end">
            <Label>Model</Label>
            <ModelSelect value={model} onChange={setModel} direction={direction} />
          </div>
        </div>
      </Card>

      <div className="mb-4 grid gap-4 md:grid-cols-2">
        <Card>
          <div className="mb-2 flex items-center justify-between">
            <Label>Input</Label>
            <span className="text-xs text-slate-500 dark:text-zinc-400">
              {input.length} chars
            </span>
          </div>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              direction === 'en_to_linkedin'
                ? 'I got fired and I need a job'
                : "I'm thrilled to share that I'm starting a new chapter..."
            }
            maxLength={10_000}
            className="min-h-[280px] w-full resize-y rounded-md bg-slate-50 p-3 text-sm leading-relaxed outline-none ring-1 ring-inset ring-slate-200 focus:ring-slate-300 dark:bg-zinc-950 dark:ring-zinc-800 dark:focus:ring-zinc-700"
          />
        </Card>

        <Card>
          <div className="mb-2 flex items-center justify-between">
            <Label>Output</Label>
            <button
              onClick={copyOutput}
              disabled={!output}
              className="rounded-md border border-slate-300 px-2.5 py-1 text-xs hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <div className="min-h-[280px] whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-sm leading-relaxed ring-1 ring-inset ring-slate-200 dark:bg-zinc-950 dark:ring-zinc-800">
            {error ? (
              <span className="text-red-600 dark:text-red-400">{error}</span>
            ) : output ? (
              output
            ) : (
              <span className="text-slate-400 dark:text-zinc-500">
                {loading ? 'Translating…' : 'Output will appear here.'}
              </span>
            )}
          </div>
          {elapsed !== null && output && !error && (
            <div className="mt-2 text-xs text-slate-500 dark:text-zinc-400">
              Done in {elapsed.toFixed(1)}s · {output.length} chars
            </div>
          )}
        </Card>
      </div>

      <button
        onClick={translate}
        disabled={!input.trim() || loading}
        className="w-full rounded-lg bg-[#0A66C2] py-3 text-sm font-semibold text-white transition hover:bg-[#0958A8] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-[#0A4F92] dark:hover:bg-[#0A4684]"
      >
        {loading ? 'Translating…' : 'Translate'}
      </button>
    </div>
  );
}

function Header() {
  return (
    <header className="mb-4 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-[#0A66C2] text-sm font-bold text-white dark:bg-[#0A4F92]">
          in
        </div>
        <h1 className="text-lg font-semibold tracking-tight">LinkedIn Translator</h1>
      </div>
      <ThemeToggle />
    </header>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <div className="h-9 w-9 rounded-md border border-slate-300 dark:border-zinc-700" />
    );
  }

  const isDark = resolvedTheme === 'dark';
  return (
    <button
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
    >
      {isDark ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      )}
    </button>
  );
}

function ModelSelect({
  value,
  onChange,
  direction,
}: {
  value: string;
  onChange: (v: string) => void;
  direction: Direction;
}) {
  return (
    <Select.Root value={value} onValueChange={onChange}>
      <Select.Trigger
        aria-label="Model"
        className="inline-flex min-w-[200px] items-center justify-between gap-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#0A66C2]/30 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:bg-zinc-700/60 dark:focus:ring-[#0A4F92]/40"
      >
        <Select.Value />
        <Select.Icon className="text-slate-500 dark:text-zinc-400">
          <ChevronDownIcon />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          position="popper"
          sideOffset={4}
          className="z-50 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg dark:border-zinc-700/60 dark:bg-zinc-800"
        >
          <Select.Viewport className="p-1">
            {MODELS[direction].map((m) => (
              <Select.Item
                key={m.id}
                value={m.id}
                className="relative flex cursor-pointer select-none items-center rounded-sm py-1.5 pl-8 pr-3 text-sm outline-none focus:bg-slate-100 data-[state=checked]:font-medium dark:focus:bg-zinc-700"
              >
                <Select.ItemIndicator className="absolute left-2 inline-flex items-center text-[#0A66C2] dark:text-[#3B82C4]">
                  <CheckIcon />
                </Select.ItemIndicator>
                <Select.ItemText>{m.label}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-zinc-700/60 dark:bg-zinc-900 ${className}`}>
      {children}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-zinc-400">
      {children}
    </span>
  );
}
