const TOKEN = localStorage.getItem('admin_token');
if (!TOKEN) window.location.href = 'index.html';

const CLOUDINARY_CLOUD_NAME = 'dnv9ctnyk';
const CLOUDINARY_UPLOAD_PRESET = 'unsigned_shop_upload';

async function api(path, options = {}) {
  const res = await fetch('/api/admin' + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + TOKEN,
      ...(options.headers || {}),
    },
  });
  if (res.status === 401 || res.status === 403) {
    localStorage.removeItem('admin_token');
    window.location.href = 'index.html';
    throw new Error('Unauthorized');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Xatolik');
  return data;
}

function closeModal(id) { document.getElementById(id).classList.remove('active'); }
function openModal(id) { document.getElementById(id).classList.add('active'); }
function esc(str) { return (str || '').toString().replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function escPara(str) {
  if (!str) return '';
  return str.split(/\n{2,}/)  
    .map(para => para.split('\n').map(esc).join('<br>'))
    .map(para => '<p class="qpara">' + para + '</p>')
    .join('');
}
function fmtDate(d) { if (!d) return '-'; return new Date(d).toLocaleString('uz-UZ', { dateStyle: 'medium', timeStyle: 'short' }); }
function optionLetter(i) { return String.fromCharCode(65 + i); }

// ---------------- DYNAMIC OPTIONS BUILDER ----------------
let optionRows = []; // [{text, id}]
let optionCorrectIndex = null;
let optionRowSeq = 0;

function renderOptionRows() {
  document.getElementById('optionsList').innerHTML = optionRows.map((row, i) => `
    <div class="option-row" data-row-id="${row.id}">
      <span>${optionLetter(i)})</span>
      <input type="text" style="flex:1" value="${esc(row.text)}" oninput="updateOptionText(${row.id}, this.value)" placeholder="Variant matni" />
      <input type="radio" name="correctOpt" ${optionCorrectIndex === i ? 'checked' : ''} onchange="setCorrectOption(${i})" title="To'g'ri javob" />
      ${optionRows.length > 2 ? `<button type="button" class="btn btn-danger btn-sm" onclick="removeOptionRow(${row.id})">${icon("x",14)}</button>` : ''}
    </div>
  `).join('');
}
function addOptionRow(text = '') {
  optionRows.push({ id: optionRowSeq++, text });
  renderOptionRows();
}
function removeOptionRow(id) {
  const idx = optionRows.findIndex(r => r.id === id);
  if (idx === -1 || optionRows.length <= 2) return;
  if (optionCorrectIndex === idx) optionCorrectIndex = null;
  else if (optionCorrectIndex !== null && optionCorrectIndex > idx) optionCorrectIndex--;
  optionRows.splice(idx, 1);
  renderOptionRows();
}
function updateOptionText(id, value) {
  const row = optionRows.find(r => r.id === id);
  if (row) row.text = value;
}
function setCorrectOption(i) {
  optionCorrectIndex = i;
}
function resetOptionsBuilder(options = ['', ''], correctIndex = null) {
  optionRowSeq = 0;
  optionRows = options.map(text => ({ id: optionRowSeq++, text }));
  optionCorrectIndex = correctIndex;
  renderOptionRows();
}
document.getElementById('addOptionBtn').addEventListener('click', () => addOptionRow());

// ---------------- FILE DOWNLOAD HELPER (auth header kerak bo'lgani uchun) ----------------
async function downloadAuthed(path, fallbackName) {
  const res = await fetch('/api/admin' + path, { headers: { 'Authorization': 'Bearer ' + TOKEN } });
  if (!res.ok) { alert('Yuklab olishda xatolik yuz berdi'); return; }
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="(.+)"/);
  const filename = match ? match[1] : fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// ---------------- NAVIGATION ----------------
// Statik HTML ichidagi "icon-xxx" klassli span'larni haqiqiy SVG ikonkalarga almashtiramiz
document.querySelectorAll('[class^="icon-"]').forEach(el => {
  const name = el.className.replace('icon-', '');
  el.outerHTML = icon(name, 16);
});

document.querySelectorAll('.nav-item[data-panel]').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    item.classList.add('active');
    document.getElementById(item.dataset.panel).classList.add('active');
    loadPanelData(item.dataset.panel);
  });
});
document.getElementById('logoutBtn').addEventListener('click', () => {
  localStorage.removeItem('admin_token');
  window.location.href = 'index.html';
});

function loadPanelData(panel) {
  if (panel === 'panel-overview') loadOverview();
  if (panel === 'panel-subjects') loadSubjects();
  if (panel === 'panel-questions') loadQuestionsPanel();
  if (panel === 'panel-results') loadResultsPanel();
  if (panel === 'panel-students') loadStudents();
  if (panel === 'panel-vocab') loadVocabWordsPanel();
  if (panel === 'panel-vocab-results') loadVocabResultsPanel();
}

