/**
 * In-memory transfer store for passing Split3r parts to the quote wizard.
 * Module-level state survives Next.js client-side navigation (router.push),
 * which is intentional — we use router.push instead of window.location.href
 * specifically to avoid a full page reload that would clear this state.
 */

export interface Split3rPartTransfer {
  name: string;
  file: File;
  bbox: { x: number; y: number; z: number };
  volumeMM3: number;
}

let _pending: Split3rPartTransfer[] = [];

export const split3rTransfer = {
  set(parts: Split3rPartTransfer[]) { _pending = parts; },
  get(): Split3rPartTransfer[] { return _pending; },
  clear() { _pending = []; },
};
