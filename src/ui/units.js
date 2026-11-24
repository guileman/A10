// Conversiones de SI a unidades de aviación (solo capa de UI).
export const MS_TO_KT = 1 / 0.514444;
export const M_TO_FT = 1 / 0.3048;
export const MS_TO_FPM = 60 / 0.3048;
export const PA_TO_HPA = 0.01;
export const mToFt = (m) => m * M_TO_FT;
export const msToKt = (v) => v * MS_TO_KT;
export const msToFpm = (v) => v * MS_TO_FPM;
export const rad2deg = (r) => (r * 180) / Math.PI;
export const finite = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
