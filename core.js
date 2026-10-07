'use strict';

// Нажатия, попавшие в это окно после предыдущего нажатия того же упражнения,
// считаются одним подходом. Окно скользящее: отсчёт перезапускается с каждого нажатия.
const SET_WINDOW_MS = 3000;
const STORE_KEY = 'workout-tracker-v1';

const EXERCISES = [
  { id: 'pullups', name: 'Подтягивания', steps: [1, 5, 10] },
  { id: 'pushups', name: 'Отжимания',    steps: [1, 5, 10] },
  { id: 'dips',    name: 'Брусья',       steps: [1, 5, 10] },
  { id: 'squats',  name: 'Приседания',   steps: [1, 5, 10] },
  { id: 'abs',     name: 'Пресс',        steps: [1, 5, 10] },
  { id: 'plank',   name: 'Планка',       steps: [15, 30, 60], timeBased: true }
];

function emptyState() {
  return { v: 1, entries: [], weight: {} };
}

// Локальная дата, не UTC: тренировка в 23:30 должна попасть в сегодняшний день.
function dayKey(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

// Полдень как точка отсчёта: сдвиг на сутки не перепрыгнет дату при переходе на летнее время.
function dayStepper(now) {
  const d = new Date(now);
  d.setHours(12, 0, 0, 0);
  return d;
}

function addEntry(state, ex, delta, now, opts) {
  let setId = null;
  if (!(opts && opts.newSet)) {
    for (let i = state.entries.length - 1; i >= 0; i--) {
      const prev = state.entries[i];
      if (prev.ex !== ex) continue;
      const gap = now - prev.ts;
      // gap >= 0 — иначе сдвинутые назад часы приклеят нажатие к старому подходу.
      // Сверка дня — иначе подход, начатый в 23:59:59, попал бы половинами в два дня.
      if (gap >= 0 && gap <= SET_WINDOW_MS && dayKey(prev.ts) === dayKey(now)) {
        setId = prev.set;
      }
      break; // интересует только последнее нажатие этого упражнения
    }
  }
  if (!setId) setId = ex + '-' + now;
  return {
    ...state,
    entries: [...state.entries, { ts: now, ex, delta, set: setId }]
  };
}

// Последнее нажатие за сегодня — то, что уберёт «Отменить».
function lastEntry(state, now) {
  const e = state.entries;
  if (!e.length) return null;
  const last = e[e.length - 1];
  return dayKey(last.ts) === dayKey(now) ? last : null;
}

// Снимает одно нажатие, а не весь подход. Историю прошлых дней не трогает.
function undoLast(state, now) {
  if (!lastEntry(state, now)) return state;
  return { ...state, entries: state.entries.slice(0, -1) };
}

// Подходы за день в порядке выполнения: [12, 10]
function setsFor(state, ex, day) {
  const order = new Map();
  const out = [];
  for (const en of state.entries) {
    if (en.ex !== ex || dayKey(en.ts) !== day) continue;
    if (!order.has(en.set)) {
      order.set(en.set, out.length);
      out.push(0);
    }
    out[order.get(en.set)] += en.delta;
  }
  return out;
}

function dayTotal(state, ex, day) {
  let sum = 0;
  for (const en of state.entries) {
    if (en.ex === ex && dayKey(en.ts) === day) sum += en.delta;
  }
  return sum;
}

function lastDays(now, n) {
  const days = [];
  const d = dayStepper(now);
  for (let i = 0; i < n; i++) {
    days.push(dayKey(d.getTime()));
    d.setDate(d.getDate() - 1);
  }
  return days;
}

// Последние 7 календарных дней, включая сегодня.
function weekTotal(state, ex, now) {
  const days = new Set(lastDays(now, 7));
  let sum = 0;
  for (const en of state.entries) {
    if (en.ex === ex && days.has(dayKey(en.ts))) sum += en.delta;
  }
  return sum;
}

// Дни подряд, в которых есть хотя бы одно повторение. Вес тела тренировкой не считается:
// он живёт отдельно от entries. Если сегодня пусто — отсчёт от вчера, иначе серия
// показывала бы ноль каждое утро до первого подхода.
function streak(state, now) {
  const active = new Set(state.entries.map((e) => dayKey(e.ts)));
  if (!active.size) return 0;
  const d = dayStepper(now);
  if (!active.has(dayKey(d.getTime()))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (active.has(dayKey(d.getTime()))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

function setWeight(state, kg, now) {
  return { ...state, weight: { ...state.weight, [dayKey(now)]: kg } };
}

// Последний замер и его изменение к предыдущему.
function weightInfo(state) {
  const days = Object.keys(state.weight).sort();
  if (!days.length) return { value: null, delta: null, day: null };
  const day = days[days.length - 1];
  const value = state.weight[day];
  const prev = days.length > 1 ? state.weight[days[days.length - 2]] : null;
  return {
    value,
    day,
    delta: prev == null ? null : Math.round((value - prev) * 10) / 10
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return emptyState();
    const s = JSON.parse(raw);
    if (!s || !Array.isArray(s.entries)) return emptyState();
    return { v: 1, entries: s.entries, weight: s.weight || {} };
  } catch (e) {
    return emptyState();
  }
}

// Возвращает false, если браузер отказал в записи — приложение обязано это показать,
// а не делать вид, что данные сохранены.
function save(state) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    return false;
  }
}

window.WT = {
  SET_WINDOW_MS, STORE_KEY, EXERCISES,
  emptyState, dayKey, addEntry, lastEntry, undoLast,
  setsFor, dayTotal, weekTotal, streak,
  setWeight, weightInfo, load, save
};
