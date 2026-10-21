# Agent Note: Force-directed edge recovery for floating dock panels

Status: implemented

English | [中文](2026-10-21-floating-window-edge-recovery.zh.md)

## Problem

The dock kit's floating panels are the client's floating windows. `FloatLayer` and the retained `DockLayout` renderer draw them in viewport coordinates through one shared gesture hook, `useFloatGestures`, and the right Sidebar embeds them, so the same panels run in the Web client and inside the Desktop window. Their drag followed the pointer one to one with only a top floor (`--dsh-dockkit-float-top`, which keeps the header below the Windows caption). A panel could therefore be dragged past the left, right or bottom edge until its header was out of reach; a viewport that shrank left a panel outside it; and the creation cascade could place a new panel outside a small viewport. The required behavior is that a panel pushed past an edge visibly resists, and on release is pulled back inside with spring physics instead of being stopped by a wall or left outside.

We reverse engineered Claude Desktop 2.42304.2 as a reference, and it has no such behavior. On macOS its Quick Entry surface is a native Swift `NSPanel`; its binary contains animation primitives, but no edge-recovery rule could be established from it. The Electron fallback used on Windows/Linux is static: after a 750 ms input debounce it makes one instantaneous `setPosition` that clamps only the right and bottom edges (trigger margin 0, target margin 30 DIP, so the first correction jumps by overflow + 30) and never clamps left or top. No `spring` symbol exists in its main bundle; its only window-motion utilities are a 240 ms `easeInOutCubic` bounds tween for main-window size changes, Electron's macOS-only `setBounds(bounds, true)`, and a 300 ms `cubic-bezier(0.16, 1, 0.3, 1)` CSS vocabulary. The behavior had to be designed, not ported.

The change keeps these obligations: a panel header is always reachable; one gesture still records at most one history entry; reduced motion is honored; the persisted Sidebar layout format and every embedder stay unchanged; and the motion is deterministic enough to test without a real browser clock.

## Decision

The behavior lives entirely in `packages/client/ui-dockkit`, inside `useFloatGestures` and the pure engine helpers it calls. Both float renderers take their rectangles from that hook through `rectOf`, so Web and Desktop share the behavior, and no embedder, shell or persisted format changed.

### Legal region and displayed position

The legal region of a panel is the viewport (`window.innerWidth` by `window.innerHeight`) with the existing top floor: the Windows caption height plus 20 px when `data-windows-titlebar` is set (20 px in native fullscreen), otherwise 0. `floatBounds` reads only these values and the root's attributes, so starting a gesture forces no layout. `legalFloatRect` projects a rectangle into the region per axis; when a panel is wider or taller than the region it pins the minimum edge, so the header and its grip stay on screen and the excess hangs off the right or bottom.

A panel draws at its stored rectangle projected into the viewport. The stored rectangle is never rewritten for the viewport: a shrinking window pushes the panel in without recording an operation, and a growing window returns it toward its stored position. The hook re-reads the bounds on every window `resize` event. Persisted layouts that hold off-screen rectangles display inside the viewport without migration.

### Drag with resistance

A move computes the desired rectangle from the gesture's start rectangle and the pointer travel, then `resistedRect` splits it per axis into the legal projection and the overflow `o` beyond it and draws it at `legal + sign(o) * K * |o| / (K + |o|)` with `K = FLOAT_RESISTANCE = 120` px. The mapping is continuous, has slope 1 at the edge, and approaches `K`:

| pointer overflow (px) | panel displacement past the edge (px) | share of the overflow |
|---|---|---|
| 10 | 9.2 | 92.3% |
| 40 | 30.0 | 75.0% |
| 120 | 60.0 | 50.0% |
| 400 | 92.3 | 23.1% |

A resize clamps the bottom-right corner to the region through `boundedResize` and keeps `FLOAT_MIN_SIZE`; resizing has no resistance, because a corner that lags the pointer reads as a broken handle.

### Release and spring

A release records the legal rectangle: `moveFloat` or `resizeFloat` when it differs from the stored one, otherwise only the raise a click records. History and persistence therefore always hold a legal position, and undo restores the pre-gesture position in one step. When the panel was drawn outside the legal region, the hook keeps a preview and springs it from where it was drawn to the recorded rectangle, then clears the preview. A release inside the region animates nothing.

The spring in `engine/spring.ts` is underdamped, because its bounce goes inward and is always legal: response 0.32 s and damping ratio 0.72. An overflowing axis starts with the pointer velocity over the last 100 ms of the drag, capped at `SPRING_MAX_VELOCITY` (1500 px/s), so a fling past the edge travels further before it turns back; an axis that did not overflow keeps still. Per axis the update is:

```
a = -omega0^2 * (x - target) - 2 * zeta * omega0 * v
v = v + a * h
x = x + v * h
```

`stepSpring` integrates in equal substeps of at most `h = 1/480 s`, so the motion does not depend on the frame rate. One `requestAnimationFrame` loop in the hook clamps a frame to 64 ms, ends at the target when a frame gap exceeds 250 ms or 900 ms have passed, and otherwise stops when each axis is within 1 px of the target and slower than 60 px/s. From rest, a 200 px overflow settles in 367 ms with an inward overshoot within one percentage point of the analytic bound `exp(-pi * zeta / sqrt(1 - zeta^2)) = 3.8%`; the resistance caps the released overflow at 120 px. The integrator is pure and takes `dt`, so the engine keeps its rule of reading no clock.

