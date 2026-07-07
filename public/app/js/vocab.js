// ==================================================================
// SO'ZLAR (VOCAB) MODULI
// ------------------------------------------------------------------
// Oqim: Fan tanlash -> Bo'limlar ro'yxati (har bo'lim = 20 so'z, boshida 3 tasi ochiq)
//       -> Bo'limni tanlash -> Kartochkalar (tanishish) -> Moslashtirish -> Yozish -> Oddiy test
//       -> Natija (bo'lim >=80% bo'lsa keyingi BO'LIM ochiladi)
//
// MUHIM: Barcha progress (bo'lim holati, har bir so'zning "yodlangan/
// yodlanmagan" holati) endi SERVERDA saqlanadi — shu tufayli qaysi
// qurilmadan kirilmasin bir xil ko'rinadi. Reyting FAQAT yodlangan
// so'zlar soniga qarab hisoblanadi (nechta sessiya ishlaganidan qat'iy
// nazar).
//
// Fayl bo'limlari (Ctrl+F bilan sarlavhalarni toping):
//   1) SOZLAMALAR VA UMUMIY HOLAT (STATE)
//   2) YORDAMCHI FUNKSIYALAR
//   3) HUB EKRANI (fanlar ro'yxati)
//   4) FAN TAFSILOTI VA GURUHLAR RO'YXATI EKRANI
//   5) GURUH SESSIYASINI BOSHLASH
//   6) 0-BOSQICH: KARTOCHKALAR (FLASHCARDS)
//   7) 1-BOSQICH: MOSLASHTIRISH (MATCHING)
//   8) 2-BOSQICH: YOZISH (TYPING)
//   9) 3-BOSQICH: ODDIY TEST (QUIZ)
//  10) NATIJA EKRANI VA SERVERGA YUBORISH
// ==================================================================


// ==================================================================
// 1) SOZLAMALAR VA UMUMIY HOLAT (STATE)
// ==================================================================
const VOCAB_SECTION_SIZE = 20;       // har bir bo'limdagi so'zlar soni
const VOCAB_INITIAL_OPEN = 3;        // boshida nechta bo'lim ochiq bo'ladi
const VOCAB_PASS_PERCENT = 80;       // har bir bo'limni topshirish uchun kerakli foiz
const VOCAB_MAX_ATTEMPTS = 3;        // oddiy testda har bir so'z jami necha marta so'raladi
const VOCAB_MATCH_ROUND_SIZE = 6;    // moslashtirish bosqichida bir round'da nechta juftlik

let vocabOverview = null;
let vocabSubjects = [];
let currentVocabSubject = null;        // hozir ochiq turgan fan
let vocabFullBank = [];                // tanlangan fandagi BARCHA so'zlar (distraktorlar uchun)
let vocabSectionsMeta = [];            // /vocab/sections dan kelgan bo'lim holatlari
let currentVocabSectionIndex = 0;      // hozir ishlanayotgan bo'lim indeksi
let currentVocabGroupWords = [];       // hozirgi bo'limdagi BARCHA so'zlar (section_index bilan)
let vocabLives = { lives: 10, max_lives: 10, refill_at: null }; // jonlar holati

// Sessiya davomidagi natijalar (har bosqichda to'ldiriladi)
let vocabWordResults = {};             // { [word_id]: { match:bool|null, type:bool|null, quiz:bool|null } }


