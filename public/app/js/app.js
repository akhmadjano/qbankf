const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  // Qaysi qurilma bo'lishidan qat'i nazar har doim to'liq ekranda ochish
  try {
    if (typeof tg.requestFullscreen === 'function') tg.requestFullscreen();
  } catch (e) {}
  try {
    tg.onEvent && tg.onEvent('viewportChanged', () => tg.expand());
    tg.onEvent && tg.onEvent('fullscreenChanged', () => { if (!tg.isFullscreen) tg.expand(); applyTelegramSafeArea(); });
  } catch (e) {}
  try { tg.disableVerticalSwipes && tg.disableVerticalSwipes(); } catch (e) {}

  // To'liq ekran (fullscreen) rejimida Telegramning o'zi "Close", strelka va
  // "..." tugmalarini yuqoriga qo'yadi — bu tugmalar ilova kontenti bilan
  // ustma-ust tushib qolmasligi uchun yuqoridan bo'sh joy (safe area) qo'shamiz.
  // Ba'zi Telegram versiyalarida contentSafeAreaInset darhol to'g'ri qiymat
  // bermaydi, shu sabab to'liq ekranda kafolatlangan minimal bo'sh joy qoldiramiz.
  const TG_FULLSCREEN_MIN_TOP = 64;
  function applyTelegramSafeArea() {
    const contentInset = tg.contentSafeAreaInset || {};
    const safeInset = tg.safeAreaInset || {};
    let top = Math.max(contentInset.top || 0, safeInset.top || 0);
    if (tg.isFullscreen && top < TG_FULLSCREEN_MIN_TOP) top = TG_FULLSCREEN_MIN_TOP;
    document.documentElement.style.setProperty('--tg-safe-top', top + 'px');
  }
  applyTelegramSafeArea();
  setTimeout(applyTelegramSafeArea, 300);
  setTimeout(applyTelegramSafeArea, 1000);
  try { tg.onEvent && tg.onEvent('safeAreaChanged', applyTelegramSafeArea); } catch (e) {}
  try { tg.onEvent && tg.onEvent('contentSafeAreaChanged', applyTelegramSafeArea); } catch (e) {}
}

// Nusxa ko'chirish / joylashtirish / kontekst menyusini butun ilova bo'ylab bloklaymiz
['copy', 'cut', 'paste', 'contextmenu'].forEach(evt => {
  document.addEventListener(evt, e => e.preventDefault());
});
document.addEventListener('dragstart', e => e.preventDefault());
document.addEventListener('selectstart', e => {
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag !== 'input' && tag !== 'textarea') e.preventDefault();
});

// Statik HTML ichidagi "icon-xxx" klassli span'larni haqiqiy SVG ikonkalarga almashtiramiz
document.querySelectorAll('[class*="icon-"]').forEach(el => {
  const match = el.className.match(/icon-([\w-]+)/);
  if (!match) return;
  const name = match[1];
  const size = el.classList.contains('tab-icon') ? 22 : el.classList.contains('icon') ? 20 : 16;
  el.outerHTML = icon(name, size, 'inline-ic');
});

let TOKEN = null;
let CURRENT_STUDENT = null;
let subjects = [];
let currentSubject = null;
let currentQuestions = [];
let currentAttemptId = null;
let currentIndex = 0;
let answers = {};   // {questionId: 0}
let flags = {};     // {questionId: true}
let timerInterval = null;
let timerDeadline = null; // Date.now() + ms da tugaydi

// Har bir savolga sarflangan vaqtni kuzatish (soniyalarda)
let questionTimes = {};
let lastRenderedQid = null;
let questionEnterTs = null;

// Natija ko'rsatilgandan keyin qaysi tabga qaytish kerakligini eslab qolish
let reviewReturnTab = 'home'; // 'home' | 'profile'

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.remove('active');
    s.style.display = '';
  });
  document.getElementById(id).classList.add('active');
}
function openSheet(id) { document.getElementById(id)?.classList.add('active'); }
function closeSheet(id) { document.getElementById(id)?.classList.remove('active'); }
function esc(str) { return (str || '').toString().replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// ---------------- TOAST / CONFIRM MODAL (native alert/confirm o'rniga chiroyli UI) ----------------
let toastTimer = null;
function showToast(message, type = 'default', duration = 2400) {
  const el = document.getElementById('appToast');
  el.className = 'toast show' + (type === 'success' ? ' toast-success' : type === 'danger' ? ' toast-danger' : '');
  el.innerHTML = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.classList.remove('show'); }, duration);
}

function showConfirm({ iconName = 'help-circle', iconType = '', title = '', message = '', okText = 'Ha', cancelText = 'Bekor qilish', danger = false }) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('confirmModal');
    document.getElementById('confirmModalIcon').innerHTML = icon(iconName, 24);
    document.getElementById('confirmModalIcon').className = 'modal-icon' + (iconType ? ' icon-' + iconType : '');
    document.getElementById('confirmModalTitle').textContent = title;
    document.getElementById('confirmModalMessage').textContent = message;

    const okBtn = document.getElementById('confirmModalOk');
    const cancelBtn = document.getElementById('confirmModalCancel');
    okBtn.textContent = okText;
    cancelBtn.textContent = cancelText;
    okBtn.className = 'modal-btn modal-btn-primary' + (danger ? ' danger' : '');

    function cleanup(result) {
      overlay.classList.remove('active');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onOverlay);
      resolve(result);
    }
    function onOk() { cleanup(true); }
    function onCancel() { cleanup(false); }
    function onOverlay(e) { if (e.target === overlay) cleanup(false); }

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    overlay.addEventListener('click', onOverlay);
    overlay.classList.add('active');
  });
}

