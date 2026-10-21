# Agent Note: Force-directed edge recovery for floating dock panels

Status: proposed

English | [中文](2026-10-21-floating-window-edge-recovery.zh.md)

## Problem

The dock kit's floating panels are the client's floating windows. `FloatLayer` and the retained `DockLayout` renderer draw them in viewport coordinates through one shared gesture hook, `useFloatGestures`, and the right Sidebar embeds them, so the same panels run in the Web client and inside the Desktop window. Their drag follows the pointer one to one with only a top floor (`--dsh-dockkit-float-top`, which keeps the header below the Windows caption). A panel can therefore be dragged past the left, right or bottom edge until its header is out of reach; a viewport that shrinks leaves a panel outside it; and the creation cascade can place a new panel outside a small viewport. The required behavior is that a panel pushed past an edge visibly resists, and on release is pulled back inside with spring physics instead of being stopped by a wall or left outside.

We reverse engineered Claude Desktop 2.42304.2 as a reference, and it has no such behavior. On macOS its Quick Entry surface is a native Swift `NSPanel`; its binary contains animation primitives, but no edge-recovery rule could be established from it. The Electron fallback used on Windows/Linux is static: after a 750 ms input debounce it makes one instantaneous `setPosition` that clamps only the right and bottom edges (trigger margin 0, target margin 30 DIP, so the first correction jumps by overflow + 30) and never clamps left or top. No `spring` symbol exists in its main bundle; its only window-motion utilities are a 240 ms `easeInOutCubic` bounds tween for main-window size changes, Electron's macOS-only `setBounds(bounds, true)`, and a 300 ms `cubic-bezier(0.16, 1, 0.3, 1)` CSS vocabulary. The behavior has to be designed, not ported.

The change must keep these obligations: a panel header is always reachable; one gesture still records exactly one history entry; reduced motion is honored; the persisted Sidebar layout format and every embedder stay unchanged; and the motion is deterministic enough to test without a real browser clock.

## Proposal

The behavior lives entirely in `packages/client/ui-dockkit`, inside `useFloatGestures` and the pure engine helpers it calls. Because both float renderers already take their rectangles from that hook, Web and Desktop gain the behavior together, and no embedder, shell or persisted format changes.

### Legal region and displayed position

The legal region of a panel is the viewport (`window.innerWidth` by `window.innerHeight`) with the existing top floor: the Windows caption height plus 20 px when `data-windows-titlebar` is set (20 px in native fullscreen), otherwise 0. A rectangle is legal when `x` lies in `[0, viewportWidth - width]` and `y` in `[top, viewportHeight - height]`. When a panel is wider or taller than the region, the minimum edge is pinned, so the header and its grip stay on screen and the excess hangs off the right or bottom.

The displayed rectangle is the per-axis projection of the stored rectangle onto the legal region, computed at render. The stored rectangle is not rewritten: a shrinking viewport pushes the panel in immediately without recording an operation, and when the viewport grows again the panel returns toward its stored position. Persisted layouts that hold off-screen rectangles from before this change display inside the viewport without migration.

### Drag with resistance

A move gesture computes the desired rectangle from the gesture's start rectangle and the pointer travel, as today, then splits it per axis into the legal projection and the overflow `o` beyond it. The preview rectangle draws at `legal + sign(o) * K * |o| / (K + |o|)` with `K = 120` px. The mapping is continuous, has slope 1 at the edge, and approaches `K`, so the panel moves past the edge at first and resists more the further the pointer goes:

| pointer overflow (px) | panel displacement past the edge (px) | share of the overflow |
|---|---|---|
| 10 | 9.2 | 92.3% |
| 40 | 30.0 | 75.0% |
| 120 | 60.0 | 50.0% |
| 400 | 92.3 | 23.1% |

A resize gesture clamps the bottom-right corner to the legal region and keeps `FLOAT_MIN_SIZE`; resizing has no resistance, because a corner that lags the pointer reads as a broken handle.

