import { Module } from '@nestjs/common';
import * as os from 'os';
import * as path from 'path';
import { STAGING_ROOT_DIR, StagingService } from './staging.service';

function platformDefaultStagingRoot(): string {
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
    return path.join(base, 'ctp', 'staging');
  }
  return '/var/ctp/staging';
}

// StagingModule is intentionally NOT imported into IntegrationModule in Milestone 1.
// The dormancy gate: no production code outside `staging/` imports this module yet.
@Module({
  providers: [
    {
      provide: STAGING_ROOT_DIR,
      useFactory: platformDefaultStagingRoot,
    },
    StagingService,
  ],
  exports: [StagingService],
})
export class StagingModule {}
