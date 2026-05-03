import Anthropic from '@anthropic-ai/sdk';
import { NextRequest } from 'next/server';
import { loadPrompt, type Direction } from '@/lib/prompts';
import { DEFAULT_MODELS, MODELS } from '@/lib/models';
import { ratelimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const maxDuration = 60;

type Body = {
  direction: Direction;
  text: string;
  model?: string;
};

const anthropic = new Anthropic();

function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

function isValidModel(direction: Direction, model: string): boolean {
  return MODELS[direction].some((m) => m.id === model);
}

export async function POST(req: NextRequest): Promise<Response> {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }

  const { direction, text } = body;
  if (!direction || !MODELS[direction]) {
    return new Response('Invalid direction', { status: 400 });
  }
  const trimmed = text?.trim();
  if (!trimmed) {
    return new Response('Empty input', { status: 400 });
  }
  if (trimmed.length > 10_000) {
    return new Response('Input too long (max 10,000 chars)', { status: 400 });
  }

  const model = body.model ?? DEFAULT_MODELS[direction];
  if (!isValidModel(direction, model)) {
    return new Response(`Model "${model}" not allowed for direction "${direction}"`, {
      status: 400,
    });
  }

  if (ratelimit) {
    const ip = clientIp(req);
    const { success, reset } = await ratelimit.limit(ip);
    if (!success) {
      const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
      return new Response(`Rate limit exceeded. Try again in ${retryAfter}s.`, {
        status: 429,
        headers: { 'Retry-After': String(retryAfter) },
      });
    }
  }

  const systemPrompt = loadPrompt(direction);

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        const response = anthropic.messages.stream({
          model,
          max_tokens: 1024,
          system: [
            {
              type: 'text',
              text: systemPrompt,
              cache_control: { type: 'ephemeral' },
            },
          ],
          messages: [{ role: 'user', content: trimmed }],
        });

        for await (const event of response) {
          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        controller.enqueue(encoder.encode(`\n\n[error] ${message}`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  });
}
