// Prints the webhook secret_token to pass to Telegram setWebhook. Reads TELEGRAM_BOT_TOKEN from the environment only.
import { webhookSecret } from '../apps/api/src/lib/telegram';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('Set TELEGRAM_BOT_TOKEN in your shell first (it is not read from files).');
  process.exit(1);
}
console.log(await webhookSecret(token));
