// Stub for Node.js built-in 'module' package.
// manifold-3d uses `await import("module")` guarded by ENVIRONMENT_IS_NODE,
// so this code never runs in the browser — webpack just needs it to resolve.
export const createRequire = () => null;
export default { createRequire };
