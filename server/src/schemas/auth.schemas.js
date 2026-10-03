import { z } from 'zod';
import { MAX_EMAIL_LENGTH, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '../constants.js';

const email = z.string().trim().toLowerCase().pipe(z.email().max(MAX_EMAIL_LENGTH));

export const registerBody = z.object({
  email,
  // The upper bound stops absurdly long inputs from turning password hashing into a DoS vector.
  password: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `must be at least ${MIN_PASSWORD_LENGTH} characters`)
    .max(MAX_PASSWORD_LENGTH),
});

export const loginBody = z.object({
  email,
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
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
