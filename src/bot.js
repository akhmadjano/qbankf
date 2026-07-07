const crypto = require('crypto');
const { Telegraf, Markup } = require('telegraf');
const { query } = require('./db');

const BOT_TOKEN = process.env.BOT_TOKEN;
const APP_URL = process.env.APP_URL;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;

if (!BOT_TOKEN) console.warn('⚠️  BOT_TOKEN topilmadi! Bot ishlamaydi.');
if (!ADMIN_CHAT_ID) console.warn('⚠️  ADMIN_CHAT_ID topilmadi!');

const bot = BOT_TOKEN ? new Telegraf(BOT_TOKEN) : null;

// Test yakunlangach adminga xabar
async function sendAdminNotification({ firstName, lastName, subjectName, score, total, durationSeconds }) {
  if (!bot || !ADMIN_CHAT_ID) return;
  try {
    const fullName = `${firstName} ${lastName}`.trim() || 'Noma\'lum';
    const pct = total > 0 ? Math.round((score / total) * 100) : 0;
    const mins = Math.floor(durationSeconds / 60);
    const secs = durationSeconds % 60;
    const timeStr = mins > 0 ? `${mins} daq ${secs} sek` : `${secs} sek`;

    const text =
      `📋 <b>Test yakunlandi!</b>\n\n` +
      `👤 <b>O'quvchi:</b> ${fullName}\n` +
      `📚 <b>Fan:</b> ${subjectName}\n` +
      `✅ <b>Natija:</b> ${score}/${total} (${pct}%)\n` +
      `⏱ <b>Sarflangan vaqt:</b> ${timeStr}`;

    await bot.telegram.sendMessage(ADMIN_CHAT_ID, text, { parse_mode: 'HTML' });
  } catch (e) {
    console.error('Admin xabar yuborishda xatolik:', e.message);
  }
}

// Kunlik statistika xabari — developer panel yoki cron chaqiradi
async function sendDailyStats() {
  if (!bot || !ADMIN_CHAT_ID) return;
  try {
    const { rows: statsRows } = await query(`
      SELECT 
        COUNT(DISTINCT a.student_id) AS active_users,
        COUNT(a.id) AS total_tests,
        COALESCE(AVG(CASE WHEN a.total > 0 THEN a.score::float/a.total*100 END),0)::int AS avg_pct
      FROM attempts a
      WHERE a.started_at >= NOW() - INTERVAL '24 hours'
    `);
    const { rows: totalUsers } = await query('SELECT COUNT(*)::int AS cnt FROM students');
    const s = statsRows[0];
    const text =
      `📊 <b>Kunlik statistika</b>\n\n` +
      `👥 <b>Jami foydalanuvchilar:</b> ${totalUsers[0].cnt}\n` +
      `🟢 <b>So'ngi 24 soatda faol:</b> ${s.active_users}\n` +
      `📝 <b>Testlar o'tkazildi:</b> ${s.total_tests}\n` +
      `📈 <b>O'rtacha natija:</b> ${s.avg_pct}%`;
    await bot.telegram.sendMessage(ADMIN_CHAT_ID, text, { parse_mode: 'HTML' });
    return { ok: true };
  } catch (e) {
    console.error('Statistika yuborishda xatolik:', e.message);
    return { ok: false, error: e.message };
  }
}

// Barcha foydalanuvchilarga broadcast xabar yuborish
async function broadcastToAllUsers(message, broadcastId) {
  if (!bot) return { sent: 0, failed: 0 };

  const { rows: students } = await query(
    'SELECT telegram_id FROM students WHERE telegram_id IS NOT NULL AND telegram_id != \'\''
  );

  let sent = 0, failed = 0;
  for (const s of students) {
    try {
      await bot.telegram.sendMessage(s.telegram_id, message, { parse_mode: 'HTML' });
      sent++;
      // Spam limitdan saqlash uchun kichik kutish
      await new Promise(r => setTimeout(r, 50));
    } catch (e) {
      failed++;
    }
  }

  if (broadcastId) {
    await query(
      'UPDATE broadcasts SET total_sent=$1, total_failed=$2, status=$3, finished_at=NOW() WHERE id=$4',
      [sent, failed, 'done', broadcastId]
    ).catch(() => {});
  }

  return { sent, failed };
}

if (bot) {
  bot.start(async (ctx) => {
    // Maintenance tekshiruvi
    const { rows: mRows } = await query('SELECT enabled, message FROM maintenance WHERE id=1').catch(() => ({ rows: [] }));
    if (mRows[0]?.enabled) {
      return ctx.reply(`🔧 ${mRows[0].message}`);
    }

    if (!APP_URL) {
      return ctx.reply('⚠️ APP_URL sozlanmagan.');
    }
    await ctx.reply(
      `Salom, ${ctx.from.first_name || ''}! 👋\n\nBu yerda turli fanlar bo'yicha test savollar bankidan mashq qilishingiz mumkin.\n\nBoshlash uchun pastdagi tugmani bosing 👇`,
      Markup.inlineKeyboard([
        Markup.button.webApp('📝 Test bankini ochish', `${APP_URL}/app`),
      ])
    );

    // Statistikani yangilash
    await query(`
      INSERT INTO bot_stats (date, total_users)
      VALUES (CURRENT_DATE, (SELECT COUNT(*) FROM students))
      ON CONFLICT (date) DO UPDATE SET total_users = (SELECT COUNT(*) FROM students), updated_at = NOW()
    `).catch(() => {});
  });

  bot.command('test', async (ctx) => {
    if (!APP_URL) return;
    await ctx.reply('Test bankini ochish:', Markup.inlineKeyboard([
      Markup.button.webApp('📝 Ochish', `${APP_URL}/app`)
    ]));
  });

  bot.command('stats', async (ctx) => {
    // Faqat admin uchun
    if (String(ctx.from.id) !== String(ADMIN_CHAT_ID)) return;
    await sendDailyStats();
  });

  async function sendAdminLink(ctx) {
    if (!APP_URL) return ctx.reply('⚠️ APP_URL sozlanmagan.');
    await ctx.reply('🔐 Admin panel:', Markup.inlineKeyboard([
      Markup.button.url('⚙️ Admin panelni ochish', `${APP_URL}/admin`)
    ]));
  }

  bot.command('admin', sendAdminLink);
  bot.hears(/^admin$/i, sendAdminLink);
}

function validateTelegramWebAppData(initData) {
  if (!BOT_TOKEN || !initData) return null;
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');

    const pairs = [];
    for (const [key, value] of params.entries()) {
      pairs.push(`${key}=${value}`);
    }
    pairs.sort();
    const dataCheckString = pairs.join('\n');

    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    if (computedHash !== hash) return null;

    const userJson = params.get('user');
    if (!userJson) return null;
    return JSON.parse(userJson);
  } catch (e) {
    console.error('initData validation error:', e);
    return null;
  }
}

module.exports = { bot, validateTelegramWebAppData, sendAdminNotification, sendDailyStats, broadcastToAllUsers };
