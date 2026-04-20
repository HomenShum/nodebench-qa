"""Tool-first chain runner — bounded tool loop, single reasoning tier."""

from __future__ import annotations

import argparse
import json
import os
import time
import urllib.request

from prompts import SYSTEM_PROMPT
from schemas import ChainInput, ChainOutput
from tools import GEMINI_TOOLS, dispatch

MODEL = "gemini-3.1-flash-lite-preview"
MAX_TURNS = 4   # bounded tool loop
FLASH_LITE_IN = 0.10 / 1_000_000
FLASH_LITE_OUT = 0.40 / 1_000_000


def _gemini_key() -> str:
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        raise RuntimeError("Set GEMINI_API_KEY")
    return key


def _post(url: str, body: dict) -> dict:
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def run(inp: ChainInput) -> ChainOutput:
    key = _gemini_key()
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/"
        f"models/{MODEL}:generateContent?key={key}"
    )
    # Initial user turn
    contents = [
        {"role": "user", "parts": [{"text": inp.query}]},
    ]
    in_tok = out_tok = 0
    tool_calls_log: list = []
    final_text = ""

    for turn in range(MAX_TURNS):
        body = {
            "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
            "contents": contents,
            "tools": GEMINI_TOOLS,
            "generationConfig": {"temperature": 0.2, "maxOutputTokens": 2048},
        }
        resp = _post(url, body)
        usage = resp.get("usageMetadata", {})
        in_tok += int(usage.get("promptTokenCount", 0))
        out_tok += int(usage.get("candidatesTokenCount", 0))
        cands = resp.get("candidates", [])
        if not cands:
            break
        parts = (cands[0].get("content") or {}).get("parts", [])
        fn_calls = [p.get("functionCall") for p in parts if p.get("functionCall")]
        text_parts = [p.get("text", "") for p in parts if p.get("text")]
        if fn_calls:
            contents.append({"role": "model", "parts": parts})
            for fc in fn_calls:
                name = fc.get("name", "")
                args = fc.get("args", {}) or {}
                result = dispatch(name, args)
                tool_calls_log.append({"tool": name, "args": args, "result": result})
                contents.append(
                    {
                        "role": "user",
                        "parts": [
                            {"functionResponse": {"name": name, "response": {"result": result}}}
                        ],
                    }
                )
            continue  # another turn with tool results
        if text_parts:
            final_text = "".join(text_parts)
            break
        break

    cost = in_tok * FLASH_LITE_IN + out_tok * FLASH_LITE_OUT
    return ChainOutput(
        answer=final_text,
        tool_calls=tool_calls_log,
        input_tokens=in_tok,
        output_tokens=out_tok,
        cost_usd=cost,
        turns=min(turn + 1, MAX_TURNS),
    )


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--query", required=True)
    args = p.parse_args()
    out = run(ChainInput(query=args.query))
    print(out.answer)
    print(
        f"\n[cost ${out.cost_usd:.6f} "
        f"tokens={out.input_tokens + out.output_tokens} "
        f"turns={out.turns} tools={len(out.tool_calls)}]"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
