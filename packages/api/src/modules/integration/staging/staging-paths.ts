import * as path from 'path';

export function tenantRoot(rootDir: string, tenant: string): string {
  return path.join(rootDir, tenant);
}

export function pointerPath(rootDir: string, tenant: string): string {
  return path.join(rootDir, tenant, 'current');
}

export function snapshotDir(rootDir: string, tenant: string, ts: string): string {
  return path.join(rootDir, tenant, ts);
}

export function tmpDir(rootDir: string, tenant: string, ts: string): string {
  return path.join(rootDir, tenant, `${ts}.tmp`);
}

export function failedDir(rootDir: string, tenant: string, ts: string): string {
  return path.join(rootDir, tenant, `${ts}.failed`);
}

export function rawDir(snapshotPath: string): string {
  return path.join(snapshotPath, 'raw');
}

export function cleansedDir(snapshotPath: string): string {
  return path.join(snapshotPath, 'cleansed');
}

export function metadataPath(snapshotPath: string): string {
  return path.join(snapshotPath, '_metadata.json');
}

export function reportPath(snapshotPath: string): string {
  return path.join(snapshotPath, '_validation-report.json');
}

const TS_PATTERN = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})$/;

export function formatTimestamp(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

export function parseTimestamp(ts: string): Date | null {
  const m = TS_PATTERN.exec(ts);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isPromotedSnapshotName(name: string): boolean {
  return TS_PATTERN.test(name);
}

export function isTmpDirName(name: string): boolean {
  return /\.tmp$/.test(name) || /\.new$/.test(name);
}

export function isFailedDirName(name: string): boolean {
  return /\.failed$/.test(name);
}
