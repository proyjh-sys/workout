// 백업(JSON) · 복원 · CSV 내보내기
import { db, TABLES, SCHEMA_VERSION, useLive, setSetting } from './db.js';
import { todayStr, toDateStr, daysBetween, nowIso, partLabel, cardioLabel, rpeLabel, toUnit } from './util.js';
import { toast } from './ui.js';

export const APP_ID = 'workout-log';

/**
 * 아이폰 공유 메뉴로 파일 보내기 (공유 기능이 없는 기기는 다운로드)
 * 공유가 실제로 끝났을 때만 onDone()을 부릅니다.
 */
export async function shareFile(file, onDone = () => {}) {
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name });
      await onDone();
      return true;
    } catch (e) {
      if (e.name === 'AbortError') return false; // 사용자가 취소
      // 아이폰이 "버튼을 다시 눌러 달라"고 거절한 경우: 한 번 더 누르게 안내
      toast('파일이 준비됐어요. 아래 버튼을 눌러 저장하세요', {
        duration: 20000,
        action: { label: '저장하기', run: () => navigator.share({ files: [file], title: file.name }).then(onDone).catch(() => {}) },
      });
      return false;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  await onDone();
  return true;
}

export async function buildBackup() {
  const data = {};
  for (const t of TABLES) data[t] = await db.table(t).toArray();
  return { app: APP_ID, schemaVersion: SCHEMA_VERSION, exportedAt: nowIso(), data };
}

export async function exportBackup() {
  const backup = await buildBackup();
  const file = new File([JSON.stringify(backup, null, 1)], `운동기록-백업-${todayStr()}.json`, { type: 'application/json' });
  return shareFile(file, () => setSetting('lastBackupAt', nowIso()));
}

/** 백업 파일 내용 검사 → 요약 반환 (문제 있으면 오류) */
export function inspectBackup(text) {
  let obj;
  try { obj = JSON.parse(text); } catch { throw new Error('JSON 파일을 읽을 수 없어요.'); }
  if (obj?.app !== APP_ID || !obj.data) throw new Error('이 앱의 백업 파일이 아니에요.');
  if (obj.schemaVersion > SCHEMA_VERSION) throw new Error('더 새로운 버전 앱에서 만든 백업이에요. 앱을 먼저 업데이트해 주세요.');
  return {
    obj,
    exportedAt: obj.exportedAt,
    workouts: obj.data.workouts?.length ?? 0,
  };
}

/** 현재 데이터를 백업 내용으로 교체 */
export async function restoreBackup(obj) {
  const data = migrateBackup(obj).data;
  await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
    // 마지막 백업 날짜는 복원 후에도 유지 (복원한 백업 시각보다 최신이면)
    const keep = (await db.settings.get('lastBackupAt'))?.value;
    for (const t of TABLES) {
      await db.table(t).clear();
      if (Array.isArray(data[t]) && data[t].length) await db.table(t).bulkPut(data[t]);
    }
    const restored = (await db.settings.get('lastBackupAt'))?.value;
    const best = [keep, restored, obj.exportedAt].filter(Boolean).sort().pop();
    if (best) await db.settings.put({ key: 'lastBackupAt', value: best, updatedAt: nowIso() });
  });
}

// 옛날 버전 백업을 현재 구조로 바꾸는 곳 (구조가 바뀌면 여기에 추가)
function migrateBackup(obj) {
  return obj;
}

export function useBackupStatus() {
  return useLive(async () => {
    const row = await db.settings.get('lastBackupAt');
    const lastAt = row?.value ?? null;
    const firstWorkout = await db.workouts.orderBy('date').first();
    const today = todayStr();
    let days = null;
    let needReminder = false;
    if (lastAt) {
      days = daysBetween(toDateStr(new Date(lastAt)), today);
      needReminder = days >= 7;
    } else if (firstWorkout) {
      needReminder = daysBetween(firstWorkout.date, today) >= 7;
    }
    return { lastAt, days, needReminder, hasData: !!firstWorkout };
  }, []);
}

/* ---------- CSV ---------- */
const esc = (v) => {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function exportCSV() {
  const exercises = Object.fromEntries((await db.exercises.toArray()).map((e) => [e.id, e]));
  const workouts = await db.workouts.toArray();
  const entries = Object.fromEntries((await db.entries.toArray()).map((e) => [e.id, e]));
  const sets = await db.sets.toArray();
  const cardio = await db.cardio.toArray();
  const wmap = Object.fromEntries(workouts.map((w) => [w.id, w]));

  const head = ['날짜', '종류', '운동', '부위', '세트', '무게(kg)', '입력 무게', '단위', '횟수', 'RPE', '강도',
    '시간(분)', '거리(km)', '평균심박', '칼로리', '체중(kg)', '허리(cm)', 'BMI', '수면(1~5)', '피로(1~5)', '통증', '메모'];
  const blank = (n) => Array(n).fill('');
  const rows = [];
  for (const s of sets.filter((s) => s.done)) {
    const ex = exercises[s.exerciseId];
    const u = s.unit || 'kg';
    rows.push({
      sort: s.date + '1' + (wmap[s.workoutId]?.startedAt || '') + String(entries[s.entryId]?.order ?? 0).padStart(3, '0') + String(s.order).padStart(3, '0'),
      cells: [s.date, '근력', ex?.name, ex ? partLabel(ex.part) : '', s.order + 1, Math.round(s.weightKg * 100) / 100, toUnit(s.weightKg, u), u,
        s.reps + (ex?.repUnit === 'sec' ? '초' : ''), s.rpe, rpeLabel(s.rpe), ...blank(10), entries[s.entryId]?.note],
    });
  }
  for (const c of cardio) {
    rows.push({
      sort: c.date + '1' + (wmap[c.workoutId]?.startedAt || ''),
      cells: [c.date, '유산소', cardioLabel(c.kind), '', '', '', '', '', '', c.rpe, rpeLabel(c.rpe), c.durationMin, c.distanceKm, c.avgHr, c.kcal, ...blank(6), c.note],
    });
  }
  for (const b of await db.body.toArray()) {
    rows.push({ sort: b.date + '0', cells: [b.date, '신체', ...blank(13), b.weightKg ?? '', b.waistCm ?? '', b.bmi ?? '', '', '', '', ''] });
  }
  for (const c of await db.conditions.toArray()) {
    const pains = (c.pains || []).map((p) => `${p.part}(${['', '약함', '중간', '심함'][p.level]})`).join(' ');
    rows.push({ sort: c.date + '0', cells: [c.date, '컨디션', ...blank(16), c.sleep ?? '', c.fatigue ?? '', pains, c.note ?? ''] });
  }
  rows.sort((a, b) => a.sort.localeCompare(b.sort));
  const csv = '﻿' + [head, ...rows.map((r) => r.cells)].map((r) => r.map(esc).join(',')).join('\n');
  const file = new File([csv], `운동기록-${todayStr()}.csv`, { type: 'text/csv' });
  return shareFile(file);
}
