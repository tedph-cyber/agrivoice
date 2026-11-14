import { createApp } from './app';
import type { Env } from './env';
import { purge } from './lib/purge';

const app = createApp();

export default {
  fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> | Response {
    return app.fetch(req, env, ctx);
  },
  /** Daily retention job (cron trigger in wrangler.toml). Logs counts only. */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(purge(env.DB).then(() => undefined));
  },
} satisfies ExportedHandler<Env>;
