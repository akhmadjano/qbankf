const express = require('express');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { parseQuestionBankPdf } = require('../pdfImport');
const { query } = require('../db');
const { signAdminToken, requireAdmin } = require('../auth');

const router = express.Router();

// A, B, C ... Z, AA, AB ... harflarni indeksdan hosil qilish (variantlar soni cheklanmagan)
function optionLetter(i) {
  let s = '';
  i = i + 1;
  while (i > 0) {
    const rem = (i - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

// ---------- LOGIN ----------
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Login va parol kiriting' });

  const { rows } = await query('SELECT * FROM admins WHERE username = $1', [username]);
  const admin = rows[0];
  if (!admin) return res.status(401).json({ error: 'Login yoki parol xato' });

  const ok = await bcrypt.compare(password, admin.password_hash);
  if (!ok) return res.status(401).json({ error: 'Login yoki parol xato' });

  const token = signAdminToken(admin);
  res.json({ token, username: admin.username });
});

router.use(requireAdmin); // quyidagi barcha yo'llar token talab qiladi

// ---------- SUBJECTS ----------
router.get('/subjects', async (req, res) => {
  const { rows } = await query(`
    SELECT s.*, COUNT(q.id)::int AS question_count
    FROM subjects s
    LEFT JOIN questions q ON q.subject_id = s.id
    GROUP BY s.id ORDER BY s.id DESC
  `);
  res.json(rows);
});

router.post('/subjects', async (req, res) => {
  const { name, description, time_limit_minutes } = req.body;
  if (!name) return res.status(400).json({ error: 'Fan nomini kiriting' });
  const tl = time_limit_minutes !== undefined && time_limit_minutes !== null && time_limit_minutes !== ''
    ? Math.max(1, parseInt(time_limit_minutes) || 0) : null;
  const { rows } = await query(
    'INSERT INTO subjects (name, description, time_limit_minutes) VALUES ($1, $2, $3) RETURNING *',
    [name, description || null, tl]
  );
  res.json(rows[0]);
});

router.put('/subjects/:id', async (req, res) => {
  const { name, description, time_limit_minutes } = req.body;
  const tl = time_limit_minutes !== undefined && time_limit_minutes !== null && time_limit_minutes !== ''
    ? Math.max(1, parseInt(time_limit_minutes) || 0) : null;
  const { rows } = await query(
    'UPDATE subjects SET name = $1, description = $2, time_limit_minutes = $3 WHERE id = $4 RETURNING *',
    [name, description || null, tl, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Topilmadi' });
  res.json(rows[0]);
});

router.delete('/subjects/:id', async (req, res) => {
  await query('DELETE FROM subjects WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ---------- QUESTIONS ----------
router.get('/questions', async (req, res) => {
  const { subject_id } = req.query;
  let sql = 'SELECT * FROM questions';
  const params = [];
  if (subject_id) {
    params.push(subject_id);
    sql += ' WHERE subject_id = $1';
  }
  sql += ' ORDER BY id DESC';
  const { rows } = await query(sql, params);
  res.json(rows);
});

router.post('/questions', async (req, res) => {
  const { subject_id, question_text, image_url, options, correct_index, explanation } = req.body;

  const cleanOptions = Array.isArray(options) ? options.map(o => (o || '').toString().trim()).filter(Boolean) : [];

  if (!subject_id || !question_text || cleanOptions.length < 2) {
    return res.status(400).json({ error: "Fan, savol matni va kamida 2 ta variant kerak" });
  }
  const idx = parseInt(correct_index);
  if (isNaN(idx) || idx < 0 || idx >= cleanOptions.length) {
    return res.status(400).json({ error: "To'g'ri javobni belgilang" });
  }

  const { rows } = await query(
    `INSERT INTO questions (subject_id, question_text, image_url, options, correct_index, explanation)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [subject_id, question_text, image_url || null, JSON.stringify(cleanOptions), idx, explanation || null]
  );
  res.json(rows[0]);
});

router.put('/questions/:id', async (req, res) => {
  const { subject_id, question_text, image_url, options, correct_index, explanation } = req.body;

  const cleanOptions = Array.isArray(options) ? options.map(o => (o || '').toString().trim()).filter(Boolean) : [];

  if (!subject_id || !question_text || cleanOptions.length < 2) {
    return res.status(400).json({ error: "Fan, savol matni va kamida 2 ta variant kerak" });
  }
  const idx = parseInt(correct_index);
  if (isNaN(idx) || idx < 0 || idx >= cleanOptions.length) {
    return res.status(400).json({ error: "To'g'ri javobni belgilang" });
  }

  const { rows } = await query(
    `UPDATE questions SET
      subject_id=$1, question_text=$2, image_url=$3, options=$4, correct_index=$5, explanation=$6
     WHERE id=$7 RETURNING *`,
    [subject_id, question_text, image_url || null, JSON.stringify(cleanOptions), idx, explanation || null, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Topilmadi' });
  res.json(rows[0]);
});

router.delete('/questions/:id', async (req, res) => {
  await query('DELETE FROM questions WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// "A", "B" ... "Z", "AA", "AB" ... harflarni indeksga aylantirish (optionLetter ning teskarisi)
function letterToIndex(letters) {
  if (!letters) return -1;
  let n = 0;
  for (const ch of letters.toUpperCase()) {
    const code = ch.charCodeAt(0) - 64; // A=1
    if (code < 1 || code > 26) return -1;
    n = n * 26 + code;
  }
  return n - 1;
}

// Excel sarlavhasini solishtirish uchun: bo'shliq/tinish belgilarini olib tashlab, kichik harfga o'tkazamiz
function normalizeHeader(s) {
  return (s || '').toString().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// ---------- QUESTIONS BULK IMPORT (Excel) ----------
router.get('/questions/import-template', async (req, res) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Savollar');
  ws.columns = [
    { header: 'Fan', key: 'subject', width: 18 },
    { header: 'Savol matni', key: 'question', width: 50 },
    { header: 'Variant A', key: 'optA', width: 28 },
    { header: 'Variant B', key: 'optB', width: 28 },
    { header: 'Variant C', key: 'optC', width: 28 },
    { header: 'Variant D', key: 'optD', width: 28 },
    { header: "To'g'ri javob", key: 'correct', width: 14 },
    { header: 'Izoh', key: 'explanation', width: 30 },
    { header: 'Rasm URL', key: 'image', width: 24 },
  ];
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0A3161' } };
  ws.addRow({
    subject: 'Matematika', question: '2 + 2 nechiga teng?',
    optA: '3', optB: '4', optC: '5', optD: '6',
    correct: 'B', explanation: '2+2=4', image: '',
  });
  ws.addRow({
    subject: 'Ingliz tili', question: 'Choose the correct word: She ___ a teacher.',
    optA: 'is', optB: 'are', optC: '', optD: '',
    correct: 'A', explanation: '', image: '',
  });

  const info = wb.addWorksheet("Yo'riqnoma");
  info.columns = [{ width: 90 }];
  [
    "QO'LLANMA — savollarni Excel orqali ommaviy yuklash",
    '',
    "1) \"Fan\" ustuniga fan nomini yozing — u admin paneldagi mavjud fan nomi bilan bir xil bo'lishi kerak (katta-kichik harf farqi muhim emas).",
    "   Agar import qilayotganda bitta fanni tanlab qo'ysangiz, bu ustun e'tiborga olinmaydi — barcha savollar shu fanga tushadi.",
    "2) \"Savol matni\" — majburiy.",
    "3) \"Variant A/B/C/...\" ustunlari — kamida 2 ta to'ldirilgan bo'lishi kerak. Variant soni cheklanmagan —",
    "   xohlasangiz \"Variant E\", \"Variant F\" va hokazo qo'shishingiz mumkin, yoki ishlatmaydiganlarini bo'sh qoldiring/o'chirib tashlang.",
    "4) \"To'g'ri javob\" ustuniga to'g'ri variant harfini yozing (masalan A, B, C...). Bu katak bo'sh variantga to'g'ri kelmasin.",
    "5) \"Izoh\" va \"Rasm URL\" — ixtiyoriy.",
    "6) Birinchi qatordagi sarlavhalarni o'chirmang yoki nomini o'zgartirmang.",
    "7) Faylni saqlab, admin paneldagi \"Savollar\" bo'limida \"Excel orqali yuklash\" tugmasi orqali yuklang.",
  ].forEach((line, i) => {
    const row = info.addRow([line]);
    if (i === 0) row.font = { bold: true, size: 13, color: { argb: 'FF0A3161' } };
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="savollar-shablon.xlsx"');
  await wb.xlsx.write(res);
  res.end();
});

router.post('/questions/import', async (req, res) => {
  const { file_base64, default_subject_id } = req.body;
  if (!file_base64) return res.status(400).json({ error: 'Fayl topilmadi' });

  let buffer;
  try {
    const base64 = file_base64.includes(',') ? file_base64.split(',').pop() : file_base64;
    buffer = Buffer.from(base64, 'base64');
  } catch (e) {
    return res.status(400).json({ error: 'Fayl formatida xatolik' });
  }

  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch (e) {
    return res.status(400).json({ error: "Fayl o'qilmadi. .xlsx formatdagi faylni yuklang." });
  }

  const ws = wb.worksheets[0];
  if (!ws || ws.rowCount < 2) {
    return res.status(400).json({ error: "Faylda ma'lumot topilmadi" });
  }

  // Sarlavha qatorini o'qiymiz va ustunlarni aniqlaymiz
  const headerRow = ws.getRow(1);
  let subjectCol = null, questionCol = null, correctCol = null, explanationCol = null, imageCol = null;
  const variantCols = []; // [{col, letterIndex}]

  headerRow.eachCell((cell, colNumber) => {
    const norm = normalizeHeader(cell.value);
    if (!norm) return;
    if (norm === 'fan') subjectCol = colNumber;
    else if (norm === 'savolmatni') questionCol = colNumber;
    else if (norm === 'togrijavob' || norm === 'javob') correctCol = colNumber;
    else if (norm === 'izoh') explanationCol = colNumber;
    else if (norm === 'rasmurl' || norm === 'rasm') imageCol = colNumber;
    else {
      const m = norm.match(/^variant([a-z]+)$/);
      if (m) variantCols.push({ col: colNumber, letterIndex: letterToIndex(m[1]) });
    }
  });

  if (!questionCol || variantCols.length < 2) {
    return res.status(400).json({
      error: "Ustunlar tanilmadi. Iltimos shablon faylidagi sarlavhalardan foydalaning (\"Savol matni\", \"Variant A\", \"Variant B\", \"To'g'ri javob\" ...)."
    });
  }
  variantCols.sort((a, b) => a.letterIndex - b.letterIndex);

  // Fanlar lug'ati (nom -> id), kichik harfda solishtirish uchun
  let subjectByName = {};
  if (!default_subject_id) {
    const { rows: subjects } = await query('SELECT id, name FROM subjects');
    subjectByName = Object.fromEntries(subjects.map(s => [s.name.trim().toLowerCase(), s.id]));
  }

  const toInsert = [];
  const errors = [];
  let skippedEmpty = 0;

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cellText = (col) => {
      if (!col) return '';
      const v = row.getCell(col).value;
      if (v === null || v === undefined) return '';
      if (typeof v === 'object' && v.richText) return v.richText.map(t => t.text).join('');
      if (typeof v === 'object' && v.text) return v.text.toString();
      return v.toString().trim();
    };

    const questionText = cellText(questionCol);
    const rawVariants = variantCols.map(v => ({ letterIndex: v.letterIndex, text: cellText(v.col) }));
    const anyContent = questionText || rawVariants.some(v => v.text);
    if (!anyContent) { skippedEmpty++; continue; }

    if (!questionText) { errors.push({ row: r, reason: "Savol matni bo'sh" }); continue; }

    const nonEmptyVariants = rawVariants.filter(v => v.text);
    if (nonEmptyVariants.length < 2) {
      errors.push({ row: r, reason: 'Kamida 2 ta variant kerak' });
      continue;
    }

    const correctLetterRaw = cellText(correctCol).replace(/[^a-zA-Z]/g, '');
    const correctLetterIndex = letterToIndex(correctLetterRaw);
    if (correctLetterIndex < 0) {
      errors.push({ row: r, reason: "To'g'ri javob ustuni bo'sh yoki noto'g'ri (masalan: A, B, C)" });
      continue;
    }
    const correctPos = nonEmptyVariants.findIndex(v => v.letterIndex === correctLetterIndex);
    if (correctPos === -1) {
      errors.push({ row: r, reason: "To'g'ri javob ko'rsatilgan variant matni bo'sh" });
      continue;
    }

    let subjectId = default_subject_id || null;
    let subjectNameForError = '';
    if (!subjectId) {
      subjectNameForError = cellText(subjectCol);
      subjectId = subjectByName[subjectNameForError.trim().toLowerCase()];
      if (!subjectId) {
        errors.push({ row: r, reason: `Fan topilmadi: "${subjectNameForError || '(bo\'sh)'}"` });
        continue;
      }
    }

    toInsert.push({
      subject_id: subjectId,
      question_text: questionText,
      options: nonEmptyVariants.map(v => v.text),
      correct_index: correctPos,
      explanation: cellText(explanationCol) || null,
      image_url: cellText(imageCol) || null,
    });
  }

  let inserted = 0;
  for (const q of toInsert) {
    try {
      await query(
        `INSERT INTO questions (subject_id, question_text, image_url, options, correct_index, explanation)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [q.subject_id, q.question_text, q.image_url, JSON.stringify(q.options), q.correct_index, q.explanation]
      );
      inserted++;
    } catch (e) {
      errors.push({ row: '-', reason: `Bazaga yozishda xatolik: ${e.message}` });
    }
  }

  res.json({ inserted, skippedEmpty, errorCount: errors.length, errors: errors.slice(0, 100) });
});

// ---------- PDF (College Board Question Bank eksporti) orqali savol yuklash ----------
router.post('/questions/import-pdf', async (req, res) => {
  const { file_base64, subject_id } = req.body;
  if (!file_base64) return res.status(400).json({ error: 'Fayl topilmadi' });
  if (!subject_id) return res.status(400).json({ error: 'Fanni tanlang' });

  let buffer;
  try {
    const base64 = file_base64.includes(',') ? file_base64.split(',').pop() : file_base64;
    buffer = Buffer.from(base64, 'base64');
  } catch (e) {
    return res.status(400).json({ error: 'Fayl formatida xatolik' });
  }

  let parsed;
  try {
    parsed = await parseQuestionBankPdf(buffer);
  } catch (e) {
    return res.status(400).json({ error: "PDF o'qilmadi. Bu College Board 'Question Bank' eksport PDF ekanligiga ishonch hosil qiling. (" + e.message + ")" });
  }

  if (parsed.length === 0) {
    return res.status(400).json({ error: "PDF ichida tanilgan savol topilmadi. Bu College Board Question Bank eksport formatidagi PDF bo'lishi kerak." });
  }

  const okItems = parsed.filter(p => !p.error);
  const failedItems = parsed.filter(p => p.error);

  // Avval shu fanda mavjud bo'lgan external_id'larni olib, takrorlanishlarni o'tkazib yuboramiz
  const { rows: existing } = await query(
    'SELECT external_id FROM questions WHERE subject_id = $1 AND external_id IS NOT NULL',
    [subject_id]
  );
  const existingIds = new Set(existing.map(r => r.external_id));

  let inserted = 0, skippedDuplicate = 0;
  const errors = failedItems.map(f => ({ external_id: f.external_id || '-', reason: f.error }));

  for (const q of okItems) {
    if (q.external_id && existingIds.has(q.external_id)) { skippedDuplicate++; continue; }
    try {
      await query(
        `INSERT INTO questions (subject_id, question_text, options, correct_index, explanation, external_id, source_meta)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [subject_id, q.question_text, JSON.stringify(q.options), q.correct_index, q.explanation, q.external_id, q.source_meta]
      );
      inserted++;
      if (q.external_id) existingIds.add(q.external_id);
    } catch (e) {
      errors.push({ external_id: q.external_id || '-', reason: `Bazaga yozishda xatolik: ${e.message}` });
    }
  }

  res.json({
    inserted, skippedDuplicate, total: parsed.length,
    errorCount: errors.length, errors: errors.slice(0, 100),
  });
});

// ---------- QUESTIONS EXPORT (Excel / PDF) ----------
router.get('/questions/export', async (req, res) => {
  const { subject_id, format, ids } = req.query;
  let sql = `SELECT q.*, s.name AS subject_name FROM questions q JOIN subjects s ON s.id = q.subject_id`;
  const params = [];
  if (ids) {
    const idList = ids.toString().split(',').map(n => parseInt(n)).filter(n => !isNaN(n));
    if (idList.length === 0) return res.status(400).json({ error: "Savollar tanlanmagan" });
    params.push(idList);
    sql += ` WHERE q.id = ANY($1::int[])`;
  } else if (subject_id) {
    params.push(subject_id); sql += ` WHERE q.subject_id = $1`;
  }
  sql += ids ? '' : ' ORDER BY q.subject_id, q.id';
  const { rows: questions } = await query(sql, params);
  if (ids) {
    // tanlangan tartibni saqlab qolamiz
    const idList = ids.toString().split(',').map(n => parseInt(n)).filter(n => !isNaN(n));
    const byId = Object.fromEntries(questions.map(q => [q.id, q]));
    questions.length = 0;
    idList.forEach(id => { if (byId[id]) questions.push(byId[id]); });
  }

  const subjectLabel = ids ? 'tanlangan-savollar' : (subject_id && questions[0] ? questions[0].subject_name : 'barcha-fanlar');
  const fileBase = `savollar-${subjectLabel}`.toLowerCase().replace(/[^a-z0-9_-]+/g, '-');

  if (format === 'pdf') {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.pdf"`);
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    doc.pipe(res);

    doc.font('Helvetica-Bold').fontSize(18).fillColor('#0a3161').text('Savollar banki', { align: 'center' });
    doc.font('Helvetica').fontSize(10).fillColor('#64748b').text(ids ? `Tanlangan savollar (${questions.length} ta)` : (subject_id ? questions[0]?.subject_name || '' : 'Barcha fanlar'), { align: 'center' });
    doc.moveDown(1);

    questions.forEach((q, i) => {
      if (doc.y > 680) doc.addPage();
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#1a2433')
        .text(`${i + 1}. ${q.question_text}`, { width: 495 });
      if (!subject_id || ids) {
        doc.font('Helvetica-Oblique').fontSize(8).fillColor('#64748b').text(q.subject_name);
      }
      doc.moveDown(0.3);
      (q.options || []).forEach((opt, oi) => {
        const isCorrect = oi === q.correct_index;
        doc.font(isCorrect ? 'Helvetica-Bold' : 'Helvetica').fontSize(10)
          .fillColor(isCorrect ? '#1a8754' : '#1a2433')
          .text(`   ${optionLetter(oi)}) ${opt}${isCorrect ? '   ✓ to\'g\'ri javob' : ''}`, { width: 495 });
      });
      if (q.explanation) {
        doc.font('Helvetica-Oblique').fontSize(9).fillColor('#64748b').text(`   Izoh: ${q.explanation}`, { width: 495 });
      }
      doc.moveDown(0.8);
    });

    doc.end();
    return;
  }

  // default: xlsx
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Savollar');
  const maxOptions = Math.max(2, ...questions.map(q => (q.options || []).length));

  const columns = [
    { header: 'ID', key: 'id', width: 6 },
    { header: 'Fan', key: 'subject', width: 18 },
    { header: 'Savol matni', key: 'question', width: 50 },
  ];
  for (let i = 0; i < maxOptions; i++) {
    columns.push({ header: `Variant ${optionLetter(i)}`, key: `opt${i}`, width: 28 });
  }
  columns.push({ header: "To'g'ri javob", key: 'correct', width: 14 });
  columns.push({ header: 'Izoh', key: 'explanation', width: 30 });
  columns.push({ header: 'Rasm URL', key: 'image', width: 20 });
  ws.columns = columns;
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0A3161' } };
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

  questions.forEach(q => {
    const row = {
      id: q.id, subject: q.subject_name, question: q.question_text,
      correct: optionLetter(q.correct_index), explanation: q.explanation || '', image: q.image_url || '',
    };
    (q.options || []).forEach((opt, i) => { row[`opt${i}`] = opt; });
    ws.addRow(row);
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});
// (eslatma: yuqoridagi /questions/export GET endpointi `ids` parametri orqali
// faqat tanlangan savollarni ham eksport qila oladi — "PDF ga qo'shish" funksiyasi shuni ishlatadi)

// ---------- RESULTS (attempts) ----------
router.get('/results', async (req, res) => {
  const { subject_id, student_id } = req.query;
  let sql = `
    SELECT a.*, s.first_name, s.last_name, s.username AS student_username, s.telegram_id,
           sub.name AS subject_name
    FROM attempts a
    JOIN students s ON s.id = a.student_id
    JOIN subjects sub ON sub.id = a.subject_id
    WHERE a.finished_at IS NOT NULL
  `;
  const params = [];
  if (subject_id) { params.push(subject_id); sql += ` AND a.subject_id = $${params.length}`; }
  if (student_id) { params.push(student_id); sql += ` AND a.student_id = $${params.length}`; }
  sql += ' ORDER BY a.finished_at DESC';

  const { rows } = await query(sql, params);
  res.json(rows);
});

router.get('/results/:id', async (req, res) => {
  const { rows } = await query(`
    SELECT a.*, s.first_name, s.last_name, sub.name AS subject_name
    FROM attempts a
    JOIN students s ON s.id = a.student_id
    JOIN subjects sub ON sub.id = a.subject_id
    WHERE a.id = $1
  `, [req.params.id]);
  const attempt = rows[0];
  if (!attempt) return res.status(404).json({ error: 'Topilmadi' });

  const qIds = attempt.question_ids;
  const { rows: questions } = await query(
    `SELECT * FROM questions WHERE id = ANY($1::int[]) `,
    [qIds]
  );
  // savollarni asl tartibda joylashtirish
  const byId = Object.fromEntries(questions.map(q => [q.id, q]));
  const ordered = qIds.map(id => byId[id]).filter(Boolean);

  res.json({ attempt, questions: ordered });
});

router.delete('/results/:id', async (req, res) => {
  await query('DELETE FROM attempts WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

router.get('/results/:id/export', async (req, res) => {
  const { rows } = await query(`
    SELECT a.*, s.first_name, s.last_name, sub.name AS subject_name
    FROM attempts a
    JOIN students s ON s.id = a.student_id
    JOIN subjects sub ON sub.id = a.subject_id
    WHERE a.id = $1
  `, [req.params.id]);
  const attempt = rows[0];
  if (!attempt) return res.status(404).json({ error: 'Topilmadi' });

  const qIds = attempt.question_ids;
  const { rows: questions } = await query(`SELECT * FROM questions WHERE id = ANY($1::int[])`, [qIds]);
  const byId = Object.fromEntries(questions.map(q => [q.id, q]));
  const ordered = qIds.map(id => byId[id]).filter(Boolean);
  const answers = attempt.answers || {};

  const studentName = `${attempt.first_name} ${attempt.last_name || ''}`.trim();
  const fileBase = `natija-${studentName}-${attempt.subject_name}`.toLowerCase().replace(/[^a-z0-9_-]+/g, '-');

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.pdf"`);
  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  doc.pipe(res);

  const NAVY = '#0a3161', GOLD = '#d4a017', GREEN = '#1a8754', RED = '#d92d20', MUTED = '#64748b', INK = '#1a2433';

  // ---- Sarlavha blok (College Board uslubi) ----
  doc.rect(0, 0, doc.page.width, 90).fill(NAVY);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20).text('Natijalar hisoboti', 50, 28);
  doc.font('Helvetica').fontSize(11).fillColor('#cbd5e1').text(attempt.subject_name, 50, 54);

  doc.fillColor(INK);
  doc.font('Helvetica-Bold').fontSize(13).text(studentName, 50, 105);

  const pct = Math.round((attempt.score / attempt.total) * 100);
  doc.font('Helvetica').fontSize(10).fillColor(MUTED)
    .text(`Sana: ${new Date(attempt.finished_at).toLocaleDateString('uz-UZ')}`, 50, 125);

  doc.font('Helvetica-Bold').fontSize(28).fillColor(pct >= 60 ? GREEN : RED)
    .text(`${attempt.score}/${attempt.total}`, 400, 100, { width: 145, align: 'right' });
  doc.font('Helvetica').fontSize(11).fillColor(MUTED)
    .text(`${pct}% to'g'ri`, 400, 132, { width: 145, align: 'right' });

  doc.moveTo(50, 155).lineTo(545, 155).strokeColor('#e2e8f0').stroke();
  doc.y = 170;

  ordered.forEach((q, i) => {
    if (doc.y > 650) doc.addPage();
    const given = answers[String(q.id)];
    const givenIdx = given !== undefined && given !== null ? parseInt(given) : null;
    const isCorrect = givenIdx === q.correct_index;

    doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(`${i + 1}. ${q.question_text}`, { width: 495 });
    doc.moveDown(0.25);

    (q.options || []).forEach((opt, oi) => {
      const isThisCorrect = oi === q.correct_index;
      const isThisGiven = oi === givenIdx;
      let color = INK, prefix = `   ${optionLetter(oi)}) `;
      let suffix = '';
      if (isThisCorrect) { color = GREEN; suffix = '   ✓ to\'g\'ri javob'; }
      if (isThisGiven && !isThisCorrect) { color = RED; suffix = '   ✗ o\'quvchi javobi'; }
      if (isThisGiven && isThisCorrect) { suffix = '   ✓ to\'g\'ri javob (o\'quvchi shuni tanlagan)'; }
      doc.font(isThisCorrect || isThisGiven ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor(color)
        .text(prefix + opt + suffix, { width: 495 });
    });

    if (givenIdx === null) {
      doc.font('Helvetica-Oblique').fontSize(9).fillColor(MUTED).text('   (Javob berilmagan)');
    }
    if (q.explanation) {
      doc.font('Helvetica-Oblique').fontSize(9).fillColor(MUTED).text(`   Izoh: ${q.explanation}`, { width: 495 });
    }
    doc.moveDown(0.9);
  });

  doc.end();
});

// ---------- STUDENTS ----------
router.get('/students', async (req, res) => {
  const { rows } = await query(`
    SELECT s.*,
      COUNT(a.id)::int AS attempt_count,
      COALESCE(AVG(CASE WHEN a.finished_at IS NOT NULL THEN (a.score::float / NULLIF(a.total,0)) * 100 END), 0) AS avg_score
    FROM students s
    LEFT JOIN attempts a ON a.student_id = s.id
    GROUP BY s.id ORDER BY s.id DESC
  `);
  res.json(rows);
});

router.delete('/students/:id', async (req, res) => {
  await query('DELETE FROM students WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ---------- SO'ZLAR BANKI (har bir so'z majburiy ravishda "fan"ga biriktiriladi) ----------
router.get('/vocab/words', async (req, res) => {
  const { subject_id } = req.query;
  let sql = `
    SELECT w.*, sub.name AS subject_name
    FROM vocab_words w
    LEFT JOIN subjects sub ON sub.id = w.subject_id
  `;
  const params = [];
  if (subject_id) { params.push(subject_id); sql += ' WHERE w.subject_id = $1'; }
  sql += ' ORDER BY w.id DESC';
  const { rows } = await query(sql, params);
  res.json(rows);
});

router.get('/vocab/summary', async (req, res) => {
  const { rows } = await query(`
    SELECT sub.id AS subject_id, sub.name AS subject_name, COUNT(w.id)::int AS word_count
    FROM subjects sub
    LEFT JOIN vocab_words w ON w.subject_id = sub.id
    GROUP BY sub.id ORDER BY sub.name ASC
  `);
  res.json(rows);
});

router.post('/vocab/words', async (req, res) => {
  const { subject_id, word, translation, example } = req.body;
  if (!subject_id) return res.status(400).json({ error: "Fanni tanlang — so'z albatta bir fanga biriktirilishi kerak" });
  if (!word || !translation) {
    return res.status(400).json({ error: "So'z va tarjimasini kiriting" });
  }
  const { rows } = await query(
    'INSERT INTO vocab_words (subject_id, word, translation, example) VALUES ($1,$2,$3,$4) RETURNING *',
    [subject_id, word.trim(), translation.trim(), example ? example.trim() : null]
  );
  res.json(rows[0]);
});

// Bir nechta so'zni bitta yozuvda qo'shish: har qatorda "so'z - tarjima" formatida
router.post('/vocab/words/bulk', async (req, res) => {
  const { subject_id, text } = req.body;
  if (!subject_id) return res.status(400).json({ error: "Fanni tanlang — so'zlar albatta bir fanga biriktirilishi kerak" });
  if (!text) return res.status(400).json({ error: "So'zlar ro'yxatini kiriting" });

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const pairs = lines.map(line => {
    const parts = line.split(/[-–—]|:/).map(p => p.trim());
    if (parts.length < 2) return null;
    const word = parts[0];
    const translation = parts.slice(1).join(' - ').trim();
    if (!word || !translation) return null;
    return { word, translation };
  }).filter(Boolean);

  if (pairs.length === 0) {
    return res.status(400).json({ error: "Hech qanday to'g'ri qator topilmadi. Format: so'z - tarjima" });
  }

  const inserted = [];
  for (const p of pairs) {
    const { rows } = await query(
      'INSERT INTO vocab_words (subject_id, word, translation) VALUES ($1,$2,$3) RETURNING *',
      [subject_id, p.word, p.translation]
    );
    inserted.push(rows[0]);
  }
  res.json({ ok: true, count: inserted.length, words: inserted });
});

router.put('/vocab/words/:id', async (req, res) => {
  const { subject_id, word, translation, example } = req.body;
  if (!subject_id) return res.status(400).json({ error: "Fanni tanlang — so'z albatta bir fanga biriktirilishi kerak" });
  if (!word || !translation) return res.status(400).json({ error: "So'z va tarjimasini kiriting" });
  const { rows } = await query(
    'UPDATE vocab_words SET subject_id = $1, word = $2, translation = $3, example = $4 WHERE id = $5 RETURNING *',
    [subject_id, word.trim(), translation.trim(), example ? example.trim() : null, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Topilmadi' });
  res.json(rows[0]);
});

router.delete('/vocab/words/:id', async (req, res) => {
  await query('DELETE FROM vocab_words WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ---------- SO'ZLARNI EXCEL ORQALI OMMAVIY YUKLASH (bitta fanga) ----------
router.get('/vocab/words/import-template', async (req, res) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("So'zlar");
  ws.columns = [
    { header: "So'z (inglizcha)", key: 'word', width: 26 },
    { header: 'Tarjimasi', key: 'translation', width: 26 },
    { header: 'Misol jumla (ixtiyoriy)', key: 'example', width: 46 },
  ];
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0A3161' } };
  ws.addRow({ word: 'apple', translation: 'olma', example: 'I eat an apple every morning.' });
  ws.addRow({ word: 'benevolent', translation: 'mehribon, xayrixoh', example: 'She is a benevolent leader.' });

  const info = wb.addWorksheet("Yo'riqnoma");
  info.columns = [{ width: 90 }];
  [
    "QO'LLANMA — so'zlarni Excel orqali ommaviy yuklash",
    '',
    '1) "So\'z (inglizcha)" va "Tarjimasi" ustunlari majburiy.',
    '2) "Misol jumla" ustuni ixtiyoriy.',
    "3) Birinchi qatordagi sarlavhalarni o'chirmang yoki nomini o'zgartirmang.",
    "4) Faylni yuklashdan oldin admin panelda qaysi FANGA biriktirilishini tanlaysiz — shu fayldagi barcha so'zlar o'sha fanga qo'shiladi.",
    "5) Faylni saqlab, admin paneldagi \"Lug'at\" bo'limida \"Excel orqali yuklash\" tugmasi orqali yuklang.",
  ].forEach((line, i) => {
    const row = info.addRow([line]);
    if (i === 0) row.font = { bold: true, size: 13, color: { argb: 'FF0A3161' } };
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="sozlar-shablon.xlsx"');
  await wb.xlsx.write(res);
  res.end();
});

router.post('/vocab/words/import', async (req, res) => {
  const { file_base64, subject_id } = req.body;
  if (!subject_id) return res.status(400).json({ error: "Fanni tanlang — so'zlar albatta bir fanga biriktirilishi kerak" });
  if (!file_base64) return res.status(400).json({ error: 'Fayl topilmadi' });

  const { rows: subjRows } = await query('SELECT id FROM subjects WHERE id = $1', [subject_id]);
  if (!subjRows[0]) return res.status(400).json({ error: 'Tanlangan fan topilmadi' });

  let buffer;
  try {
    const base64 = file_base64.includes(',') ? file_base64.split(',').pop() : file_base64;
    buffer = Buffer.from(base64, 'base64');
  } catch (e) {
    return res.status(400).json({ error: 'Fayl formatida xatolik' });
  }

  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch (e) {
    return res.status(400).json({ error: "Fayl o'qilmadi. .xlsx formatdagi faylni yuklang." });
  }

  const ws = wb.worksheets[0];
  if (!ws || ws.rowCount < 2) {
    return res.status(400).json({ error: "Faylda ma'lumot topilmadi" });
  }

  const headerRow = ws.getRow(1);
  let wordCol = null, translationCol = null, exampleCol = null;
  headerRow.eachCell((cell, colNumber) => {
    const norm = normalizeHeader(cell.value);
    if (!norm) return;
    if (norm === 'sozinglizcha' || norm === 'soz' || norm === 'word') wordCol = colNumber;
    else if (norm === 'tarjimasi' || norm === 'tarjima' || norm === 'translation') translationCol = colNumber;
    else if (norm.startsWith('misol') || norm === 'example') exampleCol = colNumber;
  });

  if (!wordCol || !translationCol) {
    return res.status(400).json({
      error: 'Ustunlar tanilmadi. Iltimos shablon faylidagi sarlavhalardan foydalaning ("So\'z (inglizcha)", "Tarjimasi").'
    });
  }

  let inserted = 0, skippedEmpty = 0;
  const errors = [];

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const word = (row.getCell(wordCol).value || '').toString().trim();
    const translation = (row.getCell(translationCol).value || '').toString().trim();
    const example = exampleCol ? (row.getCell(exampleCol).value || '').toString().trim() : '';

    if (!word && !translation) { skippedEmpty++; continue; }
    if (!word || !translation) {
      errors.push({ row: r, reason: "So'z yoki tarjima maydoni bo'sh" });
      continue;
    }
    try {
      await query(
        'INSERT INTO vocab_words (subject_id, word, translation, example) VALUES ($1,$2,$3,$4)',
        [subject_id, word, translation, example || null]
      );
      inserted++;
    } catch (e) {
      errors.push({ row: r, reason: e.message });
    }
  }

  res.json({ ok: true, inserted, skippedEmpty, errorCount: errors.length, errors: errors.slice(0, 30) });
});

// ---------- SO'ZLAR NATIJALARI (fan bo'yicha, bo'lim natijalari asosida) ----------
router.get('/vocab/results', async (req, res) => {
  const { rows } = await query(`
    SELECT st.id AS student_id, st.first_name, st.last_name, st.username AS student_username,
           sp.subject_id, sub.name AS subject_name,
           ROUND(AVG(sp.best_pct))::int AS best_score_pct,
           ROUND(AVG(sp.best_pct))::int AS last_score_pct,
           COUNT(*)::int AS attempts_count,
           BOOL_AND(sp.passed) AS passed,
           MAX(sp.updated_at) AS updated_at
    FROM vocab_section_progress sp
    JOIN students st ON st.id = sp.student_id
    LEFT JOIN subjects sub ON sub.id = sp.subject_id
    GROUP BY st.id, st.first_name, st.last_name, st.username, sp.subject_id, sub.name
    ORDER BY MAX(sp.updated_at) DESC
  `);
  res.json(rows);
});

module.exports = router;
