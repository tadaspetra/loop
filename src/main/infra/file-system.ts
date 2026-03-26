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
  ensureDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
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