// ---------------- OVERVIEW ----------------
async function loadOverview() {
  const [subjects, results, students] = await Promise.all([
    api('/subjects'), api('/results'), api('/students')
  ]);
  const totalQuestions = subjects.reduce((s, x) => s + x.question_count, 0);
  document.getElementById('statGrid').innerHTML = `
    <div class="stat-card"><div class="num">${subjects.length}</div><div class="lbl">Fanlar</div></div>
    <div class="stat-card"><div class="num">${totalQuestions}</div><div class="lbl">Savollar</div></div>
    <div class="stat-card"><div class="num">${students.length}</div><div class="lbl">O'quvchilar</div></div>
    <div class="stat-card"><div class="num">${results.length}</div><div class="lbl">Yakunlangan testlar</div></div>
  `;
  const tbody = document.querySelector('#recentResultsTable tbody');
  tbody.innerHTML = results.slice(0, 8).map(r => `
    <tr>
      <td>${esc(r.first_name)} ${esc(r.last_name || '')}</td>
      <td>${esc(r.subject_name)}</td>
      <td>${r.score}/${r.total}</td>
      <td>${fmtDate(r.finished_at)}</td>
    </tr>
  `).join('') || '<tr><td colspan="4" class="empty-state">Hali natijalar yo\'q</td></tr>';
}

// ---------------- SUBJECTS ----------------
async function loadSubjects() {
  const subjects = await api('/subjects');
  document.getElementById('subjectsTbody').innerHTML = subjects.map(s => `
    <tr>
      <td><strong>${esc(s.name)}</strong></td>
      <td>${esc(s.description || '-')}</td>
      <td><span class="badge badge-blue">${s.question_count}</span></td>
      <td>${s.time_limit_minutes ? `<span class="badge badge-gray">⏱ ${s.time_limit_minutes} daqiqa</span>` : '<span style="color:var(--muted);font-size:13px;">Cheklanmagan</span>'}</td>
      <td class="row-actions">
        <button class="btn btn-outline btn-sm" onclick='editSubject(${JSON.stringify(s)})'>Tahrirlash</button>
        <button class="btn btn-danger btn-sm" onclick="deleteSubject(${s.id})">O'chirish</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="5" class="empty-state">Fanlar yo\'q. Yangi fan qo\'shing.</td></tr>';

  // filtr select'larini ham yangilab turamiz
  const opts = subjects.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  document.getElementById('filterSubject').innerHTML = '<option value="">Barcha fanlar</option>' + opts;
  document.getElementById('resultsFilterSubject').innerHTML = '<option value="">Barcha fanlar</option>' + opts;
  document.getElementById('qSubject').innerHTML = opts;
}

document.getElementById('addSubjectBtn').addEventListener('click', () => {
  document.getElementById('subjectModalTitle').textContent = "Fan qo'shish";
  document.getElementById('subjectId').value = '';
  document.getElementById('subjectName').value = '';
  document.getElementById('subjectDesc').value = '';
  document.getElementById('subjectTimeLimit').value = '';
  openModal('subjectModal');
});

function editSubject(s) {
  document.getElementById('subjectModalTitle').textContent = 'Fanni tahrirlash';
  document.getElementById('subjectId').value = s.id;
  document.getElementById('subjectName').value = s.name;
  document.getElementById('subjectDesc').value = s.description || '';
  document.getElementById('subjectTimeLimit').value = s.time_limit_minutes || '';
  openModal('subjectModal');
}

document.getElementById('saveSubjectBtn').addEventListener('click', async () => {
  const id = document.getElementById('subjectId').value;
  const name = document.getElementById('subjectName').value.trim();
  const description = document.getElementById('subjectDesc').value.trim();
  const time_limit_minutes = document.getElementById('subjectTimeLimit').value.trim();
  if (!name) return alert("Fan nomini kiriting");

  const payload = { name, description, time_limit_minutes };
  if (id) await api('/subjects/' + id, { method: 'PUT', body: JSON.stringify(payload) });
  else await api('/subjects', { method: 'POST', body: JSON.stringify(payload) });

  closeModal('subjectModal');
  loadSubjects();
});

async function deleteSubject(id) {
  if (!confirm("Fanni o'chirsangiz, unga tegishli barcha savollar ham o'chadi. Davom etasizmi?")) return;
  await api('/subjects/' + id, { method: 'DELETE' });
  loadSubjects();
}

// ---------------- QUESTIONS ----------------
async function loadQuestionsPanel() {
  await loadSubjects(); // select uchun fanlar kerak
  await renderQuestions();
}

let currentQuestionList = []; // hozirgi filtrlangan savollar ro'yxati (ko'rish modalida navigatsiya uchun)

async function renderQuestions() {
  const subjectId = document.getElementById('filterSubject').value;
  const qs = await api('/questions' + (subjectId ? `?subject_id=${subjectId}` : ''));
  const subjects = await api('/subjects');
  const subjectName = id => (subjects.find(s => s.id === id) || {}).name || '-';
  currentQuestionList = qs.map(q => ({ ...q, subject_name: subjectName(q.subject_id) }));

  document.getElementById('questionsTbody').innerHTML = currentQuestionList.map((q, idx) => `
    <tr>
      <td>${esc(q.question_text.slice(0, 70))}${q.question_text.length > 70 ? '…' : ''}</td>
      <td>${esc(q.subject_name)}</td>
      <td>${q.image_url ? '🖼️' : '-'}</td>
      <td><span class="badge badge-blue">${(q.options||[]).length} variant</span></td>
      <td><span class="badge badge-green">${optionLetter(q.correct_index)}</span></td>
      <td class="row-actions">
        <button class="btn btn-outline btn-sm" onclick="openQuestionView(${idx})">${icon('eye',14)} Ko'rish</button>
        <button class="btn btn-outline btn-sm" onclick='editQuestion(${JSON.stringify(q).replace(/'/g, "&#39;")})'>Tahrirlash</button>
        <button class="btn btn-danger btn-sm" onclick="deleteQuestion(${q.id})">O'chirish</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="6" class="empty-state">Savollar topilmadi</td></tr>';
}

