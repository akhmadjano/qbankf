const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway')
    ? { rejectUnauthorized: false }
    : (process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false })
});

async function query(text, params) {
  const result = await pool.query(text, params);
  return result;
}

async function migrateQuestionsToFlexibleOptions() {
  const { rows: cols } = await query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'questions' AND column_name = 'option_a'
  `);
  if (cols.length === 0) return;

  await query(`
    UPDATE questions SET
      options = jsonb_build_array(option_a, option_b, option_c, option_d),
      correct_index = CASE correct_option
        WHEN 'A' THEN 0 WHEN 'B' THEN 1 WHEN 'C' THEN 2 WHEN 'D' THEN 3 ELSE 0 END
    WHERE (options IS NULL OR options = '[]'::jsonb) AND option_a IS NOT NULL
  `);

  for (const col of ['option_a', 'option_b', 'option_c', 'option_d', 'correct_option']) {
    await query(`ALTER TABLE questions ALTER COLUMN ${col} DROP NOT NULL`).catch(() => {});
  }
  console.log('✅ Savollar jadvali moslashuvchan variantlar formatiga o\'tkazildi');
}

async function initDb() {
  await query(`
    CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS subjects (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      time_limit_minutes INTEGER,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await query(`ALTER TABLE subjects ADD COLUMN IF NOT EXISTS time_limit_minutes INTEGER`);

  await query(`
    CREATE TABLE IF NOT EXISTS questions (
      id SERIAL PRIMARY KEY,
      subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      question_text TEXT NOT NULL,
      image_url TEXT,
      options JSONB NOT NULL DEFAULT '[]'::jsonb,
      correct_index INTEGER NOT NULL DEFAULT 0,
      explanation TEXT,
      external_id TEXT,
      source_meta TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await query(`ALTER TABLE questions ADD COLUMN IF NOT EXISTS external_id TEXT`);
  await query(`ALTER TABLE questions ADD COLUMN IF NOT EXISTS source_meta TEXT`);
  await query(`ALTER TABLE questions ADD COLUMN IF NOT EXISTS options JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await query(`ALTER TABLE questions ADD COLUMN IF NOT EXISTS correct_index INTEGER NOT NULL DEFAULT 0`);
  await query(`ALTER TABLE questions ADD COLUMN IF NOT EXISTS explanation TEXT`);

  await migrateQuestionsToFlexibleOptions();

  await query(`
    CREATE TABLE IF NOT EXISTS students (
      id SERIAL PRIMARY KEY,
      telegram_id TEXT UNIQUE,
      first_name TEXT,
      last_name TEXT,
      username TEXT,
      avatar_url TEXT,
      auth_type TEXT DEFAULT 'telegram',
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  // Mavjud jadvalga yangi ustunlar qo'shish
  await query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS avatar_url TEXT`);
  await query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS auth_type TEXT DEFAULT 'telegram'`);
  await query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS password_hash TEXT`);
  await query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS username_pw TEXT`);
  // telegram_id NOT NULL constraint olib tashlash (login/parol usuli uchun)
  try { await query(`ALTER TABLE students ALTER COLUMN telegram_id DROP NOT NULL`); } catch(e) {}
  // username NOT NULL bo'lsa ham olib tashlash
  try { await query(`ALTER TABLE students ALTER COLUMN username DROP NOT NULL`); } catch(e) {}

  await query(`
    CREATE TABLE IF NOT EXISTS attempts (
      id SERIAL PRIMARY KEY,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      question_ids JSONB NOT NULL,
      answers JSONB DEFAULT '{}'::jsonb,
      question_times JSONB DEFAULT '{}'::jsonb,
      score INTEGER,
      total INTEGER,
      started_at TIMESTAMP DEFAULT NOW(),
      finished_at TIMESTAMP
    );
  `);
  await query(`ALTER TABLE attempts ADD COLUMN IF NOT EXISTS question_times JSONB DEFAULT '{}'::jsonb`);
  await query(`ALTER TABLE attempts ADD COLUMN IF NOT EXISTS current_index INTEGER DEFAULT 0`);
  await query(`ALTER TABLE attempts ADD COLUMN IF NOT EXISTS flags JSONB DEFAULT '{}'::jsonb`);
  await query(`ALTER TABLE attempts ADD COLUMN IF NOT EXISTS abandoned BOOLEAN DEFAULT false`);
  await query(`ALTER TABLE attempts ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMP DEFAULT NOW()`);
  await query(`ALTER TABLE attempts ADD COLUMN IF NOT EXISTS session_active BOOLEAN DEFAULT true`);

  await query(`
    CREATE TABLE IF NOT EXISTS question_progress (
      id SERIAL PRIMARY KEY,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      is_correct BOOLEAN NOT NULL,
      given_index INTEGER,
      attempt_id INTEGER REFERENCES attempts(id) ON DELETE SET NULL,
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(student_id, question_id)
    );
  `);

  // ========= YANGI JADVALLAR =========

  // Developer panel uchun
  await query(`
    CREATE TABLE IF NOT EXISTS developers (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      password_hash TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  // Mavjud developers jadvalini migration qilish (google_id -> password_hash)
  await query(`ALTER TABLE developers ADD COLUMN IF NOT EXISTS password_hash TEXT`);
  await query(`ALTER TABLE developers ADD COLUMN IF NOT EXISTS email_new TEXT`);
  // google_id NOT NULL constraint olib tashlash
  try { await query(`ALTER TABLE developers ALTER COLUMN google_id DROP NOT NULL`); } catch(e) {}
  // email ustuni yo'q bo'lsa, google_id dan ko'chirish
  try { await query(`UPDATE developers SET email_new = COALESCE(email, google_id) WHERE email_new IS NULL`); } catch(e) {}

  // Broadcast xabarlar
  await query(`
    CREATE TABLE IF NOT EXISTS broadcasts (
      id SERIAL PRIMARY KEY,
      message TEXT NOT NULL,
      sent_by TEXT NOT NULL,
      total_sent INTEGER DEFAULT 0,
      total_failed INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW(),
      finished_at TIMESTAMP
    );
  `);

  // Maintenance mode
  await query(`
    CREATE TABLE IF NOT EXISTS maintenance (
      id SERIAL PRIMARY KEY,
      enabled BOOLEAN DEFAULT false,
      message TEXT DEFAULT 'Saytda texnik ishlar olib borilmoqda. Tez orada qaytamiz! 🔧',
      updated_at TIMESTAMP DEFAULT NOW(),
      updated_by TEXT
    );
  `);

  // Birinchi maintenance yozuvi
  const { rows: mRows } = await query('SELECT COUNT(*)::int AS count FROM maintenance');
  if (mRows[0].count === 0) {
    await query(`INSERT INTO maintenance (enabled, message) VALUES (false, 'Saytda texnik ishlar olib borilmoqda. Tez orada qaytamiz! 🔧')`);
  }

  // Bot statistikasi
  await query(`
    CREATE TABLE IF NOT EXISTS bot_stats (
      id SERIAL PRIMARY KEY,
      date DATE DEFAULT CURRENT_DATE UNIQUE,
      total_tests INTEGER DEFAULT 0,
      total_users INTEGER DEFAULT 0,
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // ========= VOCAB (SO'ZLAR) — endi mavjud "fan"larga (subjects) biriktiriladi =========
  await query(`
    CREATE TABLE IF NOT EXISTS vocab_topics (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS vocab_words (
      id SERIAL PRIMARY KEY,
      topic_id INTEGER REFERENCES vocab_topics(id) ON DELETE CASCADE,
      subject_id INTEGER REFERENCES subjects(id) ON DELETE CASCADE,
      word TEXT NOT NULL,
      translation TEXT NOT NULL,
      example TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS vocab_progress (
      id SERIAL PRIMARY KEY,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      topic_id INTEGER REFERENCES vocab_topics(id) ON DELETE CASCADE,
      subject_id INTEGER REFERENCES subjects(id) ON DELETE CASCADE,
      best_score_pct INTEGER DEFAULT 0,
      last_score_pct INTEGER DEFAULT 0,
      attempts_count INTEGER DEFAULT 0,
      passed BOOLEAN DEFAULT false,
      passed_at TIMESTAMP,
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(student_id, topic_id)
    );
  `);

  // Eski (mavzu-asoslangan) o'rnatishlardan meros ustunlarni fan-asoslangan
  // tizimga moslashtiramiz: endi so'z qo'shishda "fan" majburiy, mavzu tizimi
  // ishlatilmaydi (jadval faqat orqaga moslik uchun qoladi).
  await query(`ALTER TABLE vocab_words ADD COLUMN IF NOT EXISTS subject_id INTEGER REFERENCES subjects(id) ON DELETE CASCADE`);
  await query(`ALTER TABLE vocab_progress ADD COLUMN IF NOT EXISTS subject_id INTEGER REFERENCES subjects(id) ON DELETE CASCADE`);
  await query(`ALTER TABLE vocab_words ALTER COLUMN topic_id DROP NOT NULL`).catch(() => {});
  await query(`ALTER TABLE vocab_progress ALTER COLUMN topic_id DROP NOT NULL`).catch(() => {});
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS vocab_progress_student_subject_uidx ON vocab_progress (student_id, subject_id)`);

  // Eski (fan biriktirilmagan) so'zlarni birinchi mavjud fanga bog'lab qo'yamiz
  await query(`
    UPDATE vocab_words SET subject_id = (SELECT id FROM subjects ORDER BY id LIMIT 1)
    WHERE subject_id IS NULL AND EXISTS (SELECT 1 FROM subjects)
  `);
  await query(`
    UPDATE vocab_progress SET subject_id = (SELECT id FROM subjects ORDER BY id LIMIT 1)
    WHERE subject_id IS NULL AND EXISTS (SELECT 1 FROM subjects)
  `);

  // So'zlar o'yini uchun alohida reyting (ballar) — asosiy test reytingidan mustaqil.
  await query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS vocab_points INTEGER DEFAULT 0`);
  await query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS vocab_games_played INTEGER DEFAULT 0`);

  // Har bir so'z uchun "yodlangan/yodlanmagan" holati — barcha qurilmalarda bir xil
  // ko'rinishi uchun serverda saqlanadi (localStorage emas). Faqat "oddiy test"
  // bosqichida (yakuniy tekshiruv) yangilanadi.
  await query(`
    CREATE TABLE IF NOT EXISTS vocab_word_status (
      id SERIAL PRIMARY KEY,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      word_id INTEGER NOT NULL REFERENCES vocab_words(id) ON DELETE CASCADE,
      learned BOOLEAN DEFAULT false,
      correct_streak INTEGER DEFAULT 0,
      attempts_count INTEGER DEFAULT 0,
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(student_id, word_id)
    );
  `);

  // Bo'lim (20 tadan so'z) darajasidagi natija — 3 talik guruhlar holda
  // qulflash/ochish mantig'i shu jadval orqali serverda saqlanadi.
  await query(`
    CREATE TABLE IF NOT EXISTS vocab_section_progress (
      id SERIAL PRIMARY KEY,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      section_index INTEGER NOT NULL,
      best_pct INTEGER DEFAULT 0,
      passed BOOLEAN DEFAULT false,
      passed_at TIMESTAMP,
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(student_id, subject_id, section_index)
    );
  `);

  // Reyting endi FAQAT "yodlangan" so'zlar soniga qarab hisoblanadi
  // (nechta sessiya ishlanganidan qat'iy nazar). Tezkor saralash uchun
  // keshlangan hisoblagich.
  await query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS vocab_learned_count INTEGER DEFAULT 0`);

  // Jonlar (hearts) tizimi: boshida 10 ta jon, har xato javob uchun -1,
  // bo'limni (kamida 80%) topshirsa +2. Jonlar 0 ga tushib qolsa, to'liq
  // tiklanishi uchun VOCAB_LIVES_REFILL_HOURS soat kutish kerak.
  await query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS vocab_lives INTEGER DEFAULT 10`);
  await query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS vocab_lives_refill_at TIMESTAMP`);

  // Admin yaratish
  const { rows } = await query('SELECT COUNT(*)::int AS count FROM admins');
  if (rows[0].count === 0) {
    const username = process.env.ADMIN_USERNAME || 'admin';
    const password = process.env.ADMIN_PASSWORD || 'admin123';
    const hash = await bcrypt.hash(password, 10);
    await query('INSERT INTO admins (username, password_hash) VALUES ($1, $2)', [username, hash]);
    console.log(`✅ Admin yaratildi -> login: ${username} / parol: ${password}`);
  }

  // Developer email + parol .env dan yaratish
  if (process.env.DEVELOPER_EMAIL && process.env.DEVELOPER_PASSWORD) {
    const { rows: devRows } = await query('SELECT COUNT(*)::int AS count FROM developers WHERE email=$1', [process.env.DEVELOPER_EMAIL]);
    if (devRows[0].count === 0) {
      const devHash = await bcrypt.hash(process.env.DEVELOPER_PASSWORD, 10);
      await query('INSERT INTO developers (email, name, password_hash) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
        [process.env.DEVELOPER_EMAIL, 'Developer', devHash]);
      console.log(`✅ Developer yaratildi -> email: ${process.env.DEVELOPER_EMAIL}`);
    }
  }
}

module.exports = { query, initDb, pool };
