import type { RouteId, Routes } from '@/contract/routes';
import { credentialEndpoints } from '@/server/handlers/credentials';
import { executionEndpoints } from '@/server/handlers/executions';
import type { Endpoint } from '@/server/handlers/kit';
import { notificationEndpoints } from '@/server/handlers/notifications';
import { releaseEndpoints } from '@/server/handlers/releases';
import { repositoryEndpoints } from '@/server/handlers/repositories';
import { securityEndpoints } from '@/server/handlers/security';
import { wingetEndpoints } from '@/server/handlers/winget';
import { workflowEndpoints } from '@/server/handlers/workflow';

export const endpoints = {
	...credentialEndpoints,
	...executionEndpoints,
	...notificationEndpoints,
	...releaseEndpoints,
	...repositoryEndpoints,
	...securityEndpoints,
	...wingetEndpoints,
	...workflowEndpoints,
} as const satisfies { [K in RouteId]: Endpoint<Routes[K]> };
