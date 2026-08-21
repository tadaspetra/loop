// Test fixture: wires scripts/package-smoke-run.mjs `main` against the real
// process and filesystem, with the packager behavior selected by argv so the
// integration test can observe true process exit codes.
import fs from 'node:fs/promises';
import path from 'node:path';

import { main } from '../../../scripts/package-smoke-run.mjs';

const [, , mode, outDir] = process.argv;

const packagers = {
  // Never settles and holds no handles, so the event loop drains — the
  // exact failure mode of the extract-zip stall inside @electron/packager.
  hang: () => new Promise(() => {}),
  success: async (options) => {
    const appDir = path.join(options.out, 'Loop-fake-arm64');
    await fs.mkdir(appDir, { recursive: true });
    await fs.writeFile(path.join(appDir, 'app.txt'), 'packaged');
  },
  empty: async () => {},
  reject: async () => {
    throw new Error('packager exploded');
  }
};

if (!packagers[mode] || !outDir) {
  console.error(
    `usage: node package-smoke-entry.fixture.mjs <${Object.keys(packagers).join('|')}> <outDir>`
  );
  process.exit(2);
}

main({
  proc: process,
  packager: packagers[mode],
  createOptions: ({ projectRoot, outDir }) => ({ dir: projectRoot, out: outDir }),
  fs,
  projectRoot: path.dirname(outDir),
  outDir
});