### Release and spring

On release the gesture records one `moveFloat` with the legal rectangle, so history and persistence always store a legal position. If the preview was outside the legal region, the hook keeps drawing a preview and animates it from the released position to the recorded one with a spring, then clears it. A release inside the legal region records the move and animates nothing.

The spring is underdamped, because its bounce goes inward and is always legal: response 0.32 s and damping ratio 0.72 (`omega0 = 2 * pi / 0.32`). The initial velocity is the pointer velocity over the last 100 ms of the drag, capped at 1500 px/s, so a fling past the edge comes back faster than a slow push. Per axis the update is:

```
a = -omega0^2 * (x - target) - 2 * zeta * omega0 * v
v = v + a * h
x = x + v * h
```

The integrator uses a fixed substep `h = 1/480 s`. One `requestAnimationFrame` loop in the hook splits each frame's elapsed time into equal substeps of at most `h`, clamps a frame to 64 ms, and snaps to the target when a frame gap exceeds 250 ms. It stops and draws the exact target when each axis is within 1 px with speed below 60 px/s, or after 900 ms. Simulated from rest, a 200 px overflow settles in 367 ms with a 6.9 px (3.5%) inward overshoot, within the analytic bound `exp(-pi * zeta / sqrt(1 - zeta^2)) = 3.8%`; the resistance caps the released overflow at 120 px, so real releases settle faster. The integrator is pure and takes `dt`, so the engine keeps its rule of reading no clock.

A press on a panel during its animation cancels the animation and starts the new gesture from the rectangle being drawn. At most one animation runs per panel, and unmounting the layer cancels its frame request.

### Reduced motion

When `matchMedia('(prefers-reduced-motion: reduce)')` matches, a move gesture clamps to the legal region with no resistance, and release records the legal rectangle with no animation. The rule only removes motion; it never removes the legality correction.

### Change scope

The implementation changes one package, `@deepseek-ai/dsh-client-ui-dockkit`, and leaves its exports and `DockIntents` unchanged.

| File | Change |
|---|---|
| `packages/client/ui-dockkit/src/engine/geometry.ts` | add the legal projection and the resistance mapping |
| `packages/client/ui-dockkit/src/engine/` | new `spring.ts`: the pure spring integrator and its settle test |
| `packages/client/ui-dockkit/src/components/FloatLayer.tsx` | `useFloatGestures`: displayed projection, resistance, release spring, velocity sampling, reduced motion, frame loop and cancellation |
| `packages/client/ui-dockkit/src/components/TabLayout.tsx` | draw the hook's displayed rectangle instead of the stored one |
| `packages/client/ui-dockkit/tests/` | geometry, spring, `FloatLayer` and `TabLayout` specs |
| `packages/client/ui-dockkit/README.md` pair | the edge rule under the interaction rules |

`ui-sidebar-right` and its persisted layout schema, `apps/web`, `apps/desktop`, the shared primitives and the theme are untouched. No dependency is added.

## Testing plan

Pure tests cover the projection (inside, each edge, corner, oversized panel, the Windows top floor), the resistance mapping (continuous, monotone, slope 1 at the edge, bounded by `K`), and the spring with fixed time steps (deterministic trajectories, exact final target, inward overshoot within one percentage point of the analytic bound, settling inside the 900 ms deadline, cadence robustness at 30, 60 and 120 Hz, and the 250 ms stall snap).

Component tests run `FloatLayer` and `TabLayout` under jsdom with a fake `requestAnimationFrame` and clock: a drag past each edge draws the resisted preview; release records exactly one `moveFloat` with the legal rectangle; the preview animates to it and clears; a press mid-animation cancels it and starts from the drawn rectangle; reduced motion clamps and never schedules a frame; a viewport resize moves the displayed panel without calling any intent; unmounting cancels the frame. The per-file coverage gate applies to every changed source file.

