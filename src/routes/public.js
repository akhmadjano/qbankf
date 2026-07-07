const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../db');
const { signStudentToken, requireStudent } = require('../auth');
const { validateTelegramWebAppData, sendAdminNotification, bot } = require('../bot');

const router = express.Router();

// Maintenance middleware — barcha public route'lar uchun
router.use(async (req, res, next) => {
  // Auth route'lar maintenance da ham ishlashi kerak
  if (req.path.startsWith('/auth')) return next();
  try {
    const { rows } = await query('SELECT enabled, message FROM maintenance WHERE id=1');
    if (rows[0]?.enabled) {
      return res.status(503).json({ maintenance: true, message: rows[0].message });
    }
  } catch (e) {}
  next();
});

// ---------- TELEGRAM AUTH ----------
router.post('/auth/telegram', async (req, res) => {
  const { initData, first_name, last_name } = req.body;
  const tgUser = validateTelegramWebAppData(initData);

  if (!tgUser) {
    return res.status(401).json({ error: 'Telegram orqali tasdiqlashda xatolik. Iltimos botni qaytadan oching.' });
  }

  const telegramId = String(tgUser.id);
  const { rows } = await query('SELECT * FROM students WHERE telegram_id = $1', [telegramId]);
  let student = rows[0];

  if (!student) {
    const ins = await query(
      'INSERT INTO students (telegram_id, first_name, last_name, username, auth_type) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [telegramId, '', '', tgUser.username || '', 'telegram']
    );
    student = ins.rows[0];
  }

  const token = signStudentToken(student);
  res.json({
    token,
    student: { id: student.id, first_name: student.first_name, last_name: student.last_name, username: student.username },
    needs_name: !student.first_name
  });
});

// ---------- ISM/FAMILIYA SAQLASH ----------
router.post('/auth/set-name', async (req, res) => {
  const { initData, first_name, last_name } = req.body;
  const tgUser = validateTelegramWebAppData(initData);

  if (!tgUser) {
    return res.status(401).json({ error: 'Tasdiqlashda xatolik.' });
  }
  if (!first_name || !first_name.trim()) {
    return res.status(400).json({ error: 'Ism kiritish majburiy.' });
  }

  const telegramId = String(tgUser.id);
  const { rows } = await query(
    'UPDATE students SET first_name=$1, last_name=$2 WHERE telegram_id=$3 RETURNING *',
    [first_name.trim(), (last_name || '').trim(), telegramId]
  );
  const student = rows[0];
  if (!student) return res.status(404).json({ error: 'Foydalanuvchi topilmadi.' });

  const token = signStudentToken(student);
  res.json({ token, student: { id: student.id, first_name: student.first_name, last_name: student.last_name, username: student.username } });
});

// ---------- BOT INFO (botga taklif tugmasi uchun) ----------
router.get('/bot-info', async (req, res) => {
  try {
    const username = bot?.botInfo?.username || process.env.BOT_USERNAME || null;
    res.json({ username, link: username ? `https://t.me/${username}` : null });
  } catch (e) {
    res.json({ username: null, link: null });
  }
});

// ---------- LOGIN/PAROL: RO'YXATDAN O'TISH ----------
router.post('/auth/register', async (req, res) => {
  const { username, password, first_name, last_name } = req.body;
  if (!username || !username.trim() || !password || password.length < 4) {
    return res.status(400).json({ error: 'Login (kamida 3 belgi) va parol (kamida 4 belgi) kiriting' });
  }
  if (!first_name || !first_name.trim()) {
    return res.status(400).json({ error: 'Ism kiritish majburiy' });
  }
  const uname = username.trim().toLowerCase();

  const { rows: existing } = await query(
    `SELECT id FROM students WHERE LOWER(username) = $1 AND password_hash IS NOT NULL`,
    [uname]
  );
  if (existing[0]) {
    return res.status(409).json({ error: 'Bu login band, boshqa login tanlang' });
  }

  const hash = await bcrypt.hash(password, 10);
  const { rows } = await query(
    `INSERT INTO students (username, password_hash, first_name, last_name, auth_type)
     VALUES ($1,$2,$3,$4,'password') RETURNING *`,
    [uname, hash, first_name.trim(), (last_name || '').trim()]
  );
  const student = rows[0];
  const token = signStudentToken(student);
  res.json({
    token,
    student: { id: student.id, first_name: student.first_name, last_name: student.last_name, username: student.username }
  });
});

