// College Board "Question Bank" eksport qilingan PDF fayllarini o'qib,
// har bir sahifadagi (yoki ko'p sahifali) savolni JSON obyektiga aylantiradi.
const pdfParse = require('pdf-parse');

const ASSESSMENTS = ['PSAT/NMSQT', 'PSAT 10', 'PSAT 8/9', 'SAT'];
const TESTS = ['Reading and Writing', 'Math'];
const RW_DOMAINS = ['Information and Ideas', 'Craft and Structure', 'Expression of Ideas', 'Standard English Conventions'];
const MATH_DOMAINS = ['Algebra', 'Advanced Math', 'Problem-Solving and Data Analysis', 'Geometry and Trigonometry'];
const DIFFICULTIES = ['Easy', 'Medium', 'Hard'];

function formatMeta(raw) {
  let s = raw;
  let difficulty = '';
  for (const d of DIFFICULTIES) {
    if (s.endsWith(d)) { difficulty = d; s = s.slice(0, s.length - d.length); break; }
  }
  let assessment = '';
  for (const a of ASSESSMENTS) {
    if (s.startsWith(a)) { assessment = a; s = s.slice(a.length); break; }
  }
  let test = '';
  for (const t of TESTS) {
    if (s.startsWith(t)) { test = t; s = s.slice(t.length); break; }
  }
  const domainList = test === 'Math' ? MATH_DOMAINS : RW_DOMAINS;
  let domain = '';
  for (const d of domainList) {
    if (s.startsWith(d)) { domain = d; s = s.slice(d.length); break; }
  }
  const skill = s.trim();
  return [assessment, test, domain, skill, difficulty].filter(Boolean).join(' • ');
}

// PDF dan kelgan qatorlar ro'yxatini mantiqiy paragraflarga birlashtiradi.
//
// pdf-parse ko'pincha har bir chiziqni alohida \n bilan chiqaradi, paragraf
// chegaralarida esa \n\n bo'lmaydi. Shuning uchun quyidagi heuristikadan
// foydalanamiz:
//
//  1. Bo'sh qatorlar (\n\n) — aniq paragraf chegarasi, saqlanadi.
//  2. Har bir qator oxirida nuqta/undov/so'roq bilan tugagan jumlalar —
//     keyingi qator yangi gap boshlanadi (katta harf), demak bu yerda
//     paragraf bo'lishi mumkin. Lekin ko'p hollarda bu bir paragraf ichidagi
//     jumlalar bo'ladi — shuning uchun ularni birlashtirамiz.
//  3. Savol jumlasi odatda oxirida "?" bilan tugaydi va alohida turadi.
//     Uni passage matnidan ajratish uchun maxsus belgi — "?" bilan tugagan
//     va oldidan passage matni kelgan qator yangi paragraf sifatida qaraladi.
//
// Natijada passage + savol jumlasi 2 ta alohida paragraf bo'ladi.

function smartParagraphs(rawText) {
  // 1. Avval aniq \n\n ajratgichlar bo'yicha bo'lib olamiz
  const roughParas = rawText.split(/\n{2,}/);

  const finalParas = [];

  for (const rough of roughParas) {
    const lines = rough.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) continue;

    // Savol jumlasi (?) va passage matnini ajratamiz
    // Savol jumlasi odatda:
    //   - "?" bilan tugaydi
    //   - Yoki "According to...", "Based on...", "Which...", "What..." bilan boshlanadi
    // Passage matni esa ko'p jumlali bo'ladi.

    // Qatorlarni passage va savol qismiga ajratamiz
    let splitIdx = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      // Savol jumlasi belgilari:
      if (
        line.endsWith('?') ||
        /^(According to|Based on|Which|What|How|Why|Where|When|In the text|The author|The passage|Choose|Select)/i.test(line)
      ) {
        splitIdx = i;
        break;
      }
    }

    if (splitIdx > 0) {
      // Passage qismi (splitIdx dan oldingi qatorlar) — bitta paragraf
      const passageLines = lines.slice(0, splitIdx);
      finalParas.push(passageLines.join(' '));
      // Savol jumlasi — alohida paragraf
      const questionLines = lines.slice(splitIdx);
      finalParas.push(questionLines.join(' '));
    } else {
      // Ajratib bo'lmadi — hammasini bitta paragraf qilib yig'amiz
      finalParas.push(lines.join(' '));
    }
  }

  return finalParas.filter(p => p.trim().length > 0).join('\n\n');
}