// ==================================================================
// 2) YORDAMCHI FUNKSIYALAR
// ==================================================================
function shuffleArr(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function ensureWordResult(wordId) {
  if (!vocabWordResults[wordId]) {
    vocabWordResults[wordId] = { match: null, type: null, quiz: null };
  }
  return vocabWordResults[wordId];
}

function normalizeTypedText(s) {
  return (s || '').toString().trim().toLowerCase().replace(/\s+/g, ' ');
}

function checkTypedAnswer(input, translation) {
  const userAns = normalizeTypedText(input);
  if (!userAns) return false;
  const target = normalizeTypedText(translation);
  if (userAns === target) return true;
  const parts = target.split(/[,\/;]+/).map(p => p.trim()).filter(Boolean);
  return parts.includes(userAns);
}

// Serverga so'z natijasini yuborish (learned holati faqat 'quiz' bosqichida yangilanadi)
async function reportWordResult(wordId, stage, correct) {
  try {
    await api('/vocab/word-result', {
      method: 'POST',
      body: JSON.stringify({ word_id: wordId, stage, correct }),
    });
  } catch (err) { /* jimgina o'tkazib yuboramiz — asosiy oqim buzilmasin */ }
}

// ---------- JONLAR (HEARTS) TIZIMI ----------
function formatLivesRefillText(refillAt) {
  if (!refillAt) return '';
  const msLeft = new Date(refillAt).getTime() - Date.now();
  if (msLeft <= 0) return 'hoziroq tiklanadi';
  const h = Math.floor(msLeft / 3600000);
  const m = Math.floor((msLeft % 3600000) / 60000);
  if (h > 0) return `${h} soat ${m} daqiqadan keyin tiklanadi`;
  return `${m} daqiqadan keyin tiklanadi`;
}

function applyLivesStatus(status) {
  if (!status) return;
  vocabLives = { lives: status.lives, max_lives: status.max_lives || 10, refill_at: status.refill_at || null };
  renderLivesUI();
}

function renderLivesUI() {
  const empty = vocabLives.lives <= 0;
  const heartIcon = icon('heart', 14);
  const badgeHtml = `${heartIcon} ${vocabLives.lives}/${vocabLives.max_lives}`;

  ['vocabLivesPill', 'vocabMatchLives', 'vocabTypeLives', 'vocabQuizLives'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle('empty', empty);
    el.innerHTML = badgeHtml;
  });

  const detailBanner = document.getElementById('vocabLivesBanner');
  if (detailBanner) {
    detailBanner.innerHTML = empty
      ? `${icon('heart', 16)} Jonlaringiz tugagan — ${formatLivesRefillText(vocabLives.refill_at)}`
      : '';
    detailBanner.style.display = empty ? 'flex' : 'none';
  }
}

// Xato javobdan keyin serverdan 1 jon kamaytirishni so'raymiz va UI'ni yangilaymiz
async function loseLife() {
  try {
    const status = await api('/vocab/lives/lose', { method: 'POST' });
    applyLivesStatus(status);
    if (status.lives <= 0) kickFromVocabSessionOutOfLives();
  } catch (err) { /* jimgina o'tkazib yuboramiz */ }
}


// ==================================================================
// 3) HUB EKRANI (fanlar ro'yxati)
// ==================================================================
async function loadVocabTopics() {
  try {
    vocabOverview = await api('/vocab/overview');
    applyLivesStatus({ lives: vocabOverview.lives, max_lives: vocabOverview.max_lives, refill_at: vocabOverview.lives_refill_at });
  } catch (err) {
    vocabOverview = { word_count: 0, points: 0, games_played: 0, learned_count: 0, rank: null };
    renderLivesUI();
  }
  renderVocabHeroStats();

  try {
    vocabSubjects = await api('/vocab/subjects');
  } catch (err) {
    vocabSubjects = [];
  }
  renderVocabSubjectList();
}

function renderVocabHeroStats() {
  const o = vocabOverview || {};
  document.getElementById('vocabRankPillText').textContent = o.rank ? `#${o.rank} o'rin` : 'Reyting';
  document.getElementById('vocabHeroStats').innerHTML = `
    <div class="vocab-hero-stat">
      <div class="vocab-hero-stat-num">${o.word_count || 0}</div>
      <div class="vocab-hero-stat-lbl">So'zlar</div>
    </div>
    <div class="vocab-hero-stat">
      <div class="vocab-hero-stat-num">${o.learned_count || 0}</div>
      <div class="vocab-hero-stat-lbl">Yodlangan</div>
    </div>
    <div class="vocab-hero-stat">
      <div class="vocab-hero-stat-num">${o.games_played || 0}</div>
      <div class="vocab-hero-stat-lbl">Sessiya</div>
    </div>
  `;
}

function renderVocabSubjectList() {
  document.getElementById('vocabSubjectList').innerHTML = vocabSubjects.map(s => `
    <div class="subject-card" onclick="openVocabSubject(${s.id})">
      <div class="subject-icon">${icon('layers', 20)}</div>
      <div class="info">
        <h3>${esc(s.name)}</h3>
        <p>${s.word_count} ta so'z • ${icon('check-circle', 12)} ${s.learned_count} ta yodlangan</p>
      </div>
      <div class="arrow">${icon('chevron-right', 18)}</div>
    </div>
  `).join('') || `<div class="empty-note">${icon('layers', 22)}<p>Hozircha hech bir fanga so'z biriktirilmagan. Admin tez orada so'zlar qo'shadi.</p></div>`;
}