// ---------- LOGIN/PAROL: KIRISH ----------
router.post('/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Login va parol kiriting' });
  }
  const uname = username.trim().toLowerCase();

  const { rows } = await query(
    `SELECT * FROM students WHERE LOWER(username) = $1 AND password_hash IS NOT NULL`,
    [uname]
  );
  const student = rows[0];
  if (!student) return res.status(401).json({ error: 'Login yoki parol xato' });

  const ok = await bcrypt.compare(password, student.password_hash);
  if (!ok) return res.status(401).json({ error: 'Login yoki parol xato' });

  const token = signStudentToken(student);
  res.json({
    token,
    student: { id: student.id, first_name: student.first_name, last_name: student.last_name, username: student.username }
  });
});

// ---------- MAINTENANCE STATUS (public) ----------
router.get('/maintenance/status', async (req, res) => {
  try {
    const { rows } = await query('SELECT enabled, message FROM maintenance WHERE id=1');
    res.json(rows[0] || { enabled: false, message: '' });
  } catch (e) {
    res.json({ enabled: false, message: '' });
  }
});

router.use(requireStudent);

// ---------- PROFIL ----------
router.put('/me/profile', async (req, res) => {
  const { first_name, last_name } = req.body;
  if (!first_name || !first_name.trim()) {
    return res.status(400).json({ error: 'Ism kiritish majburiy.' });
  }

  const { rows } = await query(
    'UPDATE students SET first_name=$1, last_name=$2 WHERE id=$3 RETURNING *',
    [first_name.trim(), (last_name || '').trim(), req.auth.id]
  );
  const student = rows[0];
  if (!student) return res.status(404).json({ error: 'Foydalanuvchi topilmadi.' });

  res.json({ student: { id: student.id, first_name: student.first_name, last_name: student.last_name, username: student.username } });
});

// ---------- SUBJECTS ----------
router.get('/subjects', async (req, res) => {
  const { rows } = await query(`
    SELECT s.id, s.name, s.description, s.time_limit_minutes, COUNT(q.id)::int AS question_count
    FROM subjects s
    LEFT JOIN questions q ON q.subject_id = s.id
    GROUP BY s.id
    HAVING COUNT(q.id) > 0
    ORDER BY s.name ASC
  `);
  res.json(rows);
});

// ---------- ACTIVE (TUGALLANMAGAN) ATTEMPT ----------
router.get('/subjects/:id/active', async (req, res) => {
  const subjectId = req.params.id;
  const { rows: attemptRows } = await query(`
    SELECT a.*, s.time_limit_minutes
    FROM attempts a
    JOIN subjects s ON s.id = a.subject_id
    WHERE a.student_id=$1 AND a.subject_id=$2 AND a.finished_at IS NULL AND a.abandoned=false
    ORDER BY a.started_at DESC
    LIMIT 1
  `, [req.auth.id, subjectId]);
  const attempt = attemptRows[0];
  if (!attempt) return res.json({ active: null });

  const questionIds = attempt.question_ids;
  const { rows: questions } = await query(
    'SELECT id, question_text, image_url, options FROM questions WHERE id = ANY($1::int[])',
    [questionIds]
  );
  const questionMap = {};
  questions.forEach(q => questionMap[q.id] = q);
  const orderedQuestions = questionIds.map(id => questionMap[id]).filter(Boolean);

  let remaining_minutes = null;
  if (attempt.time_limit_minutes) {
    const elapsedMin = (Date.now() - new Date(attempt.started_at).getTime()) / 60000;
    remaining_minutes = Math.max(attempt.time_limit_minutes - elapsedMin, 0);
  }

  res.json({
    active: {
      attempt_id: attempt.id,
      questions: orderedQuestions,
      answers: attempt.answers || {},
      flags: attempt.flags || {},
      question_times: attempt.question_times || {},
      current_index: attempt.current_index || 0,
      time_limit_minutes: attempt.time_limit_minutes,
      remaining_minutes
    }
  });
});

