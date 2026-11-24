import { securityEndpoints } from '@/auth/http/security.ts';
import type { RouteId, Routes } from '@/contract/routes';
import { executionEndpoints } from '@/release/http/executions.ts';
import { releaseEndpoints } from '@/release/http/releases.ts';
import { workflowEndpoints } from '@/release/http/workflow.ts';
import { changeEndpoints } from '@/server/handlers/changes';
import { credentialEndpoints } from '@/server/handlers/credentials';
import type { Endpoint } from '@/server/handlers/kit';
import { notificationEndpoints } from '@/server/handlers/notifications';
import { repositoryEndpoints } from '@/server/handlers/repositories';
import { wingetEndpoints } from '@/server/handlers/winget';

export const endpoints = {
	...changeEndpoints,
	...credentialEndpoints,
	...executionEndpoints,
	...notificationEndpoints,
	...releaseEndpoints,
	...repositoryEndpoints,
	...securityEndpoints,
	...wingetEndpoints,
	...workflowEndpoints,
} as const satisfies { [K in RouteId]: Endpoint<Routes[K]> };
