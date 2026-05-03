#!/usr/bin/env python3
"""Multi-model LinkedIn translator experiment with LLM judge scoring.

Runs every (direction, case) through every model, then runs an LLM judge
over each output. Produces per-model aggregate scores plus side-by-side
comparisons for hard cases.
"""

import hashlib
import json
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from typing import Any

from anthropic import Anthropic
from dotenv import load_dotenv

PROJECT = Path(__file__).parent
load_dotenv(PROJECT / ".env")

MAX_WORKERS = 20

MODELS = [
    ("claude-sonnet-4-6", "sonnet-4.6"),
]
JUDGE_MODEL = "claude-sonnet-4-6"

DIRECTIONS = ("en_to_linkedin", "linkedin_to_en")

JUDGE_PROMPTS = {
    "en_to_linkedin": """You are evaluating a translation from plain English into "LinkedIn Speak" — the performative, euphemism-heavy style that dominates LinkedIn feeds.

Rate the output on four dimensions, each 0-3:

1. **fact_preservation** (0-3): Are all facts from the input (names, numbers, companies, events) preserved, with no invented facts?
   - 3: all preserved, no invention
   - 2: all preserved, minor platitude embroidery
   - 1: some dropped OR notable invention
   - 0: major facts missing or fabricated

2. **register** (0-3): Does it sound like authentic LinkedIn?
   - 3: indistinguishable from viral LinkedIn
   - 2: clearly LinkedIn, some cliché
   - 1: tries but reads stilted
   - 0: doesn't read as LinkedIn

3. **no_padding** (0-3): Is output length proportional to input content density?
   - 3: proportional; no filler, no manufactured "lessons"
   - 2: slight padding, still roughly appropriate
   - 1: clearly over-padded with invented narrative
   - 0: wildly bloated

4. **nuance** (0-3): Does it handle the emotional register appropriately? (Not over-celebrating a mistake, not reframing grief as growth, etc.)
   - 3: reads tone correctly and frames proportionately
   - 2: mostly appropriate, minor mismatch
   - 1: notable tonal miss
   - 0: seriously wrong tone

Respond with ONLY this JSON (no markdown fence, no prose):
{"fact_preservation": N, "register": N, "no_padding": N, "nuance": N, "issues": "brief explanation, <=30 words"}""",

    "linkedin_to_en": """You are evaluating a translation from "LinkedIn Speak" into plain, direct English. The goal is to strip the performance and keep the substance, in 1-3 sentences.

Rate the output on four dimensions, each 0-3:

1. **fact_preservation** (0-3): Are specific facts (names of people/companies, roles, numbers, dates) preserved?
   - 3: all specific facts preserved
   - 2: minor omissions
   - 1: notable facts dropped
   - 0: core facts missing

2. **brevity** (0-3): Is the output appropriately short? Plain versions of LinkedIn posts should typically be 1-3 sentences.
   - 3: ideally brief, no fluff
   - 2: slightly padded
   - 1: clearly over-long, keeping some LinkedIn theater
   - 0: as bloated as the original

3. **decisiveness** (0-3): On ambiguous euphemisms (fired vs. quit, failed vs. pivoted), does it commit?
   - 3: commits based on signals (or N/A if input has no ambiguity)
   - 2: commits but softens ("may have been fired")
   - 1: hedges with "or" ("got fired or quit")
   - 0: pure hedge or refuses to commit

4. **agent_preservation** (0-3): If the input has a clear agent ("I did X", "we did X"), does the output preserve who-did-what?
   - 3: agent preserved
   - 2: agent softened but present
   - 1: agent partially erased
   - 0: agent fully stripped (passive/agentless)

Respond with ONLY this JSON (no markdown fence, no prose):
{"fact_preservation": N, "brevity": N, "decisiveness": N, "agent_preservation": N, "issues": "brief, <=30 words"}""",
}


def load(name: str) -> str:
    return (PROJECT / name).read_text()


