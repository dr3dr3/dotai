#!/usr/bin/env python3
"""Generate Pi's "ollama" model list from the host Ollama's live API.

Runs inside the devcontainer against the host Mac's Ollama (OrbStack forwards
host.docker.internal to the host loopback — do not rebind Ollama to 0.0.0.0).
The host-side wrapper is just ``docker exec <container> python3 <this file>``,
so there is exactly one implementation to keep correct.

Why generated: a hand-written tag list is stale the moment a model is pulled or
removed on the host — that was the bug this replaces. Re-run after any pull/rm.

Per model, ``/api/show`` gives ``capabilities`` (``completion`` required,
``thinking`` → reasoning, ``vision`` → image input) and ``model_info``. The
``contextWindow`` written is the SERVED size, not the architecture maximum:
Ollama's /v1 endpoint ignores num_ctx, so the effective window is whatever the
server decides (OLLAMA_CONTEXT_LENGTH, Modelfile num_ctx, or its version's
default). Pi compacts against contextWindow, and overstating it makes Ollama
silently drop the front of the prompt — system prompt and tool schemas first —
mid agent loop. So by default the script MEASURES it: an empty-prompt
``/api/generate`` loads the model (~12s for a 27B on this host) and ``/api/ps``
then reports the real ``context_length``. ``--no-probe`` skips the load and
falls back to Modelfile num_ctx → PI_OLLAMA_CONTEXT_LENGTH → a loud warning.
(Measured 2026-09-14: Ollama 0.33.3 served 262144 for qwen3.8:27b-mtp-q4_K_M,
the model's maximum — an older Ollama would have served 4096 for the same tag.)

Measured on this host (do not "improve" without re-measuring): reasoning_effort
works and "none" yields zero reasoning tokens; chat_template_kwargs is ignored,
so thinkingFormat "qwen-chat-template" must NOT be used even for Qwen tags.
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from setup_pi_common import load_json, write_json_atomic  # noqa: E402

DEFAULT_URL = "http://host.docker.internal:11434"
DEFAULT_MAX_TOKENS = 16384
OLLAMA_DEFAULT_NUM_CTX = 4096
THINKING_LEVEL_MAP = {
    "off": "none", "minimal": None, "low": "low",
    "medium": "medium", "high": "high", "xhigh": "xhigh", "max": "max",
}


def log(message):
    print(message, flush=True)


def ollama_url(env=os.environ):
    url = env.get("PI_OLLAMA_URL") or env.get("OLLAMA_HOST") or DEFAULT_URL
    if not url.startswith("http"):
        url = f"http://{url}"
    return url.rstrip("/")


def request(base, path, payload=None, timeout=30):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(base + path, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return json.loads(response.read().decode())


def loaded_contexts(base):
    return {m.get("name") or m.get("model"): m.get("context_length")
            for m in (request(base, "/api/ps").get("models") or [])}


def probe_context(base, tag):
    """Load the model (no tokens generated) so /api/ps reports its served context."""
    request(base, "/api/generate", {"model": tag, "prompt": "", "keep_alive": "5m"}, timeout=600)
    return loaded_contexts(base).get(tag)


def served_context(show, loaded, env, warnings, tag, arch_max, probe=None):
    """Best evidence for the context Ollama will actually serve: measured first."""
    if loaded.get(tag):
        return int(loaded[tag]), "/api/ps (measured)"
    if probe is not None:
        measured = probe(tag)
        if measured:
            return int(measured), "/api/ps (measured after load)"
    for line in (show.get("parameters") or "").splitlines():
        parts = line.split()
        if len(parts) >= 2 and parts[0] == "num_ctx":
            return int(parts[1]), "Modelfile num_ctx"
    if env.get("PI_OLLAMA_CONTEXT_LENGTH"):
        return int(env["PI_OLLAMA_CONTEXT_LENGTH"]), "PI_OLLAMA_CONTEXT_LENGTH"
    warnings.append(
        f"{tag}: served context unknown (not measurable, no Modelfile num_ctx, PI_OLLAMA_CONTEXT_LENGTH unset); "
        f"assuming {OLLAMA_DEFAULT_NUM_CTX}. Model max is {arch_max}. Re-run without --no-probe, "
        f"or set OLLAMA_CONTEXT_LENGTH on the host and pass it as PI_OLLAMA_CONTEXT_LENGTH here."
    )
    return OLLAMA_DEFAULT_NUM_CTX, "assumed"


def build_model(tag, show, loaded, env, warnings, max_tokens, probe=None):
    capabilities = set(show.get("capabilities") or [])
    if "completion" not in capabilities:
        return None
    info = show.get("model_info") or {}
    arch_max = next((int(v) for k, v in info.items() if k.endswith(".context_length")), None)
    served, source = served_context(show, loaded, env, warnings, tag, arch_max, probe)
    context = min(served, arch_max) if arch_max else served
    details = show.get("details") or {}
    descriptor = " ".join(x for x in (details.get("parameter_size"), details.get("quantization_level")) if x)
    model = {
        "id": tag,
        "name": f"{tag.split(':')[0]} (local Ollama, {descriptor})" if descriptor else f"{tag} (local Ollama)",
        "reasoning": "thinking" in capabilities,
        "input": ["text", "image"] if "vision" in capabilities else ["text"],
        "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0},
        "contextWindow": context,
        "maxTokens": min(max_tokens, context),
        "compat": {"supportsDeveloperRole": False, "supportsReasoningEffort": "thinking" in capabilities},
    }
    if model["reasoning"]:
        # Model-level field, a sibling of compat — inside compat it is silently inert.
        model["thinkingLevelMap"] = dict(THINKING_LEVEL_MAP)
    return model, source


def generate(base, env, max_tokens, probe=True):
    try:
        version = request(base, "/api/version")
    except (urllib.error.URLError, OSError) as error:
        raise SystemExit(f"✖ Ollama not reachable at {base} ({error}). Is it running on the host? Not working around it.")
    tags = request(base, "/api/tags").get("models") or []
    loaded = loaded_contexts(base)
    prober = (lambda tag: probe_context(base, tag)) if probe else None
    warnings, models, rows = [], [], []
    for entry in sorted(tags, key=lambda m: m.get("name", "")):
        tag = entry["name"]
        show = request(base, "/api/show", {"model": tag})
        built = build_model(tag, show, loaded, env, warnings, max_tokens, prober)
        if built is None:
            rows.append((tag, "skipped: no completion capability", ""))
            continue
        model, source = built
        models.append(model)
        rows.append((tag, f"ctx {model['contextWindow']} ({source})",
                     f"thinking={'yes' if model['reasoning'] else 'no'} images={'yes' if 'image' in model['input'] else 'no'}"))
    return version.get("version", "?"), models, rows, warnings


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--models-json", type=Path,
                        default=Path(os.environ.get("PI_CODING_AGENT_DIR", Path.home() / ".pi" / "agent")) / "models.json")
    parser.add_argument("--url", default=ollama_url())
    parser.add_argument("--max-tokens", type=int, default=int(os.environ.get("PI_OLLAMA_MAX_TOKENS", DEFAULT_MAX_TOKENS)))
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--no-probe", action="store_true",
                        help="don't load models to measure served context (falls back to Modelfile/env/assumed)")
    args = parser.parse_args()

    version, models, rows, warnings = generate(args.url, os.environ, args.max_tokens, probe=not args.no_probe)
    log(f"Ollama {version} at {args.url}: {len(models)} usable model(s)")
    for tag, ctx, flags in rows:
        log(f"  {tag:32} {ctx:40} {flags}")
    for warning in warnings:
        log(f"⚠ {warning}")

    path = args.models_json
    if path.exists():
        try:
            live = load_json(path, allow_comments=True)
        except ValueError as error:
            raise SystemExit(f"✖ {path} is not valid JSON ({error}); refusing to overwrite it")
    else:
        live = {"providers": {}}
    providers = dict(live.get("providers", {}))
    ollama = dict(providers.get("ollama", {}))
    ollama.setdefault("baseUrl", f"{args.url}/v1")
    ollama.setdefault("api", "openai-completions")
    ollama.setdefault("apiKey", "ollama")
    ollama["models"] = models
    providers["ollama"] = ollama
    updated = dict(live)
    updated["providers"] = providers

    if path.exists() and updated == live:
        log(f"✓ {path} already up to date")
        return
    if args.dry_run:
        log(f"(dry run) would update {path}")
        return
    if path.exists():
        backup = path.with_name(f"{path.name}.bak.{time.strftime('%Y%m%d-%H%M%S')}")
        backup.write_bytes(path.read_bytes())
        log(f"  backup: {backup}")
    write_json_atomic(path, updated)
    log(f"✓ Wrote ollama provider ({len(models)} models) to {path}")


if __name__ == "__main__":
    main()
