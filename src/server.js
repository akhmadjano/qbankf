require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

const { initDb } = require('./db');
const { bot } = require('./bot');
const adminRoutes = require('./routes/admin');
const publicRoutes = require('./routes/public');
const developerRoutes = require('./routes/developer');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Static frontendlar
app.use('/admin', express.static(path.join(__dirname, '..', 'public', 'admin')));
app.use('/app', express.static(path.join(__dirname, '..', 'public', 'app')));
app.use('/developer', express.static(path.join(__dirname, '..', 'public', 'developer')));

// API
app.use('/api/admin', adminRoutes);
app.use('/api/developer', developerRoutes);
app.use('/api', publicRoutes);

app.get('/', (req, res) => {
  res.send('✅ Server ishlayapti. /admin - admin panel, /app - App, /developer - Developer panel');
});

app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;

async function main() {
  await initDb();
  console.log('✅ Database tayyor');

  app.listen(PORT, () => {
    console.log(`✅ Server http://localhost:${PORT} portida ishga tushdi`);
  });

  if (bot) {
    try {
      await bot.telegram.deleteWebhook({ drop_pending_updates: true });
      await bot.launch();
      console.log('✅ Telegram bot ishga tushdi (polling)');
    } catch (err) {
      console.error('❌ Bot ishga tushmadi (server baribir ishlayapti):', err.message);
    }
  }
}

main().catch((err) => {
  console.error('❌ Server ishga tushmadi:', err);
  process.exit(1);
});

process.on('unhandledRejection', (err) => {
  console.error('⚠️ Unhandled rejection:', err);
});

process.once('SIGINT', () => bot && bot.stop('SIGINT'));
process.once('SIGTERM', () => bot && bot.stop('SIGTERM'));
