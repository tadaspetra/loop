export async function runPackageSmoke({ packager, createOptions, fs, projectRoot, outDir }) {
  await fs.rm(outDir, { recursive: true, force: true });

  await packager(createOptions({ projectRoot, outDir }));

  // A resolved packager promise is not proof of success: require real output.
  let entries;
  try {
    entries = await fs.readdir(outDir);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Packaging smoke produced no output directory at ${outDir} (${reason})`, {
      cause: error
    });
  }
  if (entries.length === 0) {
    throw new Error(`Packaging smoke produced an empty output directory at ${outDir}`);
  }

  await fs.rm(outDir, { recursive: true, force: true });
}

export function main({ proc, log = console.log, logError = console.error, ...smokeDeps }) {
  // Fail-safe preset: @electron/packager's zip extraction can stall without
  // rejecting (observed on Node >= 26 via extract-zip), draining the event
  // loop. A drained process must exit 1, so only verified success resets this.
  proc.exitCode = 1;

  const onBeforeExit = () => {
    logError(
      'Packaging smoke did not complete: the event loop drained before packaging finished. ' +
        'Known cause: @electron/packager zip extraction stalls on Node >= 26. ' +
        'Use the Node version from .nvmrc.'
    );
  };
  proc.once('beforeExit', onBeforeExit);

  return runPackageSmoke(smokeDeps).then(
    () => {
      proc.removeListener('beforeExit', onBeforeExit);
      log('Packaging smoke succeeded');
      proc.exitCode = 0;
    },
    (error) => {
      proc.removeListener('beforeExit', onBeforeExit);
      logError(error instanceof Error ? error.message : error);
      proc.exitCode = 1;
    }
  );
}