A press on the grip or the corner during a return cancels it. A move picks the panel up where it is drawn: `unresistedRect` inverts the resistance, so zero pointer travel draws the same rectangle, and a release in place resumes the return without recording a second operation. One hook runs at most one return; a window resize ends a running return at its recorded rectangle, and unmounting cancels the pending frame.

### Reduced motion

When `matchMedia('(prefers-reduced-motion: reduce)')` matches, a move clamps to the legal region with no resistance, and release records the legal rectangle with no animation. Environments without `matchMedia` report no preference. The rule only removes motion; it never removes the legality correction.

### Change scope

The change touches one package, `@deepseek-ai/dsh-client-ui-dockkit`, and leaves its exports and `DockIntents` unchanged.

| File | Change |
|---|---|
| `packages/client/ui-dockkit/src/engine/geometry.ts` | `FloatBounds`, `FLOAT_RESISTANCE`, `legalFloatRect`, `resistedRect`, `unresistedRect`, `boundedResize` |
| `packages/client/ui-dockkit/src/engine/spring.ts` | the pure spring integrator, its rest test and its timing limits |
| `packages/client/ui-dockkit/src/components/FloatLayer.tsx` | `useFloatGestures`: viewport projection, resistance, release spring, velocity sampling, reduced motion, frame loop and cancellation; `rectOf` for both renderers |
| `packages/client/ui-dockkit/src/components/TabLayout.tsx` | draws the hook's displayed rectangle |
| `packages/client/ui-dockkit/README.md` pair | the edge rule beside the float renderer description |

`ui-sidebar-right` and its persisted layout schema, `apps/web`, `apps/desktop`, the shared primitives and the theme are untouched. No dependency was added.

## Testing

`tests/float-bounds.client.spec.ts` covers the projection (inside, each edge, corner, the top floor, an oversized panel), the resistance (the table values, slope 1 at the edge, monotone growth bounded by `K`, independent axes), its inverse and its cap, and the bounded resize. `tests/spring.client.spec.ts` covers settling inside the deadline, the overshoot bound, frame-rate independence at 30, 60 and 120 Hz, the effect of release velocity, and determinism.

`tests/float-recovery.client.spec.tsx` renders `FloatLayer` over a live controller with hand-driven frames and clock: the resisted preview past an edge, exactly one legal `moveFloat` per release and the spring to it with an inward overshoot, undo in one step, fling against slow push, no animation for a release inside, a push that ends at the stored position, a press mid-return picking the panel up without a jump, the stall snap, the deadline, unmount cancellation, both reduced-motion answers, the viewport projection on shrink and growth without any intent, a resize ending a return, and an off-screen stored rectangle drawn inside. The existing `FloatLayer` and `TabLayout` specs still pass unchanged, including the rule that starting a gesture forces no layout read; every changed source file is fully covered.

## Alternatives considered

**Hard clamp at the edge.** Stopping the panel at the viewport edge is the cheapest correct rule, but it feels like hitting a wall and gives no sense of the boundary before contact. It remains as the reduced-motion path.

**Clamp during the drag and rebound on release.** Clamping the drag at the edge and converting the outward pointer speed into an inward bounce keeps every frame inside the viewport. It hides how far the user pushed, so the bounce has no visible cause; the resistance shows the push and still bounds the overflow at 120 px.

**Eased tween on release.** A fixed 240-300 ms ease-out from the released position is predictable, but it carries no velocity, so a fling and a slow push return identically, and a press during it either jumps or restarts. The spring keeps velocity continuous and is interruptible.

**Store the off-screen position and correct it later.** Recording the released rectangle and fixing it on the next render would persist off-screen positions and make undo restore them. Recording the legal rectangle keeps one history entry per gesture with a legal value.

**Rewrite stored rectangles when the viewport shrinks.** Moving panels through operations on resize would add history entries the user never made and change persisted layouts on every window resize. Projecting at render achieves the visible result without either, at the cost of the elastic return described below.

**Native always-on-top OS window.** A real Electron floating window could float above other applications, but only on Desktop; the Web client cannot do it at all, and native frameless dragging gives no per-frame control, so the resistance would be impossible and the spring could only start after release. It is a separate product decision with its own window, IPC and platform work, and this decision does not preclude it.

**Animation library dependency.** A spring library would replace a pure integrator of a few dozen lines and its tests with a new dependency in a statically linked package. The integrator also has to be clock-free for the engine's deterministic tests.

**A shared primitive in `ui-primitives`.** Placing the hook in the primitives package would widen the change to a second package with no second consumer. It can move there when another floating surface needs it.

## Consequences

Floating panels can no longer be lost off screen, in either client, and a push past an edge reads as a pull back rather than a wall. History, persistence and every embedder are unaffected, and the motion is covered by deterministic tests instead of manual checks.

The spring updates the preview through React state, which costs the same per frame as a drag, but a panel hosting heavy content re-renders for up to 900 ms after release; writing a transform on the panel element directly is the fallback if that measures as a problem. A panel pushed in by a shrinking window returns toward its stored position when the window grows, which a user who expects it to stay where it was pushed may find surprising. Content inside a panel, such as a webview, can observe up to 900 ms of motion after release. The constants are tuned for a mouse or trackpad; touch input works through the same pointer events but remains untuned.
