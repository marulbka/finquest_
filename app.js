/* ФінКвест — навчальний прототип.
   Усі дані зберігаються лише в браузері користувача (localStorage).
   Жодних реальних фінансових операцій застосунок не виконує. */
'use strict';

/* ---------- Утиліти ---------- */
const STORAGE_KEY = 'finquest-v1';
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const nf = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 });
const fmt = n => nf.format(Math.round(Number(n) || 0));
const money = n => `${fmt(n)} грн`;
const pad = n => String(n).padStart(2, '0');
const toISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayISO = () => toISO(new Date());
function parseISO(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(iso, n) { const d = parseISO(iso); d.setDate(d.getDate() + n); return toISO(d); }
function addMonths(iso, n) { const d = parseISO(iso); d.setMonth(d.getMonth() + n); return toISO(d); }
const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86400000);
const fmtDate = s => parseISO(s).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' });
const fmtShort = s => parseISO(s).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' });
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const sum = (list, f = x => x) => list.reduce((s, x) => s + f(x), 0);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const daysInMonth = (d = new Date()) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
const rand = (a, b) => Math.round(a + Math.random() * (b - a));
const cat = id => CATEGORIES.find(c => c.id === id) || CATEGORIES[CATEGORIES.length - 1];
function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/* ---------- Стан ---------- */
const defaultState = () => ({
  version: 1,
  user: null,               // { name, ageGroup: '14-17' | '18-25', createdAt }
  budget: { monthly: 0 },
  goal: null,               // { title, icon, target, deadline, createdAt }
  goalsDone: [],
  contributions: [],        // { id, amount, date, source: 'start'|'self'|'parent', note }
  card: { connected: false },
  expenses: [],             // { id, amount, category, date, note, source: 'manual'|'card' }
  lessonsDone: [],
  quizDone: [],
  xp: 0,
  badges: [],
  parental: { enabled: false, pin: '', parentName: '', limits: {} },
  simulations: []
});

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return Object.assign(defaultState(), JSON.parse(raw));
  } catch (e) { /* localStorage недоступний — працюємо в пам'яті */ }
  return defaultState();
}
let state = load();
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ігноруємо */ }
}
let parentUnlocked = false;   // кабінет батьків відкривається PIN-кодом на одну сесію

/* ---------- Гейміфікація ---------- */
function levelInfo(xp = state.xp) {
  const lvl = Math.floor(xp / 100) + 1;
  return { lvl, name: LEVEL_NAMES[Math.min(lvl - 1, LEVEL_NAMES.length - 1)], into: xp % 100 };
}
function addXP(n, reason) {
  const before = levelInfo().lvl;
  state.xp += n;
  save();
  toast(`+${n} XP · ${reason}`);
  const after = levelInfo();
  if (after.lvl > before) setTimeout(() => toast(`Новий рівень ${after.lvl}: ${after.name}!`, 'level'), 700);
}
function award(id) {
  if (state.badges.includes(id)) return;
  state.badges.push(id);
  save();
  const b = BADGES.find(x => x.id === id);
  if (b) setTimeout(() => toast(`Нова нагорода: ${b.icon} ${b.title}`, 'badge'), 350);
}

/* ---------- Розрахунки ---------- */
const monthPrefix = () => todayISO().slice(0, 7);
const monthExpenses = () => state.expenses.filter(e => e.date.startsWith(monthPrefix()));
const dailyLimitBase = () => (state.budget.monthly || 0) / daysInMonth();

function budgetStats() {
  const list = monthExpenses();
  const spent = sum(list, e => e.amount);
  const budget = state.budget.monthly || 0;
  const dom = new Date().getDate();
  const daysLeft = daysInMonth() - dom + 1;
  const todaySpent = sum(list.filter(e => e.date === todayISO()), e => e.amount);
  const leftBeforeToday = budget - (spent - todaySpent);
  const todayLimit = Math.max(0, leftBeforeToday / daysLeft);
  const byCat = CATEGORIES.map(c => ({ ...c, total: sum(list.filter(e => e.category === c.id), e => e.amount) }))
    .filter(c => c.total > 0).sort((a, b) => b.total - a.total);
  return { spent, budget, left: budget - spent, todaySpent, todayLimit, todayLeft: todayLimit - todaySpent, byCat, pct: budget ? spent / budget * 100 : 0 };
}

function streak() {
  // Скільки днів поспіль (до вчора) витрати не перевищували базовий денний ліміт.
  const limit = dailyLimitBase();
  if (!limit || !state.user) return 0;
  let n = 0;
  for (let i = 1; i <= 60; i++) {
    const d = addDays(todayISO(), -i);
    if (d < state.user.createdAt) break;
    const spent = sum(state.expenses.filter(e => e.date === d), e => e.amount);
    if (spent <= limit) n++; else break;
  }
  return n;
}

function goalStats() {
  const g = state.goal;
  if (!g) return null;
  const saved = sum(state.contributions, c => c.amount);
  const remaining = Math.max(0, g.target - saved);
  const pct = clamp(saved / g.target * 100, 0, 100);
  const today = todayISO();
  const daysLeft = Math.max(0, daysBetween(today, g.deadline));
  const total = Math.max(1, daysBetween(g.createdAt, g.deadline));
  const elapsed = clamp(daysBetween(g.createdAt, today), 0, total);
  const startSaved = sum(state.contributions.filter(c => c.source === 'start'), c => c.amount);
  const expected = startSaved + (g.target - startSaved) * elapsed / total;
  const perDay = daysLeft > 0 ? remaining / daysLeft : remaining;
  return { saved, remaining, pct, daysLeft, perDay, perWeek: perDay * 7, perMonth: perDay * 30.4, diff: saved - expected, done: saved >= g.target };
}

function checkGoalBadges() {
  const s = goalStats();
  if (!s) return;
  [25, 50, 75, 100].forEach(m => { if (s.pct >= m) award(`goal_${m}`); });
}

function parentalWarnings() {
  if (!state.parental.enabled) return [];
  const list = monthExpenses();
  return Object.entries(state.parental.limits || {})
    .filter(([, lim]) => lim > 0)
    .map(([id, lim]) => ({ c: cat(id), lim, used: sum(list.filter(e => e.category === id), e => e.amount) }))
    .filter(x => x.used > x.lim * 0.8);
}

/* ---------- Демо-дані ---------- */
// Масштаб демо-сум під бюджет користувача (шаблони розраховані на бюджет ≈ 7 000 грн).
const demoScale = () => clamp((state.budget.monthly || 7000) / 7000, 0.25, 2);
function demoTransaction(date, scale = demoScale()) {
  const m = DEMO_MERCHANTS[Math.floor(Math.random() * DEMO_MERCHANTS.length)];
  return { id: uid(), amount: Math.max(10, Math.round(rand(m.min, m.max) * scale)), category: m.c, date, note: m.n, source: 'card' };
}
function generateCardHistory() {
  const today = todayISO();
  const start = today.slice(0, 8) + '01';
  const days = daysBetween(start, today);
  const list = [];
  for (let i = 0; i <= days; i++) {
    const d = addDays(start, i);
    const count = d === today ? 0 : rand(0, 2); // сьогоднішні витрати користувач додасть сам або кнопкою «Оновити»
    for (let k = 0; k < count; k++) list.push(demoTransaction(d, 1));
  }
  // Підганяємо суму так, щоб демо-витрати були ≈ 80% від «належного» на сьогодні бюджету.
  const target = (state.budget.monthly || 7000) * (days + 1) / daysInMonth() * 0.8;
  const total = sum(list, e => e.amount) || 1;
  const k = target / total;
  list.forEach(e => { e.amount = Math.max(10, Math.round(e.amount * k)); });
  state.expenses.push(...list);
}
function seedDemo() {
  const today = todayISO();
  state = defaultState();
  state.user = { name: 'Артем', ageGroup: '18-25', createdAt: addDays(today, -30) };
  state.budget.monthly = 7000;
  state.goal = { title: 'Ноутбук для навчання', icon: '💻', target: 25000, deadline: addMonths(today, 5), createdAt: addDays(today, -30) };
  state.contributions = [
    { id: uid(), amount: 3000, date: addDays(today, -30), source: 'start', note: 'Стартова сума' },
    { id: uid(), amount: 1200, date: addDays(today, -21), source: 'self', note: 'Зі стипендії' },
    { id: uid(), amount: 2500, date: addDays(today, -7), source: 'self', note: 'Підробіток' }
  ];
  state.card = { connected: true, bank: 'monobank', last4: '4821', nickname: 'Основна', connectedAt: addDays(today, -30) };
  generateCardHistory();
  state.lessonsDone = ['budget'];
  state.quizDone = ['budget'];
  state.xp = 145;
  state.badges = ['first_goal', 'card', 'first_expense', 'lesson_first', 'goal_25'];
  save();
}

