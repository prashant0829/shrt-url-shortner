import { z } from 'zod';

const email = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const registerBody = z.object({
  email,
  // Upper bound stops absurdly long inputs from turning password hashing into a DoS vector.
  password: z.string().min(8, 'must be at least 8 characters').max(128),
});

export const loginBody = z.object({
  email,
  password: z.string().min(1).max(128),
});

export const userView = z.object({
  id: z.string(),
  email: z.string(),
  createdAt: z.string(),
});

export const authResponse = z.object({
  token: z.string().describe('Send as `Authorization: Bearer <token>`'),
  expiresIn: z.number().int().describe('Token lifetime in seconds'),
  user: userView,
});

export const meResponse = z.object({ user: userView });