// Explanation uchun ham paragraf aniqlash (bir oz farqli logika)
function smartExplanationParagraphs(rawText) {
  const roughParas = rawText.split(/\n{2,}/);
  const finalParas = [];

  for (const rough of roughParas) {
    const lines = rough.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) continue;

    // Explanation da "Choice A/B/C/D" bilan boshlanuvchi jumlalar
    // alohida paragraf bo'lishi kerak
    let currentPara = [];
    for (const line of lines) {
      if (
        currentPara.length > 0 &&
        /^Choice [A-D]/i.test(line)
      ) {
        finalParas.push(currentPara.join(' '));
        currentPara = [line];
      } else {
        currentPara.push(line);
      }
    }
    if (currentPara.length > 0) finalParas.push(currentPara.join(' '));
  }

  return finalParas.filter(p => p.trim().length > 0).join('\n\n');
}

function parseBlocks(fullText) {
  const blocks = fullText
    .split(/(?=Question ID:\s*\S+)/)
    .map(b => b.trim())
    .filter(b => b.startsWith('Question ID:'));

  const results = [];
  for (const block of blocks) {
    const idMatch = block.match(/^Question ID:\s*(\S+)/);
    const externalId = idMatch ? idMatch[1] : null;

    const metaMatch = block.match(/AssessmentTestDomainSkillDifficulty\s*\n([\s\S]*?)\nQuestion\n/);
    const metaRaw = metaMatch ? metaMatch[1].replace(/\s+/g, ' ').trim() : '';
    const sourceMeta = metaRaw ? formatMeta(metaRaw) : null;

    const qMatch = block.match(/\nQuestion\n([\s\S]*?)\nAnswer\n/);
    const questionText = qMatch ? smartParagraphs(qMatch[1]) : null;

    const ansBlockMatch = block.match(/\nAnswer\n([\s\S]*?)\nCorrect Answer:\s*([A-Z])/);
    if (!questionText || !ansBlockMatch) {
      results.push({ error: "Savol matni yoki javob qismi tanilmadi", external_id: externalId });
      continue;
    }

    const optionsRaw = ansBlockMatch[1];
    const correctLetter = ansBlockMatch[2];
    const optionMatches = [...optionsRaw.matchAll(/(?:^|\n)([A-H])\.\s*([\s\S]*?)(?=\n[A-H]\.\s|$)/g)];
    const options = optionMatches.map(m => ({ letter: m[1], text: m[2].replace(/\s+/g, ' ').trim() }));
    const correctIndex = options.findIndex(o => o.letter === correctLetter);

    if (options.length < 2 || correctIndex < 0) {
      results.push({ error: "Variantlar yoki to'g'ri javob tanilmadi", external_id: externalId });
      continue;
    }

    const explMatch = block.match(/\nRationale\n([\s\S]*)$/);
    const explanation = explMatch ? smartExplanationParagraphs(explMatch[1]) : null;

    results.push({
      external_id: externalId,
      question_text: questionText,
      options: options.map(o => o.text),
      correct_index: correctIndex,
      explanation,
      source_meta: sourceMeta,
    });
  }
  return results;
}

async function parseQuestionBankPdf(buffer) {
  const data = await pdfParse(buffer);
  return parseBlocks(data.text);
}

module.exports = { parseQuestionBankPdf, parseBlocks, formatMeta };