A browser check in the Web client drags a Sidebar floating panel past each edge and corner, flings it, resizes the window under it, and repeats with reduced motion; the PR records it as a GIF. Desktop loads the same client bundle, so one manual pass there confirms the Windows caption floor.

No keyless recorded-session snapshot is required: nothing model-visible changes and no `SessionEventMap` member is added. Documentation gates: `doc-sync`.

## Alternatives considered

**Hard clamp at the edge.** Stopping the panel at the viewport edge is the cheapest correct rule, but it feels like hitting a wall and gives no sense of the boundary before contact. It remains as the reduced-motion path.

**Clamp during the drag and rebound on release.** Clamping the drag at the edge and converting the outward pointer speed into an inward bounce keeps every frame inside the viewport. It hides how far the user pushed, so the bounce has no visible cause; the resistance mapping shows the push and still bounds the overflow at 120 px.

**Eased tween on release.** A fixed 240-300 ms ease-out from the released position is predictable, but it carries no velocity, so a fling and a slow push return identically, and a press during it either jumps or restarts. The spring keeps velocity continuous and is interruptible.

**Store the off-screen position and correct it later.** Recording the released rectangle and fixing it on the next render would persist off-screen positions and make undo restore them. Recording the legal rectangle keeps one history entry per gesture with a legal value.

**Rewrite stored rectangles when the viewport shrinks.** Moving panels through operations on resize would add history entries the user never made and change persisted layouts on every window resize. Projecting at render achieves the same visible result without either.

**Native always-on-top OS window.** A real Electron floating window could float above other applications, but only on Desktop; the Web client cannot do it at all, and native frameless dragging gives no per-frame control, so the resistance would be impossible and the spring could only start after release. It is a separate product decision with its own window, IPC and platform work, and this note does not preclude it.

**Animation library dependency.** A spring library would replace a pure integrator of a few dozen lines and its tests with a new dependency in a statically linked package. The integrator also has to be clock-free for the engine's deterministic tests.

**A shared primitive in `ui-primitives`.** Placing the hook in the primitives package would widen the change to a second package with no second consumer today. It can move there when another floating surface needs it.

## Acceptance criteria

- Dragging a floating panel past any viewport edge draws it at the resisted displacement, never more than 120 px beyond the edge; reduced motion clamps it at the edge instead.
- Releasing it outside the legal region records exactly one `moveFloat` whose rectangle is legal, and the panel springs to that rectangle within 900 ms, ending at the exact recorded position.
- Undo after such a gesture restores the pre-gesture position in one step, and the persisted layout never contains a rectangle that was illegal when it was recorded.
- Releasing inside the legal region behaves as today: one operation and no animation.
- Pressing a panel during its animation stops the animation and the new gesture starts from the rectangle on screen.
- Shrinking the viewport keeps every panel header on screen without recording an operation; growing it returns the panel toward its stored position.
- Under the Windows caption the header stays at least 20 px below the caption, as today.
- No package other than `@deepseek-ai/dsh-client-ui-dockkit` changes, and its exports and `DockIntents` are unchanged.

## Risks

**One render per animation frame.** The spring updates the preview through React state, which costs the same per frame as a drag does today, but a panel hosting heavy content re-renders for up to 900 ms after release. If measurement shows dropped frames, the loop can write a transform on the panel element directly without changing the rule.

**Elastic return after the viewport grows.** A panel pushed in by a shrinking window returns toward its stored position when the window grows. That is the intended consequence of not rewriting stored rectangles, but a user who expects the panel to stay where it was pushed may find it surprising.

**Embedded content under motion.** Panels can host a webview or an iframe that receives pointer events. The spring runs only after release and a press cancels it, but content that reacts to its own movement could observe up to 900 ms of motion.

**Touch remains untuned.** The resistance and the velocity sample come from pointer events and work for touch input, but the constants are tuned for a mouse or trackpad; the README already lists touch as untuned.
