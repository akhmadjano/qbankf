const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../db');
const { requireDeveloper, signDeveloperToken } = require('../auth');
const { sendDailyStats, broadcastToAllUsers, bot } = require('../bot');

const router = express.Router();

// ====== LOGIN (token talab qilmaydi) ======
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email va parol kiriting' });

  const { rows } = await query('SELECT * FROM developers WHERE email=$1', [email.trim().toLowerCase()]);
  const dev = rows[0];
  if (!dev) return res.status(401).json({ error: 'Email yoki parol xato' });
  if (!dev.password_hash) return res.status(401).json({ error: "Parol o'rnatilmagan. Admin bilan bog'laning." });

  const ok = await bcrypt.compare(password, dev.password_hash);
  if (!ok) return res.status(401).json({ error: 'Email yoki parol xato' });

  const token = signDeveloperToken(dev);
  res.json({ token, dev: { id: dev.id, email: dev.email, name: dev.name } });
});

// Barcha developer route'lari token talab qiladi
router.use(requireDeveloper);

// ====== DASHBOARD STATISTIKA ======
router.get('/stats', async (req, res) => {
  try {
    const { rows: overview } = await query(`
      SELECT
        (SELECT COUNT(*)::int FROM students) AS total_students,
        (SELECT COUNT(*)::int FROM students WHERE auth_type='password') AS password_students,
        (SELECT COUNT(*)::int FROM students WHERE auth_type='telegram') AS telegram_students,
        (SELECT COUNT(*)::int FROM attempts WHERE finished_at IS NOT NULL) AS total_attempts,
        (SELECT COUNT(*)::int FROM attempts WHERE started_at >= NOW() - INTERVAL '24 hours') AS attempts_today,
        (SELECT COUNT(*)::int FROM subjects) AS total_subjects,
        (SELECT COUNT(*)::int FROM questions) AS total_questions,
        (SELECT COUNT(*)::int FROM broadcasts WHERE status='done') AS total_broadcasts
    `);

    const { rows: dailyTests } = await query(`
      SELECT DATE(started_at) AS date, COUNT(*)::int AS count
      FROM attempts
      WHERE started_at >= NOW() - INTERVAL '7 days'
      GROUP BY DATE(started_at)
      ORDER BY date DESC
    `);

    const { rows: topSubjects } = await query(`
      SELECT s.name, COUNT(a.id)::int AS attempts
      FROM subjects s
      LEFT JOIN attempts a ON a.subject_id = s.id
      GROUP BY s.id, s.name
      ORDER BY attempts DESC
      LIMIT 5
    `);

    const { rows: recentActivity } = await query(`
      SELECT st.first_name, st.last_name, subj.name AS subject, 
             a.score, a.total, a.finished_at
      FROM attempts a
      JOIN students st ON st.id = a.student_id
      JOIN subjects subj ON subj.id = a.subject_id
      WHERE a.finished_at IS NOT NULL
      ORDER BY a.finished_at DESC
      LIMIT 10
    `);

    res.json({ overview: overview[0], dailyTests, topSubjects, recentActivity });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ====== BROADCAST ======
router.get('/broadcasts', async (req, res) => {
  const { rows } = await query('SELECT * FROM broadcasts ORDER BY created_at DESC LIMIT 20');
  res.json(rows);
});

router.post('/broadcasts', async (req, res) => {
  const { message } = req.body;
  if (!message || !message.trim()) return res.status(400).json({ error: 'Xabar matni kiritilmadi' });

  if (!bot) return res.status(500).json({ error: 'Bot sozlanmagan' });

  try {
    // Avval broadcastni DBga yozish
    const { rows } = await query(
      'INSERT INTO broadcasts (message, sent_by, status) VALUES ($1,$2,$3) RETURNING *',
      [message.trim(), req.auth.email, 'sending']
    );
    const bc = rows[0];

    // Xabar yuborish (background)
    broadcastToAllUsers(message.trim(), bc.id).then(result => {
      console.log(`Broadcast #${bc.id} yakunlandi: ${result.sent} yuborildi, ${result.failed} xato`);
    }).catch(err => {
      console.error('Broadcast xatolik:', err);
    });

    res.json({ ok: true, broadcast_id: bc.id, message: 'Xabar yuborilmoqda...' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ====== MAINTENANCE MODE ======
router.get('/maintenance', async (req, res) => {
  const { rows } = await query('SELECT * FROM maintenance WHERE id=1');
  res.json(rows[0] || { enabled: false, message: '' });
});

router.put('/maintenance', async (req, res) => {
  const { enabled, message } = req.body;
  const { rows } = await query(
    'UPDATE maintenance SET enabled=$1, message=$2, updated_at=NOW(), updated_by=$3 WHERE id=1 RETURNING *',
    [!!enabled, message || 'Saytda texnik ishlar olib borilmoqda. Tez orada qaytamiz! 🔧', req.auth.email]
  );

  // Telegram orqali ham xabar yuborish
  if (bot && process.env.ADMIN_CHAT_ID) {
    const status = enabled ? '🔧 MAINTENANCE MODE YOQILDI' : '✅ MAINTENANCE MODE O\'CHIRILDI';
    bot.telegram.sendMessage(process.env.ADMIN_CHAT_ID, `${status}\n\nXabar: ${message}`, { parse_mode: 'HTML' }).catch(() => {});
  }

  res.json(rows[0]);
});

// ====== STATISTIKA BOTGA YUBORISH ======
router.post('/send-stats', async (req, res) => {
  const result = await sendDailyStats();
  if (result?.ok) {
    res.json({ ok: true, message: 'Statistika botga yuborildi' });
  } else {
    res.status(500).json({ error: result?.error || 'Xatolik' });
  }
});

// ====== REAL-TIME: HOZIR TEST ISHLAYOTGANLAR ======
router.get('/live', async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT
        a.id AS attempt_id,
        a.current_index,
        jsonb_array_length(a.question_ids) AS total_questions,
        (SELECT COUNT(*) FROM jsonb_object_keys(COALESCE(a.answers, '{}'::jsonb)))::int AS answered_count,
        a.started_at,
        a.last_activity_at,
        a.session_active,
        st.id AS student_id,
        st.first_name,
        st.last_name,
        st.username,
        st.auth_type,
        subj.name AS subject_name
      FROM attempts a
      JOIN students st ON st.id = a.student_id
      JOIN subjects subj ON subj.id = a.subject_id
      WHERE a.finished_at IS NULL
        AND a.abandoned = false
        AND a.last_activity_at >= NOW() - INTERVAL '30 minutes'
      ORDER BY a.last_activity_at DESC
    `);

    const now = Date.now();
    const sessions = rows.map(r => {
      const secondsSinceActivity = Math.max(0, Math.round((now - new Date(r.last_activity_at).getTime()) / 1000));
      const total = r.total_questions || 0;
      const progressPct = total ? Math.min(100, Math.round(((r.current_index || 0) + 1) / total * 100)) : 0;

      // status: 'online' - faol va yaqinda signal bergan
      //         'idle'   - sessiya faol deb belgilangan, lekin biroz signal kelmadi
      //         'paused' - foydalanuvchi testdan chiqib ketgan (saqlangan holat)
      let status = 'paused';
      if (r.session_active) status = secondsSinceActivity <= 45 ? 'online' : 'idle';

      return {
        ...r,
        seconds_since_activity: secondsSinceActivity,
        status,
        is_online: status === 'online',
        progress_pct: progressPct
      };
    });

    res.json({
      count_online: sessions.filter(s => s.status === 'online').length,
      count_total: sessions.length,
      sessions
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ====== STUDENTS LISTI ======
router.get('/students', async (req, res) => {
  const { rows } = await query(`
    SELECT id, first_name, last_name, username, auth_type, created_at,
           (SELECT COUNT(*)::int FROM attempts WHERE student_id=students.id) AS attempt_count
    FROM students
    ORDER BY created_at DESC
    LIMIT 100
  `);
  res.json(rows);
});

// ====== DEVELOPER QOSHISH ======
router.get('/developers', async (req, res) => {
  const { rows } = await query('SELECT id, email, name, created_at FROM developers ORDER BY created_at');
  res.json(rows);
});

router.post('/developers', async (req, res) => {
  const { email, password } = req.body;
  if (!email) return res.status(400).json({ error: 'Email kiritilmadi' });
  if (!password || password.length < 6) return res.status(400).json({ error: "Parol kamida 6 belgidan iborat bo'lishi kerak" });
  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await query(
      'INSERT INTO developers (email, name, password_hash) VALUES ($1,$2,$3) ON CONFLICT(email) DO NOTHING RETURNING *',
      [email.trim().toLowerCase(), email.split('@')[0], hash]
    );
    if (!rows[0]) return res.status(409).json({ error: 'Bu email allaqachon mavjud' });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Developer paroli yangilash
router.put('/developers/:id/password', async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 6) return res.status(400).json({ error: "Parol kamida 6 belgidan iborat bo'lishi kerak" });
  const hash = await bcrypt.hash(password, 10);
  await query('UPDATE developers SET password_hash=$1 WHERE id=$2', [hash, req.params.id]);
  res.json({ ok: true });
});

router.delete('/developers/:id', async (req, res) => {
  // O'zini o'chira olmaydi
  const { rows } = await query('SELECT email FROM developers WHERE id=$1', [req.params.id]);
  if (rows[0]?.email === req.auth.email) {
    return res.status(400).json({ error: 'O\'zingizni o\'chira olmaysiz' });
  }
  await query('DELETE FROM developers WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