document.getElementById('vocabRankPillBtn').addEventListener('click', () => {
  showScreen('screen-leaderboard');
  setLeaderboardType('words');
});


// ==================================================================
// 4) FAN TAFSILOTI VA GURUHLAR RO'YXATI EKRANI
// ==================================================================
// Test boshlashda "avval vocab ishlang" xatosi kelsa, foydalanuvchini
// to'g'ridan-to'g'ri shu fanning "So'zlar" bo'limiga olib o'tamiz
async function goToVocabSubjectForTest(subjectId) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll(`[data-tab="vocab"]`).forEach(t => t.classList.add('active'));
  showScreen('screen-vocab');
  await loadVocabTopics();
  if (subjectId && vocabSubjects.some(s => s.id === subjectId)) {
    await openVocabSubject(subjectId);
  }
}

async function openVocabSubject(subjectId) {
  currentVocabSubject = vocabSubjects.find(s => s.id === subjectId);
  if (!currentVocabSubject) return;
  renderLivesUI();

  document.getElementById('vocabDetailTitle').innerHTML = `${icon('layers', 20)} ${esc(currentVocabSubject.name)}`;
  document.getElementById('vocabDetailDesc').textContent = currentVocabSubject.description || "Ushbu fandagi so'zlarni o'rganing";

  try {
    vocabFullBank = await api('/vocab/words?subject_id=' + subjectId);
  } catch (err) {
    vocabFullBank = [];
    showToast(err.message, 'danger');
  }

  await loadVocabSectionsMeta(subjectId);

  const totalLearned = vocabSectionsMeta.reduce((sum, s) => sum + s.learned_count, 0);
  const allPassed = vocabSectionsMeta.length > 0 && vocabSectionsMeta.every(s => s.passed);

  document.getElementById('vocabDetailStats').innerHTML = `
    <div class="vocab-stat">
      <div class="vocab-stat-num">${currentVocabSubject.word_count}</div>
      <div class="vocab-stat-lbl">So'zlar</div>
    </div>
    <div class="vocab-stat">
      <div class="vocab-stat-num">${totalLearned}</div>
      <div class="vocab-stat-lbl">Yodlangan</div>
    </div>
    <div class="vocab-stat">
      <div class="vocab-stat-num">${allPassed ? icon('check-circle', 20) : icon('x-circle', 20)}</div>
      <div class="vocab-stat-lbl">${allPassed ? 'Topshirilgan' : 'Topshirilmagan'}</div>
    </div>
  `;

  renderVocabGroupsList();
  showScreen('screen-vocab-detail');
}

async function loadVocabSectionsMeta(subjectId) {
  try {
    const res = await api('/vocab/sections?subject_id=' + subjectId);
    vocabSectionsMeta = res.sections || [];
  } catch (err) {
    vocabSectionsMeta = [];
    showToast(err.message, 'danger');
  }
}

function renderVocabGroupsList() {
  if (!currentVocabSubject) return;

  if (vocabSectionsMeta.length === 0) {
    document.getElementById('vocabSectionsList').innerHTML =
      `<div class="empty-note">${icon('layers', 22)}<p>Ushbu fanda hali so'zlar yo'q.</p></div>`;
    return;
  }

  // Har bir bo'lim uchun so'z raqamlari oralig'ini hisoblaymiz
  let runningFrom = 1;
  const sectionsWithRange = vocabSectionsMeta.map(sec => {
    const from = runningFrom;
    const to = from + sec.word_count - 1;
    runningFrom = to + 1;
    return { ...sec, from, to };
  });

  document.getElementById('vocabSectionsList').innerHTML = sectionsWithRange.map(s => {
    const attempted = s.best_pct > 0;
    const btnLabel = s.passed ? "Takrorlash" : (attempted ? 'Davom ettirish' : 'Boshlash');
    const btnIcon = s.passed ? icon('refresh-cw', 15) : icon('chevron-right', 16);
    const btnClass = s.passed ? 'repeat' : '';
    const actionHtml = s.unlocked
      ? `<div class="vocab-group-actions"><button class="btn-full ${btnClass}" onclick="startVocabGroup(${s.index})">${btnIcon} ${btnLabel}</button></div>`
      : '';

    return `
      <div class="vocab-group-card ${s.unlocked ? '' : 'locked'}">
        <div class="vocab-group-head">
          <h4>${s.index + 1}-bo'lim</h4>
          ${s.passed ? `<span class="vocab-group-lock-lbl" style="color:var(--success);">${icon('check-circle', 12)} Topshirilgan</span>` : (s.unlocked ? '' : `<span class="vocab-group-lock-lbl">${icon('lock', 12)} Yopiq</span>`)}
        </div>
        <div class="vocab-group-sub">${s.from}-${s.to} so'z • ${s.learned_count}/${s.word_count} yodlangan${s.best_pct ? ` • ${s.best_pct}%` : ''}${s.unlocked ? '' : " • oldingi bo'limni to'liq (80%) topshiring"}</div>
        ${actionHtml}
      </div>
    `;
  }).join('');
}

