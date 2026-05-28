import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from '../../config/config.service';
import { StateService } from '../state/state.service';
import {
  ConfigChecks,
  DataChecks,
  EngineChecks,
  EntityChecks,
  TenantHealthReport,
  TenantHealthStatus,
} from './tenant-health.types';

// IRawDataPayload entity files we expect under data/current/. Same set FileConfigStore reads.
const REQUIRED_ENTITIES = ['resources', 'tasks', 'orders', 'calendars', 'state-changes'] as const;
const OPTIONAL_ENTITIES = ['products', 'materials', 'processes', 'uom-conversions'] as const;

@Injectable()
export class TenantHealthService {
  constructor(
    private readonly config: ConfigService,
    private readonly state: StateService,
  ) {}

  build(): TenantHealthReport {
    const tenant = this.config.getTenantId();
    const tenantDir = path.join(this.config.getConfigRoot(), 'tenants', tenant);

    const warnings: string[] = [];
    const errors: string[] = [];

    const config = this.checkConfig(tenantDir, warnings, errors);
    const data = this.checkData(tenantDir, warnings, errors);
    const entities = this.checkEntities(tenantDir, data, warnings, errors);
    const engine = this.checkEngine(warnings, errors);

    const status: TenantHealthStatus = this.deriveStatus({ config, data, entities, engine, warnings, errors });

    return {
      tenant,
      status,
      checks: { config, data, entities, engine },
      warnings,
      errors,
    };
  }

  private checkConfig(tenantDir: string, warnings: string[], errors: string[]): ConfigChecks {
    const tenantJsonPath = path.join(tenantDir, 'tenant.json');
    let tenantJson: ConfigChecks['tenantJson'] = 'absent';
    if (fs.existsSync(tenantJsonPath)) {
      try {
        JSON.parse(fs.readFileSync(tenantJsonPath, 'utf-8'));
        tenantJson = 'present';
      } catch {
        tenantJson = 'invalid';
        errors.push('tenant.json is not valid JSON');
      }
    } else {
      errors.push('tenant.json is missing');
    }

    const mappingProfile = this.config.getMappingProfile() != null ? 'present' : 'absent';
    const adapterCfg = this.config.getAdapterConfig();
    const adapter = adapterCfg != null ? 'present' : 'absent';
    const adapterType = adapterCfg?.adapterType;

    return { tenantJson, mappingProfile, adapter, adapterType };
  }

  private checkData(tenantDir: string, warnings: string[], errors: string[]): DataChecks {
    const dataDir = path.join(tenantDir, 'data');
    if (!fs.existsSync(dataDir)) {
      errors.push(`data dir missing at ${dataDir}`);
      return {
        dataDir: 'absent',
        currentSymlink: 'missing',
        currentTarget: null,
        fallbackInUse: false,
        snapshotCount: 0,
        snapshots: [],
      };
    }

    const subdirs = fs
      .readdirSync(dataDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== 'current')
      .map((e) => e.name)
      .sort();

    const currentLink = path.join(dataDir, 'current');
    let currentSymlink: DataChecks['currentSymlink'] = 'missing';
    let currentTarget: string | null = null;
    let fallbackInUse = false;

    if (fs.existsSync(currentLink)) {
      try {
        const resolved = fs.realpathSync(currentLink);
        currentSymlink = 'resolves';
        currentTarget = path.relative(dataDir, resolved);
      } catch {
        currentSymlink = 'broken';
        errors.push('data/current exists but does not resolve');
      }
    } else if (subdirs.includes('initial-fixture')) {
      // No symlink, but the fallback in FileConfigStore will use initial-fixture/.
      fallbackInUse = true;
      warnings.push('data/current symlink absent; reads fall back to initial-fixture/');
    } else {
      errors.push('no data/current and no initial-fixture/');
    }

    return {
      dataDir: 'present',
      currentSymlink,
      currentTarget,
      fallbackInUse,
      snapshotCount: subdirs.length,
      snapshots: subdirs,
    };
  }

  private checkEntities(
    tenantDir: string,
    data: DataChecks,
    warnings: string[],
    errors: string[],
  ): EntityChecks {
    const out: EntityChecks = {};

    // Where to read from: either through the symlink, or fall back to initial-fixture.
    const readBase =
      data.currentSymlink === 'resolves'
        ? path.join(tenantDir, 'data', 'current')
        : path.join(tenantDir, 'data', 'initial-fixture');

    if (!fs.existsSync(readBase)) {
      // checkData already flagged this
      return out;
    }

    for (const name of REQUIRED_ENTITIES) {
      const filePath = path.join(readBase, `${name}.json`);
      const check = this.readEntityFile(filePath);
      out[name] = check;
      if (!check.present) {
        errors.push(`required entity file missing: ${name}.json`);
      }
    }
    for (const name of OPTIONAL_ENTITIES) {
      const filePath = path.join(readBase, `${name}.json`);
      // Absence is legitimate for optional entities — report state without warning.
      out[name] = this.readEntityFile(filePath);
    }

    return out;
  }

  private readEntityFile(filePath: string): { present: boolean; count: number } {
    try {
      const text = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(text);
      const count = Array.isArray(parsed) ? parsed.length : parsed == null ? 0 : 1;
      return { present: true, count };
    } catch {
      return { present: false, count: 0 };
    }
  }

  private checkEngine(warnings: string[], errors: string[]): EngineChecks {
    const result = this.state.getSummary();
    if (result.status === 'not_loaded') {
      // Not a failure — engine just hasn't been exercised yet. Operator can hit
      // /v1/state/sync. Reported as informational.
      return {
        landscapeLoaded: false,
        resources: 0,
        tasks: 0,
        stateChanges: 0,
        horizon: null,
        validationErrorCount: 0,
        validationWarningCount: 0,
      };
    }

    const summary = result.summary;
    return {
      landscapeLoaded: true,
      resources: summary?.resources ?? 0,
      tasks: summary?.tasks ?? 0,
      stateChanges: summary?.stateChanges ?? 0,
      horizon: summary?.horizon ?? null,
      validationErrorCount: result.validationSummary?.recordsWithErrors ?? 0,
      validationWarningCount: result.validationSummary?.recordsWithWarnings ?? 0,
    };
  }

  private deriveStatus(parts: {
    config: ConfigChecks;
    data: DataChecks;
    entities: EntityChecks;
    engine: EngineChecks;
    warnings: string[];
    errors: string[];
  }): TenantHealthStatus {
    if (parts.errors.length > 0) return 'unhealthy';
    if (parts.warnings.length > 0) return 'degraded';
    if (parts.engine.validationErrorCount > 0) return 'degraded';
    return 'healthy';
  }
}
