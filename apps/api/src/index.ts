import { createApp } from './app';
import type { Env } from './env';

const app = createApp();

export default {
  fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> | Response {
    return app.fetch(req, env, ctx);
  },
} satisfies ExportedHandler<Env>;
