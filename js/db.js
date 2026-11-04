// 기기 안 데이터베이스(IndexedDB) 정의와 읽기·쓰기 함수
//
// ⚠️ 데이터 보존 규칙: 구조를 바꿀 때는 아래 version(1)을 고치지 말고
//    db.version(2).stores({...}).upgrade(...) 를 "추가"해야 기존 기록이 유지됩니다.

import Dexie, { liveQuery } from './vendor/dexie.mjs';
import { useState, useEffect } from './vendor/preact-htm.mjs';
import { uuid, nowIso, todayStr } from './util.js';
import { SEED_EXERCISES } from './seed.js';

export const SCHEMA_VERSION = 1;

export const db = new Dexie('workout-log');

db.version(1).stores({
  exercises: 'id, part, name',
  workouts: 'id, date, type',
  entries: 'id, workoutId, exerciseId',
  sets: 'id, workoutId, entryId, [exerciseId+date]',
  cardio: 'id, workoutId, date',
  routines: 'id',
  body: 'id, date',
  conditions: 'id, date',
  settings: 'key',
});

// 데이터베이스를 처음 만들 때 한 번만 기본 운동 목록을 넣습니다.
db.on('populate', (tx) => {
  const t = nowIso();
  tx.table('exercises').bulkAdd(
    SEED_EXERCISES.map(([part, name, opts = {}]) => ({
      id: uuid(), name, part,
      incrementKg: opts.inc ?? 2.5,
      repUnit: opts.sec ? 'sec' : 'reps',
      defaultWeightKg: opts.bw ? 0 : null,
      favorite: false, archived: false, builtIn: true,
      createdAt: t, updatedAt: t,
    })),
  );
});

export const TABLES = ['exercises', 'workouts', 'entries', 'sets', 'cardio', 'routines', 'body', 'conditions', 'settings'];

/** 데이터가 바뀌면 화면이 자동으로 다시 그려지게 하는 도우미 */
export function useLive(fn, deps = [], initial = undefined) {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    const sub = liveQuery(fn).subscribe({ next: setValue, error: (e) => console.error(e) });
    return () => sub.unsubscribe();
  }, deps);
  return value;
}

/* ---------- 설정 ---------- */
export async function getSetting(key, def = null) {
  const row = await db.settings.get(key);
  return row ? row.value : def;
}
export function setSetting(key, value) {
  return db.settings.put({ key, value, updatedAt: nowIso() });
}

/* ---------- 운동 목록 ---------- */
export function useExercises() {
  return useLive(async () => {
    const list = await db.exercises.toArray();
    const map = {};
    for (const e of list) map[e.id] = e;
    return map;
  }, [], {});
}

/** 운동별 사용 횟수 (자주 쓰는 운동을 위로 올리기 위해) */
export async function exerciseUsage() {
  const counts = {};
  await db.entries.each((e) => { counts[e.exerciseId] = (counts[e.exerciseId] || 0) + 1; });
  return counts;
}

export async function addExercise({ name, part, incrementKg = 2.5, repUnit = 'reps' }) {
  const t = nowIso();
  const ex = {
    id: uuid(), name: name.trim(), part, incrementKg, repUnit, defaultWeightKg: null,
    favorite: false, archived: false, builtIn: false, createdAt: t, updatedAt: t,
  };
  await db.exercises.add(ex);
  return ex;
}
export function updateExercise(id, patch) {
  return db.exercises.update(id, { ...patch, updatedAt: nowIso() });
}

/* ---------- 운동(하루 기록) ---------- */
export async function createWorkout(type, date = todayStr()) {
  const t = nowIso();
  const w = { id: uuid(), type, date, startedAt: t, endedAt: null, note: '', createdAt: t, updatedAt: t };
  await db.workouts.add(w);
  return w;
}

export function touchWorkout(id, patch = {}) {
  return db.workouts.update(id, { ...patch, updatedAt: nowIso() });
}

export async function deleteWorkout(id) {
  await db.transaction('rw', db.workouts, db.entries, db.sets, db.cardio, async () => {
    await db.sets.where('workoutId').equals(id).delete();
    await db.entries.where('workoutId').equals(id).delete();
    await db.cardio.where('workoutId').equals(id).delete();
    await db.workouts.delete(id);
  });
}

/** 완료한 세트가 하나도 없는 근력 기록(시작만 하고 닫은 것)인지 */
export async function isEmptyWorkout(w) {
  if (w.type !== 'strength') return false;
  return !(await db.sets.where('workoutId').equals(w.id).filter((s) => s.done).first());
}

/** 가장 최근 운동 (기준일 이전, 빈 기록 제외) */
export async function lastWorkoutBefore(date) {
  const list = await db.workouts.where('date').below(date).reverse().sortBy('date');
  for (const w of list) if (!(await isEmptyWorkout(w))) return w;
  return null;
}

/* ---------- 근력: 운동 항목과 세트 ---------- */

