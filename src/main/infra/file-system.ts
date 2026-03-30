import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function ensureDirectory(folderPath: string): void {
  fs.mkdirSync(folderPath, { recursive: true });
}

export function safeUnlink(filePath: string | null | undefined): void {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (error) {
    console.warn(`Failed to delete file at ${filePath}:`, error);
  }
}

export function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (error) {
    console.error(`Failed to read JSON file at ${filePath}:`, error);
    return fallback;
  }
}

export function writeJsonFile(filePath: string, data: unknown): void {
  atomicWriteFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Write a file atomically: write to a temp file in the same directory,
 * then rename into place. This prevents partial/corrupt files if the
 * process crashes mid-write.
 */
export function atomicWriteFileSync(
  filePath: string,
  data: string | Buffer,
  encoding?: BufferEncoding
): void {
  const dir = path.dirname(filePath);
  ensureDirectory(dir);
  const tmpPath = path.join(
    dir,
    `.tmp-${crypto.randomBytes(6).toString('hex')}${path.extname(filePath)}`
  );
  try {
    if (encoding) {
      fs.writeFileSync(tmpPath, data, encoding);
    } else {
      fs.writeFileSync(tmpPath, data);
    }
    fs.renameSync(tmpPath, filePath);
  } catch (error) {
    // Clean up temp file on failure
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }
    throw error;
  }
}

export function isDirectoryEmpty(folderPath: string): boolean {
  try {
    return fs.readdirSync(folderPath).length === 0;
  } catch {
    return false;
  }
}

export function copyFile(sourcePath: string, destFolder: string, prefix: string): string {
  const ext = path.extname(sourcePath);
  const baseName = path.basename(sourcePath, ext);
  const destName = `${prefix}-${Date.now()}-${baseName}${ext}`;
  ensureDirectory(destFolder);
  const destPath = path.join(destFolder, destName);
  fs.copyFileSync(sourcePath, destPath);
  return destPath;
}

export { fs };
