import { Hono } from 'hono';
import type { AppEnv } from '../env';

// Filled in by T16 (CSV import and export).
export const csvRoutes = new Hono<AppEnv>();
