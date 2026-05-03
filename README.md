# Linkedinese

A bidirectional translator between plain English and "LinkedIn Speak" — the performative, euphemism-heavy dialect of professional self-promotion. Type "I got fired and I need a job" and get back the appropriate `#OpenToWork #NewChapter #Grateful` post. Paste in a humblebrag and get back what the author probably meant — usually with a quiet "I'm tired" at the end.

Built with Next.js, the Anthropic Claude API, and a pair of carefully-tuned system prompts.

## What it looks like

**Plain English → LinkedIn Speak.** Take a normal human statement; receive a viral-formatted post complete with hashtags, mandatory line breaks, and exactly the right amount of manufactured optimism.

![English to LinkedIn Speak](screenshots/en-to-linkedin.png)

**LinkedIn Speak → Plain English.** Strip the performance, keep the substance. A nine-paragraph humblebrag about an actuarial fellowship collapses into the three sentences the author actually meant — including the part they would never post.

![LinkedIn Speak to English](screenshots/linkedin-to-en.png)

## Quick start

```bash
git clone https://github.com/Lomnus-ai/linkedinese.git
cd linkedinese
cp .env.example .env.local       # then fill in ANTHROPIC_API_KEY
npm install
npm run dev
```

Open <http://localhost:3000> and translate.

Rate limiting is env-gated — local dev runs without it. To enable it locally, also set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` in `.env.local` (see [Rate limiting](#rate-limiting) below).

## How it works

Prompt engineering, not a fine-tuned model. Two carefully-tuned system prompts (one per direction) handle the style transfer. Each request:

1. Hits the Next.js API route at `/api/translate`
2. Loads the appropriate prompt `.md` file from disk (cached after first read)
3. Calls Claude via `@anthropic-ai/sdk` with prompt caching on the system prompt (~90% off the input prefix on cache hits)
4. Streams the response back to the browser as plain text chunks via the Web Streams API

The hard part isn't the LLM call — it's the prompts. They live in:

- **`prompt_en_to_linkedin.md`** — handles when to add #OpenToWork without inventing a fake team to be grateful to. Empty gratitude theater is the #1 tell of an AI-written LinkedIn post, so the prompt is hardened against manufacturing teammates, mentors, durations, or credentials that weren't in the input.
- **`prompt_linkedin_to_en.md`** — decides whether "new chapter" means "got fired" or "quit" based on signal words around it, preserves named entities (companies, dollar amounts, conferences), and ends the right kind of post with a deflated punchline like "I'm tired" or "at least it's over."

Both prompts are heavily annotated with style rules and few-shot examples. They are, in some non-trivial sense, the entire product.

## Models

Pick a model per direction from the dropdown. Defaults are tuned for the difficulty of each direction:

| Direction              | Default       | Why                                                                    |
| ---------------------- | ------------- | ---------------------------------------------------------------------- |
| English → LinkedIn     | Sonnet 4.6    | The easy direction — adding fluff is what LLMs do natively             |
| LinkedIn → English     | Opus 4.7      | The hard direction — needs nuance to decode intent and pick the right deflation |

Haiku 4.5 is also available if you want it cheaper.

## Rate limiting

The `/api/translate` endpoint uses Upstash Redis + `@upstash/ratelimit` (sliding window, 10 requests/minute per IP) when `UPSTASH_REDIS_REST_URL` is set. If unset, rate limiting is skipped — fine for local dev, not what you want in production.

To enable it:

1. Create an account at <https://console.upstash.com>.
2. Create a new Redis database (the free tier is more than enough).
3. From the database's REST API tab, copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
4. Set both in `.env.local` for local dev, and as Vercel project env vars for production.

## Deploying to Vercel

```bash
npm i -g vercel
vercel login
vercel                                              # interactive — links project, deploys preview
vercel env add ANTHROPIC_API_KEY production         # paste key when prompted
vercel env add UPSTASH_REDIS_REST_URL production
vercel env add UPSTASH_REDIS_REST_TOKEN production
vercel --prod                                       # promote to production
```

Or import the repo through the Vercel dashboard and set the env vars there. Either way, after the first deploy you can wire up auto-deploy on push via `vercel git connect`.

## Project layout

```
app/                           Next.js App Router
  page.tsx                       UI — direction toggle, model picker, input/output, theme toggle
  layout.tsx                     Root layout + theme provider
  api/translate/route.ts         Streaming endpoint, rate-limited
lib/
  prompts.ts                     Loads + caches prompt .md files
  models.ts                      Per-direction model registry + defaults
  ratelimit.ts                   Upstash rate limiter (env-gated)
prompt_en_to_linkedin.md       System prompt — plain → LinkedIn
prompt_linkedin_to_en.md       System prompt — LinkedIn → plain
linkedin_speak.py              Python CLI for prompt iteration (not deployed)
run_experiment.py              Offline experiment harness with LLM judge
cases.json                     Test cases for both directions
screenshots/                   The pictures above
```

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind · `next-themes` (dark mode) · Radix UI primitives (Select, Toggle Group) · `@anthropic-ai/sdk` · `@upstash/ratelimit`. Deployed on Vercel.

The Python CLI and experiment harness use `anthropic` + `python-dotenv` only — kept around because tuning the prompts is much faster from the terminal than through the web UI.

## Constraints

- Rate limit: 10 requests/minute per IP (when Upstash is configured)
- Max input: 10,000 characters
- The English → LinkedIn direction will refuse to invent facts. If you don't mention a team, it won't thank one. If you don't say how long you worked somewhere, it won't add "after nearly a decade." Generic LinkedIn slop is the failure mode the prompt was built to avoid.

## License

MIT — see [LICENSE](LICENSE).

## Credits

- Anthropic for the model.
- Every overcaffeinated VP of Operations whose Sunday-night announcement post supplied the training intuition.