async function api(path, options = {}) {
  const res = await fetch('/api' + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(TOKEN ? { 'Authorization': 'Bearer ' + TOKEN } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Xatolik yuz berdi');
    err.data = data;
    throw err;
  }
  return data;
}

// ---------------- MAINTENANCE SCREEN ----------------
function showMaintenanceScreen(message) {
  const msg = message || 'Saytda texnik ishlar olib borilmoqda. Tez orada qaytamiz!';
  document.getElementById('maintenanceMsg').textContent = msg;
  document.querySelectorAll('.screen').forEach(s => { s.classList.remove('active'); s.style.display = ''; });
  const ms = document.getElementById('screen-maintenance');
  ms.style.display = 'flex'; ms.classList.add('active');
  function updateClock() {
    const now = new Date();
    const pad = n => String(n).padStart(2,'0');
    const clockEl = document.getElementById('maintenanceClock');
    const dateEl = document.getElementById('maintenanceDate');
    if (clockEl) clockEl.textContent = pad(now.getHours())+':'+pad(now.getMinutes())+':'+pad(now.getSeconds());
    if (dateEl) {
      const days=['Yakshanba','Dushanba','Seshanba','Chorshanba','Payshanba','Juma','Shanba'];
      const months=['yanvar','fevral','mart','aprel','may','iyun','iyul','avgust','sentabr','oktabr','noyabr','dekabr'];
      dateEl.textContent = days[now.getDay()]+', '+now.getDate()+' '+months[now.getMonth()]+' '+now.getFullYear();
    }
  }
  updateClock(); setInterval(updateClock, 1000);
}

// ---------------- AUTH (Telegram taklifi + login/parol) ----------------
async function loadBotLink() {
  try {
    const res = await fetch('/api/bot-info');
    const data = await res.json();
    const linkEl = document.getElementById('telegramBotLink');
    if (linkEl) {
      linkEl.href = data.link || 'https://t.me/';
    }
  } catch (e) {}
}

function switchAuthTab(tab) {
  const loginBtn = document.getElementById('tabLoginBtn');
  const registerBtn = document.getElementById('tabRegisterBtn');
  const loginForm = document.getElementById('authFormLogin');
  const registerForm = document.getElementById('authFormRegister');
  document.getElementById('authError').style.display = 'none';
  if (tab === 'register') {
    registerForm.style.display = 'block';
    loginForm.style.display = 'none';
    registerBtn.style.background = '#6366f1'; registerBtn.style.color = '#fff';
    loginBtn.style.background = '#1e293b'; loginBtn.style.color = '#94a3b8';
  } else {
    loginForm.style.display = 'block';
    registerForm.style.display = 'none';
    loginBtn.style.background = '#6366f1'; loginBtn.style.color = '#fff';
    registerBtn.style.background = '#1e293b'; registerBtn.style.color = '#94a3b8';
  }
}

function showAuthError(msg) {
  const errEl = document.getElementById('authError');
  errEl.textContent = msg;
  errEl.style.display = 'block';
}

async function submitLogin() {
  const username = document.getElementById('loginUsername')?.value.trim();
  const password = document.getElementById('loginPassword')?.value;
  if (!username || !password) return showAuthError('Login va parolni kiriting');
  const loginBtn = document.querySelector('#authFormLogin .btn-auth-submit');
  if (loginBtn) { loginBtn.disabled = true; loginBtn.textContent = 'Kirilmoqda...'; }
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) {
      if (loginBtn) { loginBtn.disabled = false; loginBtn.textContent = 'Kirish'; }
      return showAuthError(data.error || 'Kirishda xatolik');
    }
    TOKEN = data.token;
    CURRENT_STUDENT = data.student;
    localStorage.setItem('student_token', TOKEN);
    await loadSubjects();
    showScreen('screen-home');
    const name = data.student?.first_name || data.student?.username || 'Foydalanuvchi';
    setTimeout(() => showToast('Xush kelibsiz, ' + name + '!', 'success', 3000), 200);
  } catch (e) {
    if (loginBtn) { loginBtn.disabled = false; loginBtn.textContent = 'Kirish'; }
    showAuthError('Serverga ulanishda xatolik');
  }
}

async function submitRegister() {
  const first_name = document.getElementById('regFirst')?.value.trim();
  const last_name = document.getElementById('regLast')?.value.trim();
  const username = document.getElementById('regUsername')?.value.trim();
  const password = document.getElementById('regPassword')?.value;
  if (!first_name) return showAuthError('Ism kiritish majburiy');
  if (!username || username.length < 3) return showAuthError('Login kamida 3 belgidan iborat bo\'lishi kerak');
  if (!password || password.length < 4) return showAuthError('Parol kamida 4 belgidan iborat bo\'lishi kerak');
  const regBtn = document.querySelector('#authFormRegister .btn-auth-submit');
  if (regBtn) { regBtn.disabled = true; regBtn.textContent = 'Saqlanmoqda...'; }
  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ first_name, last_name, username, password })
    });
    const data = await res.json();
    if (!res.ok) {
      if (regBtn) { regBtn.disabled = false; regBtn.textContent = "Ro\'yxatdan o\'tish"; }
      return showAuthError(data.error || "Ro\'yxatdan o\'tishda xatolik");
    }
    TOKEN = data.token;
    CURRENT_STUDENT = data.student;
    localStorage.setItem('student_token', TOKEN);
    await loadSubjects();
    showScreen('screen-home');
    const name = data.student?.first_name || data.student?.username || 'Foydalanuvchi';
    setTimeout(() => showToast(name + " - Muvaffaqiyatli ro\'yxatdan o\'tdingiz!", 'success', 3500), 200);
  } catch (e) {
    if (regBtn) { regBtn.disabled = false; regBtn.textContent = "Ro\'yxatdan o\'tish"; }
    showAuthError('Serverga ulanishda xatolik');
  }
}