document.getElementById('vocabDetailBackBtn').addEventListener('click', () => {
  showScreen('screen-vocab');
  loadVocabTopics();
});

async function exitVocabSession(targetScreen) {
  const ok = await showConfirm({
    iconName: 'help-circle',
    title: "Bo'limni tark etasizmi?",
    message: "Joriy sessiyadagi natija saqlanmaydi.",
    okText: 'Ha, chiqish',
    cancelText: 'Davom etish',
    danger: true,
  });
  if (ok) {
    showScreen(targetScreen || 'screen-vocab-detail');
    if (!targetScreen) {
      await loadVocabSectionsMeta(currentVocabSubject.id);
      renderVocabGroupsList();
    }
  }
}

// Jonlar 0 ga tushib qolganda sessiyadan majburiy chiqarish (tasdiq so'ramasdan)
let vocabKickInProgress = false;
async function kickFromVocabSessionOutOfLives() {
  if (vocabKickInProgress) return;
  vocabKickInProgress = true;
  showToast(`${icon('heart', 14)} Jonlaringiz tugadi! ${formatLivesRefillText(vocabLives.refill_at)}`, 'danger', 4500);
  showScreen('screen-vocab-detail');
  if (currentVocabSubject) {
    await loadVocabSectionsMeta(currentVocabSubject.id);
    renderVocabGroupsList();
  }
  vocabKickInProgress = false;
}


// ==================================================================
// 5) GURUH SESSIYASINI BOSHLASH
// ==================================================================
async function startVocabGroup(sectionIndex) {
  currentVocabSectionIndex = sectionIndex;
  vocabWordResults = {};

  try {
    const res = await api(`/vocab/section-words?subject_id=${currentVocabSubject.id}&section=${sectionIndex}`);
    currentVocabGroupWords = res.words || [];
  } catch (err) {
    showToast(err.message, 'danger');
    try { applyLivesStatus(await api('/vocab/lives')); } catch (e2) { /* jim */ }
    return;
  }
  if (currentVocabGroupWords.length === 0) return;

  renderLivesUI();
  currentVocabGroupWords.forEach(w => ensureWordResult(w.id));
  startVocabFlashcards();
}


// ==================================================================
// 6) 0-BOSQICH: KARTOCHKALAR (FLASHCARDS) — guruh so'zlari bilan tanishish
// ==================================================================
let vocabFlashIndex = 0;
let vocabFlashFlipped = false;
let vocabFlashWords = [];

function startVocabFlashcards() {
  vocabFlashWords = shuffleArr(currentVocabGroupWords);
  vocabFlashIndex = 0;
  showScreen('screen-vocab-flashcards');
  renderVocabFlashcard();
}

function renderVocabFlashcard() {
  const total = vocabFlashWords.length;
  const w = vocabFlashWords[vocabFlashIndex];
  vocabFlashFlipped = false;

  document.getElementById('vocabFlashProgress').textContent =
    `${vocabFlashIndex + 1}/${total} · ${currentVocabSectionIndex + 1}-bo'lim tanishish`;
  document.getElementById('vocabFlashProgressBar').style.width = `${Math.round((vocabFlashIndex / total) * 100)}%`;
  document.getElementById('vocabFlashFront').textContent = w.word;
  document.getElementById('vocabFlashBack').innerHTML = `
    <div class="flashcard-translation">${esc(w.translation)}</div>
    ${w.example ? `<div class="flashcard-example">${esc(w.example)}</div>` : ''}
  `;
  document.getElementById('vocabFlashcard').classList.remove('flipped');
  document.getElementById('vocabFlashHint').textContent = "Tarjimasini ko'rish uchun kartochkaga bosing";
  document.getElementById('vocabFlashPrevBtn').disabled = vocabFlashIndex === 0;
}

