export interface SnapshotHandle {
  tenant: string;
  ts: string;
  tmpDir: string;
  rawDir: string;
  cleansedDir: string;
  metadataPath: string;
  reportPath: string;
}

export interface SnapshotMetadata {
  capturedAt: string;
  adapterType: string;
  recordCounts: Record<string, number>;
}

export interface SnapshotInfo {
  tenant: string;
  ts: string;
  fullPath: string;
  isCurrent: boolean;
  metadata: SnapshotMetadata | null;
}

export type PruneSkipReason = 'current' | 'within-retention';

export interface PruneResult {
  deleted: string[];
  skipped: { ts: string; reason: PruneSkipReason }[];
}
