const TelegramBot = require('node-telegram-bot-api');

let bot = null;

const getBot = () => {
  if (!process.env.TELEGRAM_BOT_TOKEN) return null;
  if (!bot) {
    bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
  }
  return bot;
};

const getChatId = () => process.env.TELEGRAM_CHAT_ID;

const notify = async (message) => {
  const b = getBot();
  const chatId = getChatId();
  if (!b || !chatId) return;

  try {
    await b.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('Telegram notify error:', err.message);
  }
};

const notifyNewLeads = async (count, category, city) => {
  await notify(`🎯 *New Leads Found!*\n\n📍 ${category} in ${city}\n✅ ${count} businesses without websites added to your dashboard`);
};

const notifyReply = async (businessName, channel) => {
  await notify(`💬 *New Reply!*\n\n🏢 ${businessName} replied via ${channel}\n\nCheck your dashboard to review and respond`);
};

const notifyDailySummary = async (stats) => {
  await notify(
    `📊 *Daily Summary*\n\n` +
    `🔍 Searches run: ${stats.searches}\n` +
    `👥 New leads: ${stats.newLeads}\n` +
    `📨 Messages sent: ${stats.sent}\n` +
    `💬 Replies received: ${stats.replies}\n` +
    `⏳ Pending review: ${stats.pending}`
  );
};

module.exports = { notify, notifyNewLeads, notifyReply, notifyDailySummary };
