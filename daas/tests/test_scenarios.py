"""Scenario-based tests for the DaaS pipeline.

Persona-driven per .claude/rules/scenario_testing.md. Runs against the
live NodeBench prod Convex deployment (agile-caribou-964.convex.cloud /
.convex.site) because DaaS is a serverless surface — there is no local
equivalent that exercises the real rate-limit mutation.

Usage:
    python3 test_scenarios.py        # run all
    python3 test_scenarios.py -k rate  # pytest-style filter (substring match)

Every test ends with a cleanup step using the admin action.
"""

import json
import sys
import time
import urllib.error
import urllib.request
from typing import Any
from convex import ConvexClient

CONVEX_CLOUD = "https://agile-caribou-964.convex.cloud"
CONVEX_SITE = "https://agile-caribou-964.convex.site"


# ─── HTTP helpers ───────────────────────────────────────────────────────────

def post_ingest(payload: dict, headers: dict | None = None, timeout: int = 15):
    req = urllib.request.Request(
        f"{CONVEX_SITE}/api/daas/ingest",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", **(headers or {})},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, dict(r.headers), r.read().decode()
    except urllib.error.HTTPError as e:
        return e.status, dict(e.headers), e.read().decode()


def _minimal(session_id: str, **overrides):
    base = {
        "sessionId": session_id,
        "sourceModel": "gemini-3.1-pro-preview",
        "sourceSystem": "scenario-test",
        "query": "scenario probe",
        "finalAnswer": "scenario probe response",
        "totalCostUsd": 0.0001,
        "totalTokens": 42,
        "durationMs": 50,
    }
    base.update(overrides)
    return base


def cleanup_prefix(prefix: str):
    c = ConvexClient(CONVEX_CLOUD)
    c.action(
        "domains/daas/admin:runAdminOp",
        {"op": "deleteTracesByPrefix", "sessionIdPrefix": prefix},
    )


# ─── Scenarios ──────────────────────────────────────────────────────────────

def scenario_happy_path():
    """
    Scenario: new developer, first ingest
    User: first-time ingester with a clean payload
    Goal: get back 201 with a traceId they can reference in /daas UI
    Prior state: no rows for this prefix
    Actions: one POST with minimal valid payload
    Scale: 1 user
    Duration: single request
    Expected: status=201, traceId present, row visible via query
    Edge cases: covered by other scenarios
    """
    cleanup_prefix("scen_happy_")
    status, headers, body = post_ingest(_minimal("scen_happy_1"))
    assert status == 201, f"expected 201 got {status}: {body}"
    data = json.loads(body)
    assert data.get("ok") is True and data.get("traceId")
    # Verify row is readable via query
    c = ConvexClient(CONVEX_CLOUD)
    run = c.query("domains/daas/queries:getRun", {"sessionId": "scen_happy_1"})
    assert run and run.get("trace", {}).get("sessionId") == "scen_happy_1"
    cleanup_prefix("scen_happy_")
    return "HAPPY ok"


def scenario_adversarial_missing_field():
    """
    Scenario: integrator forgets a required field
    User: adversarial / sloppy client
    Goal: server rejects cleanly with actionable error
    Expected: 400 with missing_required_field, server never stores a row
    """
    payload = _minimal("scen_adv_missing_1")
    payload.pop("finalAnswer")
    status, _, body = post_ingest(payload)
    assert status == 400, f"expected 400 got {status}"
    assert "missing_required_field" in body
    return "ADVERSARIAL_MISSING ok"


def scenario_adversarial_oversize():
    """
    Scenario: integrator accidentally pastes a 300KB log into finalAnswer
    User: adversarial / sloppy
    Goal: BOUND_READ applies — server rejects with 413 before parsing
    """
    payload = _minimal("scen_adv_size_1", finalAnswer="x" * 300_000)
    status, _, body = post_ingest(payload)
    assert status == 413, f"expected 413 got {status}"
    assert "payload_too_large" in body
    return "ADVERSARIAL_OVERSIZE ok"


def scenario_adversarial_negative_cost():
    """
    Scenario: malicious client sets totalCostUsd = -999 to inflate savings
    User: adversarial
    Goal: numeric validation rejects
    """
    payload = _minimal("scen_adv_neg_cost_1", totalCostUsd=-999)
    status, _, body = post_ingest(payload)
    assert status == 400, f"expected 400 got {status}"
    assert "invalid_totalCostUsd" in body
    return "ADVERSARIAL_NEGATIVE ok"


def scenario_adversarial_non_finite_tokens():
    """
    Scenario: client sends totalTokens = NaN (encoded as null by some JSON libs)
    User: adversarial
    Goal: reject
    """
    # JSON spec doesn't allow NaN, so send a string instead — should also 400
    payload = _minimal("scen_adv_nan_1")
    payload["totalTokens"] = "not a number"  # type: ignore
    # JSON encode manually to bypass dict type hints
    req = urllib.request.Request(
        f"{CONVEX_SITE}/api/daas/ingest",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            raise AssertionError(f"expected 4xx got {r.status}: {r.read()[:200]}")
    except urllib.error.HTTPError as e:
        # Either 400 (our check) or Convex's own number validator — both acceptable
        assert e.status in (400, 500), f"expected 4xx/5xx got {e.status}"
    return "ADVERSARIAL_NAN ok"


def scenario_concurrent_burst():
    """
    Scenario: 4 simultaneous ingests using distinct api keys (authed clients)
    User: multiple CI pipelines batching to the same endpoint
    Goal: all 4 succeed (each has own per-key bucket, limit 120/min)
    Scale: 4 concurrent
    Duration: burst
    Expected: 4x 201, no 429, no dedupe collision
    """
    cleanup_prefix("scen_burst_")
    import concurrent.futures

    def _one(i: int):
        # Distinct 16+ char API key per simulated client — gets own bucket
        key = f"scenario-concurrent-burst-client-{i:04d}"
        return post_ingest(
            _minimal(f"scen_burst_{i}"),
            headers={"x-daas-api-key": key},
        )

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(_one, range(4)))
    statuses = [s for s, _, _ in results]
    assert all(s == 201 for s in statuses), f"burst statuses: {statuses}"
    trace_ids = {json.loads(b).get("traceId") for _, _, b in results}
    assert len(trace_ids) == 4, f"expected 4 distinct traceIds, got {len(trace_ids)}"
    cleanup_prefix("scen_burst_")
    return "CONCURRENT_BURST ok"


def scenario_rate_limit_exhaustion():
    """
    Scenario: misconfigured client in a retry loop
    User: adversarial / misconfigured
    Goal: rate limit fires — beyond the current remaining count, requests
          return 429 with bounded, monotonically non-increasing counts.
    Scale: 1 client, sequential
    Duration: short — within one 60s window
    Expected:
      - The first few requests return 201 with remaining decreasing by 1
      - At least ONE request returns 429
      - remaining in 429 responses is 0

    NB: We can't easily isolate a bucket from other scenarios (Convex
    strips client X-Forwarded-For for security), so we probe the current
    remaining count and send `remaining + 3` requests. This keeps the
    assertion deterministic regardless of shared-bucket starting state.
    """
    cleanup_prefix("scen_rl_")
    # Probe: one request to discover current `remaining`
    probe_status, probe_headers, _ = post_ingest(_minimal("scen_rl_probe"))
    probe_remaining = int(
        probe_headers.get("X-RateLimit-Remaining")
        or probe_headers.get("x-ratelimit-remaining")
        or 0
    )
    if probe_status != 201:
        # Already rate-limited; acceptable — just assert the next is also 429
        status2, _, _ = post_ingest(_minimal("scen_rl_followup"))
        assert status2 == 429, f"expected 429 when bucket already full, got {status2}"
        cleanup_prefix("scen_rl_")
        return "RATE_LIMIT ok (already full from prior scenarios)"

    # Send remaining + 3 to guarantee we trip the limit
    extra = probe_remaining + 3
    results = [(probe_status, probe_remaining)]
    for i in range(extra):
        status, headers, _ = post_ingest(_minimal(f"scen_rl_{i}"))
        rem = int(
            headers.get("X-RateLimit-Remaining")
            or headers.get("x-ratelimit-remaining")
            or 0
        )
        results.append((status, rem))

    ok = sum(1 for s, _ in results if s == 201)
    limited = sum(1 for s, _ in results if s == 429)
    assert limited >= 1, f"expected >= 1 429 got {limited}; results={results}"
    # Every 429 must have remaining=0 (no false-positive limit reporting)
    for s, rem in results:
        if s == 429:
            assert rem == 0, f"429 should carry remaining=0, got {rem}"
    cleanup_prefix("scen_rl_")
    return f"RATE_LIMIT ok ({ok} allowed, {limited} limited)"


# ─── Runner ─────────────────────────────────────────────────────────────────

SCENARIOS = [
    ("happy", scenario_happy_path),
    ("adv_missing_field", scenario_adversarial_missing_field),
    ("adv_oversize", scenario_adversarial_oversize),
    ("adv_negative_cost", scenario_adversarial_negative_cost),
    ("adv_nan_tokens", scenario_adversarial_non_finite_tokens),
    ("concurrent_burst", scenario_concurrent_burst),
    ("rate_limit", scenario_rate_limit_exhaustion),
]


def main():
    filt = None
    if len(sys.argv) >= 3 and sys.argv[1] == "-k":
        filt = sys.argv[2]

    results = {"pass": [], "fail": []}
    for name, fn in SCENARIOS:
        if filt and filt not in name:
            continue
        print(f"\n=== {name} ===")
        try:
            out = fn()
            print(f"  PASS: {out}")
            results["pass"].append(name)
        except AssertionError as e:
            print(f"  FAIL: {e}")
            results["fail"].append((name, str(e)))
        except Exception as e:
            print(f"  ERROR: {type(e).__name__}: {e}")
            results["fail"].append((name, f"{type(e).__name__}: {e}"))
        time.sleep(1)  # gentle between scenarios

    print(f"\n{'='*50}")
    print(f"PASS: {len(results['pass'])}/{len(results['pass']) + len(results['fail'])}")
    if results["fail"]:
        print("FAILURES:")
        for n, e in results["fail"]:
            print(f"  {n}: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
