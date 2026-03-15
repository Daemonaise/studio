# Karaslice App Test Cases

This document summarizes the app-level frontend coverage for [tests/frontend/karaslice-app-flow.test.tsx](/home/user/studio/tests/frontend/karaslice-app-flow.test.tsx).

Run the test with:

```bash
npx vitest run tests/frontend/karaslice-app-flow.test.tsx
```

## Covered Flow

### `KarasliceApp` upload, analysis, and repair-mode selection

- Renders the full [KarasliceApp](/home/user/studio/src/components/karaslice/karaslice-app.tsx) with a mocked viewport and mocked heavy reconstruction modules.
- Simulates uploading a file through the app's real hidden file input.
- Simulates the viewport reporting the loaded mesh back into app state via the same `karaslice:load-file` event path used by the UI.
- Verifies the loaded file appears in app UI.
- Runs `Analyze Mesh` and verifies AI analysis output is shown.
- Switches into the `Repair` workbench tab.
- Opens the `Reconstruction` section.
- Changes reconstruction mode to `Point Cloud`.
- Verifies the point-cloud-specific reconstruction description is shown.
- Verifies the app exposes the correct reconstruction CTA: `Reconstruct (Point Cloud)`.

## Why This Test Exists

This test covers the main app wiring that pure module tests cannot:

- file upload -> viewport -> app state integration
- analysis state transitions in the real component
- workbench tab switching
- reconstruction mode selection in the live UI

It intentionally mocks WebGL-heavy and compute-heavy modules so the test stays focused on `KarasliceApp` behavior rather than reconstruction engine internals.

## Related Tests

- Route/profile gating:
  [tests/frontend/karaslice-pages.test.tsx](/home/user/studio/tests/frontend/karaslice-pages.test.tsx)
- Name gate interactions:
  [tests/frontend/karaslice-name-gate.test.tsx](/home/user/studio/tests/frontend/karaslice-name-gate.test.tsx)
- Repair and reconstruction modules:
  [tests/repair-modules.test.mjs](/home/user/studio/tests/repair-modules.test.mjs)
- Manifold engine coverage:
  [tests/manifold-engine.test.mjs](/home/user/studio/tests/manifold-engine.test.mjs)
