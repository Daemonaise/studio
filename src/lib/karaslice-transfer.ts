/**
 * In-memory transfer store for passing Karaslice parts to the quote wizard.
 * Module-level state survives Next.js client-side navigation (router.push),
 * which is intentional — we use router.push instead of window.location.href
 * specifically to avoid a full page reload that would clear this state.
 */

export interface KaraslicePartTransfer {
  name: string;
  file: File;
  bbox: { x: number; y: number; z: number };
  volumeMM3: number;
  triangleCount: number;
}

let _pending: KaraslicePartTransfer[] = [];

export const karasliceTransfer = {
  set(parts: KaraslicePartTransfer[]) { _pending = parts; },
  get(): KaraslicePartTransfer[] { return _pending; },
  clear() { _pending = []; },
};