async function init() {
  try {
    // 1. Maintenance tekshirish
    const mRes = await fetch('/api/maintenance/status').catch(() => null);
    if (mRes?.ok) {
      const m = await mRes.json();
      if (m.enabled) { showMaintenanceScreen(m.message); return; }
    }

    // 2. URL dan auth xatosi bo'lsa ko'rsatish (eski Google havolalardan qolgan bo'lishi mumkin)
    const urlParams = new URLSearchParams(location.search);
    const authError = urlParams.get('auth_error');
    if (authError) {
      history.replaceState({}, '', '/app');
    }

    // 3. Saqlangan token bor bo'lsa
    const savedToken = localStorage.getItem('student_token');
    if (savedToken && !tg) {
      TOKEN = savedToken;
      try {
        const res = await api('/subjects');
        if (Array.isArray(res)) {
          subjects = res;
          // Token hali ham yaroqli, studentni olish
          try {
            const me = await api('/me/attempts');
            if (me) {
              const payload = JSON.parse(atob(savedToken.split('.')[1]));
              CURRENT_STUDENT = { id: payload.id, first_name: '', last_name: '' };
            }
          } catch(e) {}
          renderSubjectList();
          showScreen('screen-home');
          return;
        }
      } catch(e) {
        localStorage.removeItem('student_token');
        TOKEN = null;
      }
    }

    // 4. Telegram WebApp
    const initData = tg ? tg.initData : '';
    if (initData) {
      const data = await api('/auth/telegram', { method: 'POST', body: JSON.stringify({ initData }) });
      TOKEN = data.token;
      CURRENT_STUDENT = data.student;
      if (tg?.initDataUnsafe?.user?.photo_url) {
        CURRENT_STUDENT.photo_url = tg.initDataUnsafe.user.photo_url;
      }
      localStorage.setItem('student_token', TOKEN);
      if (data.needs_name) {
        showNameForm(initData);
        return;
      }
      await loadSubjects();
      showScreen('screen-home');
      return;
    }

    // 5. Na Telegram, na token — Telegram taklifi + login/parol ekranini ko'rsat
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const loginScreen = document.getElementById('screen-browser-entry');
    loginScreen.style.display = 'flex';
    loginScreen.classList.add('active');
    loadBotLink();

  } catch (err) {
    document.getElementById('screen-loading').innerHTML =
      `<div style="padding:30px;text-align:center;color:#d92d20;">Xatolik: ${esc(err.message)}</div>`;
  }
}

// ---------------- ISM/FAMILIYA FORMA ----------------
function showNameForm(initData) {
  const loadingEl = document.getElementById('screen-loading');
  loadingEl.innerHTML = `
    <div style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;background:#f8fafc;">
      <div style="background:#fff;border-radius:20px;padding:32px 24px;max-width:380px;width:100%;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <div style="text-align:center;margin-bottom:24px;">
          <div style="font-size:40px;margin-bottom:12px;">👋</div>
          <h2 style="margin:0 0 8px;font-size:20px;color:#0f172a;">Xush kelibsiz!</h2>
          <p style="margin:0;color:#64748b;font-size:14px;">Davom etish uchun ism va familiyangizni kiriting</p>
        </div>
        <div style="display:flex;flex-direction:column;gap:14px;">
          <div>
            <label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:6px;">Ism <span style="color:#ef4444;">*</span></label>
            <input id="nameFormFirst" type="text" placeholder="Ismingiz" maxlength="50"
              style="width:100%;padding:12px 14px;border:1.5px solid #e2e8f0;border-radius:10px;font-size:15px;outline:none;box-sizing:border-box;transition:border-color 0.2s;"
              onfocus="this.style.borderColor='#6366f1'" onblur="this.style.borderColor='#e2e8f0'" />
          </div>
          <div>
            <label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:6px;">Familiya</label>
            <input id="nameFormLast" type="text" placeholder="Familiyangiz" maxlength="50"
              style="width:100%;padding:12px 14px;border:1.5px solid #e2e8f0;border-radius:10px;font-size:15px;outline:none;box-sizing:border-box;transition:border-color 0.2s;"
              onfocus="this.style.borderColor='#6366f1'" onblur="this.style.borderColor='#e2e8f0'" />
          </div>
          <div id="nameFormError" style="color:#ef4444;font-size:13px;display:none;text-align:center;"></div>
          <button id="nameFormBtn" onclick="submitNameForm('${initData.replace(/'/g, "\\'")}')"
            style="margin-top:4px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;border:none;border-radius:12px;padding:14px;font-size:15px;font-weight:600;cursor:pointer;transition:opacity 0.2s;">
            ✅ Saqlash va davom etish
          </button>
        </div>
      </div>
    </div>
  `;
  // Enter tugmasida submit
  setTimeout(() => {
    document.getElementById('nameFormFirst')?.addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('nameFormLast')?.focus(); });
    document.getElementById('nameFormLast')?.addEventListener('keydown', e => { if (e.key === 'Enter') submitNameForm(initData); });
  }, 100);
}

