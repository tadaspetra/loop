export function createPackagerOptions({
  projectRoot,
  outDir,
  platform = process.platform,
  arch = process.arch
}) {
  return {
    dir: projectRoot,
    out: outDir,
    overwrite: true,
    platform,
    arch,
    // electron-packager pruning does not support pnpm's symlinked layout reliably.
    // Keep node_modules intact so packaging smoke verifies packager startup instead
    // of failing on known dependency-walk issues in CI.
    prune: false,
    quiet: true,
    ignore: [
      /^\/tests($|\/)/,
      /^\/docs($|\/)/,
      /^\/coverage($|\/)/,
      /^\/\.github($|\/)/,
      /^\/tmp($|\/)/,
      /^\/dist-smoke($|\/)/
    ]
  };
}
