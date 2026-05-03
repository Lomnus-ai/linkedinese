#!/usr/bin/env python3
"""linkedin-speak — translate between plain English and LinkedIn Speak.

Usage:
    linkedin_speak.py "I got fired"                    # EN → LinkedIn Speak (default)
    linkedin_speak.py --plain "I'm humbled to announce..."  # LinkedIn → plain English
    echo "I got fired" | linkedin_speak.py             # reads stdin when no text arg
    cat post.txt | linkedin_speak.py --plain
"""

import argparse
import sys
from pathlib import Path

from anthropic import Anthropic
from dotenv import load_dotenv

PROJECT = Path(__file__).resolve().parent
load_dotenv(PROJECT / ".env")

DEFAULT_MODEL = "claude-sonnet-4-6"


def translate(client: Anthropic, system_prompt: str, text: str, model: str) -> str:
    resp = client.messages.create(
        model=model,
        max_tokens=1024,
        system=[{
            "type": "text",
            "text": system_prompt,
            "cache_control": {"type": "ephemeral"},
        }],
        messages=[{"role": "user", "content": text}],
    )
    return resp.content[0].text.strip()


def main() -> int:
    parser = argparse.ArgumentParser(
        prog="linkedin-speak",
        description="Translate between plain English and LinkedIn Speak.",
    )
    parser.add_argument(
        "text",
        nargs="?",
        help="Text to translate. If omitted, reads from stdin.",
    )
    parser.add_argument(
        "-p", "--plain",
        action="store_true",
        help="Reverse direction: LinkedIn Speak → plain English.",
    )
    parser.add_argument(
        "--model",
        default=DEFAULT_MODEL,
        help=f"Anthropic model id (default: {DEFAULT_MODEL}).",
    )
    args = parser.parse_args()

    if args.text:
        text = args.text
    elif not sys.stdin.isatty():
        text = sys.stdin.read()
    else:
        parser.print_help(sys.stderr)
        return 2

    text = text.strip()
    if not text:
        print("error: empty input", file=sys.stderr)
        return 2

    prompt_file = "prompt_linkedin_to_en.md" if args.plain else "prompt_en_to_linkedin.md"
    system_prompt = (PROJECT / prompt_file).read_text()

    client = Anthropic()
    output = translate(client, system_prompt, text, args.model)
    print(output)
    return 0


if __name__ == "__main__":
    sys.exit(main())