document.getElementById('vocabFlashcard').addEventListener('click', () => {
  vocabFlashFlipped = !vocabFlashFlipped;
  document.getElementById('vocabFlashcard').classList.toggle('flipped', vocabFlashFlipped);
  document.getElementById('vocabFlashHint').textContent = vocabFlashFlipped
    ? "Inglizcha ko'rinishga qaytish uchun yana bosing"
    : "Tarjimasini ko'rish uchun kartochkaga bosing";
});

document.getElementById('vocabFlashPrevBtn').addEventListener('click', () => {
  if (vocabFlashIndex > 0) {
    vocabFlashIndex--;
    renderVocabFlashcard();
  }
});

document.getElementById('vocabFlashNextBtn').addEventListener('click', () => {
  const total = vocabFlashWords.length;
  const isLast = vocabFlashIndex === total - 1;

  if (isLast) {
    startVocabMatchStage();
    return;
  }

  vocabFlashIndex++;
  renderVocabFlashcard();
});

document.getElementById('vocabFlashExitBtn').addEventListener('click', () => exitVocabSession());


// ==================================================================
// 7) 1-BOSQICH: MOSLASHTIRISH (MATCHING)
// ------------------------------------------------------------------
// So'zlar VOCAB_MATCH_ROUND_SIZE tadan round'larga bo'linadi. Har
// round'da chap ustunda so'zlar, o'ng ustunda aralashtirilgan
// tarjimalar ko'rsatiladi — o'quvchi bosib mos juftlikni tanlaydi.
// ==================================================================
let vocabMatchRounds = [];
let vocabMatchRoundIndex = 0;
let vocabMatchRemainingIds = new Set();
let vocabMatchSelectedWordId = null;
let vocabMatchSelectedTransWord = null; // translation tugmasi qaysi so'zga tegishli ekanini bildiruvchi obyekt
let vocabMatchLocked = false;

function startVocabMatchStage() {
  const shuffled = shuffleArr(currentVocabGroupWords);
  vocabMatchRounds = [];
  for (let i = 0; i < shuffled.length; i += VOCAB_MATCH_ROUND_SIZE) {
    vocabMatchRounds.push(shuffled.slice(i, i + VOCAB_MATCH_ROUND_SIZE));
  }
  vocabMatchRoundIndex = 0;
  showScreen('screen-vocab-match');
  renderVocabMatchRound();
}

function updateVocabMatchProgress() {
  document.getElementById('vocabMatchProgress').textContent =
    `1-bosqich · Moslashtirish · ${vocabMatchRoundIndex + 1}/${vocabMatchRounds.length}-round`;
  document.getElementById('vocabMatchProgressBar').style.width =
    `${Math.round((vocabMatchRoundIndex / Math.max(1, vocabMatchRounds.length)) * 100)}%`;
}

function renderVocabMatchRound() {
  if (vocabMatchRoundIndex >= vocabMatchRounds.length) {
    document.getElementById('vocabMatchProgressBar').style.width = '100%';
    startVocabTypeStage();
    return;
  }
  const roundWords = vocabMatchRounds[vocabMatchRoundIndex];
  vocabMatchRemainingIds = new Set(roundWords.map(w => w.id));
  vocabMatchSelectedWordId = null;
  vocabMatchSelectedTransWord = null;
  vocabMatchLocked = false;
  updateVocabMatchProgress();

  const wordOrder = shuffleArr(roundWords);
  const transOrder = shuffleArr(roundWords);

  document.getElementById('vocabMatchWordsCol').innerHTML = wordOrder.map(w => `
    <div class="vocab-match-item" data-word-id="${w.id}" data-side="word" onclick="onVocabMatchClick(this)">${esc(w.word)}</div>
  `).join('');
  document.getElementById('vocabMatchTransCol').innerHTML = transOrder.map(w => `
    <div class="vocab-match-item" data-word-id="${w.id}" data-side="trans" onclick="onVocabMatchClick(this)">${esc(w.translation)}</div>
  `).join('');
}