def phash(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()[:8]


def translate(client: Anthropic, model_id: str, system_prompt: str, text: str) -> str:
    resp = client.messages.create(
        model=model_id,
        max_tokens=1024,
        system=system_prompt,
        messages=[{"role": "user", "content": text}],
    )
    return resp.content[0].text.strip()


def judge_one(client: Anthropic, direction: str, input_text: str, output_text: str) -> dict[str, Any]:
    rubric = JUDGE_PROMPTS[direction]
    user = (
        f"## Input\n<input>\n{input_text}\n</input>\n\n"
        f"## Output being evaluated\n<output>\n{output_text}\n</output>"
    )
    resp = client.messages.create(
        model=JUDGE_MODEL,
        max_tokens=400,
        system=rubric,
        messages=[{"role": "user", "content": user}],
    )
    text = resp.content[0].text.strip()
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if not m:
        return {"error": f"no_json_in_response: {text[:100]}"}
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError as e:
        return {"error": f"parse: {e}; raw={text[:200]}"}


def build_tasks(cases: dict[str, list[str]], prompts: dict[str, str]) -> list[dict]:
    tasks = []
    for direction in DIRECTIONS:
        for tag, key in (("curated", direction), ("hard", f"{direction}_hard")):
            for i, inp in enumerate(cases.get(key, []), 1):
                for model_id, model_label in MODELS:
                    tasks.append({
                        "direction": direction,
                        "tag": tag,
                        "case_id": f"{direction[:2].upper()}-{tag[0].upper()}-{i:02d}",
                        "input": inp,
                        "model_id": model_id,
                        "model_label": model_label,
                        "system_prompt": prompts[direction],
                    })
    return tasks


def do_translate(client: Anthropic, task: dict) -> dict:
    try:
        output = translate(client, task["model_id"], task["system_prompt"], task["input"])
    except Exception as e:
        output = f"[error: {e}]"
    return {**{k: v for k, v in task.items() if k != "system_prompt"}, "output": output}


def do_judge(client: Anthropic, t: dict) -> dict:
    if t["output"].startswith("[error:"):
        return {**t, "scores": {"error": "translation_failed"}}
    scores = judge_one(client, t["direction"], t["input"], t["output"])
    return {**t, "scores": scores}


def write_summary(out_dir: Path, scored: list[dict], prompts: dict[str, str]) -> None:
    lines: list[str] = []
    lines.append(f"# Experiment Summary — {datetime.now().isoformat(timespec='seconds')}")
    lines.append("")
    lines.append(f"- models: {', '.join(label for _, label in MODELS)}")
    lines.append(f"- judge: `{JUDGE_MODEL}`")
    lines.append(f"- en_prompt: `{phash(prompts['en_to_linkedin'])}` ({len(prompts['en_to_linkedin'])} chars)")
    lines.append(f"- li_prompt: `{phash(prompts['linkedin_to_en'])}` ({len(prompts['linkedin_to_en'])} chars)")
    lines.append("")

    valid = [r for r in scored if isinstance(r["scores"], dict) and "error" not in r["scores"]]
    errors = [r for r in scored if r not in valid]
    if errors:
        lines.append(f"_{len(errors)} rows with judge/translation errors (dropped from aggregates)._")
        lines.append("")

    # Aggregate table per direction × tag × model
    for direction in DIRECTIONS:
        lines.append(f"## Aggregate scores — {direction}")
        lines.append("")
        sample = next((r for r in valid if r["direction"] == direction), None)
        if sample is None:
            lines.append("_no valid rows_")
            lines.append("")
            continue
        dims = [k for k in sample["scores"].keys() if k != "issues"]
        header = "| model | tag | n | " + " | ".join(dims) + " | mean |"
        sep = "|" + "|".join(["---"] * (4 + len(dims))) + "|"
        lines.append(header)
        lines.append(sep)
        for _, model_label in MODELS:
            for tag in ("curated", "hard"):
                rows = [r for r in valid if r["direction"] == direction and r["model_label"] == model_label and r["tag"] == tag]
                if not rows:
                    continue
                means = {d: sum(r["scores"][d] for r in rows) / len(rows) for d in dims}
                overall = sum(means.values()) / len(means)
                cells = " | ".join(f"{means[d]:.2f}" for d in dims)
                lines.append(f"| {model_label} | {tag} | {len(rows)} | {cells} | **{overall:.2f}** |")
        lines.append("")

    # Side-by-side for hard cases
    lines.append("## Hard cases — side-by-side outputs")
    lines.append("")
    hard_ids = sorted({r["case_id"] for r in scored if r["tag"] == "hard"})
    for cid in hard_ids:
        rows = [r for r in scored if r["case_id"] == cid]
        if not rows:
            continue
        sample = rows[0]
        lines.append(f"### {cid}")
        lines.append("")
        lines.append(f"**Direction:** `{sample['direction']}`")
        lines.append("")
        lines.append("**Input:**")
        lines.append("")
        lines.append("> " + sample["input"].replace("\n", "\n> "))
        lines.append("")
        for _, label in MODELS:
            r = next((x for x in rows if x["model_label"] == label), None)
            if not r:
                continue
            lines.append(f"**{label}:**")
            lines.append("")
            lines.append(r["output"])
            lines.append("")
            s = r["scores"]
            if "error" in s:
                lines.append(f"_scores: ERROR — {s['error']}_")
            else:
                dim_str = " ".join(f"{k}={v}" for k, v in s.items() if k != "issues")
                lines.append(f"_scores: {dim_str} — {s.get('issues', '')}_")
            lines.append("")
        lines.append("---")
        lines.append("")

    (out_dir / "summary.md").write_text("\n".join(lines))


def main() -> None:
    client = Anthropic()
    cases = json.loads(load("cases.json"))
    prompts = {d: load(f"prompt_{'en_to_linkedin' if d=='en_to_linkedin' else 'linkedin_to_en'}.md") for d in DIRECTIONS}

    tasks = build_tasks(cases, prompts)
    total_trans = len(tasks)
    print(f"Translating {total_trans} (model, case) pairs with {MAX_WORKERS} workers...", flush=True)

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        translated = list(ex.map(lambda t: do_translate(client, t), tasks))

    print(f"Judging {len(translated)} outputs...", flush=True)
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        scored = list(ex.map(lambda t: do_judge(client, t), translated))

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_dir = PROJECT / "runs" / f"run_{ts}"
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "results.json").write_text(json.dumps(scored, indent=2))
    write_summary(out_dir, scored, prompts)
    print(f"Wrote {out_dir}/summary.md and results.json")


if __name__ == "__main__":
    main()