// ---------- START ATTEMPT ----------
router.post('/subjects/:id/start', async (req, res) => {
  const subjectId = req.params.id;
  const { count, mode } = req.body;

  // Agar shu fanda "So'zlar" (vocab) bo'lsa, testni boshlashdan oldin
  // kamida 1-bo'lim so'zlarini (80%) o'rganib chiqish majburiy
  const { rows: vocabCountRows } = await query(
    'SELECT COUNT(*)::int AS c FROM vocab_words WHERE subject_id = $1', [subjectId]
  );
  if (vocabCountRows[0].c > 0) {
    const { rows: firstSecRows } = await query(
      'SELECT passed FROM vocab_section_progress WHERE student_id = $1 AND subject_id = $2 AND section_index = 0',
      [req.auth.id, subjectId]
    );
    if (!firstSecRows[0]?.passed) {
      return res.status(403).json({
        error: "Testni boshlashdan oldin ushbu fanning \"So'zlar\" bo'limidagi 1-bo'limni (kamida 80%) o'rganib chiqing",
        vocab_required: true,
        subject_id: Number(subjectId),
      });
    }
  }

  let questionIds;
  if (mode === 'wrong') {
    const { rows: wrongIds } = await query(`
      SELECT qp.question_id FROM question_progress qp
      WHERE qp.student_id = $1 AND qp.is_correct = false
        AND qp.question_id IN (SELECT id FROM questions WHERE subject_id = $2)
      ORDER BY qp.updated_at DESC
    `, [req.auth.id, subjectId]);
    questionIds = wrongIds.map(r => r.question_id);
  } else if (mode === 'unseen') {
    const { rows: unseenIds } = await query(`
      SELECT q.id FROM questions q
      WHERE q.subject_id = $1
        AND q.id NOT IN (
          SELECT question_id FROM question_progress WHERE student_id = $2 AND is_correct = true
        )
      ORDER BY RANDOM()
    `, [subjectId, req.auth.id]);
    questionIds = unseenIds.map(r => r.id);
  } else {
    const { rows: allIds } = await query(
      'SELECT id FROM questions WHERE subject_id = $1 ORDER BY RANDOM()',
      [subjectId]
    );
    questionIds = allIds.map(r => r.id);
  }

  const maxCount = count && count > 0 ? Math.min(count, questionIds.length) : questionIds.length;
  questionIds = questionIds.slice(0, maxCount);

  if (questionIds.length === 0) {
    return res.status(400).json({ error: 'Savollar topilmadi.' });
  }

  // Shu fan bo'yicha eski tugallanmagan testlar endi "abandoned" hisoblanadi
  await query(
    'UPDATE attempts SET abandoned=true WHERE student_id=$1 AND subject_id=$2 AND finished_at IS NULL',
    [req.auth.id, subjectId]
  );

  const { rows: attemptRows } = await query(
    'INSERT INTO attempts (student_id, subject_id, question_ids, current_index) VALUES ($1,$2,$3,0) RETURNING *',
    [req.auth.id, subjectId, JSON.stringify(questionIds)]
  );
  const attempt = attemptRows[0];

  const { rows: questions } = await query(
    'SELECT id, question_text, image_url, options FROM questions WHERE id = ANY($1::int[])',
    [questionIds]
  );
  const questionMap = {};
  questions.forEach(q => questionMap[q.id] = q);
  const orderedQuestions = questionIds.map(id => questionMap[id]).filter(Boolean);

  res.json({ attempt_id: attempt.id, questions: orderedQuestions });
});

