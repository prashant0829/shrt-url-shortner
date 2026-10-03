import { z } from 'zod';
import { DependencyStatus, HealthStatus } from '../constants.js';

const dependencyStatus = z.enum(Object.values(DependencyStatus));

export const liveResponse = z.object({ status: z.literal(HealthStatus.OK) });

export const readyResponse = z.object({
  status: z.enum(Object.values(HealthStatus)),
  checks: z.object({ postgres: dependencyStatus, redis: dependencyStatus }),
});
