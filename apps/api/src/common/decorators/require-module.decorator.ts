import { SetMetadata } from '@nestjs/common';
import type { KorvaModule } from '@korva/types';

export const MODULE_KEY = 'requiredModule';

/** Requires the resolved TenantContext's organization to have this module in enabledModules. */
export const RequireModule = (module: KorvaModule) =>
  SetMetadata(MODULE_KEY, module);
