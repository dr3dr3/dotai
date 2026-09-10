---
name: draw-diagram
description: Draw a diagram as an editable Excalidraw file from a description — architecture, sequence of calls, data flow, state machine, org/process map. Use when André says "draw me a diagram of X", "diagram this", "sketch the architecture", "can you visualise this flow", "make me an Excalidraw of the tenant resolution path", "I need a picture of this for the ADR / for Mark / for the team", or asks to change a diagram made earlier. Produces a .excalidraw file he opens and hand-tweaks in VS Code or Excalidraw+. NOT for a Mermaid block inline in a doc or PR (write Mermaid directly), and NOT for UI mockups (that is the impeccable / design skills).
---

# Draw Diagram

Turns a description into an **editable Excalidraw file** that is laid out properly
before he ever opens it. The output is a starting point he can drag around — not a
finished picture he has to accept.

The tool is on PATH as `diagram` (personal, not in any RoE repo — `diagram home` prints
where it is installed). ⚠️ **`diagram: command not found` after a devcontainer rebuild is
expected, not broken** — the launcher lives in `~/.local/bin`, which a rebuild wipes, and
nothing re-runs the installer. Fix it with
`bash /workspace/dotfiles/tools/diagram/install.sh`. You write a
small YAML spec; ELK does the layout; the generator emits native Excalidraw elements
with real arrow bindings and grouping, so dragging a box drags its label and reroutes
its arrows.

## The loop

1. **Agree what the diagram is FOR** before drawing it. One sentence: who reads it,
   and what should they be able to say after ten seconds? A diagram that shows
   "everything" shows nothing. If he has not said, infer it and state your assumption
   in one line — do not interrogate him.
2. **Write the spec** to `/workspace/tmp/diagrams/<name>.yaml`.
3. **Build it:** `diagram /workspace/tmp/diagrams/<name>.yaml`
   The geometry check runs automatically and exits non-zero on a layout problem.
   **Never hand over a file that failed the check.**
4. **Look at it yourself** before showing him (see *Seeing your own output*). Fix what
   reads badly. This is the step that separates a usable diagram from valid JSON.
5. **Hand it over** with the path, and tell him how to open it.
6. **Iterate on the YAML**, never on the JSON. If he has hand-edited the file, ask
   before regenerating — a rebuild overwrites his tweaks.

## Spec reference

```yaml
title: Request-time tenant resolution        # optional, drawn top-left
subtitle: How a portal request reaches the right tenant DB
theme: light                                  # light | roe (gold on near-black)
direction: RIGHT                              # RIGHT | DOWN | LEFT | UP
routing: ORTHOGONAL                           # ORTHOGONAL | POLYLINE | SPLINES
roughness: 1                                  # 0 = ruled, 1 = hand-drawn, 2 = sketchy
spacing: { node: 56, layer: 96 }

groups:                                       # optional subsystem containers
  - id: backends
    label: Backends

nodes:
  - id: api                                   # referenced by edges
    label: rock-of-eye-api                    # wraps automatically
    sub: Laravel 10 · 28 modules              # optional smaller second line
    style: service                            # see styles below
    shape: rect                               # rect | sharp | ellipse | diamond
    group: backends                           # optional, must match a group id
    link: https://…                           # optional, clickable in Excalidraw

edges:
  - from: aio
    to: api
    label: Bearer + X-ROE-SSO-KEY
    style: solid                              # solid | dashed | dotted
    arrow: end                                # end | both | none
    emphasis: true                            # thicker line for the main path
```

**Styles:** `neutral` `frontend` `service` `datastore` `external` `actor` `danger`
`accent`. They map onto Excalidraw's own colour picker values, so anything you draw
can be re-picked by hand without hunting for a hex.

## Making it read well

The layout engine handles geometry. These are the judgement calls it cannot make:

- **Cap it at about a dozen nodes.** Past that, split into two diagrams or collapse a
  subsystem into one box. Completeness is not the goal; the ten-second read is.
- **Label edges with the contract, not the verb.** `Bearer + X-ROE-SSO-KEY` earns its
  space; `sends request` does not. Drop labels that only restate the arrow.
- **Model a round trip as one bidirectional edge**, not two opposing ones. A back-edge
  forces the layout to sweep a long arc around the whole diagram — the single ugliest
  thing this tool produces, and always avoidable in the spec.