/* ---------- Сповіщення та модальні вікна ---------- */
function toast(text, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = text;
  const box = $('#toasts');
  while (box.children.length >= 3) box.firstElementChild.remove();
  box.appendChild(el);
  setTimeout(() => el.classList.add('out'), 2600);
  setTimeout(() => el.remove(), 3000);
}
function openSheet(title, html, onMount) {
  $('#sheet-title').textContent = title;
  $('#sheet-body').innerHTML = html;
  $('#sheet').hidden = false;
  document.body.classList.add('no-scroll');
  if (onMount) onMount($('#sheet-body'));
  const first = $('#sheet-body input, #sheet-body select, #sheet-body button');
  if (first) setTimeout(() => first.focus(), 50);
}
function closeSheet() {
  $('#sheet').hidden = true;
  document.body.classList.remove('no-scroll');
}
document.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeSheet(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });

function askPin(title, onOk) {
  openSheet(title, `
    <form id="pin-form" class="form">
      <label>PIN-код батьків
        <input name="pin" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" required autocomplete="off" placeholder="••••">
      </label>
      <p class="error" id="pin-err" hidden>Неправильний PIN-код</p>
      <button class="btn primary" type="submit">Підтвердити</button>
    </form>`, body => {
    $('#pin-form', body).addEventListener('submit', ev => {
      ev.preventDefault();
      if (ev.target.pin.value === state.parental.pin) { closeSheet(); onOk(); }
      else { $('#pin-err', body).hidden = false; ev.target.pin.value = ''; }
    });
  });
}