function onVocabMatchClick(el) {
  if (vocabMatchLocked) return;
  const wordId = parseInt(el.dataset.wordId, 10);
  const side = el.dataset.side;
  if (!vocabMatchRemainingIds.has(wordId)) return;
  if (el.classList.contains('selected')) return;

  // Avvalgi shu tomondagi tanlovni bekor qilamiz
  document.querySelectorAll(`.vocab-match-item[data-side="${side}"]`).forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');

  if (side === 'word') vocabMatchSelectedWordId = wordId;
  else vocabMatchSelectedTransWord = wordId;

  if (vocabMatchSelectedWordId == null || vocabMatchSelectedTransWord == null) return;

  vocabMatchLocked = true;
  const isMatch = vocabMatchSelectedWordId === vocabMatchSelectedTransWord;
  const wordEl = document.querySelector(`.vocab-match-item[data-side="word"][data-word-id="${vocabMatchSelectedWordId}"]`);
  const transEl = document.querySelector(`.vocab-match-item[data-side="trans"][data-word-id="${vocabMatchSelectedTransWord}"]`);

  const res = ensureWordResult(vocabMatchSelectedWordId);
  if (res.match === null) res.match = isMatch; // faqat birinchi urinish hisoblanadi

  if (isMatch) {
    wordEl.classList.add('correct');
    transEl.classList.add('correct');
    setTimeout(() => {
      if (vocabLives.lives <= 0) return;
      wordEl.classList.add('matched-hidden');
      transEl.classList.add('matched-hidden');
      vocabMatchRemainingIds.delete(vocabMatchSelectedWordId);
      vocabMatchSelectedWordId = null;
      vocabMatchSelectedTransWord = null;
      vocabMatchLocked = false;
      if (vocabMatchRemainingIds.size === 0) {
        vocabMatchRoundIndex++;
        renderVocabMatchRound();
      }
    }, 400);
  } else {
    wordEl.classList.add('wrong');
    transEl.classList.add('wrong');
    loseLife();
    setTimeout(() => {
      if (vocabLives.lives <= 0) return;
      wordEl.classList.remove('selected', 'wrong');
      transEl.classList.remove('selected', 'wrong');
      vocabMatchSelectedWordId = null;
      vocabMatchSelectedTransWord = null;
      vocabMatchLocked = false;
    }, 700);
  }
}

document.getElementById('vocabMatchExitBtn').addEventListener('click', () => exitVocabSession());


// ==================================================================
// 8) 2-BOSQICH: YOZISH (TYPING)
// ==================================================================
let vocabTypeWords = [];
let vocabTypeIndex = 0;
let vocabTypeLocked = false;

function startVocabTypeStage() {
  vocabTypeWords = shuffleArr(currentVocabGroupWords);
  vocabTypeIndex = 0;
  showScreen('screen-vocab-type');
  renderVocabTypeQuestion();
}

function updateVocabTypeProgress() {
  document.getElementById('vocabTypeProgress').textContent =
    `2-bosqich · Yozish · ${vocabTypeIndex + 1}/${vocabTypeWords.length}`;
  document.getElementById('vocabTypeProgressBar').style.width =
    `${Math.round((vocabTypeIndex / vocabTypeWords.length) * 100)}%`;
}

function renderVocabTypeQuestion() {
  if (vocabTypeIndex >= vocabTypeWords.length) {
    document.getElementById('vocabTypeProgressBar').style.width = '100%';
    startVocabQuizStage();
    return;
  }
  vocabTypeLocked = false;
  updateVocabTypeProgress();
  const w = vocabTypeWords[vocabTypeIndex];
  document.getElementById('vocabTypeWord').textContent = w.translation;
  const input = document.getElementById('vocabTypeInput');
  input.value = '';
  input.className = 'vocab-type-input';
  document.getElementById('vocabTypeFeedback').textContent = '';
  document.getElementById('vocabTypeFeedback').className = 'vocab-type-feedback';
  document.getElementById('vocabTypeSubmitBtn').textContent = 'Tekshirish';
  setTimeout(() => input.focus(), 50);
}

function submitVocabTypeAnswer() {
  if (vocabTypeLocked) {
    vocabTypeIndex++;
    renderVocabTypeQuestion();
    return;
  }
  vocabTypeLocked = true;
  const w = vocabTypeWords[vocabTypeIndex];
  const input = document.getElementById('vocabTypeInput');
  const isCorrect = checkTypedAnswer(input.value, w.word);

  ensureWordResult(w.id).type = isCorrect;

  input.className = `vocab-type-input ${isCorrect ? 'correct' : 'wrong'}`;
  const fb = document.getElementById('vocabTypeFeedback');
  fb.className = `vocab-type-feedback ${isCorrect ? 'correct' : ''}`;
  fb.textContent = isCorrect ? "To'g'ri!" : `To'g'ri javob: ${w.word}`;
  if (!isCorrect) loseLife();
  document.getElementById('vocabTypeSubmitBtn').textContent = 'Keyingisi';

  setTimeout(() => {
    if (vocabLives.lives <= 0) return;
    vocabTypeIndex++;
    renderVocabTypeQuestion();
  }, isCorrect ? 700 : 1400);
}

