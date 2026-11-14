import { appDeps, createApp } from './app';
import type { Env } from './env';
import { makeNotifier, telegramEnabled } from './adapters/notifier';
import { purge } from './lib/purge';
import { dispatchTelegramAlerts } from './lib/telegram';

const app = createApp();

export default {
  fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> | Response {
    return app.fetch(req, env, ctx);
  },
  /** Daily cron: retention purge, and Telegram alerts when TELEGRAM_BOT_TOKEN is set. */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        await purge(env.DB);
        if (telegramEnabled(env)) await dispatchTelegramAlerts(env, appDeps(), makeNotifier(env, 'telegram'));
      })(),
    );
  },
} satisfies ExportedHandler<Env>;
