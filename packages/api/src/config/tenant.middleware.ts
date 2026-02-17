import { Injectable, NestMiddleware, HttpException, HttpStatus } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from './config.service';

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  private readonly configRoot: string;

  constructor(private readonly configService: ConfigService) {
    this.configRoot =
      process.env.CONFIG_ROOT ??
      path.join(process.cwd(), '..', '..', 'config');
  }

  use(req: any, _res: any, next: () => void) {
    const tenantId =
      (req.headers?.['x-tenant-id'] as string) ||
      process.env.TENANT_ID ||
      'demo-manufacturing';

    // Validate tenant folder exists
    const tenantDir = path.resolve(
      this.configRoot,
      'tenants',
      tenantId,
    );
    if (!fs.existsSync(tenantDir)) {
      throw new HttpException(
        `Tenant '${tenantId}' not found`,
        HttpStatus.NOT_FOUND,
      );
    }

    this.configService.switchTenant(tenantId);
    next();
  }
}
