import { SetMetadata } from '@nestjs/common';

export const SKIP_TENANT_KEY = 'skipTenant';

/** Marks a route as authenticated but not requiring a resolved active organization (e.g. listing orgs, creating the first org). */
export const SkipTenant = () => SetMetadata(SKIP_TENANT_KEY, true);
