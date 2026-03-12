// Custom webpack loader for manifold-3d/manifold.js
// Adds /* webpackIgnore: true */ to the dynamic import("module") so webpack
// doesn't try to resolve the Node.js built-in for the browser bundle.
// The import is guarded by ENVIRONMENT_IS_NODE so it never runs in the browser.
module.exports = function manifoldWasmLoader(source) {
  return source.replace(
    /await import\("module"\)/g,
    'await import(/* webpackIgnore: true */ "module")'
  );
};