async function submitNameForm(initData) {
  const firstName = document.getElementById('nameFormFirst')?.value?.trim();
  const lastName = document.getElementById('nameFormLast')?.value?.trim();
  const errEl = document.getElementById('nameFormError');
  const btn = document.getElementById('nameFormBtn');

  if (!firstName) {
    errEl.textContent = 'Iltimos, ismingizni kiriting.';
    errEl.style.display = 'block';
    document.getElementById('nameFormFirst')?.focus();
    return;
  }
  errEl.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Saqlanmoqda...';

  try {
    const data = await fetch('/api/auth/set-name', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, first_name: firstName, last_name: lastName || '' })
    }).then(r => r.json());

    if (data.error) throw new Error(data.error);

    TOKEN = data.token;
    CURRENT_STUDENT = data.student;
    localStorage.setItem('student_token', TOKEN);
    await loadSubjects();
    showScreen('screen-home');
  } catch (err) {
    errEl.textContent = err.message || 'Xatolik yuz berdi.';
    errEl.style.display = 'block';
    btn.disabled = false;
    btn.textContent = '✅ Saqlash va davom etish';
  }
}

// ---------------- HOME / SUBJECTS ----------------
async function loadSubjects() {
  subjects = await api('/subjects');
  document.getElementById('subjectList').innerHTML = subjects.map(s => `
    <div class="subject-card" onclick="openStartSheet(${s.id})">
      <div class="subject-icon">${icon('book-open', 20)}</div>
      <div class="info">
        <h3>${esc(s.name)}</h3>
        <p>${s.question_count} ta savol${s.description ? ' • ' + esc(s.description) : ''}${s.time_limit_minutes ? ` • ${icon('clock',12)} ${s.time_limit_minutes} daq` : ''}</p>
      </div>
      <div class="arrow">${icon('chevron-right', 18)}</div>
    </div>
  `).join('') || `<div class="empty-note">${icon('folder',22)}<p>Hozircha fanlar mavjud emas</p></div>`;
}

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', async () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll(`[data-tab="${tab.dataset.tab}"]`).forEach(t => t.classList.add('active'));
    if (tab.dataset.tab === 'home') { showScreen('screen-home'); }
    if (tab.dataset.tab === 'leaderboard') { showScreen('screen-leaderboard'); setLeaderboardType('questions'); }
    if (tab.dataset.tab === 'vocab') { showScreen('screen-vocab'); await loadVocabTopics(); }
    if (tab.dataset.tab === 'profile') { showScreen('screen-profile'); await loadProfile(); }
  });
});

// ---------------- LEADERBOARD (REYTING) — Savollar / So'zlar ----------------
let currentLeaderboardType = 'questions';

document.querySelectorAll('.lb-switch-btn').forEach(btn => {
  btn.addEventListener('click', () => setLeaderboardType(btn.dataset.lb));
});

function setLeaderboardType(type) {
  currentLeaderboardType = type;
  document.querySelectorAll('.lb-switch-btn').forEach(b => b.classList.toggle('active', b.dataset.lb === type));
  document.querySelector('.gradient-header p').textContent = type === 'words'
    ? "Yodlangan so'zlar soni bo'yicha"
    : "Eng yaxshi natijali o'quvchilar";
  loadLeaderboard();
}

async function loadLeaderboard() {
  const list = await api(currentLeaderboardType === 'words' ? '/vocab/leaderboard' : '/leaderboard');
  const myId = CURRENT_STUDENT?.id;
  document.getElementById('leaderboardList').innerHTML = list.map(r => {
    const isMe = r.student_id === myId || r.id === myId;
    const medalCls = r.rank === 1 ? 'gold' : r.rank === 2 ? 'silver' : r.rank === 3 ? 'bronze' : '';
    const sub = currentLeaderboardType === 'words'
      ? `${r.games_played} ta sessiya • ${r.points} ${icon('zap', 12)}`
      : `${r.attempt_count} test • ${r.total_correct != null ? r.total_correct : 0}/${r.total_questions != null ? r.total_questions : 0} to'g'ri javob`;
    const pct = currentLeaderboardType === 'words'
      ? `${r.learned_count} ${icon('check-circle', 12)}`
      : `${Math.round(r.avg_pct != null ? r.avg_pct : 0)}%`;
    return `
      <div class="leaderboard-item ${isMe ? 'is-me' : ''}">
        <div class="lb-rank ${medalCls}">${r.rank <= 3 ? icon('trophy', 16) : r.rank}</div>
        <div class="lb-info">
          <div class="lb-name">${esc(r.first_name)} ${esc(r.last_name || '')}${isMe ? ' <span class="lb-you-tag">Siz</span>' : ''}</div>
          <div class="lb-sub">${sub}</div>
        </div>
        <div class="lb-pct">${pct}</div>
      </div>
    `;
  }).join('') || `<div class="empty-note">${icon('trophy',22)}<p>Hali reyting uchun yetarli ma'lumot yo'q</p></div>`;
}