document.getElementById('filterSubject').addEventListener('change', renderQuestions);
document.getElementById('exportXlsxBtn').addEventListener('click', () => {
  const subjectId = document.getElementById('filterSubject').value;
  downloadAuthed('/questions/export?format=xlsx' + (subjectId ? `&subject_id=${subjectId}` : ''), 'savollar.xlsx');
});
document.getElementById('exportPdfBtn').addEventListener('click', () => {
  const subjectId = document.getElementById('filterSubject').value;
  downloadAuthed('/questions/export?format=pdf' + (subjectId ? `&subject_id=${subjectId}` : ''), 'savollar.pdf');
});

// ---------------- EXCEL IMPORT ----------------
document.getElementById('openImportBtn').addEventListener('click', async () => {
  document.getElementById('importResultBox').innerHTML = '';
  document.getElementById('importFile').value = '';
  const subjects = await api('/subjects');
  document.getElementById('importDefaultSubject').innerHTML =
    '<option value="">— Excel\'dagi "Fan" ustunidan foydalanilsin —</option>' +
    subjects.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  openModal('importModal');
});

document.getElementById('downloadTemplateBtn').addEventListener('click', () => {
  downloadAuthed('/questions/import-template', 'savollar-shablon.xlsx');
});

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',').pop());
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

document.getElementById('runImportBtn').addEventListener('click', async () => {
  const fileInput = document.getElementById('importFile');
  const file = fileInput.files[0];
  const box = document.getElementById('importResultBox');
  if (!file) { box.innerHTML = '<div class="import-msg import-msg-error">Avval Excel fayl tanlang.</div>'; return; }

  const btn = document.getElementById('runImportBtn');
  btn.disabled = true; btn.textContent = 'Yuklanmoqda...';
  box.innerHTML = '';

  try {
    const base64 = await fileToBase64(file);
    const default_subject_id = document.getElementById('importDefaultSubject').value || null;
    const result = await api('/questions/import', {
      method: 'POST',
      body: JSON.stringify({ file_base64: base64, default_subject_id }),
    });

    let html = `<div class="import-msg import-msg-ok">${icon('check-circle',16)} ${result.inserted} ta savol muvaffaqiyatli qo'shildi.</div>`;
    if (result.skippedEmpty) html += `<div class="import-msg import-msg-muted">${result.skippedEmpty} ta bo'sh qator o'tkazib yuborildi.</div>`;
    if (result.errorCount) {
      html += `<div class="import-msg import-msg-error">${result.errorCount} ta qatorda xatolik topildi:</div>`;
      html += '<ul class="import-error-list">' + result.errors.map(e => `<li><strong>${e.row}-qator:</strong> ${esc(e.reason)}</li>`).join('') + '</ul>';
    }
    box.innerHTML = html;
    if (result.inserted) renderQuestions();
  } catch (err) {
    box.innerHTML = `<div class="import-msg import-msg-error">${icon('x-circle',16)} ${esc(err.message)}</div>`;
  } finally {
    btn.disabled = false; btn.textContent = 'Yuklash';
  }
});

document.getElementById('openPdfImportBtn').addEventListener('click', async () => {
  document.getElementById('pdfImportResultBox').innerHTML = '';
  document.getElementById('pdfImportFile').value = '';
  const subjects = await api('/subjects');
  document.getElementById('pdfImportSubject').innerHTML =
    '<option value="">— Fanni tanlang —</option>' +
    subjects.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  openModal('pdfImportModal');
});

document.getElementById('runPdfImportBtn').addEventListener('click', async () => {
  const fileInput = document.getElementById('pdfImportFile');
  const file = fileInput.files[0];
  const subjectId = document.getElementById('pdfImportSubject').value;
  const box = document.getElementById('pdfImportResultBox');

  if (!subjectId) { box.innerHTML = `<div class="import-msg import-msg-error">${icon('x-circle',16)} Avval fanni tanlang.</div>`; return; }
  if (!file) { box.innerHTML = `<div class="import-msg import-msg-error">${icon('x-circle',16)} Avval PDF fayl tanlang.</div>`; return; }

  const btn = document.getElementById('runPdfImportBtn');
  btn.disabled = true; btn.textContent = "O'qilmoqda...";
  box.innerHTML = `<div class="import-msg import-msg-muted">${icon('clock',14)} PDF o'qilmoqda, bu biroz vaqt olishi mumkin...</div>`;

  try {
    const base64 = await fileToBase64(file);
    const result = await api('/questions/import-pdf', {
      method: 'POST',
      body: JSON.stringify({ file_base64: base64, subject_id: subjectId }),
    });

    let html = `<div class="import-msg import-msg-ok">${icon('check-circle',16)} ${result.inserted} ta savol muvaffaqiyatli qo'shildi (jami ${result.total} ta topildi).</div>`;
    if (result.skippedDuplicate) html += `<div class="import-msg import-msg-muted">${result.skippedDuplicate} ta savol bu fanda allaqachon mavjud edi (o'tkazib yuborildi).</div>`;
    if (result.errorCount) {
      html += `<div class="import-msg import-msg-error">${result.errorCount} ta savolni o'qishda xatolik:</div>`;
      html += '<ul class="import-error-list">' + result.errors.map(e => `<li><strong>${esc(e.external_id)}:</strong> ${esc(e.reason)}</li>`).join('') + '</ul>';
    }
    box.innerHTML = html;
    if (result.inserted) renderQuestions();
  } catch (err) {
    box.innerHTML = `<div class="import-msg import-msg-error">${icon('x-circle',16)} ${esc(err.message)}</div>`;
  } finally {
    btn.disabled = false; btn.textContent = 'Yuklash';
  }
});

