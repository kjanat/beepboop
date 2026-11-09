import { z } from 'zod';

export const packageManifest = z.object({ name: z.string(), version: z.string() });