// ---------- SUBMIT ATTEMPT ----------
router.post('/attempts/:id/submit', async (req, res) => {
  const attemptId = req.params.id;
  const { answers, question_times, times } = req.body;
  const questionTimes = question_times || times || {};

  const { rows: attemptRows } = await query(
    'SELECT * FROM attempts WHERE id=$1 AND student_id=$2',
    [attemptId, req.auth.id]
  );
  const attempt = attemptRows[0];
  if (!attempt) return res.status(404).json({ error: 'Topilmadi' });
  if (attempt.finished_at) return res.status(400).json({ error: 'Allaqachon yakunlangan' });

  const questionIds = attempt.question_ids;
  const { rows: questions } = await query(
    'SELECT id, correct_index, explanation FROM questions WHERE id = ANY($1::int[])',
    [questionIds]
  );
  const questionMap = {};
  questions.forEach(q => questionMap[q.id] = q);

  let score = 0;
  const results = {};
  for (const qId of questionIds) {
    const q = questionMap[qId];
    if (!q) continue;
    const given = answers?.[qId];
    const correct = given !== undefined && given !== null && Number(given) === q.correct_index;
    if (correct) score++;
    results[qId] = {
      given_index: given !== undefined ? Number(given) : null,
      correct_index: q.correct_index,
      is_correct: correct,
      explanation: q.explanation || null
    };

    // question_progress yangilash
    await query(`
      INSERT INTO question_progress (student_id, question_id, is_correct, given_index, attempt_id)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (student_id, question_id) DO UPDATE
        SET is_correct=$3, given_index=$4, attempt_id=$5, updated_at=NOW()
    `, [req.auth.id, qId, correct, given !== undefined ? Number(given) : null, attemptId]);
  }

  const total = questionIds.length;
  const startedAt = attempt.started_at;
  const finishedAt = new Date();
  const durationSeconds = Math.round((finishedAt - new Date(startedAt)) / 1000);

  await query(
    'UPDATE attempts SET answers=$1, score=$2, total=$3, finished_at=$4, question_times=$5 WHERE id=$6',
    [JSON.stringify(answers || {}), score, total, finishedAt, JSON.stringify(questionTimes), attemptId]
  );

  // Bot statistikani yangilash
  await query(`
    INSERT INTO bot_stats (date, total_tests, total_users)
    VALUES (CURRENT_DATE, 1, (SELECT COUNT(*) FROM students))
    ON CONFLICT (date) DO UPDATE 
      SET total_tests = bot_stats.total_tests + 1, updated_at = NOW()
  `).catch(() => {});

  // Subject nomini olish admin xabari uchun
  const { rows: subjectRows } = await query('SELECT name FROM subjects WHERE id=$1', [attempt.subject_id]);
  const subjectName = subjectRows[0]?.name || 'Noma\'lum';

  const { rows: studentRows } = await query('SELECT * FROM students WHERE id=$1', [req.auth.id]);
  const student = studentRows[0];

  await sendAdminNotification({
    firstName: student?.first_name || '',
    lastName: student?.last_name || '',
    subjectName,
    score,
    total,
    durationSeconds
  });

  res.json({ score, total, results, duration_seconds: durationSeconds });
});