document.getElementById('vocabTypeSubmitBtn').addEventListener('click', submitVocabTypeAnswer);
document.getElementById('vocabTypeInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitVocabTypeAnswer();
});
document.getElementById('vocabTypeExitBtn').addEventListener('click', () => exitVocabSession());


// ==================================================================
// 9) 3-BOSQICH: ODDIY TEST (QUIZ)
// ------------------------------------------------------------------
// Har bir so'z navbat (queue) orqali so'raladi. Agar javob xato bo'lsa
// va so'z hali VOCAB_MAX_ATTEMPTS marta so'ralmagan bo'lsa, u navbatga
// tasodifiy joyga qaytarib qo'yiladi. Har bir so'zning YAKUNIY natijasi
// (to'g'ri/xato) shu bosqichda "yodlangan/yodlanmagan" holatini belgilaydi.
// ==================================================================
let vocabQuizQueue = [];
let vocabQuizTotal = 0;
let vocabQuizResolvedCount = 0;
let vocabQuizCorrectCount = 0;
let vocabQuizLocked = false;
let vocabQuizCurrentEntry = null;

function startVocabQuizStage() {
  vocabQuizTotal = currentVocabGroupWords.length;
  vocabQuizResolvedCount = 0;
  vocabQuizCorrectCount = 0;
  vocabQuizLocked = false;
  vocabQuizQueue = shuffleArr(currentVocabGroupWords.map(w => ({ word: w, attempts: 0 })));
  showScreen('screen-vocab-quiz');
  updateVocabQuizProgress();
  askNextVocabQuizQuestion();
}

function updateVocabQuizProgress() {
  document.getElementById('vocabQuizProgress').textContent =
    `${vocabQuizResolvedCount}/${vocabQuizTotal} · 3-bosqich · Oddiy test`;
  document.getElementById('vocabQuizProgressBar').style.width =
    `${Math.round((vocabQuizResolvedCount / vocabQuizTotal) * 100)}%`;
}

function askNextVocabQuizQuestion() {
  if (vocabQuizQueue.length === 0) {
    document.getElementById('vocabQuizProgressBar').style.width = '100%';
    return finishVocabGroupSession();
  }
  const entry = vocabQuizQueue.shift();
  vocabQuizCurrentEntry = entry;
  renderVocabQuizQuestion(entry);
}

