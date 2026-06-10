// DB stores money as integer centavos (BIGINT); all JS code works in BRL floats.
// Convert at the DB boundary — never inside business logic.

export const toDb = (brl: number): number => Math.round(brl * 100);
export const fromDb = (centavos: number): number => centavos / 100;