document.getElementById('addQuestionBtn').addEventListener('click', () => {
  document.getElementById('questionModalTitle').textContent = 'Savol qo\'shish';
  document.getElementById('questionId').value = '';
  document.getElementById('qText').value = '';
  document.getElementById('qImageUrl').value = '';
  document.getElementById('qImageFile').value = '';
  document.getElementById('qImagePreview').style.display = 'none';
  document.getElementById('uploadProgress').textContent = '';
  document.getElementById('qExplanation').value = '';
  resetOptionsBuilder(['', ''], null);
  openModal('questionModal');
});

function editQuestion(q) {
  document.getElementById('questionModalTitle').textContent = 'Savolni tahrirlash';
  document.getElementById('questionId').value = q.id;
  document.getElementById('qSubject').value = q.subject_id;
  document.getElementById('qText').value = q.question_text;
  document.getElementById('qImageUrl').value = q.image_url || '';
  if (q.image_url) {
    document.getElementById('qImagePreview').src = q.image_url;
    document.getElementById('qImagePreview').style.display = 'block';
  } else {
    document.getElementById('qImagePreview').style.display = 'none';
  }
  document.getElementById('qExplanation').value = q.explanation || '';
  resetOptionsBuilder(q.options && q.options.length >= 2 ? q.options : ['', ''], q.correct_index ?? null);
  openModal('questionModal');
}

// Cloudinary'ga rasm yuklash
document.getElementById('qImageFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const progress = document.getElementById('uploadProgress');
  progress.textContent = 'Yuklanmoqda...';

  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);

  try {
    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, {
      method: 'POST',
      body: formData,
    });
    const data = await res.json();
    if (!data.secure_url) throw new Error('Yuklashda xatolik');
    document.getElementById('qImageUrl').value = data.secure_url;
    document.getElementById('qImagePreview').src = data.secure_url;
    document.getElementById('qImagePreview').style.display = 'block';
    progress.innerHTML = icon('check-circle',14) + ' Rasm yuklandi';
  } catch (err) {
    progress.innerHTML = icon('x-circle',14) + ' Rasm yuklashda xatolik: ' + err.message;
  }
});

document.getElementById('saveQuestionBtn').addEventListener('click', async () => {
  const id = document.getElementById('questionId').value;
  const options = optionRows.map(r => r.text.trim());
  const payload = {
    subject_id: document.getElementById('qSubject').value,
    question_text: document.getElementById('qText').value.trim(),
    image_url: document.getElementById('qImageUrl').value || null,
    options,
    correct_index: optionCorrectIndex,
    explanation: document.getElementById('qExplanation').value.trim(),
  };
  const filledCount = options.filter(Boolean).length;
  if (!payload.subject_id || !payload.question_text || filledCount < 2) {
    return alert("Fan, savol matni va kamida 2 ta to'ldirilgan variant kerak");
  }
  if (optionCorrectIndex === null || !options[optionCorrectIndex]) {
    return alert("To'g'ri javobni belgilang");
  }

  try {
    if (id) await api('/questions/' + id, { method: 'PUT', body: JSON.stringify(payload) });
    else await api('/questions', { method: 'POST', body: JSON.stringify(payload) });
  } catch (err) {
    return alert(err.message);
  }

  closeModal('questionModal');
  renderQuestions();
});

async function deleteQuestion(id) {
  if (!confirm("Savolni o'chirishni tasdiqlaysizmi?")) return;
  await api('/questions/' + id, { method: 'DELETE' });
  renderQuestions();
}

// ---------------- QUESTION VIEWER (College Board uslubidagi ko'rinish) ----------------
let qvIndex = 0;
let qvSelectedForPdf = new Set(JSON.parse(localStorage.getItem('qv_pdf_selection') || '[]'));

function persistQvSelection() {
  localStorage.setItem('qv_pdf_selection', JSON.stringify([...qvSelectedForPdf]));
  updateSelectedPdfBtn();
}

function updateSelectedPdfBtn() {
  const btn = document.getElementById('selectedPdfBtn');
  document.getElementById('selectedPdfCount').textContent = qvSelectedForPdf.size;
  btn.style.display = qvSelectedForPdf.size > 0 ? 'inline-flex' : 'none';
}

function openQuestionView(idx) {
  qvIndex = idx;
  renderQuestionView();
  openModal('questionViewModal');
}