// ---------------- PROFILNI TAHRIRLASH ----------------
document.getElementById('profileEditBtn')?.addEventListener('click', () => {
  document.getElementById('editFirstName').value = CURRENT_STUDENT?.first_name || '';
  document.getElementById('editLastName').value = CURRENT_STUDENT?.last_name || '';
  const errEl = document.getElementById('editProfileError');
  errEl.classList.remove('show');
  errEl.textContent = '';
  openSheet('editProfileSheet');
  setTimeout(() => document.getElementById('editFirstName')?.focus(), 150);
});

document.getElementById('saveProfileBtn')?.addEventListener('click', async () => {
  const firstName = document.getElementById('editFirstName')?.value?.trim();
  const lastName = document.getElementById('editLastName')?.value?.trim();
  const errEl = document.getElementById('editProfileError');
  const btn = document.getElementById('saveProfileBtn');

  if (!firstName) {
    errEl.textContent = 'Iltimos, ismingizni kiriting.';
    errEl.classList.add('show');
    document.getElementById('editFirstName')?.focus();
    return;
  }
  errEl.classList.remove('show');
  btn.disabled = true;
  const prevLabel = btn.textContent;
  btn.textContent = 'Saqlanmoqda...';

  try {
    const data = await api('/me/profile', {
      method: 'PUT',
      body: JSON.stringify({ first_name: firstName, last_name: lastName || '' })
    });
    CURRENT_STUDENT = { ...CURRENT_STUDENT, ...data.student };
    closeSheet('editProfileSheet');
    await loadProfile();
    showToast("Profil ma'lumotlari yangilandi", 'success');
  } catch (err) {
    errEl.textContent = err.message || 'Xatolik yuz berdi.';
    errEl.classList.add('show');
  } finally {
    btn.disabled = false;
    btn.textContent = prevLabel;
  }
});

document.getElementById('editProfileSheet')?.addEventListener('click', (e) => {
  if (e.target.id === 'editProfileSheet') closeSheet('editProfileSheet');
});
document.getElementById('editFirstName')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('editLastName')?.focus();
});
document.getElementById('editLastName')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('saveProfileBtn')?.click();
});

// ---------------- PROFILE ----------------
async function loadProfile() {
  const name = `${CURRENT_STUDENT?.first_name || ''} ${CURRENT_STUDENT?.last_name || ''}`.trim() || "O'quvchi";
  document.getElementById('profileName').textContent = name;
  document.getElementById('profileUsername').textContent = CURRENT_STUDENT?.username ? '@' + CURRENT_STUDENT.username : '';
  // Avatar: Telegram photo_url bo'lsa rasm, bo'lmasa harf
  const avatarEl = document.getElementById('profileAvatar');
  if (avatarEl) {
    if (CURRENT_STUDENT?.photo_url) {
      avatarEl.innerHTML = `<img src="${CURRENT_STUDENT.photo_url}" alt="${name}" onerror="this.parentElement.innerHTML='<span class=\'avatar-letter\'>' + (name[0]||'?').toUpperCase() + '</span>'" />`;
    } else {
      avatarEl.innerHTML = `<span class="avatar-letter">${(name[0]||'?').toUpperCase()}</span>`;
    }
  }

  const stats = await api('/me/stats');
  document.getElementById('profileStats').innerHTML = `
    <div class="stat-box">
      <div class="stat-box-icon">${icon('book-open', 18)}</div>
      <div class="stat-box-num">${stats.attempt_count}</div>
      <div class="stat-box-lbl">Testlar</div>
    </div>
    <div class="stat-box">
      <div class="stat-box-icon">${icon('check-circle', 18)}</div>
      <div class="stat-box-num">${stats.total_correct}/${stats.total_questions}</div>
      <div class="stat-box-lbl">To'g'ri javob</div>
    </div>
    <div class="stat-box">
      <div class="stat-box-icon">${icon('bar-chart', 18)}</div>
      <div class="stat-box-num">${Math.round(stats.avg_pct)}%</div>
      <div class="stat-box-lbl">O'rtacha natija</div>
    </div>
  `;
  await loadHistory();
}

async function loadHistory() {
  const list = await api('/me/attempts');
  document.getElementById('historyList').innerHTML = list.map(h => {
    const pct = h.total ? Math.round((h.score / h.total) * 100) : 0;
    const passed = pct >= 80;
    return `
    <div class="history-item">
      <div class="history-item-icon">${icon('book-open', 16)}</div>
      <div class="history-item-body">
        <div class="name">${esc(h.subject_name)}</div>
        <div class="date">${new Date(h.finished_at).toLocaleDateString('uz-UZ')}</div>
      </div>
      <div class="history-item-right">
        <div class="score">${h.score}/${h.total} <span class="history-pct">(${pct}%)</span></div>
        <span class="history-pass-tag ${passed ? 'passed' : 'failed'}">${passed ? "O'tdi" : "O'tmadi"}</span>
      </div>
    </div>
  `;
  }).join('') || `<div class="empty-note">${icon('clock',22)}<p>Hali test ishlamagansiz</p></div>`;
}

// ---------------- START SHEET ----------------
let selectedCount = 50; // HTML'dagi default "active" tugma (50 ta) bilan mos bo'lishi kerak

