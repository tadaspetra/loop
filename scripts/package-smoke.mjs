import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as packagerModule from '@electron/packager';

import { createPackagerOptions } from './package-smoke-options.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const outDir = path.join(projectRoot, 'dist-smoke');

async function run() {
  const packager = packagerModule.default || packagerModule.packager || packagerModule;

  await fs.rm(outDir, { recursive: true, force: true });

  await packager(createPackagerOptions({ projectRoot, outDir }));

  await fs.rm(outDir, { recursive: true, force: true });
  console.log('Packaging smoke succeeded');
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
