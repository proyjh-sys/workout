// 공통 도우미 함수 (날짜, ID, 숫자 표시)

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export const nowIso = () => new Date().toISOString();

const pad = (n) => String(n).padStart(2, '0');

/** Date → 'YYYY-MM-DD' (기기 현지 시간 기준) */
export function toDateStr(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export const todayStr = () => toDateStr(new Date());

/** 'YYYY-MM-DD' → Date (현지 자정) */
export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s, n) {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

export function daysBetween(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / 86400000);
}

const WD = ['일', '월', '화', '수', '목', '금', '토'];
export function fmtDate(s, withYear = false) {
  const d = parseDate(s);
  const y = withYear ? `${d.getFullYear()}년 ` : '';
  return `${y}${d.getMonth() + 1}월 ${d.getDate()}일 (${WD[d.getDay()]})`;
}
export function fmtShort(s) {
  const d = parseDate(s);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 62.5 → "62.5", 60 → "60" */
export function fmtNum(n) {
  if (n == null || n === '') return '';
  return String(Math.round(Number(n) * 100) / 100);
}

/* ---------- 무게 단위 (kg / lb) ----------
 * 저장은 항상 weightKg(정확한 kg 값) + unit(입력한 단위)으로 합니다.
 * 화면에는 입력한 단위로 보여 줍니다. */
export const LB = 0.45359237;
export const toUnit = (kg, unit) => (unit === 'lb' ? Math.round((kg / LB) * 100) / 100 : kg);
export const fromUnit = (v, unit) => (unit === 'lb' ? v * LB : v);
/** 단위를 바꿀 때: 같은 무게를 새 단위로 바꾸고 가까운 값(kg 0.5, lb 2.5)으로 맞춤 */
export function convertRounded(kg, unit) {
  const step = unit === 'lb' ? 2.5 : 0.5;
  return Math.round(toUnit(kg, unit) / step) * step;
}

/** 무게 표시. unit을 주면 그 단위로 ('맨몸' 포함) */
export function fmtWeight(kg, unit = 'kg') {
  return Number(kg) === 0 ? '맨몸' : `${fmtNum(toUnit(Number(kg), unit))}${unit}`;
}
/** 세트 무게 표시 (세트에 저장된 단위로) */
export const fmtSetWeight = (s) => fmtWeight(s.weightKg, s.unit || 'kg');

export const PARTS = [
  { id: 'chest', label: '가슴' },
  { id: 'back', label: '등' },
  { id: 'legs', label: '하체' },
  { id: 'shoulders', label: '어깨' },
  { id: 'arms', label: '팔' },
  { id: 'core', label: '코어' },
];
export const partLabel = (id) => PARTS.find((p) => p.id === id)?.label ?? id;

// 강도 버튼 → RPE 값
export const INTENSITY = [
  { label: '쉬움', rpe: 6 },
  { label: '보통', rpe: 7.5 },
  { label: '힘듦', rpe: 9 },
  { label: '한계', rpe: 10 },
];
export function rpeLabel(rpe) {
  if (rpe == null) return '';
  let best = INTENSITY[0];
  for (const i of INTENSITY) if (Math.abs(i.rpe - rpe) < Math.abs(best.rpe - rpe)) best = i;
  return best.label;
}

export const CARDIO_KINDS = [
  { id: 'walk', label: '걷기' },
  { id: 'run', label: '달리기' },
  { id: 'bike', label: '실내자전거' },
  { id: 'swim', label: '수영' },
  { id: 'other', label: '기타' },
];
export const cardioLabel = (id) => CARDIO_KINDS.find((k) => k.id === id)?.label ?? id;

export function vibrate() {
  try { navigator.vibrate?.(15); } catch {}
}