/** 지난번 기록: 해당 운동의 가장 최근(현재 운동 제외) 완료 세트들 */
export async function getLastPerformance(exerciseId, excludeWorkoutId, beforeOrOnDate = '9999-12-31') {
  const sets = await db.sets
    .where('[exerciseId+date]')
    .between([exerciseId, Dexie.minKey], [exerciseId, beforeOrOnDate], true, true)
    .toArray();
  const done = sets.filter((s) => s.done && s.workoutId !== excludeWorkoutId);
  if (!done.length) return null;
  done.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.completedAt || '').localeCompare(a.completedAt || '')));
  const wid = done[0].workoutId;
  const lastSets = done.filter((s) => s.workoutId === wid).sort((a, b) => a.order - b.order);
  return { date: done[0].date, workoutId: wid, sets: lastSets };
}

/**
 * 운동 추가. opts(루틴에서 불러올 때): { targetSets, targetReps, routineId }
 * 지난번 기록의 무게·횟수로 세트를 미리 채웁니다. 루틴이면 목표 세트 수만큼 만들어 둡니다.
 */
export async function addEntry(workout, exercise, opts = {}) {
  const t = nowIso();
  const existing = await db.entries.where('workoutId').equals(workout.id).toArray();
  const entry = {
    id: uuid(), workoutId: workout.id, exerciseId: exercise.id,
    order: existing.length ? Math.max(...existing.map((e) => e.order)) + 1 : 0,
    note: '',
    targetSets: opts.targetSets ?? null,
    targetReps: opts.targetReps ?? null,
    routineId: opts.routineId ?? null,
    progression: null, // 증량 제안 선택: { status: 'accepted'|'ignored', toKg }
    createdAt: t, updatedAt: t,
  };
  const last = await getLastPerformance(exercise.id, workout.id, workout.date);
  const count = Math.max(1, opts.targetSets || 1);
  await db.transaction('rw', db.entries, db.sets, db.workouts, async () => {
    await db.entries.add(entry);
    for (let i = 0; i < count; i++) {
      const base = last?.sets[i] ?? last?.sets[last.sets.length - 1];
      await db.sets.add(newSet(entry, workout, i, {
        weightKg: base ? base.weightKg : exercise.defaultWeightKg ?? 20,
        reps: opts.targetReps ?? (base ? base.reps : exercise.repUnit === 'sec' ? 30 : 10),
      }));
    }
    await touchWorkout(workout.id);
  });
  return entry;
}

function newSet(entry, workout, order, { weightKg, reps }) {
  const t = nowIso();
  return {
    id: uuid(), workoutId: workout.id, entryId: entry.id, exerciseId: entry.exerciseId,
    date: workout.date, order, weightKg, reps, rpe: null, done: false, completedAt: null,
    createdAt: t, updatedAt: t,
  };
}

/** 세트 추가: 직전 세트 값을 그대로 복사 */
export async function addSet(entry, workout) {
  const sets = (await db.sets.where('entryId').equals(entry.id).toArray()).sort((a, b) => a.order - b.order);
  const prev = sets[sets.length - 1];
  let base = prev;
  if (!base) {
    const last = await getLastPerformance(entry.exerciseId, workout.id, workout.date);
    base = last?.sets[0] ?? { weightKg: 20, reps: 10 };
  }
  const s = newSet(entry, workout, prev ? prev.order + 1 : 0, { weightKg: base.weightKg, reps: base.reps });
  await db.sets.add(s);
  return s;
}

export function updateSet(id, patch) {
  return db.sets.update(id, { ...patch, updatedAt: nowIso() });
}
export function deleteSet(id) {
  return db.sets.delete(id);
}
export function updateEntry(id, patch) {
  return db.entries.update(id, { ...patch, updatedAt: nowIso() });
}
export async function deleteEntry(id) {
  await db.transaction('rw', db.entries, db.sets, async () => {
    await db.sets.where('entryId').equals(id).delete();
    await db.entries.delete(id);
  });
}

/** 하루치 운동 묶음 상세 (기록 탭/오늘 탭에서 사용) */
export async function loadWorkoutDetails(workouts) {
  const out = [];
  for (const w of workouts) {
    if (w.type === 'strength') {
      const entries = (await db.entries.where('workoutId').equals(w.id).toArray()).sort((a, b) => a.order - b.order);
      const sets = await db.sets.where('workoutId').equals(w.id).toArray();
      out.push({
        ...w,
        entries: entries.map((e) => ({
          ...e,
          sets: sets.filter((s) => s.entryId === e.id).sort((a, b) => a.order - b.order),
        })),
      });
    } else {
      const c = await db.cardio.where('workoutId').equals(w.id).first();
      out.push({ ...w, cardio: c });
    }
  }
  return out.sort((a, b) => (a.startedAt || '').localeCompare(b.startedAt || ''));
}

/* ---------- 유산소 ---------- */
export async function saveCardio({ workoutId, date, data }) {
  const t = nowIso();
  return db.transaction('rw', db.workouts, db.cardio, async () => {
    if (workoutId) {
      const c = await db.cardio.where('workoutId').equals(workoutId).first();
      await db.cardio.update(c.id, { ...data, updatedAt: t });
      await touchWorkout(workoutId, { endedAt: t });
      return workoutId;
    }
    const w = await createWorkout('cardio', date);
    await touchWorkout(w.id, { endedAt: t });
    await db.cardio.add({ id: uuid(), workoutId: w.id, date, ...data, createdAt: t, updatedAt: t });
    return w.id;
  });
}

/* ---------- 저장 공간 보호 ---------- */
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch {}
}