/* ---------- Спільні компоненти ---------- */
function progressBar(pct, cls = '') {
  return `<div class="bar ${cls}" role="progressbar" aria-valuenow="${Math.round(pct)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${clamp(pct, 0, 100)}%"></span></div>`;
}
function ring(pct, size = 180, stroke = 16, color = 'url(#ringGrad)') {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#06B6D4"/><stop offset="0.5" stop-color="#2563EB"/><stop offset="1" stop-color="#4F46E5"/></linearGradient></defs>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--soft)" stroke-width="${stroke}"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"
      stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - clamp(pct, 0, 100) / 100)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
  </svg>`;
}
function donut(items, size = 150, stroke = 26) {
  const total = sum(items, i => i.total);
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  let offset = 0;
  const segs = items.map(i => {
    const len = c * i.total / total;
    const seg = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${i.color}" stroke-width="${stroke}"
      stroke-dasharray="${Math.max(0, len - 2)} ${c}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${size / 2} ${size / 2})"/>`;
    offset += len;
    return seg;
  }).join('');
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Діаграма витрат за категоріями">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--line)" stroke-width="${stroke}"/>${segs}</svg>`;
}
function txRow(e, deletable = true) {
  const c = cat(e.category);
  return `<li class="tx">
    <span class="tx-ico" style="background:${c.color}1f">${c.icon}</span>
    <span class="tx-main"><b>${esc(e.note || c.name)}</b><small>${c.name} · ${fmtShort(e.date)}${e.source === 'card' ? ' · картка' : ''}</small></span>
    <span class="tx-sum">−${money(e.amount)}</span>
    ${deletable ? `<button class="icon-btn small" data-del="${e.id}" aria-label="Видалити витрату">✕</button>` : ''}
  </li>`;
}
function setNav(route) {
  const nav = $('#nav');
  nav.hidden = !state.user;
  $$('a', nav).forEach(a => a.classList.toggle('active', a.dataset.route === route));
}
function render(html, route) {
  $('#app').innerHTML = html;
  setNav(route);
  window.scrollTo(0, 0);
}

/* ---------- Екран вітання ---------- */
function renderWelcome() {
  render(`
  <section class="welcome">
    <div class="welcome-art" aria-hidden="true">
      <div class="orb orb1"></div><div class="orb orb2"></div>
      <div class="mini-card">
        <p>Квест семестру</p>
        <div class="bar"><span style="width:100%"></span></div>
        <div class="bar"><span style="width:62%"></span></div>
        <div class="bar"><span style="width:28%"></span></div>
      </div>
    </div>
    <h1 class="logo-big">Фін<span>Квест</span></h1>
    <p class="lead">Керуй грошима як у грі: став цілі, проходь рівні й тренуйся інвестувати на віртуальних грошах.</p>
    <ul class="checks">
      <li>Ціль накопичення з прогресом і нагородами</li>
      <li>Облік витрат і статистика за категоріями</li>
      <li>Тренажер ОВДП і депозитів без ризику</li>
      <li>Короткі уроки та батьківський режим</li>
    </ul>
    <a class="btn primary big" href="#/onboarding">Почати</a>
    <button class="btn ghost big" id="demo-btn">Переглянути з демо-даними</button>
    <p class="fine">Навчальний прототип. Дані зберігаються лише у вашому браузері.</p>
  </section>`, 'welcome');
  $('#demo-btn').addEventListener('click', () => { seedDemo(); location.hash = '#/home'; toast('Демо-режим: дані Артема, 20 років'); });
}

/* ---------- Реєстрація (3 кроки) ---------- */
let ob = { step: 1, data: {} };
function renderOnboarding() {
  const s = ob.step;
  const steps = ['Про вас', 'Ціль', 'Картка'];
  const head = `
    <div class="ob-head">
      <a href="#/" class="back" aria-label="Назад до вітання">←</a>
      <ol class="stepper">${steps.map((t, i) => `<li class="${i + 1 < s ? 'done' : i + 1 === s ? 'now' : ''}"><span>${i + 1}</span>${t}</li>`).join('')}</ol>
    </div>`;
  let body = '';
  if (s === 1) {
    const d = ob.data;
    body = `
    <h1>Давайте знайомитися</h1>
    <p class="muted">Це допоможе підібрати поради та рівень уроків.</p>
    <form id="ob-form" class="form">
      <label>Як вас звати?
        <input name="uname" required maxlength="30" value="${esc(d.name || '')}" placeholder="Наприклад, Софія">
      </label>
      <fieldset class="seg">
        <legend>Ваш вік</legend>
        <label><input type="radio" name="age" value="14-17" ${d.ageGroup === '14-17' ? 'checked' : ''} required><span>14–17 років</span></label>
        <label><input type="radio" name="age" value="18-25" ${d.ageGroup === '18-25' ? 'checked' : ''}><span>18–25 років</span></label>
      </fieldset>
      <label>Скільки грошей у вас на місяць (кишенькові, стипендія, підробіток)?
        <div class="input-suffix"><input name="budget" type="number" min="100" step="50" required value="${d.budget || ''}" placeholder="4000"><span>грн</span></div>
      </label>
      <button class="btn primary big" type="submit">Далі</button>
    </form>`;
  } else if (s === 2) {
    const d = ob.data;
    const minDate = addDays(todayISO(), 7);
    body = `
    <h1>На що накопичуєте?</h1>
    <p class="muted">Ціль — головний «квест». Застосунок порахує, скільки відкладати щодня, щоб встигнути вчасно.</p>
    <form id="ob-form" class="form">
      <fieldset class="icons">
        <legend>Іконка цілі</legend>
        ${GOAL_ICONS.map((ic, i) => `<label><input type="radio" name="icon" value="${ic}" ${(d.icon || GOAL_ICONS[0]) === ic ? 'checked' : ''}><span>${ic}</span></label>`).join('')}
      </fieldset>
      <label>Ціль
        <input name="gtitle" required maxlength="40" value="${esc(d.title || '')}" placeholder="Наприклад, бездротові навушники">
      </label>
      <label>Потрібна сума
        <div class="input-suffix"><input name="gsum" type="number" min="100" step="10" required value="${d.target || ''}" placeholder="3500"><span>грн</span></div>
      </label>
      <label>До якої дати хочете накопичити?
        <input name="deadline" type="date" min="${minDate}" required value="${d.deadline || addMonths(todayISO(), 3)}">
      </label>
      <label>Уже відкладено (необов’язково)
        <div class="input-suffix"><input name="start" type="number" min="0" step="10" value="${d.start || ''}" placeholder="0"><span>грн</span></div>
      </label>
      <div id="goal-preview" class="hint-box"></div>
      <div class="row">
        <button class="btn ghost" type="button" id="ob-back">Назад</button>
        <button class="btn primary grow" type="submit">Далі</button>
      </div>
    </form>`;
  } else {
    body = `
    <h1>Підключіть картку</h1>
    <p class="muted">Щоб бачити витрати автоматично. Застосунок лише показує витрати — він не може списувати гроші.</p>
    <div class="safe-box">
      <b>🔒 Безпека понад усе</b>
      <p>ФінКвест ніколи не просить повний номер картки, CVV, PIN чи коди з SMS. У прототипі підключення демонстраційне: витрати генеруються як приклад.</p>
    </div>
    <form id="ob-form" class="form">
      <label>Банк
        <select name="bank" required>
          ${BANKS.map(b => `<option>${b}</option>`).join('')}
        </select>
      </label>
      <label>Назва картки (необов’язково)
        <input name="nickname" maxlength="20" placeholder="Наприклад, Стипендія">
      </label>
      <label>Останні 4 цифри (необов’язково)
        <input name="last4" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" placeholder="1234" autocomplete="off">
      </label>
      <p class="error" id="last4-err" hidden>Введіть лише 4 останні цифри — повний номер нам не потрібен.</p>
      <label class="check"><input type="checkbox" name="demo" checked> Показати приклад витрат за цей місяць</label>
      <label class="check"><input type="checkbox" name="consent" required> Розумію, що це демо-підключення без доступу до моїх коштів</label>
      <div class="row">
        <button class="btn ghost" type="button" id="ob-back">Назад</button>
        <button class="btn primary grow" type="submit">Підключити</button>
      </div>
      <button class="btn link" type="button" id="ob-skip">Пропустити — вводитиму витрати вручну</button>
    </form>`;
  }
  render(`<section class="page onboarding">${head}${body}</section>`, 'onboarding');

  const form = $('#ob-form');
  const back = $('#ob-back');
  if (back) back.addEventListener('click', () => { ob.step--; renderOnboarding(); });

  if (s === 1) {
    form.addEventListener('submit', e => {
      e.preventDefault();
      const f = e.target;
      ob.data.name = f.uname.value.trim();
      ob.data.ageGroup = f.age.value;
      ob.data.budget = Number(f.budget.value);
      ob.step = 2; renderOnboarding();
    });
  }
  if (s === 2) {
    const preview = () => {
      const t = Number(form.gsum.value), st = Number(form.start.value) || 0, dl = form.deadline.value;
      const days = dl ? daysBetween(todayISO(), dl) : 0;
      $('#goal-preview').innerHTML = t > 0 && days > 0
        ? `Щоб встигнути, відкладайте <b>${money(Math.max(0, t - st) / days)}</b> на день або <b>${money(Math.max(0, t - st) / days * 30.4)}</b> на місяць.`
        : 'Введіть суму й дату — і ми порахуємо план накопичення.';
    };
    $$('input', form).forEach(i => i.addEventListener('input', preview));
    preview();
    form.addEventListener('submit', e => {
      e.preventDefault();
      const f = e.target;
      Object.assign(ob.data, { icon: f.icon.value, title: f.gtitle.value.trim(), target: Number(f.gsum.value), deadline: f.deadline.value, start: Number(f.start.value) || 0 });
      if (ob.data.start >= ob.data.target) { toast('Стартова сума вже більша за ціль — збільште суму цілі'); return; }
      ob.step = 3; renderOnboarding();
    });
  }
  if (s === 3) {
    form.last4.addEventListener('input', ev => {
      const v = ev.target.value;
      ev.target.value = v.replace(/\D/g, '').slice(0, 4);
      $('#last4-err').hidden = !(v.replace(/\D/g, '').length > 4);
    });
    form.addEventListener('submit', e => {
      e.preventDefault();
      const f = e.target;
      finishOnboarding({ bank: f.bank.value, nickname: f.nickname.value.trim(), last4: f.last4.value, demo: f.demo.checked });
    });
    $('#ob-skip').addEventListener('click', () => finishOnboarding(null));
  }
}

function finishOnboarding(card) {
  const d = ob.data, today = todayISO();
  state = defaultState();
  state.user = { name: d.name, ageGroup: d.ageGroup, createdAt: today };
  state.budget.monthly = d.budget;
  state.goal = { title: d.title, icon: d.icon, target: d.target, deadline: d.deadline, createdAt: today };
  if (d.start > 0) state.contributions.push({ id: uid(), amount: d.start, date: today, source: 'start', note: 'Стартова сума' });
  if (card) {
    state.card = { connected: true, bank: card.bank, last4: card.last4, nickname: card.nickname, connectedAt: today };
    if (card.demo) generateCardHistory();
  }
  save();
  ob = { step: 1, data: {} };
  location.hash = '#/home';
  addXP(50, 'реєстрацію завершено');
  award('first_goal');
  if (card) award('card');
  checkGoalBadges();
}

/* ---------- Головна ---------- */
function renderHome() {
  const b = budgetStats();
  const g = goalStats();
  const lv = levelInfo();
  const st = streak();
  if (st >= 3) award('streak_3');
  const warnings = parentalWarnings();
  const tip = TIPS[new Date().getDate() % TIPS.length];
  const recent = [...state.expenses].sort((a, z) => z.date.localeCompare(a.date) || 0).slice(0, 8);

  // Витрати за 7 днів
  const days = Array.from({ length: 7 }, (_, i) => addDays(todayISO(), i - 6));
  const daySums = days.map(d => sum(state.expenses.filter(e => e.date === d), e => e.amount));
  const limit = dailyLimitBase();
  const maxBar = Math.max(limit, ...daySums, 1);
  const weekday = d => parseISO(d).toLocaleDateString('uk-UA', { weekday: 'short' });

  const card = state.card.connected
    ? `<div class="chip-card"><span>💳 ${esc(state.card.bank)}${state.card.last4 ? ' •• ' + esc(state.card.last4) : ''} <small>демо</small></span><button class="btn tiny" id="sync">Оновити</button></div>`
    : `<div class="chip-card off"><span>💳 Картку не підключено</span><button class="btn tiny" id="connect">Підключити</button></div>`;

  render(`
  <section class="page">
    <header class="top">
      <div>
        <p class="muted">Привіт, ${esc(state.user.name)}!</p>
        <h1 class="logo">Фін<span>Квест</span></h1>
      </div>
      <a href="#/profile" class="level-chip" aria-label="Рівень ${lv.lvl}">
        <b>Рів. ${lv.lvl}</b><small>${lv.name}</small>
      </a>
    </header>
    <div class="xp">${progressBar(lv.into, 'thin')}<small>${lv.into}/100 XP до рівня ${lv.lvl + 1}</small></div>

    ${card}

    ${warnings.map(w => `<div class="alert">⚠️ Ліміт батьків на «${w.c.name}»: витрачено ${money(w.used)} з ${money(w.lim)}</div>`).join('')}

    <div class="card hero-card">
      <div class="row between">
        <h2>Бюджет місяця</h2>
        <button class="btn tiny ghost" id="edit-budget">Змінити</button>
      </div>
      <p class="big-num">${money(b.spent)} <small>з ${money(b.budget)}</small></p>
      ${progressBar(b.pct, b.pct > 100 ? 'over' : b.pct > 85 ? 'warn' : '')}
      <div class="stats3">
        <div><small>Сьогодні можна</small><b class="${b.todayLeft < 0 ? 'neg' : ''}">${money(Math.max(0, b.todayLeft))}</b></div>
        <div><small>Залишок місяця</small><b class="${b.left < 0 ? 'neg' : ''}">${money(b.left)}</b></div>
        <div><small>Днів у бюджеті</small><b>🔥 ${st}</b></div>
      </div>
    </div>

    ${g ? `
    <a class="card goal-mini" href="#/goal">
      <span class="goal-ico">${state.goal.icon}</span>
      <span class="grow">
        <b>${esc(state.goal.title)}</b>
        ${progressBar(g.pct)}
        <small>${money(g.saved)} з ${money(state.goal.target)} · ${Math.round(g.pct)}%</small>
      </span>
      <span class="arrow">›</span>
    </a>` : `<a class="card goal-mini" href="#/goal"><span class="goal-ico">🎯</span><b class="grow">Створіть нову ціль</b><span class="arrow">›</span></a>`}

    <div class="card">
      <h2>Витрати за категоріями</h2>
      ${b.byCat.length ? `
      <div class="donut-wrap">
        <div class="donut">${donut(b.byCat, 170, 28)}<div class="donut-center"><b>${fmt(b.spent)}</b><small>грн за місяць</small></div></div>
        <ul class="legend">${b.byCat.map(c => `<li><i style="background:${c.color}"></i><span class="lg-name">${c.icon} ${c.name}</span><span class="lg-pct">${Math.round(c.total / b.spent * 100)}%</span><b>${money(c.total)}</b></li>`).join('')}</ul>
      </div>` : `<p class="empty">Цього місяця витрат ще немає. Додайте першу — і тут з’явиться статистика.</p>`}
    </div>

    <div class="card">
      <div class="row between"><h2>Останні 7 днів</h2><small class="muted">лінія — денний ліміт ${money(limit)}</small></div>
      <div class="bars">
        <div class="limit-line" style="bottom:${limit / maxBar * 100}%"></div>
        ${days.map((d, i) => `<div class="bar-col"><div class="bar-v ${daySums[i] > limit ? 'over' : ''}" style="height:${daySums[i] / maxBar * 100}%" title="${weekday(d)}: ${money(daySums[i])}"></div></div>`).join('')}
      </div>
      <div class="bar-labels">${days.map((d, i) => `<small>${weekday(d)}<b>${fmt(daySums[i])}</b></small>`).join('')}</div>
    </div>

    <div class="card">
      <div class="row between"><h2>Останні витрати</h2></div>
      ${recent.length ? `<ul class="tx-list">${recent.map(e => txRow(e)).join('')}</ul>` : '<p class="empty">Поки порожньо.</p>'}
    </div>

    <div class="card tip"><b>💡 Порада дня</b><p>${tip}</p></div>
    <button class="fab" id="add-exp" aria-label="Додати витрату">＋ Витрата</button>
  </section>`, 'home');

  $('#add-exp').addEventListener('click', openExpenseForm);
  $('#edit-budget').addEventListener('click', openBudgetForm);
  const sync = $('#sync');
  if (sync) sync.addEventListener('click', () => {
    const n = rand(1, 2);
    for (let i = 0; i < n; i++) state.expenses.push(demoTransaction(todayISO()));
    save(); renderHome(); toast(`Синхронізовано: ${n} ${plural(n, 'нова витрата', 'нові витрати', 'нових витрат')}`);
  });
  const connect = $('#connect');
  if (connect) connect.addEventListener('click', openCardForm);
  $$('[data-del]').forEach(btn => btn.addEventListener('click', () => {
    state.expenses = state.expenses.filter(e => e.id !== btn.dataset.del);
    save(); renderHome(); toast('Витрату видалено');
  }));
}

function openExpenseForm() {
  openSheet('Нова витрата', `
    <form id="exp-form" class="form">
      <label>Сума
        <div class="input-suffix"><input name="amount" type="number" min="1" step="1" required placeholder="0" inputmode="decimal"><span>грн</span></div>
      </label>
      <fieldset class="cats">
        <legend>Категорія</legend>
        ${CATEGORIES.map((c, i) => `<label><input type="radio" name="cat" value="${c.id}" ${i === 0 ? 'checked' : ''}><span>${c.icon}<small>${c.name}</small></span></label>`).join('')}
      </fieldset>
      <label>Дата
        <input name="date" type="date" max="${todayISO()}" value="${todayISO()}" required>
      </label>
      <label>Коментар (необов’язково)
        <input name="note" maxlength="40" placeholder="Наприклад, піца з друзями">
      </label>
      <button class="btn primary big" type="submit">Зберегти</button>
    </form>`, body => {
    $('#exp-form', body).addEventListener('submit', e => {
      e.preventDefault();
      const f = e.target;
      const exp = { id: uid(), amount: Number(f.amount.value), category: f.cat.value, date: f.date.value, note: f.note.value.trim(), source: 'manual' };
      state.expenses.push(exp);
      save(); closeSheet();
      renderHome();
      addXP(5, 'витрату записано');
      award('first_expense');
      const lim = state.parental.enabled && state.parental.limits[exp.category];
      if (lim) {
        const used = sum(monthExpenses().filter(x => x.category === exp.category), x => x.amount);
        if (used > lim) setTimeout(() => toast(`Перевищено ліміт батьків на «${cat(exp.category).name}»`, 'warn'), 500);
      }
    });
  });
}

function openBudgetForm() {
  openSheet('Бюджет на місяць', `
    <form id="bud-form" class="form">
      <label>Скільки грошей у вас на місяць?
        <div class="input-suffix"><input name="b" type="number" min="100" step="50" required value="${state.budget.monthly || ''}"><span>грн</span></div>
      </label>
      <p class="muted">Підказка за правилом 50/30/20: 50% — потреби, 30% — бажання, 20% — на ціль.</p>
      <button class="btn primary big" type="submit">Зберегти</button>
    </form>`, body => {
    $('#bud-form', body).addEventListener('submit', e => {
      e.preventDefault();
      state.budget.monthly = Number(e.target.b.value);
      save(); closeSheet(); router(); toast('Бюджет оновлено');
    });
  });
}

function openCardForm() {
  openSheet('Підключення картки', `
    <div class="safe-box"><b>🔒 Лише перегляд витрат</b><p>Не вводьте повний номер картки, CVV чи PIN. У прототипі підключення демонстраційне.</p></div>
    <form id="card-form" class="form">
      <label>Банк <select name="bank">${BANKS.map(b => `<option>${b}</option>`).join('')}</select></label>
      <label>Назва картки (необов’язково) <input name="nickname" maxlength="20"></label>
      <label>Останні 4 цифри (необов’язково) <input name="last4" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" autocomplete="off"></label>
      <label class="check"><input type="checkbox" name="demo" checked> Показати приклад витрат за цей місяць</label>
      <button class="btn primary big" type="submit">Підключити</button>
    </form>`, body => {
    const f = $('#card-form', body);
    f.last4.addEventListener('input', ev => { ev.target.value = ev.target.value.replace(/\D/g, '').slice(0, 4); });
    f.addEventListener('submit', e => {
      e.preventDefault();
      state.card = { connected: true, bank: f.bank.value, nickname: f.nickname.value.trim(), last4: f.last4.value, connectedAt: todayISO() };
      if (f.demo.checked) generateCardHistory();
      save(); closeSheet(); router(); toast('Картку підключено (демо)'); award('card');
    });
  });
}

/* ---------- Ціль ---------- */
function renderGoal() {
  if (!state.goal) return renderGoalCreate();
  const g = state.goal, s = goalStats();
  const status = s.done
    ? `<div class="status ok">🏆 Ціль досягнуто! Час купувати «${esc(g.title)}» без боргів.</div>`
    : s.diff >= 0
      ? `<div class="status ok">✅ Ви в графіку${s.diff > 1 ? ` і випереджаєте план на ${money(s.diff)}` : ''}.</div>`
      : `<div class="status warn">⏳ Відставання від плану: ${money(-s.diff)}. Поповніть ціль, щоб наздогнати.</div>`;
  const milestones = [25, 50, 75, 100].map(m => `<li class="${s.pct >= m ? 'on' : ''}"><span>${m === 100 ? '🏆' : m === 75 ? '🥇' : m === 50 ? '🥈' : '🥉'}</span><small>${m}%</small></li>`).join('');
  const hist = [...state.contributions].sort((a, z) => z.date.localeCompare(a.date));
  const srcName = { start: 'Стартова сума', self: 'Поповнення', parent: 'Бонус від батьків' };

  render(`
  <section class="page">
    <h1>Моя ціль</h1>
    <div class="card goal-card">
      <div class="ring-wrap">
        ${ring(s.pct)}
        <div class="ring-center"><span class="goal-ico big">${g.icon}</span><b>${Math.round(s.pct)}%</b></div>
      </div>
      <h2 class="center">${esc(g.title)}</h2>
      <p class="center big-num">${money(s.saved)} <small>з ${money(g.target)}</small></p>
      ${status}
      <ul class="milestones">${milestones}</ul>
      ${s.done ? `<button class="btn primary big" id="new-goal">Нова ціль</button>` : `<button class="btn primary big" id="contribute">＋ Поповнити ціль</button>`}
    </div>

    ${s.done ? '' : `
    <div class="card">
      <h2>План накопичення</h2>
      <div class="stats3">
        <div><small>На день</small><b>${money(s.perDay)}</b></div>
        <div><small>На тиждень</small><b>${money(s.perWeek)}</b></div>
        <div><small>На місяць</small><b>${money(s.perMonth)}</b></div>
      </div>
      <p class="muted">Залишилось ${money(s.remaining)} і ${s.daysLeft} ${plural(s.daysLeft, 'день', 'дні', 'днів')} — до ${fmtDate(g.deadline)}</p>
      <button class="btn ghost" id="edit-goal">Змінити ціль</button>
    </div>`}

    <div class="card">
      <h2>Історія поповнень</h2>
      ${hist.length ? `<ul class="tx-list">${hist.map(c => `<li class="tx">
        <span class="tx-ico" style="background:#2563EB1a">${c.source === 'parent' ? '👨‍👩‍👧' : '💰'}</span>
        <span class="tx-main"><b>${esc(c.note || srcName[c.source])}</b><small>${srcName[c.source]} · ${fmtShort(c.date)}</small></span>
        <span class="tx-sum pos">+${money(c.amount)}</span></li>`).join('')}</ul>` : '<p class="empty">Ще немає поповнень.</p>'}
    </div>

    ${state.goalsDone.length ? `<div class="card"><h2>Досягнуті цілі</h2><ul class="plain">${state.goalsDone.map(x => `<li>${x.icon} ${esc(x.title)} — ${money(x.target)}</li>`).join('')}</ul></div>` : ''}
  </section>`, 'goal');

  const c = $('#contribute');
  if (c) c.addEventListener('click', openContributionForm);
  const ed = $('#edit-goal');
  if (ed) ed.addEventListener('click', () => renderGoalCreate(true));
  const ng = $('#new-goal');
  if (ng) ng.addEventListener('click', () => {
    state.goalsDone.push({ ...state.goal, doneAt: todayISO() });
    state.goal = null; state.contributions = [];
    save(); renderGoalCreate();
  });
}

function openContributionForm() {
  const s = goalStats();
  openSheet('Поповнити ціль', `
    <form id="ctr-form" class="form">
      <label>Скільки відкладаєте?
        <div class="input-suffix"><input name="amount" type="number" min="1" step="1" required value="${Math.ceil(s.perWeek)}"><span>грн</span></div>
      </label>
      <div class="quick">${[50, 100, 200, 500].map(v => `<button type="button" class="btn tiny ghost" data-q="${v}">+${v}</button>`).join('')}</div>
      <label>Звідки гроші (необов’язково)
        <input name="note" maxlength="30" placeholder="Наприклад, зі стипендії">
      </label>
      <button class="btn primary big" type="submit">Відкласти</button>
    </form>`, body => {
    const f = $('#ctr-form', body);
    $$('[data-q]', body).forEach(b => b.addEventListener('click', () => { f.amount.value = b.dataset.q; }));
    f.addEventListener('submit', e => {
      e.preventDefault();
      state.contributions.push({ id: uid(), amount: Number(f.amount.value), date: todayISO(), source: 'self', note: f.note.value.trim() });
      save(); closeSheet(); renderGoal();
      addXP(10, 'ціль поповнено');
      checkGoalBadges();
    });
  });
}

function renderGoalCreate(edit = false) {
  const g = edit ? state.goal : null;
  render(`
  <section class="page">
    <h1>${edit ? 'Змінити ціль' : 'Нова ціль'}</h1>
    <form id="goal-form" class="form card">
      <fieldset class="icons">
        <legend>Іконка</legend>
        ${GOAL_ICONS.map((ic, i) => `<label><input type="radio" name="icon" value="${ic}" ${(g ? g.icon === ic : i === 0) ? 'checked' : ''}><span>${ic}</span></label>`).join('')}
      </fieldset>
      <label>На що накопичуєте? <input name="gtitle" required maxlength="40" value="${esc(g ? g.title : '')}"></label>
      <label>Сума <div class="input-suffix"><input name="gsum" type="number" min="100" required value="${g ? g.target : ''}"><span>грн</span></div></label>
      <label>Дата <input name="deadline" type="date" min="${addDays(todayISO(), 1)}" required value="${g ? g.deadline : addMonths(todayISO(), 3)}"></label>
      <div class="row">
        ${edit ? '<a class="btn ghost" href="#/goal">Скасувати</a>' : ''}
        <button class="btn primary grow" type="submit">Зберегти</button>
      </div>
    </form>
  </section>`, 'goal');
  $('#goal-form').addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target;
    const data = { icon: f.icon.value, title: f.gtitle.value.trim(), target: Number(f.gsum.value), deadline: f.deadline.value };
    if (edit) Object.assign(state.goal, data);
    else { state.goal = { ...data, createdAt: todayISO() }; state.contributions = []; }
    save();
    if (location.hash === '#/goal') renderGoal(); else location.hash = '#/goal';
    if (!edit) { addXP(20, 'нова ціль'); award('first_goal'); }
  });
}

/* ---------- Тренажер інвестицій ---------- */
let simInput = { amount: 10000, months: 12, depRate: 14, capital: false, ovdpRate: 16, inflation: 10, early: false, earlyMonth: 6 };
const TAX_DEPOSIT = 0.23;      // 18% ПДФО + 5% військовий збір
const EARLY_DEP_RATE = 1;      // умовна ставка при достроковому розірванні, % річних
const EARLY_OVDP_DISCOUNT = 0.02; // умовна знижка ціни при продажу ОВДП до погашення

function simulate(p) {
  const n = p.early ? Math.min(p.earlyMonth, p.months - 1) : p.months;
  const P = p.amount;
  // Депозит
  const rDep = (p.early ? EARLY_DEP_RATE : p.depRate) / 100;
  const depGross = p.capital && !p.early ? P * Math.pow(1 + rDep / 12, n) - P : P * rDep * n / 12;
  const depTax = depGross * TAX_DEPOSIT;
  const depFinal = P + depGross - depTax;
  // ОВДП (купон двічі на рік; при продажу раніше — накопичений купон і знижка ціни)
  const ovdpIncome = P * (p.ovdpRate / 100) * n / 12;
  const ovdpLoss = p.early ? P * EARLY_OVDP_DISCOUNT : 0;
  const ovdpFinal = P + ovdpIncome - ovdpLoss;
  // Картка
  const cardFinal = P;
  const infl = Math.pow(1 + p.inflation / 100, n / 12);
  return {
    n,
    rows: [
      { id: 'dep', name: 'Депозит', icon: '🏦', final: depFinal, income: depGross, tax: depTax, loss: 0, real: depFinal / infl },
      { id: 'ovdp', name: 'ОВДП', icon: '🇺🇦', final: ovdpFinal, income: ovdpIncome, tax: 0, loss: ovdpLoss, real: ovdpFinal / infl },
      { id: 'card', name: 'Гроші на картці', icon: '💳', final: cardFinal, income: 0, tax: 0, loss: 0, real: cardFinal / infl }
    ]
  };
}

function renderSim() {
  const p = simInput;
  render(`
  <section class="page">
    <h1>Тренажер інвестицій</h1>
    <p class="muted">Віртуальні гроші — реальні уроки. Порівняйте депозит, ОВДП і «гроші на картці» та подивіться, як працюють відсотки, податки й інфляція.</p>
    <form id="sim-form" class="form card">
      <label>Віртуальна сума
        <div class="input-suffix"><input name="amount" type="number" min="1000" max="1000000" step="1000" value="${p.amount}"><span>грн</span></div>
      </label>
      <label>Строк
        <select name="months">${[3, 6, 12, 24, 36].map(m => `<option value="${m}" ${p.months === m ? 'selected' : ''}>${m} міс.</option>`).join('')}</select>
      </label>
      <div class="grid2">
        <label>Ставка депозиту, % річних <input name="depRate" type="number" min="0" max="50" step="0.5" value="${p.depRate}"></label>
        <label>Ставка ОВДП, % річних <input name="ovdpRate" type="number" min="0" max="50" step="0.5" value="${p.ovdpRate}"></label>
      </div>
      <label>Інфляція, % на рік <input name="inflation" type="number" min="0" max="50" step="0.5" value="${p.inflation}"></label>
      <label class="check"><input type="checkbox" name="capital" ${p.capital ? 'checked' : ''}> Депозит із щомісячною капіталізацією</label>
      <label class="check"><input type="checkbox" name="early" ${p.early ? 'checked' : ''}> Забрати гроші достроково</label>
      <label class="${p.early ? '' : 'hidden'}" id="early-row">Через скільки місяців?
        <input name="earlyMonth" type="number" min="1" max="35" value="${p.earlyMonth}">
      </label>
      <p class="fine">Ставки в полях — приклад. Актуальні ставки дивіться на сайтах банків і Мінфіну.</p>
    </form>
    <div id="sim-result"></div>
    <div class="card">
      <h2>Журнал угод</h2>
      ${state.simulations.length ? `<ul class="plain">${state.simulations.slice(-5).reverse().map(s => `<li>${fmtShort(s.date)}: ${s.choice} · ${money(s.amount)} на ${s.months} міс. → <b>${money(s.final)}</b></li>`).join('')}</ul>` : '<p class="empty">Збережіть першу віртуальну угоду — отримаєте нагороду.</p>'}
    </div>
  </section>`, 'sim');

  const form = $('#sim-form');
  const update = () => {
    simInput = {
      amount: Number(form.amount.value) || 0, months: Number(form.months.value),
      depRate: Number(form.depRate.value) || 0, ovdpRate: Number(form.ovdpRate.value) || 0,
      inflation: Number(form.inflation.value) || 0, capital: form.capital.checked,
      early: form.early.checked, earlyMonth: Math.max(1, Number(form.earlyMonth.value) || 1)
    };
    $('#early-row').classList.toggle('hidden', !simInput.early);
    drawSim();
  };
  form.addEventListener('input', update);
  form.addEventListener('change', update);
  drawSim();
}

function drawSim() {
  const p = simInput;
  if (p.early && p.earlyMonth >= p.months) {
    $('#sim-result').innerHTML = `<div class="alert">Дострокове зняття має бути раніше за кінець строку (${p.months} міс.).</div>`;
    return;
  }
  const r = simulate(p);
  const best = r.rows.reduce((a, b) => (b.final > a.final ? b : a));
  const maxReal = Math.max(...r.rows.map(x => x.final));
  $('#sim-result').innerHTML = `
    <div class="card">
      <h2>Результат через ${r.n} міс.</h2>
      <div class="sim-rows">
        ${r.rows.map(x => `
        <div class="sim-row ${x.id === best.id ? 'best' : ''}">
          <div class="row between"><b>${x.icon} ${x.name}</b>${x.id === best.id ? '<span class="pill">найбільше</span>' : ''}</div>
          <div class="sim-bar"><span style="width:${x.final / maxReal * 100}%"></span><span class="real" style="width:${x.real / maxReal * 100}%"></span></div>
          <div class="sim-nums">
            <span>Отримаєте: <b>${money(x.final)}</b></span>
            <span>Дохід: ${money(x.income - x.tax - x.loss)}</span>
            ${x.tax ? `<span>Податки 23%: −${money(x.tax)}</span>` : ''}
            ${x.loss ? `<span>Втрата при продажу: −${money(x.loss)}</span>` : ''}
            <span>З урахуванням інфляції: <b>${money(x.real)}</b></span>
          </div>
        </div>`).join('')}
      </div>
      <div class="legend-note"><span><i class="sw a"></i> сума в гривнях</span><span><i class="sw b"></i> скільки це в сьогоднішніх цінах (з урахуванням інфляції)</span></div>
      <div class="lesson-box">${simInsight(r)}</div>
      <div class="form">
        <label>Який варіант ви б обрали?
          <select id="sim-choice">${r.rows.map(x => `<option value="${x.id}" ${x.id === best.id ? 'selected' : ''}>${x.name}</option>`).join('')}</select>
        </label>
        <button class="btn primary big" id="sim-save">Зберегти угоду в журнал · +15 XP</button>
      </div>
    </div>`;
  $('#sim-save').addEventListener('click', () => {
    const row = r.rows.find(x => x.id === $('#sim-choice').value);
    state.simulations.push({ date: todayISO(), choice: row.name, amount: p.amount, months: r.n, final: row.final });
    save();
    addXP(15, 'віртуальна угода');
    award('sim_first');
    renderSim();
  });
}

function simInsight(r) {
  const [dep, ovdp, card] = r.rows;
  const tips = [];
  if (simInput.early) tips.push('Дострокове зняття зменшує дохід: за депозитом відсотки перераховують за нижчою ставкою (у прикладі — 1% річних), а ОВДП продають за ринковою ціною (у прикладі — на 2% нижче номіналу). Реальні умови залежать від договору й ринку.');
  if (dep.tax > 0) tips.push(`З відсотків за депозитом утримано ${money(dep.tax)} податків. Дохід від ОВДП для фізосіб не оподатковується.`);
  if (card.real < card.final) tips.push(`Гроші на картці не ростуть: через інфляцію ${money(card.final)} купуватимуть стільки, скільки сьогодні ${money(card.real)}.`);
  if (ovdp.real < simInput.amount && dep.real < simInput.amount) tips.push('Ставки нижчі за інфляцію: навіть вкладені гроші втрачають купівельну спроможність.');
  return '<b>Що це означає</b><ul>' + tips.map(t => `<li>${t}</li>`).join('') + '</ul>';
}

/* ---------- Навчання ---------- */
function renderLearn() {
  const done = state.lessonsDone.length, total = LESSONS.length;
  render(`
  <section class="page">
    <h1>Навчання</h1>
    <p class="muted">Короткі уроки про гроші. За кожен урок — 30 XP, за правильну відповідь у тесті — ще 20 XP.</p>
    <div class="card">
      <div class="row between"><b>Пройдено ${done} з ${total}</b><span>${Math.round(done / total * 100)}%</span></div>
      ${progressBar(done / total * 100)}
    </div>
    <div class="lessons">
      ${LESSONS.map((l, i) => {
        const isDone = state.lessonsDone.includes(l.id);
        return `<a class="card lesson-item ${isDone ? 'done' : ''}" href="#/lesson/${l.id}">
          <span class="lesson-ico">${l.icon}</span>
          <span class="grow"><small>Урок ${i + 1} · ${l.minutes} хв</small><b>${l.title}</b></span>
          <span class="lesson-state">${isDone ? '✓' : '›'}</span>
        </a>`;
      }).join('')}
    </div>
  </section>`, 'learn');
}

function renderLesson(id) {
  const idx = LESSONS.findIndex(l => l.id === id);
  if (idx < 0) { location.hash = '#/learn'; return; }
  const l = LESSONS[idx];
  const next = LESSONS[idx + 1];
  const isDone = state.lessonsDone.includes(l.id);
  render(`
  <section class="page lesson">
    <a href="#/learn" class="back-link">← Усі уроки</a>
    <p class="muted">Урок ${idx + 1} з ${LESSONS.length} · ${l.minutes} хв читання</p>
    <h1>${l.icon} ${l.title}</h1>
    <p class="lead">${l.intro}</p>
    ${l.sections.map(s => `<div class="card"><h2>${s.h}</h2>${s.html}</div>`).join('')}
    <div class="example">${l.example}</div>
    <div class="card quiz">
      <h2>Перевір себе</h2>
      <p><b>${l.quiz.q}</b></p>
      <div class="options">${l.quiz.options.map((o, i) => `<button class="opt" data-i="${i}">${o}</button>`).join('')}</div>
      <p class="quiz-feedback" hidden></p>
    </div>
    ${isDone ? '<div class="status ok">✓ Урок пройдено</div>' : '<button class="btn primary big" id="finish">Урок прочитано · +30 XP</button>'}
    ${next ? `<a class="btn ghost big" href="#/lesson/${next.id}">Наступний урок: ${next.title} →</a>` : '<a class="btn ghost big" href="#/learn">До списку уроків</a>'}
  </section>`, 'learn');

  $$('.opt').forEach(btn => btn.addEventListener('click', () => {
    const i = Number(btn.dataset.i);
    const ok = i === l.quiz.correct;
    $$('.opt').forEach(b => { b.disabled = true; if (Number(b.dataset.i) === l.quiz.correct) b.classList.add('right'); });
    if (!ok) btn.classList.add('wrong');
    const fb = $('.quiz-feedback');
    fb.hidden = false;
    fb.className = `quiz-feedback ${ok ? 'ok' : 'bad'}`;
    fb.innerHTML = `${ok ? 'Правильно!' : 'Не зовсім.'} ${l.quiz.explain}`;
    if (ok && !state.quizDone.includes(l.id)) { state.quizDone.push(l.id); save(); addXP(20, 'правильна відповідь'); }
  }));
  const fin = $('#finish');
  if (fin) fin.addEventListener('click', () => {
    state.lessonsDone.push(l.id);
    save();
    addXP(30, 'урок пройдено');
    award('lesson_first');
    if (state.lessonsDone.length === LESSONS.length) award('lessons_all');
    renderLesson(l.id);
  });
}

/* ---------- Профіль ---------- */
function renderProfile() {
  const u = state.user, lv = levelInfo(), p = state.parental;
  render(`
  <section class="page">
    <h1>Профіль</h1>
    <div class="card profile-card">
      <div class="avatar">${esc(u.name.slice(0, 1).toUpperCase())}</div>
      <div class="grow">
        <h2>${esc(u.name)}</h2>
        <p class="muted">${u.ageGroup === '14-17' ? '14–17 років' : '18–25 років'} · з ${fmtShort(u.createdAt)}</p>
        <p><b>Рівень ${lv.lvl}: ${lv.name}</b> · ${state.xp} XP</p>
        ${progressBar(lv.into, 'thin')}
      </div>
    </div>

    <div class="card">
      <h2>Нагороди <small class="muted">${state.badges.length} з ${BADGES.length}</small></h2>
      <ul class="badges">${BADGES.map(b => {
        const on = state.badges.includes(b.id);
        return `<li class="${on ? 'on' : ''}" title="${b.hint}"><span>${on ? b.icon : '🔒'}</span><small>${b.title}</small></li>`;
      }).join('')}</ul>
    </div>

    <div class="card">
      <h2>Картка</h2>
      ${state.card.connected
        ? `<p>💳 ${esc(state.card.bank)}${state.card.last4 ? ' •• ' + esc(state.card.last4) : ''}${state.card.nickname ? ' · ' + esc(state.card.nickname) : ''} <span class="pill">демо</span></p>
           <button class="btn ghost" id="disconnect">Відключити картку</button>`
        : `<p class="muted">Картку не підключено — витрати можна вводити вручну.</p><button class="btn primary" id="connect">Підключити картку</button>`}
    </div>

    <div class="card">
      <h2>Бюджет</h2>
      <p>На місяць: <b>${money(state.budget.monthly)}</b> · денний ліміт ≈ ${money(dailyLimitBase())}</p>
      <button class="btn ghost" id="edit-budget">Змінити бюджет</button>
    </div>

    <div class="card parent-card">
      <h2>👨‍👩‍👧 Батьківський режим</h2>
      ${p.enabled ? `
        <div class="status ok">Увімкнено${p.parentName ? ` · ${esc(p.parentName)}` : ''}</div>
        <p class="muted"><b>Батьки бачать:</b> прогрес цілі, частку використаного бюджету, суми за категоріями, пройдені уроки.<br><b>Батьки не бачать:</b> окремі покупки та коментарі до них.</p>
        <div class="row">
          <button class="btn primary grow" id="open-parent">Кабінет батьків</button>
          <button class="btn ghost" id="disable-parent">Вимкнути</button>
        </div>` : `
        <p class="muted">Батьки зможуть підтримувати ваші цілі бонусами та встановлювати ліміти на категорії. Це не стеження: окремі покупки батьки не бачать.</p>
        ${u.ageGroup === '14-17' ? '<p class="hint-box">Рекомендовано для 14–17 років: бонуси від батьків допоможуть швидше досягти цілі.</p>' : ''}
        <button class="btn primary" id="enable-parent">Увімкнути</button>`}
    </div>

    <div class="card">
      <h2>Дані</h2>
      <p class="muted">Усі дані зберігаються лише в цьому браузері. Сервера немає.</p>
      <div class="row wrap">
        <button class="btn ghost" id="export">Завантажити мої дані</button>
        <button class="btn danger" id="reset">Скинути все</button>
      </div>
    </div>

    <p class="fine center">ФінКвест · навчальний прототип з дисципліни «Діджитал підприємництво», КНЕУ.<br>Не є фінансовою порадою. Застосунок не виконує реальних операцій.</p>
  </section>`, 'profile');

  const on = (id, fn) => { const el = $('#' + id); if (el) el.addEventListener('click', fn); };
  on('connect', openCardForm);
  on('disconnect', () => { state.card = { connected: false }; state.expenses = state.expenses.filter(e => e.source !== 'card'); save(); renderProfile(); toast('Картку відключено, демо-витрати видалено'); });
  on('edit-budget', openBudgetForm);
  on('enable-parent', openParentSetup);
  on('open-parent', () => askPin('Вхід до кабінету батьків', () => { parentUnlocked = true; location.hash = '#/parent'; }));
  on('disable-parent', () => askPin('Вимкнути батьківський режим', () => {
    state.parental = { enabled: false, pin: '', parentName: '', limits: {} }; parentUnlocked = false;
    save(); renderProfile(); toast('Батьківський режим вимкнено');
  }));
  on('export', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'finquest-data.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  on('reset', () => {
    if (state.parental.enabled) { toast('Спершу вимкніть батьківський режим'); return; }
    if (confirm('Видалити всі дані ФінКвесту з цього браузера?')) {
      state = defaultState(); save(); location.hash = '#/';
    }
  });
}

function limitsFields() {
  return CATEGORIES.map(c => `<label class="limit-row"><span>${c.icon} ${c.name}</span>
    <div class="input-suffix"><input name="lim_${c.id}" type="number" min="0" step="50" value="${state.parental.limits[c.id] || ''}" placeholder="немає"><span>грн</span></div></label>`).join('');
}
function readLimits(form) {
  const limits = {};
  CATEGORIES.forEach(c => { const v = Number(form['lim_' + c.id].value); if (v > 0) limits[c.id] = v; });
  return limits;
}

function openParentSetup() {
  openSheet('Увімкнути батьківський режим', `
    <form id="par-form" class="form">
      <p class="muted">Цей крок виконують батьки разом з дитиною.</p>
      <label>Як звертатися до батьків (необов’язково) <input name="pname" maxlength="20" placeholder="Мама, тато…"></label>
      <div class="grid2">
        <label>PIN-код (4 цифри) <input name="pin" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" required autocomplete="off"></label>
        <label>Повторіть PIN <input name="pin2" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" required autocomplete="off"></label>
      </div>
      <p class="error" id="pin-mismatch" hidden>PIN-коди не збігаються</p>
      <details><summary>Ліміти на категорії на місяць (необов’язково)</summary>${limitsFields()}</details>
      <button class="btn primary big" type="submit">Увімкнути</button>
    </form>`, body => {
    $('#par-form', body).addEventListener('submit', e => {
      e.preventDefault();
      const f = e.target;
      if (f.pin.value !== f.pin2.value) { $('#pin-mismatch', body).hidden = false; return; }
      state.parental = { enabled: true, pin: f.pin.value, parentName: f.pname.value.trim(), limits: readLimits(f) };
      save(); closeSheet(); renderProfile();
      toast('Батьківський режим увімкнено');
      award('parent_on');
    });
  });
}

/* ---------- Кабінет батьків ---------- */
function renderParent() {
  if (!state.parental.enabled) { location.hash = '#/profile'; return; }
  if (!parentUnlocked) {
    history.replaceState(null, '', '#/profile');
    renderProfile();
    askPin('Вхід до кабінету батьків', () => { parentUnlocked = true; location.hash = '#/parent'; });
    return;
  }
  const u = state.user, b = budgetStats(), g = goalStats(), lv = levelInfo();
  const limits = Object.entries(state.parental.limits || {});
  render(`
  <section class="page parent">
    <div class="row between">
      <h1>Кабінет батьків</h1>
      <button class="btn tiny ghost" id="lock">Вийти</button>
    </div>
    <p class="muted">Огляд для ${esc(u.name)}. Окремі покупки тут не показуються — лише загальна картина.</p>

    ${g ? `<div class="card">
      <h2>${state.goal.icon} ${esc(state.goal.title)}</h2>
      ${progressBar(g.pct)}
      <p>${money(g.saved)} з ${money(state.goal.target)} · ${Math.round(g.pct)}% · до ${fmtDate(state.goal.deadline)}</p>
      <p class="${g.diff >= 0 ? 'ok-text' : 'warn-text'}">${g.diff >= 0 ? 'Дитина в графіку накопичення' : `Відставання від плану: ${money(-g.diff)}`}</p>
      <button class="btn primary" id="bonus">🎁 Надіслати бонус до цілі</button>
    </div>` : '<div class="card"><p>Дитина ще не створила ціль.</p></div>'}

    <div class="card">
      <h2>Бюджет цього місяця</h2>
      ${progressBar(b.pct, b.pct > 100 ? 'over' : b.pct > 85 ? 'warn' : '')}
      <p>Використано ${Math.round(b.pct)}% бюджету (${money(b.spent)} з ${money(b.budget)})</p>
    </div>

    <div class="card">
      <div class="row between"><h2>Ліміти за категоріями</h2><button class="btn tiny ghost" id="edit-limits">Змінити</button></div>
      ${limits.length ? `<ul class="limits">${limits.map(([id, lim]) => {
        const used = sum(monthExpenses().filter(e => e.category === id), e => e.amount);
        const pct = used / lim * 100;
        return `<li><div class="row between"><span>${cat(id).icon} ${cat(id).name}</span><small>${money(used)} / ${money(lim)}</small></div>${progressBar(pct, pct > 100 ? 'over' : pct > 80 ? 'warn' : '')}</li>`;
      }).join('')}</ul>` : '<p class="empty">Лімітів не встановлено.</p>'}
    </div>

    <div class="card">
      <h2>Навчання та прогрес</h2>
      <p>Рівень ${lv.lvl} (${lv.name}) · уроків пройдено: ${state.lessonsDone.length} з ${LESSONS.length} · нагород: ${state.badges.length}</p>
    </div>
  </section>`, 'profile');

  $('#lock').addEventListener('click', () => { parentUnlocked = false; location.hash = '#/profile'; });
  const bonus = $('#bonus');
  if (bonus) bonus.addEventListener('click', () => openSheet('Бонус до цілі', `
    <form id="bonus-form" class="form">
      <label>Сума бонусу <div class="input-suffix"><input name="amount" type="number" min="1" required><span>грн</span></div></label>
      <label>Повідомлення <input name="note" maxlength="40" placeholder="Молодець, так тримати!"></label>
      <button class="btn primary big" type="submit">Надіслати</button>
    </form>`, body => {
    $('#bonus-form', body).addEventListener('submit', e => {
      e.preventDefault();
      state.contributions.push({ id: uid(), amount: Number(e.target.amount.value), date: todayISO(), source: 'parent', note: e.target.note.value.trim() || 'Бонус від батьків' });
      save(); closeSheet(); renderParent(); toast('Бонус додано до цілі'); checkGoalBadges();
    });
  }));
  $('#edit-limits').addEventListener('click', () => openSheet('Ліміти на місяць', `
    <form id="lim-form" class="form">${limitsFields()}<button class="btn primary big" type="submit">Зберегти</button></form>`, body => {
    $('#lim-form', body).addEventListener('submit', e => {
      e.preventDefault();
      state.parental.limits = readLimits(e.target);
      save(); closeSheet(); renderParent(); toast('Ліміти збережено');
    });
  }));
}

/* ---------- Маршрутизація ---------- */
function router() {
  const [name, param] = location.hash.replace(/^#\/?/, '').split('/');
  closeSheet();
  if (!state.user) {
    if (name === 'onboarding') return renderOnboarding();
    return renderWelcome();
  }
  switch (name) {
    case 'goal': return renderGoal();
    case 'sim': return renderSim();
    case 'learn': return renderLearn();
    case 'lesson': return renderLesson(param);
    case 'profile': return renderProfile();
    case 'parent': return renderParent();
    case 'home': return renderHome();
    default: location.hash = '#/home';
  }
}
window.addEventListener('hashchange', router);
router();
