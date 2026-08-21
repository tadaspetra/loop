import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as packagerModule from '@electron/packager';

import { createPackagerOptions } from './package-smoke-options.mjs';
import { main } from './package-smoke-run.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const outDir = path.join(projectRoot, 'dist-smoke');

main({
  proc: process,
  packager: packagerModule.default || packagerModule.packager || packagerModule,
  createOptions: createPackagerOptions,
  fs,
  projectRoot,
  outDir
});