function renderVocabQuizQuestion(entry) {
  const w = entry.word;
  const distractorPool = vocabFullBank.filter(x => x.id !== w.id);
  const distractors = shuffleArr(distractorPool).slice(0, Math.min(3, distractorPool.length)).map(x => x.translation);
  const options = shuffleArr([w.translation, ...distractors]);

  document.getElementById('vocabQuizArea').innerHTML = `
    ${entry.attempts > 0 ? `<div class="vocab-quiz-retry-hint">${icon('refresh-cw', 13)} Qayta so'ralmoqda — avval xato javob berilgan</div>` : ''}
    <div class="question-text" style="text-align:center;font-size:22px;font-weight:800;margin:24px 0 28px;">
      ${esc(w.word)}
    </div>
    <div id="vocabQuizOptions">
      ${options.map((opt, i) => `
        <div class="option" data-opt="${esc(opt)}" onclick="selectVocabQuizOption(this)">
          <span class="letter">${String.fromCharCode(65 + i)}</span>
          <span>${esc(opt)}</span>
        </div>
      `).join('')}
    </div>
  `;
}

function selectVocabQuizOption(el) {
  if (vocabQuizLocked) return;
  vocabQuizLocked = true;

  const entry = vocabQuizCurrentEntry;
  const chosen = el.dataset.opt;
  const correctAnswer = entry.word.translation;
  const isCorrect = chosen === correctAnswer;

  document.querySelectorAll('#vocabQuizOptions .option').forEach(o => {
    o.style.pointerEvents = 'none';
    if (o.dataset.opt === correctAnswer) o.classList.add('correct');
  });
  if (!isCorrect) el.classList.add('wrong');
  if (!isCorrect) loseLife();

  entry.attempts++;

  if (isCorrect) {
    vocabQuizResolvedCount++;
    vocabQuizCorrectCount++;
    ensureWordResult(entry.word.id).quiz = true;
  } else if (entry.attempts >= VOCAB_MAX_ATTEMPTS) {
    vocabQuizResolvedCount++;
    ensureWordResult(entry.word.id).quiz = false;
  } else {
    // navbatga tasodifiy joyga qaytarib qo'yamiz — darhol keyingisi bo'lib chiqmaydi
    const idx = vocabQuizQueue.length === 0 ? 0 : Math.floor(Math.random() * (vocabQuizQueue.length + 1));
    vocabQuizQueue.splice(idx, 0, entry);
  }

  updateVocabQuizProgress();

  setTimeout(() => {
    if (vocabLives.lives <= 0) return;
    vocabQuizLocked = false;
    askNextVocabQuizQuestion();
  }, isCorrect ? 500 : 1100);
}

document.getElementById('vocabQuizExitBtn').addEventListener('click', () => exitVocabSession());


// ==================================================================
// 10) NATIJA EKRANI VA SERVERGA YUBORISH
// ==================================================================
async function finishVocabGroupSession() {
  // Har bir so'z bo'yicha yakuniy (oddiy test) natijani serverga yuboramiz —
  // shu orqali "yodlangan/yodlanmagan" holati yangilanadi.
  await Promise.all(currentVocabGroupWords.map(w => {
    const r = vocabWordResults[w.id];
    return reportWordResult(w.id, 'quiz', !!(r && r.quiz));
  }));

  const matchCorrectCount = currentVocabGroupWords.filter(w => vocabWordResults[w.id]?.match).length;
  const typeCorrectCount = currentVocabGroupWords.filter(w => vocabWordResults[w.id]?.type).length;
  const points = matchCorrectCount * 3 + typeCorrectCount * 5 + vocabQuizCorrectCount * 10;

  const total = vocabQuizTotal;
  const correct = vocabQuizCorrectCount;

  let result = null;
  try {
    result = await api('/vocab/section-attempt', {
      method: 'POST',
      body: JSON.stringify({
        subject_id: currentVocabSubject.id,
        section_index: currentVocabSectionIndex,
        correct,
        total,
        points,
      }),
    });
  } catch (err) {
    showToast(err.message, 'danger');
  }

  if (result && vocabOverview) {
    vocabOverview.points = result.total_points;
    vocabOverview.games_played = result.games_played;
    vocabOverview.learned_count = result.learned_count;
  }
  if (result && result.lives) applyLivesStatus(result.lives);

  const pct = Math.round((correct / total) * 100);
  const passed = result ? result.passed : pct >= VOCAB_PASS_PERCENT;

  document.getElementById('vocabResultScore').textContent = `${correct}/${total}`;
  document.getElementById('vocabResultPercent').textContent =
    `${esc(currentVocabSubject.name)} • ${currentVocabSectionIndex + 1}-bo'lim • ${pct}%`;
  document.getElementById('vocabResultPoints').innerHTML = `${icon('zap', 15)} +${points} ball to'plandi${passed ? ` · ${icon('heart', 14)} +2 jon` : ''}`;
  document.getElementById('vocabResultBadge').innerHTML = passed
    ? `<span class="pass-badge passed">${icon('check-circle', 14)} Bo'lim topshirildi! Keyingi bo'lim ochildi</span>`
    : `<span class="pass-badge failed">${icon('star', 14)} Kamida 80% kerak, yana urinib ko'ring</span>`;

  document.getElementById('vocabResultBreakdown').innerHTML = `
    <div class="result-stat-row">
      <div class="result-stat-item correct">
        <div class="result-stat-num">${correct}</div>
        <div class="result-stat-lbl">To'g'ri</div>
      </div>
      <div class="result-stat-item wrong">
        <div class="result-stat-num">${total - correct}</div>
        <div class="result-stat-lbl">Xato</div>
      </div>
    </div>
  `;

  renderVocabResultActions();
  showScreen('screen-vocab-result');
}

function renderVocabResultActions() {
  const actions = document.getElementById('vocabResultActions');
  actions.innerHTML = `
    <button class="result-home-link" id="vocabResultRetryBtn">${icon('refresh-cw', 15)} Bo'limni qaytadan ishlash</button>
    <button class="result-home-link" id="vocabResultBackBtn">${icon('layers', 15)} Bo'limlarga qaytish</button>
  `;
  document.getElementById('vocabResultRetryBtn').addEventListener('click', () => startVocabGroup(currentVocabSectionIndex));
  document.getElementById('vocabResultBackBtn').addEventListener('click', async () => {
    showScreen('screen-vocab-detail');
    await loadVocabSectionsMeta(currentVocabSubject.id);
    renderVocabGroupsList();
  });
}
