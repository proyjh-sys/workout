// 증량 제안, 개인 최고 기록(PR), 추정 1RM 계산
import Dexie from './vendor/dexie.mjs';
import { db, getLastPerformance } from './db.js';

/** Epley 공식: 1RM = 무게 × (1 + 횟수/30) */
export function epley(weightKg, reps) {
  if (!weightKg || !reps) return 0;
  if (reps === 1) return weightKg;
  return weightKg * (1 + reps / 30);
}

export const round1 = (n) => Math.round(n * 10) / 10;
const roundTo = (n, step) => Math.round(n / step) * step;

export const DEFAULT_TARGET_REPS = 10;

/**
 * 증량 제안: 지난번에 모든 세트가 목표 횟수를 채웠으면 '최고 무게 + 증량 폭'을 제안
 * 목표 횟수는 지난번 루틴 목표 → 이번 루틴 목표 → 운동별 기본 목표(기본 10회) 순으로 사용
 */
export async function progressionFor(entry, ex, workout) {
  if (!ex || ex.repUnit === 'sec') return null;
  const last = await getLastPerformance(entry.exerciseId, workout.id, workout.date);
  if (!last || !last.sets.length) return null;
  const lastEntry = await db.entries.get(last.sets[0].entryId);
  const target = lastEntry?.targetReps ?? entry.targetReps ?? ex.targetReps ?? DEFAULT_TARGET_REPS;
  const targetSets = lastEntry?.targetSets ?? 0;
  const sets = last.sets;
  if (sets.length < targetSets) return null;
  const top = Math.max(...sets.map((s) => s.weightKg || 0));
  if (top <= 0) return null; // 맨몸 운동은 제안하지 않음
  if (!sets.every((s) => s.reps >= target)) return null;
  const inc = ex.incrementKg || 2.5;
  return { fromKg: top, toKg: roundTo(top + inc, 0.25), target, lastDate: last.date };
}

/** 세트 완료 시 개인 최고 기록인지 확인 (첫 기록은 제외) */
export async function checkPR(set, ex) {
  const prev = await db.sets
    .where('[exerciseId+date]')
    .between([set.exerciseId, Dexie.minKey], [set.exerciseId, Dexie.maxKey])
    .filter((s) => s.done && s.id !== set.id)
    .toArray();
  // 처음 하는 운동(예전 운동일의 기록이 없음)은 알리지 않음
  if (!prev.some((s) => s.workoutId !== set.workoutId)) return null;
  const name = ex?.name ?? '';
  if ((set.weightKg || 0) > 0) {
    const maxW = Math.max(...prev.map((s) => s.weightKg || 0));
    if (set.weightKg > maxW) return { kind: '최고 무게', text: `${name} ${set.weightKg}kg` };
    const maxE = Math.max(...prev.map((s) => epley(s.weightKg, s.reps)));
    const e = epley(set.weightKg, set.reps);
    if (e > maxE + 0.05) return { kind: '추정 1RM', text: `${name} ${round1(e)}kg` };
  } else {
    const bw = prev.filter((s) => !s.weightKg);
    if (!bw.length) return null;
    const maxR = Math.max(...bw.map((s) => s.reps || 0));
    if (set.reps > maxR) return { kind: '최고 횟수', text: `${name} ${set.reps}${ex?.repUnit === 'sec' ? '초' : '회'}` };
  }
  return null;
}

/** 가장 많이 나온 값 (같으면 큰 값) */
export function mode(nums) {
  const c = {};
  for (const n of nums) c[n] = (c[n] || 0) + 1;
  return Number(Object.keys(c).sort((a, b) => c[b] - c[a] || b - a)[0]);
}