// ---------- TEST DAVOMIDA AVTOSAQLASH (real-time progress / heartbeat) ----------
router.post('/attempts/:id/progress', async (req, res) => {
  const attemptId = req.params.id;
  const { answers, times, current_index, flags, exiting } = req.body;
  try {
    const { rows } = await query(`
      UPDATE attempts
      SET answers=$1, question_times=$2, current_index=$3, flags=$4,
          last_activity_at=NOW(), session_active=$7
      WHERE id=$5 AND student_id=$6 AND finished_at IS NULL
      RETURNING id
    `, [
      JSON.stringify(answers || {}),
      JSON.stringify(times || {}),
      Number.isFinite(current_index) ? current_index : 0,
      JSON.stringify(flags || {}),
      attemptId,
      req.auth.id,
      !exiting
    ]);
    res.json({ ok: !!rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- LEADERBOARD ----------
router.get('/leaderboard', async (req, res) => {
  const { rows } = await query(`
    SELECT
      st.id AS student_id,
      st.first_name,
      st.last_name,
      st.username,
      st.avatar_url,
      COUNT(a.id)::int AS attempt_count,
      COALESCE(SUM(a.score), 0)::int AS total_correct,
      COALESCE(SUM(a.total), 0)::int AS total_questions,
      COALESCE(AVG(CASE WHEN a.total > 0 THEN a.score::float / a.total * 100 END), 0)::int AS avg_pct,
      MAX(subj.name) AS last_subject
    FROM students st
    JOIN attempts a ON a.student_id = st.id
    LEFT JOIN subjects subj ON subj.id = a.subject_id
    WHERE a.finished_at IS NOT NULL
    GROUP BY st.id
    HAVING COUNT(a.id) >= 1
    ORDER BY avg_pct DESC, attempt_count DESC
    LIMIT 50
  `);
  const ranked = rows.map((r, i) => ({ ...r, rank: i + 1 }));
  res.json(ranked);
});

// ---------- MY STATS ----------
router.get('/me/stats', async (req, res) => {
  const { rows } = await query(`
    SELECT
      COUNT(*)::int AS attempt_count,
      COALESCE(SUM(score), 0)::int AS total_correct,
      COALESCE(SUM(total), 0)::int AS total_questions,
      COALESCE(AVG(CASE WHEN total > 0 THEN score::float / total * 100 END), 0)::float AS avg_pct
    FROM attempts
    WHERE student_id = $1 AND finished_at IS NOT NULL
  `, [req.auth.id]);
  res.json(rows[0] || { attempt_count: 0, total_correct: 0, total_questions: 0, avg_pct: 0 });
});

// ---------- MY ATTEMPTS ----------
router.get('/me/attempts', async (req, res) => {
  const { rows } = await query(`
    SELECT a.id, a.score, a.total, a.started_at, a.finished_at, s.name AS subject_name
    FROM attempts a
    JOIN subjects s ON s.id = a.subject_id
    WHERE a.student_id = $1 AND a.finished_at IS NOT NULL
    ORDER BY a.finished_at DESC
    LIMIT 30
  `, [req.auth.id]);
  res.json(rows);
});

// ---------- MY RESULTS ----------
router.get('/me/results', async (req, res) => {
  const { rows } = await query(`
    SELECT a.id, a.score, a.total, a.started_at, a.finished_at, s.name AS subject_name
    FROM attempts a
    JOIN subjects s ON s.id = a.subject_id
    WHERE a.student_id = $1 AND a.finished_at IS NOT NULL
    ORDER BY a.finished_at DESC
    LIMIT 20
  `, [req.auth.id]);
  res.json(rows);
});

// ---------- QUESTION PROGRESS ----------
router.get('/me/progress', async (req, res) => {
  const { rows } = await query(`
    SELECT q.subject_id, COUNT(*)::int AS total,
           SUM(CASE WHEN qp.is_correct THEN 1 ELSE 0 END)::int AS correct
    FROM question_progress qp
    JOIN questions q ON q.id = qp.question_id
    WHERE qp.student_id = $1
    GROUP BY q.subject_id
  `, [req.auth.id]);
  res.json(rows);
});

// ---------- SO'ZLAR (har bir so'z bir "fan"ga biriktirilgan) ----------
//
// Tuzilma: har fandagi so'zlar ID bo'yicha 20 talik BO'LIMlarga bo'linadi.
// Boshida faqat DASTLABKI 3 ta bo'lim ochiq bo'ladi. Shundan keyin ketma-ket:
// N-bo'lim kamida 80% bilan topshirilsa, (N+1)-bo'lim ochiladi. Har bir
// so'zning "yodlangan/yodlanmagan" holati serverda saqlanadi (barcha
// qurilmalarda bir xil ko'rinadi), o'quvchi reytingi FAQAT shu yodlangan
// so'zlar soniga qarab hisoblanadi.
const VOCAB_SECTION_SIZE = 20;
const VOCAB_INITIAL_OPEN = 3;     // boshida nechta bo'lim ochiq bo'ladi
const VOCAB_PASS_PERCENT = 80;

// ---------- JONLAR (HEARTS) TIZIMI ----------
// Boshida VOCAB_LIVES_MAX ta jon beriladi. Har xato javob uchun -1 jon,
// har bir bo'lim (kamida 80%) topshirilganda +2 jon (maksimumdan oshmaydi).
// Jonlar 0 ga tushib qolsa, to'liq tiklanishi uchun VOCAB_LIVES_REFILL_HOURS
// soat kutish kerak.
const VOCAB_LIVES_MAX = 10;
const VOCAB_LIVES_REFILL_HOURS = 6;

// Joriy jon holatini o'qiydi, agar tiklanish vaqti o'tgan bo'lsa avtomatik
// to'ldirib qo'yadi, so'ng {lives, max_lives, refill_at} qaytaradi
async function refreshAndGetLives(studentId) {
  const { rows } = await query(
    'SELECT COALESCE(vocab_lives, $2) AS lives, vocab_lives_refill_at FROM students WHERE id = $1',
    [studentId, VOCAB_LIVES_MAX]
  );
  if (!rows[0]) return { lives: VOCAB_LIVES_MAX, max_lives: VOCAB_LIVES_MAX, refill_at: null };

  let { lives, vocab_lives_refill_at: refillAt } = rows[0];
  if (refillAt && new Date(refillAt).getTime() <= Date.now()) {
    lives = VOCAB_LIVES_MAX;
    refillAt = null;
    await query('UPDATE students SET vocab_lives = $2, vocab_lives_refill_at = NULL WHERE id = $1', [studentId, lives]);
  }
  return { lives, max_lives: VOCAB_LIVES_MAX, refill_at: refillAt };
}

// Jonlar sonini amount'ga o'zgartiradi (manfiy = yo'qotish, musbat = qo'shish),
// 0..VOCAB_LIVES_MAX oralig'ida ushlab turadi va kerak bo'lsa tiklanish vaqtini belgilaydi
async function adjustLives(studentId, amount) {
  const current = await refreshAndGetLives(studentId);
  let lives = Math.max(0, Math.min(VOCAB_LIVES_MAX, current.lives + amount));
  let refillAt = current.refill_at;
  if (lives === 0 && current.lives > 0) {
    refillAt = new Date(Date.now() + VOCAB_LIVES_REFILL_HOURS * 3600 * 1000);
  } else if (lives > 0) {
    refillAt = null;
  }
  await query('UPDATE students SET vocab_lives = $2, vocab_lives_refill_at = $3 WHERE id = $1', [studentId, lives, refillAt]);
  return { lives, max_lives: VOCAB_LIVES_MAX, refill_at: refillAt };
}

// Joriy jon holatini olish
router.get('/vocab/lives', async (req, res) => {
  const status = await refreshAndGetLives(req.auth.id);
  res.json(status);
});

// Xato javobdan keyin 1 jon kamaytirish
router.post('/vocab/lives/lose', async (req, res) => {
  const status = await adjustLives(req.auth.id, -1);
  res.json(status);
});


function buildSections(words) {
  const sorted = words.slice().sort((a, b) => a.id - b.id);
  const sections = [];
  for (let i = 0; i < sorted.length; i += VOCAB_SECTION_SIZE) {
    sections.push(sorted.slice(i, i + VOCAB_SECTION_SIZE));
  }
  return sections;
}

// Bosh ekran uchun umumiy statistikalar (barcha fanlar bo'yicha)
router.get('/vocab/overview', async (req, res) => {
  const { rows: wc } = await query('SELECT COUNT(*)::int AS word_count FROM vocab_words');
  const { rows: me } = await query(
    'SELECT COALESCE(vocab_points,0) AS points, COALESCE(vocab_games_played,0) AS games_played, COALESCE(vocab_learned_count,0) AS learned_count FROM students WHERE id = $1',
    [req.auth.id]
  );
  const { rows: rankRows } = await query(`
    SELECT COUNT(*)::int + 1 AS rank FROM students
    WHERE COALESCE(vocab_learned_count,0) > (SELECT COALESCE(vocab_learned_count,0) FROM students WHERE id = $1)
  `, [req.auth.id]);
  const lives = await refreshAndGetLives(req.auth.id);

  res.json({
    word_count: wc[0].word_count,
    points: me[0]?.points || 0,
    games_played: me[0]?.games_played || 0,
    learned_count: me[0]?.learned_count || 0,
    rank: (me[0]?.learned_count || 0) > 0 ? rankRows[0].rank : null,
    lives: lives.lives,
    max_lives: lives.max_lives,
    lives_refill_at: lives.refill_at,
  });
});

// Fanlar ro'yxati — so'z borligiga qarab, har biriga o'quvchining shu fandagi natijasi bilan
router.get('/vocab/subjects', async (req, res) => {
  const { rows } = await query(`
    SELECT sub.id, sub.name, sub.description, COUNT(w.id)::int AS word_count
    FROM subjects sub
    JOIN vocab_words w ON w.subject_id = sub.id
    GROUP BY sub.id
    ORDER BY sub.name ASC
  `);

  const { rows: learnedRows } = await query(`
    SELECT w.subject_id AS subject_id, COUNT(*)::int AS learned_count
    FROM vocab_word_status s
    JOIN vocab_words w ON w.id = s.word_id
    WHERE s.student_id = $1 AND s.learned = true
    GROUP BY w.subject_id
  `, [req.auth.id]);
  const learnedMap = {};
  learnedRows.forEach(r => { learnedMap[r.subject_id] = r.learned_count; });

  res.json(rows.map(s => ({ ...s, learned_count: learnedMap[s.id] || 0 })));
});

// Tanlangan fandagi BARCHA so'zlar (distraktorlar/moslashtirish uchun ham ishlatiladi)
router.get('/vocab/words', async (req, res) => {
  const { subject_id } = req.query;
  if (!subject_id) return res.status(400).json({ error: 'Fan tanlanmagan' });
  const { rows } = await query(
    'SELECT id, word, translation, example FROM vocab_words WHERE subject_id = $1 ORDER BY id ASC',
    [subject_id]
  );
  if (rows.length === 0) return res.status(404).json({ error: "Bu fanda hozircha so'zlar yo'q" });
  res.json(rows);
});

// Bo'limlar (guruhlangan holda) ro'yxati — qulf/ochiq holati serverda hisoblanadi
router.get('/vocab/sections', async (req, res) => {
  const { subject_id } = req.query;
  if (!subject_id) return res.status(400).json({ error: 'Fan tanlanmagan' });

  const { rows: words } = await query(
    'SELECT id, word, translation FROM vocab_words WHERE subject_id = $1 ORDER BY id ASC',
    [subject_id]
  );
  const sections = buildSections(words);

  const { rows: progressRows } = await query(
    'SELECT section_index, best_pct, passed FROM vocab_section_progress WHERE student_id = $1 AND subject_id = $2',
    [req.auth.id, subject_id]
  );
  const progressMap = {};
  progressRows.forEach(r => { progressMap[r.section_index] = r; });

  const { rows: learnedRows } = await query(`
    SELECT w.id AS word_id, s.learned
    FROM vocab_word_status s
    JOIN vocab_words w ON w.id = s.word_id
    WHERE s.student_id = $1 AND w.subject_id = $2
  `, [req.auth.id, subject_id]);
  const learnedMap = {};
  learnedRows.forEach(r => { learnedMap[r.word_id] = r.learned; });

  const result = sections.map((sectionWords, idx) => {
    const prog = progressMap[idx];
    const learnedCount = sectionWords.filter(w => learnedMap[w.id]).length;
    return {
      index: idx,
      word_count: sectionWords.length,
      learned_count: learnedCount,
      best_pct: prog ? prog.best_pct : 0,
      passed: prog ? prog.passed : false,
    };
  });

  // Dastlabki VOCAB_INITIAL_OPEN ta bo'lim har doim ochiq. Shundan keyingi
  // har bir bo'lim faqat undan OLDINGI bo'lim topshirilgan bo'lsa ochiladi.
  result.forEach((s, idx) => {
    s.unlocked = idx < VOCAB_INITIAL_OPEN || !!result[idx - 1]?.passed;
  });

  res.json({ sections: result, initial_open: VOCAB_INITIAL_OPEN, section_size: VOCAB_SECTION_SIZE, pass_percent: VOCAB_PASS_PERCENT });
});

// Bitta bo'limning so'zlarini olib kelish — 3 bosqichli sessiya
// (Moslashtirish -> Yozish -> Oddiy test) shu ro'yxat ustida ishlaydi
router.get('/vocab/section-words', async (req, res) => {
  const { subject_id, section } = req.query;
  const sectionIndex = parseInt(section, 10);
  if (!subject_id || Number.isNaN(sectionIndex)) return res.status(400).json({ error: "Fan yoki bo'lim tanlanmagan" });

  const { rows: words } = await query(
    'SELECT id, word, translation, example FROM vocab_words WHERE subject_id = $1 ORDER BY id ASC',
    [subject_id]
  );
  const sections = buildSections(words);
  if (sectionIndex < 0 || sectionIndex >= sections.length) return res.status(404).json({ error: "Bu bo'lim mavjud emas" });

  const livesStatus = await refreshAndGetLives(req.auth.id);
  if (livesStatus.lives <= 0) {
    const msLeft = livesStatus.refill_at ? new Date(livesStatus.refill_at).getTime() - Date.now() : VOCAB_LIVES_REFILL_HOURS * 3600 * 1000;
    const hoursLeft = Math.max(0, Math.ceil(msLeft / 3600000));
    return res.status(403).json({ error: `Jonlaringiz tugagan. ${hoursLeft} soatdan keyin tiklanadi`, lives: livesStatus });
  }

  // Qulflanganligini tekshirish: dastlabki bo'limlardan tashqarisi uchun
  // oldingi bo'lim to'liq (80%) topshirilgan bo'lishi kerak
  if (sectionIndex >= VOCAB_INITIAL_OPEN) {
    const { rows: prevProgress } = await query(
      'SELECT passed FROM vocab_section_progress WHERE student_id = $1 AND subject_id = $2 AND section_index = $3',
      [req.auth.id, subject_id, sectionIndex - 1]
    );
    if (!prevProgress[0]?.passed) return res.status(403).json({ error: "Avvalgi bo'limni to'liq (80%) topshiring" });
  }

  const out = sections[sectionIndex].map(w => ({ ...w, section_index: sectionIndex }));
  res.json({ words: out, section_index: sectionIndex });
});

// Bitta so'z bo'yicha natija — har safar biror bosqichda so'z so'ralganda chaqiriladi.
// "learned" (yodlangan) holati FAQAT yakuniy "quiz" bosqichida yangilanadi.
router.post('/vocab/word-result', async (req, res) => {
  const wordId = parseInt(req.body.word_id, 10);
  const stage = (req.body.stage || 'quiz').toString();
  const correct = !!req.body.correct;
  if (!wordId) return res.status(400).json({ error: "So'z tanlanmagan" });

  if (stage !== 'quiz') {
    // Moslashtirish/Yozish bosqichlari faqat mashq — learned holatiga ta'sir qilmaydi
    return res.json({ ok: true, stage });
  }

  const { rows: existing } = await query(
    'SELECT learned FROM vocab_word_status WHERE student_id = $1 AND word_id = $2',
    [req.auth.id, wordId]
  );
  const wasLearned = existing[0]?.learned || false;

  await query(`
    INSERT INTO vocab_word_status (student_id, word_id, learned, correct_streak, attempts_count, updated_at)
    VALUES ($1, $2, $3, $4, 1, NOW())
    ON CONFLICT (student_id, word_id) DO UPDATE SET
      learned = $3,
      correct_streak = $4,
      attempts_count = vocab_word_status.attempts_count + 1,
      updated_at = NOW()
  `, [req.auth.id, wordId, correct, correct ? 1 : 0]);

  if (correct !== wasLearned) {
    await query(
      'UPDATE students SET vocab_learned_count = GREATEST(0, COALESCE(vocab_learned_count,0) + $2) WHERE id = $1',
      [req.auth.id, correct ? 1 : -1]
    );
  }

  res.json({ ok: true, learned: correct });
});

// Bo'lim sessiyasi (3 bosqich) tugagach — natijani yozib, ball qo'shish
router.post('/vocab/section-attempt', async (req, res) => {
  const { subject_id } = req.body;
  const sectionIndex = parseInt(req.body.section_index, 10);
  const correct = Math.max(0, Math.round(Number(req.body.correct) || 0));
  const total = Math.max(0, Math.round(Number(req.body.total) || 0));
  const points = Math.max(0, Math.round(Number(req.body.points) || 0));
  if (!subject_id || Number.isNaN(sectionIndex) || total === 0) return res.status(400).json({ error: "Ma'lumot yetarli emas" });

  const pct = Math.max(0, Math.min(100, Math.round((correct / total) * 100)));
  const passed = pct >= VOCAB_PASS_PERCENT;

  const { rows } = await query(`
    INSERT INTO vocab_section_progress (student_id, subject_id, section_index, best_pct, passed, passed_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, CASE WHEN $5 THEN NOW() ELSE NULL END, NOW())
    ON CONFLICT (student_id, subject_id, section_index) DO UPDATE SET
      best_pct = GREATEST(vocab_section_progress.best_pct, $4),
      passed = vocab_section_progress.passed OR $5,
      passed_at = CASE WHEN vocab_section_progress.passed THEN vocab_section_progress.passed_at
                        WHEN $5 THEN NOW() ELSE vocab_section_progress.passed_at END,
      updated_at = NOW()
    RETURNING *
  `, [req.auth.id, subject_id, sectionIndex, pct, passed]);

  const { rows: studentRows } = await query(
    'UPDATE students SET vocab_points = COALESCE(vocab_points,0) + $2, vocab_games_played = COALESCE(vocab_games_played,0) + 1 WHERE id = $1 RETURNING vocab_points, vocab_games_played, vocab_learned_count',
    [req.auth.id, points]
  );

  // Bo'lim shu urinishda kamida 80% bilan topshirilsa +2 jon beramiz
  let livesStatus = await refreshAndGetLives(req.auth.id);
  if (passed) {
    livesStatus = await adjustLives(req.auth.id, 2);
  }

  res.json({
    section: rows[0],
    passed: rows[0].passed,
    points_earned: points,
    total_points: studentRows[0].vocab_points,
    games_played: studentRows[0].vocab_games_played,
    learned_count: studentRows[0].vocab_learned_count,
    lives: livesStatus,
  });
});

// ---------- SO'ZLAR REYTINGI (asosiy test reytingidan mustaqil) ----------
// Reyting FAQAT "yodlangan" so'zlar soniga qarab — nechta sessiya
// ishlaganidan qat'iy nazar.
router.get('/vocab/leaderboard', async (req, res) => {
  const { rows } = await query(`
    SELECT id AS student_id, first_name, last_name, username, avatar_url,
           COALESCE(vocab_learned_count, 0) AS learned_count,
           COALESCE(vocab_points, 0) AS points,
           COALESCE(vocab_games_played, 0) AS games_played
    FROM students
    WHERE COALESCE(vocab_learned_count, 0) > 0
    ORDER BY learned_count DESC, points DESC
    LIMIT 50
  `);
  const ranked = rows.map((r, i) => ({ ...r, rank: i + 1 }));
  res.json(ranked);
});


module.exports = router;