async function openStartSheet(subjectId) {
  currentSubject = subjects.find(s => s.id === subjectId);

  // Avval shu fan bo'yicha tugallanmagan (yarim qolgan) test bor-yo'qligini tekshiramiz.
  // Faqat shunday test mavjud bo'lsagina davom ettirish haqida so'raymiz.
  try {
    const { active } = await api(`/subjects/${subjectId}/active`);
    if (active) {
      const answered = Object.keys(active.answers || {}).length;
      const wantsResume = await showConfirm({
        iconName: 'bookmark',
        title: 'Saqlangan testingiz bor',
        message: `"${currentSubject.name}" fanidan tugallanmagan testingiz bor (${answered}/${active.questions.length} ta savolga javob berilgan).\n\nDavom ettirasizmi?`,
        okText: 'Davom ettirish',
        cancelText: 'Yangi test',
      });
      if (wantsResume) {
        resumeAttempt(active);
        return;
      }
      // "Yangi test" tanlansa - pastdagi sheet ochiladi, eski test /start chaqirilganda avtomatik bekor qilinadi
    }
  } catch (err) {
    // Tekshirishda xatolik bo'lsa, oddiy "yangi test" oqimiga o'tamiz
  }

  showStartSheetUI();
}

function showStartSheetUI() {
  document.getElementById('startSheetTitle').textContent = currentSubject.name;
  const timeNote = document.getElementById('startSheetTimeNote');
  if (currentSubject.time_limit_minutes) {
    timeNote.innerHTML = `${icon('clock', 14)} Bu fan uchun vaqt chegarasi: ${currentSubject.time_limit_minutes} daqiqa`;
    timeNote.style.display = 'flex';
  } else {
    timeNote.style.display = 'none';
  }
  // Tanlovni har safar standart holatga (50 ta) qaytaramiz
  document.querySelectorAll('#countOptions button').forEach(b => b.classList.remove('active'));
  const defaultBtn = document.querySelector('#countOptions button[data-count="50"]');
  if (defaultBtn) defaultBtn.classList.add('active');
  selectedCount = 50;
  document.getElementById('startSheet').classList.add('active');
}
document.querySelectorAll('#countOptions button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#countOptions button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedCount = parseInt(btn.dataset.count);
  });
});
document.getElementById('startSheet').addEventListener('click', (e) => {
  if (e.target.id === 'startSheet') e.target.classList.remove('active');
});

document.getElementById('startTestBtn').addEventListener('click', async () => {
  document.getElementById('startSheet').classList.remove('active');
  try {
    const data = await api(`/subjects/${currentSubject.id}/start`, {
      method: 'POST', body: JSON.stringify({ count: selectedCount })
    });
    currentAttemptId = data.attempt_id;
    currentQuestions = data.questions;
    currentIndex = 0;
    answers = {};
    flags = {};
    questionTimes = {};
    lastRenderedQid = null;
    questionEnterTs = null;
    showScreen('screen-test');
    renderQuestion();
    startTimer(data.time_limit_minutes);
    if (data.mastered_all) {
      showToast(`${icon('check-circle', 14)} Siz bu fandagi barcha savollarni to'g'ri yechgansiz — takrorlash uchun ber qildik`, 'success', 3200);
    }
  } catch (err) {
    if (err.message !== 'maintenance') {
      if (err.data && err.data.vocab_required) {
        showToast(err.message, 'danger', 4200);
        if (typeof goToVocabSubjectForTest === 'function') goToVocabSubjectForTest(err.data.subject_id);
      } else {
        showToast(err.message, 'danger');
      }
    }
  }
});

// Tugallanmagan testni xuddi qolgan joyidan davom ettiradi
function resumeAttempt(active) {
  currentAttemptId = active.attempt_id;
  currentQuestions = active.questions;
  currentIndex = Math.min(active.current_index || 0, Math.max(currentQuestions.length - 1, 0));

  answers = {};
  Object.entries(active.answers || {}).forEach(([k, v]) => { answers[k] = parseInt(v); });

  flags = {};
  Object.entries(active.flags || {}).forEach(([k, v]) => { flags[k] = !!v; });

  questionTimes = {};
  Object.entries(active.question_times || {}).forEach(([k, v]) => { questionTimes[k] = v; });

  lastRenderedQid = null;
  questionEnterTs = null;
  showScreen('screen-test');
  renderQuestion();

  if (active.time_limit_minutes) {
    if (active.remaining_minutes <= 0) {
      autoSubmitOnTimeout();
    } else {
      startTimer(active.remaining_minutes);
    }
  } else {
    startTimer(null);
  }
}

// ---------------- PROGRESS AVTOSAQLASH ----------------
// Har bir javob/o'tishda testni serverga saqlaymiz, shunda test o'rtasida
// chiqib ketilsa ham, keyinroq xuddi shu joydan davom ettirish mumkin bo'ladi
let progressSaveTimer = null;
function saveProgressNow(exiting) {
  if (!currentAttemptId) return;
  try {
    fetch('/api/attempts/' + currentAttemptId + '/progress', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(TOKEN ? { 'Authorization': 'Bearer ' + TOKEN } : {}),
      },
      body: JSON.stringify({ answers, times: questionTimes, current_index: currentIndex, flags, exiting: !!exiting }),
      keepalive: true,
    }).catch(() => {});
  } catch (e) {}
}
function scheduleSaveProgress() {
  clearTimeout(progressSaveTimer);
  progressSaveTimer = setTimeout(saveProgressNow, 500);
}