function renderQuestionView() {
  const q = currentQuestionList[qvIndex];
  if (!q) return;

  document.getElementById('qvId').textContent = q.id;
  document.getElementById('qvSubject').textContent = q.subject_name;
  document.getElementById('qvHasImage').textContent = q.image_url ? 'Bor' : "Yo'q";
  document.getElementById('qvOptionCount').textContent = (q.options || []).length;
  document.getElementById('qvCorrectLetter').textContent = optionLetter(q.correct_index);

  const metaBox = document.getElementById('qvSourceMeta');
  if (q.source_meta) {
    metaBox.innerHTML = `${icon('file-text', 13)} ${esc(q.source_meta)}`;
    metaBox.style.display = 'flex';
  } else {
    metaBox.style.display = 'none';
  }

  document.getElementById('qvQuestionText').innerHTML = escPara(q.question_text);
  const img = document.getElementById('qvImage');
  if (q.image_url) { img.src = q.image_url; img.style.display = 'block'; }
  else { img.removeAttribute('src'); img.style.display = 'none'; }

  document.getElementById('qvOptions').innerHTML = (q.options || []).map((opt, i) => `
    <div class="qview-option" data-correct="${i === q.correct_index ? '1' : '0'}">
      <span class="qview-option-letter">${optionLetter(i)}.</span>
      <span class="qview-option-text">${esc(opt)}</span>
    </div>
  `).join('');

  document.getElementById('qvExplanationBox').innerHTML = q.explanation
    ? `${icon('lightbulb',14)} ${escPara(q.explanation)}` : "Bu savol uchun izoh kiritilmagan.";

  document.getElementById('qvRevealToggle').checked = false;
  applyQvReveal(false);

  document.getElementById('qvBackBtn').disabled = qvIndex === 0;
  document.getElementById('qvNextBtn').disabled = qvIndex === currentQuestionList.length - 1;

  const inPdf = qvSelectedForPdf.has(q.id);
  const addBtn = document.getElementById('qvAddPdfBtn');
  addBtn.innerHTML = inPdf ? `${icon('check-circle',14)} PDF ro'yxatida` : `${icon('bookmark',14)} PDF ga qo'sh`;
  addBtn.classList.toggle('btn-primary', inPdf);
  addBtn.classList.toggle('btn-outline', !inPdf);
}

function applyQvReveal(show) {
  document.querySelectorAll('#qvOptions .qview-option').forEach(el => {
    el.classList.toggle('qview-option-correct', show && el.dataset.correct === '1');
  });
  document.getElementById('qvExplanationBox').style.display = show ? 'block' : 'none';
}

function toggleQvReveal() {
  applyQvReveal(document.getElementById('qvRevealToggle').checked);
}

function toggleQvPdfSelection() {
  const q = currentQuestionList[qvIndex];
  if (!q) return;
  if (qvSelectedForPdf.has(q.id)) qvSelectedForPdf.delete(q.id);
  else qvSelectedForPdf.add(q.id);
  persistQvSelection();
  renderQuestionView();
}

document.getElementById('qvBackBtn').addEventListener('click', () => {
  if (qvIndex > 0) { qvIndex--; renderQuestionView(); }
});
document.getElementById('qvNextBtn').addEventListener('click', () => {
  if (qvIndex < currentQuestionList.length - 1) { qvIndex++; renderQuestionView(); }
});

document.getElementById('selectedPdfBtn').addEventListener('click', () => {
  if (qvSelectedForPdf.size === 0) return;
  downloadAuthed('/questions/export?format=pdf&ids=' + [...qvSelectedForPdf].join(','), 'tanlangan-savollar.pdf');
});

updateSelectedPdfBtn();

// ---------------- RESULTS ----------------
async function loadResultsPanel() {
  await loadSubjects();
  await renderResults();
}