- **`emphasis: true` on the happy path only.** If everything is emphasised, nothing is.
- **`direction: RIGHT`** for request/call flows, **`DOWN`** for hierarchies and state
  machines. If a RIGHT diagram comes out very wide, try DOWN before fiddling with spacing.
- **`sub:` is for the answer to "what IS that box"** — runtime, layer, count. Not for
  a second sentence of prose.
- **Use `theme: roe`** when it is going in front of Mark or into anything brand-facing;
  `light` for engineering docs and ADRs. RoE brand is gold `#AC9250` on near-black.
- **Domain language applies here too** — Client, Clothier, Tailor, Tenant, Labour Form.
  A diagram gets screenshotted into places the code never reaches.

## Seeing your own output

Do not hand over a diagram you have not looked at. Excalidraw renders it, so you are
checking the real thing rather than your own idea of it:

```bash
cd "$(diagram home)" && npm run build:render          # one-off, ~2 min
PORT=8765   # pick a free one; a preview server outlives the session that started it
diagram preview /workspace/tmp/diagrams/<name>.excalidraw --port $PORT &
agent-browser open http://localhost:$PORT/ && agent-browser wait 5000
agent-browser eval "String(window.__READY__)"          # must be "true"
agent-browser screenshot /workspace/tmp/diagrams/<name>.png
```

**Use the port you actually started.** Opening a hard-coded port that something else is
already serving attaches you to *the previous diagram* — you then review the wrong picture
and report on it confidently. `diagram preview` refuses a port already in use and tells you
so; the trap is only in the browser step.

Then read the screenshot. Look for: labels sitting on lines, a long arc sweeping the
diagram, boxes whose text spills the stroke, anything you cannot follow in ten seconds.
`window.__READY__ === "error"` means the scene is malformed — read `#err` for the reason.

If the preview bundle is not built, say so and hand over the file rather than silently
skipping the look — but expect to be wrong about how it reads.

## Handing it over

Give him the path and the opening instructions:

> `/workspace/tmp/diagrams/<name>.excalidraw` — open it in VS Code (the Excalidraw
> extension renders it as a canvas), or drag it into Excalidraw+ to keep it in your
> workspace.

The VS Code extension is `pomdtr.excalidraw-editor` and must be installed on the **local**
VS Code — it is a UI extension and cannot be installed from inside the devcontainer. If he
says the file opens as JSON, that is why.

`/workspace/tmp/` is gitignored, which is the default on purpose. **Committing a diagram
is a deliberate act** — if it belongs to an ADR or a guide, ask where it should live in
the relevant repo, and commit the `.yaml` next to the `.excalidraw` so it stays
regenerable.

## When not to use this

- **A diagram that will be published, presented, or put in a training video** →
  use **archify** (`tt-a1i/archify`) instead. It renders a self-contained interactive
  HTML page with guided views, a legend, Present mode and PNG/WebM export — a finished
  artifact rather than a canvas to tweak. The trade is that archify has **no layout
  engine**: you place every component, and its validator then judges you hard (edge
  crossings, label clearance, a 6px projected-font legibility floor). This tool is the
  opposite — layout is solved, rendering is plain.
  Published diagrams live in `roe-eng-dashboard:diagrams/<slug>.architecture.json`
  plus the delivered `.html`, served at `https://eng.rockofeye.net/diagrams/<slug>`.
  ⚠️ They must be served by a **route**, never from `site/public/`, which bypasses the
  auth middleware entirely — see `diagrams/README.md` in that repo.
- **A diagram inside a Markdown doc, PR, or Linear ticket** → write a Mermaid block.
  It renders in place and needs no file. This tool is for a file he will open and edit.
- **A UI mockup or screen design** → that is the `impeccable` / `design` skills.
- **"Where is X defined / what calls Y"** → Graphify (`make codegraph-explain`) answers
  it directly. Draw a diagram only if he wants a picture of the answer.

## Getting the facts right

Read the source, not the docs — ports from `docker-compose.yml`, commands from what a
developer is actually told to type. ⚠️ For local-dev-env that is **`roe`, not `make`**:
every make target still works, so `make` in a diagram is never *wrong* and nothing
corrects it. A diagram shipped saying `make up · make fresh · make doctor` and needed a
follow-up PR.