// Test ekranida turganda har 20 soniyada "men hali shu yerdaman" signalini yuborish
// (developer paneldagi real-time monitoring shunga tayanadi)
let heartbeatInterval = null;
function startHeartbeat() {
  clearInterval(heartbeatInterval);
  saveProgressNow(false);
  heartbeatInterval = setInterval(() => saveProgressNow(false), 20000);
}
function stopHeartbeat() {
  clearInterval(heartbeatInterval);
  heartbeatInterval = null;
}
// Ilova fonga o'tganda yoki yopilganda ham saqlab qolish uchun
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && document.getElementById('screen-test').classList.contains('active')) {
    flushCurrentQuestionTime();
    saveProgressNow();
  }
});
window.addEventListener('beforeunload', () => {
  if (document.getElementById('screen-test').classList.contains('active')) {
    flushCurrentQuestionTime();
    saveProgressNow();
  }
});

// ---------------- TIMER ----------------
function startTimer(timeLimitMinutes) {
  clearTimer();
  startHeartbeat();
  const timerEl = document.getElementById('testTimer');
  if (!timeLimitMinutes) { timerEl.style.display = 'none'; return; }

  timerDeadline = Date.now() + timeLimitMinutes * 60 * 1000;
  timerEl.style.display = 'inline-flex';
  timerEl.classList.remove('timer-warning');
  updateTimerDisplay();
  timerInterval = setInterval(updateTimerDisplay, 1000);
}

function updateTimerDisplay() {
  const timerEl = document.getElementById('testTimer');
  const remainingMs = timerDeadline - Date.now();
  if (remainingMs <= 0) {
    timerEl.innerHTML = `${icon('clock', 14)} 00:00`;
    clearTimer();
    autoSubmitOnTimeout();
    return;
  }
  const totalSec = Math.ceil(remainingMs / 1000);
  const mm = Math.floor(totalSec / 60).toString().padStart(2, '0');
  const ss = (totalSec % 60).toString().padStart(2, '0');
  timerEl.innerHTML = `${icon('clock', 14)} ${mm}:${ss}`;
  timerEl.classList.toggle('timer-warning', totalSec <= 60);
}

function clearTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  stopHeartbeat();
}

// joriy ko'rinayotgan savolga sarflangan vaqtni hisoblab questionTimes ga qo'shadi
function flushCurrentQuestionTime() {
  if (lastRenderedQid !== null && questionEnterTs !== null) {
    const elapsed = (Date.now() - questionEnterTs) / 1000;
    questionTimes[lastRenderedQid] = (questionTimes[lastRenderedQid] || 0) + elapsed;
  }
}

async function autoSubmitOnTimeout() {
  flushCurrentQuestionTime();
  lastRenderedQid = null;
  try {
    const result = await api(`/attempts/${currentAttemptId}/submit`, {
      method: 'POST', body: JSON.stringify({ answers, times: questionTimes })
    });
    document.getElementById('qnavSheet').classList.remove('active');
    showToast(`${icon('clock', 14)} Vaqt tugadi! Test avtomatik yakunlandi.`, 'danger', 3000);
    await showResult(currentAttemptId, result);
  } catch (err) {
    if (err.message !== 'maintenance') showToast(err.message, 'danger');
  }
}

// ---------------- TEST SCREEN ----------------
function renderQuestion() {
  flushCurrentQuestionTime();

  const q = currentQuestions[currentIndex];
  lastRenderedQid = q.id;
  questionEnterTs = Date.now();

  const total = currentQuestions.length;
  document.getElementById('testProgress').textContent = `Savol ${currentIndex + 1}/${total}`;
  document.getElementById('progressBar').style.width = `${((currentIndex + 1) / total) * 100}%`;

  const isFlagged = !!flags[q.id];
  const selected = answers[q.id];

  const optionsHtml = (q.options || []).map((text, i) => {
    const letter = String.fromCharCode(65 + i);
    const sel = selected === i;
    return `
      <div class="option ${sel ? 'selected' : ''}" onclick="selectAnswer('${q.id}', ${i})">
        <div class="letter">${letter}</div>
        <div>${esc(text)}</div>
      </div>
    `;
  }).join('');

  document.getElementById('questionArea').innerHTML = `
    <div class="meta-bar">
      <span>${esc(currentSubject ? currentSubject.name : '')}</span>
      <span>${(q.options || []).length} variant</span>
    </div>
    <div class="question-flag-row">
      <button class="flag-btn ${isFlagged ? 'flagged' : ''}" onclick="toggleFlag('${q.id}')">
        ${icon('bookmark', 13)} ${isFlagged ? "Belgilangan" : "Keyinroq ko'rish uchun belgilash"}
      </button>
    </div>
    <div class="question-columns">
      <div class="question-passage-col">
        <div class="question-text">${esc(q.question_text)}</div>
        ${q.image_url ? `<img src="${q.image_url}" class="question-image" />` : ''}
      </div>
      <div class="question-options-col">
        ${optionsHtml}
      </div>
    </div>
  `;

  document.getElementById('prevBtn').disabled = currentIndex === 0;
  document.getElementById('nextBtn').innerHTML = currentIndex === total - 1
    ? `Yakunlash ${icon('chevron-right', 16)}`
    : `Keyingi ${icon('chevron-right', 16)}`;
}

function selectAnswer(qid, letter) {
  answers[qid] = letter;
  renderQuestion();
  scheduleSaveProgress();
}
function toggleFlag(qid) {
  flags[qid] = !flags[qid];
  renderQuestion();
  scheduleSaveProgress();
}