async function renderResults() {
  const subjectId = document.getElementById('resultsFilterSubject').value;
  const results = await api('/results' + (subjectId ? `?subject_id=${subjectId}` : ''));
  document.getElementById('resultsTbody').innerHTML = results.map(r => `
    <tr>
      <td>${esc(r.first_name)} ${esc(r.last_name || '')} ${r.student_username ? `<span style="color:var(--muted)">@${esc(r.student_username)}</span>` : ''}</td>
      <td>${esc(r.subject_name)}</td>
      <td>${r.score}/${r.total}</td>
      <td><span class="badge ${(r.score/r.total) >= 0.6 ? 'badge-green' : 'badge-gray'}">${Math.round((r.score/r.total)*100)}%</span></td>
      <td>${fmtDate(r.finished_at)}</td>
      <td class="row-actions">
        <button class="btn btn-outline btn-sm" onclick="viewResult(${r.id})">${icon('eye',14)} Ko'rish</button>
        <button class="btn btn-danger btn-sm" onclick="deleteResult(${r.id})">${icon('trash',14)} O'chirish</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="6" class="empty-state">Natijalar topilmadi</td></tr>';
}

document.getElementById('resultsFilterSubject').addEventListener('change', renderResults);

let currentResultId = null;

function fmtSeconds(sec) {
  if (sec === undefined || sec === null) return "—";
  sec = Math.round(sec);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}m ${s}s`;
}

async function viewResult(id) {
  currentResultId = id;
  const { attempt, questions } = await api('/results/' + id);
  const answers = attempt.answers || {};
  const times = attempt.question_times || {};
  const pct = Math.round((attempt.score / attempt.total) * 100);
  let wrongCount = 0;
  let unansweredCount = 0;

  document.getElementById('resultDetailTitle').textContent = `${attempt.first_name} ${attempt.last_name || ''} — ${attempt.subject_name}`;

  const body = questions.map((q, i) => {
    const given = answers[String(q.id)];
    const givenIdx = (given !== undefined && given !== null) ? parseInt(given) : null;
    const isCorrect = givenIdx === q.correct_index;
    if (!isCorrect) {
      if (givenIdx === null) unansweredCount++;
      else wrongCount++;
    }
    const timeSpent = times[String(q.id)];

    const optionsHtml = (q.options || []).map((opt, oi) => {
      const isThisCorrect = oi === q.correct_index;
      const isThisGiven = oi === givenIdx;
      let cls = 'review-opt';
      if (isThisCorrect) cls += ' review-opt-correct';
      if (isThisGiven && !isThisCorrect) cls += ' review-opt-wrong';
      return `
        <div class="${cls}">
          <span class="review-opt-letter">${optionLetter(oi)}</span>
          <span class="review-opt-text">${esc(opt)}</span>
          ${isThisCorrect ? `<span class="review-opt-tag correct">${icon('check-circle',12)} To'g'ri</span>` : ''}
          ${isThisGiven && !isThisCorrect ? `<span class="review-opt-tag wrong">${icon('x-circle',12)} Tanlangan</span>` : ''}
        </div>
      `;
    }).join('');

    return `
      <div class="review-card ${isCorrect ? 'is-correct' : 'is-wrong'}">
        <div class="review-card-head">
          <span class="review-num">${i + 1}</span>
          <span class="review-status ${isCorrect ? 'correct' : 'wrong'}">${isCorrect ? "To'g'ri" : (givenIdx === null ? "Javob berilmagan" : "Noto'g'ri")}</span>
          <span class="review-time-spent">${icon('clock',13)} ${fmtSeconds(timeSpent)}</span>
        </div>
        <div class="review-question">${escPara(q.question_text)}</div>
        ${q.image_url ? `<img src="${q.image_url}" class="review-image" />` : ''}
        <div class="review-options">${optionsHtml}</div>
        ${q.explanation ? `<div class="review-explanation">${icon('lightbulb',14)} ${escPara(q.explanation)}</div>` : ''}
      </div>
    `;
  }).join('');

  const totalTime = Object.values(times).reduce((a, b) => a + (parseFloat(b) || 0), 0);
  const correctCount = attempt.total - wrongCount - unansweredCount;

  document.getElementById('resultDetailBody').innerHTML = `
    <div class="cb-report">
      <div class="cb-report-top">
        <div class="cb-report-titles">
          <div class="cb-report-label">Natijalar hisoboti</div>
          <div class="cb-report-subject">${esc(attempt.subject_name)}</div>
        </div>
        <div class="cb-report-score">
          <div class="cb-report-score-num ${pct >= 60 ? 'good' : 'bad'}">${attempt.score}/${attempt.total}</div>
          <div class="cb-report-score-pct">${pct}% to'g'ri</div>
        </div>
      </div>
      <div class="cb-report-stats">
        <div class="cb-stat cb-stat-correct"><div class="cb-stat-num">${correctCount}</div><div class="cb-stat-lbl">${icon('check-circle',13)} To'g'ri</div></div>
        <div class="cb-stat cb-stat-wrong"><div class="cb-stat-num">${wrongCount}</div><div class="cb-stat-lbl">${icon('x-circle',13)} Noto'g'ri</div></div>
        <div class="cb-stat cb-stat-empty"><div class="cb-stat-num">${unansweredCount}</div><div class="cb-stat-lbl">${icon('help-circle',13)} Javobsiz</div></div>
        <div class="cb-stat cb-stat-time"><div class="cb-stat-num">${fmtSeconds(totalTime)}</div><div class="cb-stat-lbl">${icon('clock',13)} Jami vaqt</div></div>
      </div>
      <div class="cb-report-date">${fmtDate(attempt.finished_at)}</div>
    </div>
    ${wrongCount === 0 && unansweredCount === 0 ? `<div class="all-correct-note">${icon('star',16)} Barcha javoblar to'g'ri</div>` : ''}
    ${body}
  `;
  document.getElementById('onlyWrongToggle').checked = false;
  document.getElementById('onlyWrongToggle').dataset.wrongCount = wrongCount;
  document.getElementById('resultDetailBody').classList.remove('hide-correct');
  openModal('resultDetailModal');
}

function toggleOnlyWrong() {
  const checked = document.getElementById('onlyWrongToggle').checked;
  document.getElementById('resultDetailBody').classList.toggle('hide-correct', checked);
}

document.getElementById('resultPdfBtn').addEventListener('click', () => {
  if (currentResultId) downloadAuthed(`/results/${currentResultId}/export`, 'natija.pdf');
});

async function deleteResult(id) {
  if (!confirm("Bu natijani o'chirishni tasdiqlaysizmi?")) return;
  await api('/results/' + id, { method: 'DELETE' });
  renderResults();
}

// ---------------- STUDENTS ----------------
async function loadStudents() {
  const students = await api('/students');
  document.getElementById('studentsTbody').innerHTML = students.map(s => `
    <tr>
      <td>${esc(s.first_name)} ${esc(s.last_name||'')}</td>
      <td>${s.username ? '@'+esc(s.username) : esc(s.telegram_id)}</td>
      <td>${s.attempt_count}</td>
      <td>${Math.round(s.avg_score)}%</td>
      <td class="row-actions">
        <button class="btn btn-outline btn-sm" onclick="viewStudentResults(${s.id})">Natijalari</button>
        <button class="btn btn-danger btn-sm" onclick="deleteStudent(${s.id})">O'chirish</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="5" class="empty-state">O\'quvchilar topilmadi</td></tr>';
}

async function viewStudentResults(id) {
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelector('[data-panel="panel-results"]').classList.add('active');
  document.getElementById('panel-results').classList.add('active');
  await loadSubjects();
  const results = await api('/results?student_id=' + id);
  document.getElementById('resultsTbody').innerHTML = results.map(r => `
    <tr>
      <td>${esc(r.first_name)} ${esc(r.last_name||'')}</td>
      <td>${esc(r.subject_name)}</td>
      <td>${r.score}/${r.total}</td>
      <td>${Math.round((r.score/r.total)*100)}%</td>
      <td>${fmtDate(r.finished_at)}</td>
      <td class="row-actions"><button class="btn btn-outline btn-sm" onclick="viewResult(${r.id})">Ko'rish</button></td>
    </tr>
  `).join('') || '<tr><td colspan="6" class="empty-state">Natijalar yo\'q</td></tr>';
}

async function deleteStudent(id) {
  if (!confirm("O'quvchini va uning barcha natijalarini o'chirishni tasdiqlaysizmi?")) return;
  await api('/students/' + id, { method: 'DELETE' });
  loadStudents();
}

// ---------------- VOCAB WORDS (fanlarga biriktirilgan so'zlar) ----------------
let vocabWordsCache = [];
let vocabSubjectsCache = [];

async function loadVocabSubjectsCache() {
  vocabSubjectsCache = await api('/subjects');
  const opts = vocabSubjectsCache.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  document.getElementById('vocabWordSubject').innerHTML = opts;
  document.getElementById('vocabBulkSubject').innerHTML = opts;
  document.getElementById('vocabImportSubject').innerHTML = opts;
  document.getElementById('vocabWordsFilterSubject').innerHTML = '<option value="">Barcha fanlar</option>' + opts;
}

async function loadVocabWordsPanel() {
  await loadVocabSubjectsCache(); // fanlar ro'yxati doim yangilanadi (keshda qolib ketmasin)
  await renderVocabWordsTable();
}

async function renderVocabWordsTable() {
  const subjectId = document.getElementById('vocabWordsFilterSubject').value;
  vocabWordsCache = await api('/vocab/words' + (subjectId ? `?subject_id=${subjectId}` : ''));
  document.getElementById('vocabWordsTbody').innerHTML = vocabWordsCache.map(w => `
    <tr>
      <td><strong>${esc(w.word)}</strong></td>
      <td>${esc(w.translation)}</td>
      <td style="color:var(--muted);font-size:12.5px;">${esc(w.example || '-')}</td>
      <td>${w.subject_name ? `<span class="badge badge-blue">${esc(w.subject_name)}</span>` : `<span class="badge badge-gray">Fan yo'q</span>`}</td>
      <td class="row-actions">
        <button class="btn btn-outline btn-sm" onclick='openVocabWordModal(${JSON.stringify(w)})'>${icon('pencil',14)}</button>
        <button class="btn btn-danger btn-sm" onclick="deleteVocabWord(${w.id})">${icon('trash',14)}</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="5" class="empty-state">Hozircha so\'zlar yo\'q. Yangi so\'z qo\'shing yoki Excel orqali yuklang.</td></tr>';
}

document.getElementById('vocabWordsFilterSubject').addEventListener('change', renderVocabWordsTable);

async function openVocabWordModal(word) {
  await loadVocabSubjectsCache();
  if (vocabSubjectsCache.length === 0) {
    alert("Avval kamida bitta fan yarating (Fanlar bo'limida), so'ngra so'z qo'sha olasiz.");
    return;
  }
  document.getElementById('vocabWordModalTitle').textContent = word ? "So'zni tahrirlash" : "So'z qo'shish";
  document.getElementById('vocabWordId').value = word ? word.id : '';
  document.getElementById('vocabWordSubject').value = word ? word.subject_id : vocabSubjectsCache[0].id;
  document.getElementById('vocabWordText').value = word ? word.word : '';
  document.getElementById('vocabWordTranslation').value = word ? word.translation : '';
  document.getElementById('vocabWordExample').value = word ? (word.example || '') : '';
  openModal('vocabWordModal');
}

document.getElementById('addVocabWordBtn2').addEventListener('click', () => openVocabWordModal(null));

document.getElementById('saveVocabWordBtn').addEventListener('click', async () => {
  const id = document.getElementById('vocabWordId').value;
  const subject_id = document.getElementById('vocabWordSubject').value;
  const word = document.getElementById('vocabWordText').value.trim();
  const translation = document.getElementById('vocabWordTranslation').value.trim();
  const example = document.getElementById('vocabWordExample').value.trim();
  if (!subject_id) return alert("Fanni tanlang");
  if (!word || !translation) return alert("So'z va tarjimasini kiriting");

  const payload = { subject_id, word, translation, example };
  try {
    if (id) await api('/vocab/words/' + id, { method: 'PUT', body: JSON.stringify(payload) });
    else await api('/vocab/words', { method: 'POST', body: JSON.stringify(payload) });
    closeModal('vocabWordModal');
    await renderVocabWordsTable();
  } catch (err) {
    alert(err.message);
  }
});

async function deleteVocabWord(id) {
  if (!confirm("Bu so'zni o'chirishni tasdiqlaysizmi?")) return;
  await api('/vocab/words/' + id, { method: 'DELETE' });
  await renderVocabWordsTable();
}

document.getElementById('addVocabBulkBtn').addEventListener('click', async () => {
  const subject_id = document.getElementById('vocabBulkSubject').value;
  const text = document.getElementById('vocabBulkWords').value.trim();
  if (!subject_id) return alert("Fanni tanlang");
  if (!text) return alert("So'zlar ro'yxatini kiriting");

  try {
    const result = await api('/vocab/words/bulk', { method: 'POST', body: JSON.stringify({ subject_id, text }) });
    document.getElementById('vocabBulkWords').value = '';
    await renderVocabWordsTable();
    alert(`${result.count} ta so'z qo'shildi`);
  } catch (err) {
    alert(err.message);
  }
});

// ---------------- VOCAB EXCEL IMPORT ----------------
function downloadVocabTemplate() {
  downloadAuthed('/vocab/words/import-template', 'sozlar-shablon.xlsx');
}
document.getElementById('downloadVocabTemplateBtn').addEventListener('click', downloadVocabTemplate);
document.getElementById('downloadVocabTemplateBtn2').addEventListener('click', downloadVocabTemplate);

document.getElementById('openVocabImportBtn').addEventListener('click', async () => {
  await loadVocabSubjectsCache();
  if (vocabSubjectsCache.length === 0) {
    alert("Avval kamida bitta fan yarating (Fanlar bo'limida), so'ngra so'zlarni Excel orqali yuklay olasiz.");
    return;
  }
  document.getElementById('vocabImportResultBox').innerHTML = '';
  document.getElementById('vocabImportFile').value = '';
  openModal('vocabImportModal');
});

document.getElementById('runVocabImportBtn').addEventListener('click', async () => {
  const subject_id = document.getElementById('vocabImportSubject').value;
  const fileInput = document.getElementById('vocabImportFile');
  const file = fileInput.files[0];
  const box = document.getElementById('vocabImportResultBox');
  if (!subject_id) { box.innerHTML = '<div class="import-msg import-msg-error">Fanni tanlang.</div>'; return; }
  if (!file) { box.innerHTML = '<div class="import-msg import-msg-error">Avval Excel fayl tanlang.</div>'; return; }

  const btn = document.getElementById('runVocabImportBtn');
  btn.disabled = true; btn.textContent = 'Yuklanmoqda...';
  box.innerHTML = '';

  try {
    const base64 = await fileToBase64(file);
    const result = await api('/vocab/words/import', {
      method: 'POST',
      body: JSON.stringify({ file_base64: base64, subject_id }),
    });

    let html = `<div class="import-msg import-msg-ok">${icon('check-circle',16)} ${result.inserted} ta so'z muvaffaqiyatli qo'shildi.</div>`;
    if (result.skippedEmpty) html += `<div class="import-msg import-msg-muted">${result.skippedEmpty} ta bo'sh qator o'tkazib yuborildi.</div>`;
    if (result.errorCount) {
      html += `<div class="import-msg import-msg-error">${result.errorCount} ta qatorda xatolik topildi:</div>`;
      html += '<ul class="import-error-list">' + result.errors.map(e => `<li><strong>${e.row}-qator:</strong> ${esc(e.reason)}</li>`).join('') + '</ul>';
    }
    box.innerHTML = html;
    if (result.inserted) renderVocabWordsTable();
  } catch (err) {
    box.innerHTML = `<div class="import-msg import-msg-error">${icon('x-circle',16)} ${esc(err.message)}</div>`;
  } finally {
    btn.disabled = false; btn.textContent = 'Yuklash';
  }
});

// ---------------- VOCAB RESULTS (o'quvchilar test natijalari) ----------------
async function loadVocabResultsPanel() {
  const rows = await api('/vocab/results');
  document.getElementById('vocabResultsTbody').innerHTML = rows.map(r => `
    <tr>
      <td>${esc(r.first_name)} ${esc(r.last_name || '')} ${r.student_username ? `<span style="color:var(--muted)">@${esc(r.student_username)}</span>` : ''}</td>
      <td>${r.subject_name ? esc(r.subject_name) : '-'}</td>
      <td><span class="badge ${r.best_score_pct >= 80 ? 'badge-green' : 'badge-gray'}">${r.best_score_pct}%</span></td>
      <td>${r.last_score_pct}%</td>
      <td>${r.attempts_count}</td>
      <td>${r.passed ? `<span class="badge badge-green">${icon('check-circle',12)} Topshirilgan</span>` : `<span class="badge badge-gray">Topshirilmagan</span>`}</td>
      <td>${fmtDate(r.updated_at)}</td>
    </tr>
  `).join('') || '<tr><td colspan="7" class="empty-state">Hali natijalar yo\'q</td></tr>';
}

// Boshlanishi
loadOverview();