document.getElementById('prevBtn').addEventListener('click', () => {
  if (currentIndex > 0) { currentIndex--; renderQuestion(); scheduleSaveProgress(); }
});
document.getElementById('nextBtn').addEventListener('click', () => {
  if (currentIndex < currentQuestions.length - 1) {
    currentIndex++;
    renderQuestion();
    scheduleSaveProgress();
  } else {
    openQnavSheet();
  }
});
document.getElementById('exitTestBtn').addEventListener('click', () => {
  flushCurrentQuestionTime();
  saveProgressNow(true); // chiqib ketdi — endi "online" emas, "saqlangan" deb belgilanadi
  clearTimer();
  lastRenderedQid = null;
  showScreen('screen-home');
  loadSubjects();
  showToast(`${icon('check-circle', 14)} Holatingiz saqlandi`, 'success');
});

// ---------------- QUESTION NAV GRID ----------------
function openQnavSheet() {
  document.getElementById('qnavGrid').innerHTML = currentQuestions.map((q, i) => `
    <div class="qnav-item ${answers[q.id] !== undefined ? 'answered' : ''} ${flags[q.id] ? 'flagged' : ''} ${i === currentIndex ? 'current' : ''}"
         onclick="jumpTo(${i})">${i + 1}</div>
  `).join('');
  document.getElementById('qnavSheet').classList.add('active');
}
document.getElementById('navGridToggle').addEventListener('click', openQnavSheet);
document.getElementById('qnavSheet').addEventListener('click', (e) => {
  if (e.target.id === 'qnavSheet') e.target.classList.remove('active');
});
function jumpTo(i) {
  currentIndex = i;
  document.getElementById('qnavSheet').classList.remove('active');
  renderQuestion();
  scheduleSaveProgress();
}

let submitTestBusy = false;
document.getElementById('submitTestBtn').addEventListener('click', async () => {
  if (submitTestBusy) return; // spam himoyasi — ikki marta bosilsa ham qayta yubormaydi
  const unanswered = currentQuestions.length - Object.keys(answers).length;
  const ok = await showConfirm({
    iconName: 'help-circle',
    title: "Testni yakunlaymizmi?",
    message: unanswered > 0
      ? `${unanswered} ta savolga javob berilmagan. Baribir yakunlamoqchimisiz?`
      : "Test yakunlanadi va natijalar hisoblanadi. Aniqmisiz?",
    okText: 'Ha, yakunlash',
    cancelText: 'Davom etish',
    danger: unanswered > 0,
  });
  if (!ok) return;

  submitTestBusy = true;
  const btn = document.getElementById('submitTestBtn');
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="btn-spinner"></span> Natijalar tekshirilmoqda...`;

  flushCurrentQuestionTime();
  lastRenderedQid = null;
  try {
    const result = await api(`/attempts/${currentAttemptId}/submit`, {
      method: 'POST', body: JSON.stringify({ answers, times: questionTimes })
    });
    clearTimer();
    document.getElementById('qnavSheet').classList.remove('active');
    await showResult(currentAttemptId, result);
  } catch (err) {
    if (err.message !== 'maintenance') showToast(err.message, 'danger');
  } finally {
    submitTestBusy = false;
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
});

// ---------------- RESULT (oddiy statistika: nechtadan nechta, necha foiz) ----------------
function showResult(attemptId, summary) {
  reviewReturnTab = 'home';
  renderResultStats(summary.score, summary.total, answers, summary.passed);
}

function renderResultStats(score, total, answersMap, passedFlag) {
  const pct = total ? Math.round((score / total) * 100) : 0;
  const answeredCount = Object.keys(answersMap || {}).length;
  const wrong = Math.max(answeredCount - score, 0);
  const unanswered = Math.max(total - answeredCount, 0);
  const passed = (passedFlag !== undefined) ? passedFlag : (pct >= 80);

  document.getElementById('resultScore').textContent = `${score}/${total}`;
  document.getElementById('resultPercent').textContent = `${pct}% to'g'ri`;

  document.getElementById('resultPassBadge').innerHTML = passed
    ? `<span class="pass-badge passed">${icon('check-circle', 14)} O'tdingiz (kamida 80%)</span>`
    : `<span class="pass-badge failed">${icon('x-circle', 14)} O'ta olmadingiz (kamida 80% kerak)</span>`;

  document.getElementById('resultBreakdown').innerHTML = `
    <div class="result-stat-row">
      <div class="result-stat-item correct">
        <div class="result-stat-num">${score}</div>
        <div class="result-stat-lbl">To'g'ri</div>
      </div>
      <div class="result-stat-item wrong">
        <div class="result-stat-num">${wrong}</div>
        <div class="result-stat-lbl">Xato</div>
      </div>
      ${unanswered > 0 ? `
      <div class="result-stat-item unanswered">
        <div class="result-stat-num">${unanswered}</div>
        <div class="result-stat-lbl">Javobsiz</div>
      </div>` : ''}
    </div>
  `;

  showScreen('screen-result');
}

document.getElementById('backHomeBtn').addEventListener('click', () => {
  clearTimer();
  if (reviewReturnTab === 'profile') {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll(`[data-tab="profile"]`).forEach(t => t.classList.add('active'));
    showScreen('screen-profile');
    loadProfile();
  } else {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll(`[data-tab="home"]`).forEach(t => t.classList.add('active'));
    showScreen('screen-home');
    loadSubjects();
  }
  reviewReturnTab = 'home';
});

// ==================================================================
// SO'ZLAR (VOCAB) bo'limi endi alohida faylga ko'chirildi: js/vocab.js
// ==================================================================


init();
