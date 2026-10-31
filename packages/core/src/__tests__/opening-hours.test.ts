import { describe, expect, it } from 'vitest';

import { formatInterval, minutesOutside, openingOn, parseOpeningHours } from '../engine/opening-hours.ts';

/** Przedziały dnia jako tekst „09:00–18:00” — czytelniej w asercjach. */
function on(raw: string, date: string, ctx: Parameters<typeof openingOn>[2] = {}) {
  const hours = parseOpeningHours(raw);
  if (hours === null) throw new Error(`Nie sparsowano: ${raw}`);
  const opening = openingOn(hours, date, ctx);
  return { hours: opening.intervals.map(formatInterval), approximate: opening.approximate };
}

// 2026-12-26 to sobota, 2026-12-28 poniedziałek, 2026-12-27 niedziela.
const SAT = '2026-12-26';
const SUN = '2026-12-27';
const MON = '2026-12-28';

describe('godziny otwarcia OSM', () => {
  it('dni tygodnia i nadpisywanie regułą po średniku', () => {
    const raw = 'Mo-Sa 09:00-18:00; Su 10:30-14:00';
    expect(on(raw, MON).hours).toEqual(['09:00–18:00']);
    expect(on(raw, SAT).hours).toEqual(['09:00–18:00']);
    expect(on(raw, SUN).hours).toEqual(['10:30–14:00']);
  });

  it('przerwa w środku dnia i lista dni', () => {
    expect(on('Mo,We,Fr 10:00-13:00,14:00-18:00', MON).hours).toEqual(['10:00–13:00', '14:00–18:00']);
    expect(on('Mo,We,Fr 10:00-13:00,14:00-18:00', SAT).hours).toEqual([]);
  });

  it('zakres dni przez weekend i dzień bez reguły jest zamknięty', () => {
    expect(on('Fr-Mo 12:00-20:00', SUN).hours).toEqual(['12:00–20:00']);
    expect(on('Fr-Mo 12:00-20:00', '2026-12-29').hours).toEqual([]);
  });

  it('przez północ: końcówka nocy trafia do następnego dnia', () => {
    expect(on('Fr-Sa 20:00-02:00', SAT).hours).toEqual(['00:00–02:00', '20:00–02:00']);
    expect(on('Fr-Sa 20:00-02:00', SUN).hours).toEqual(['00:00–02:00']);
  });

  it('24/7, off, zamknięte i dni bez godzin', () => {
    expect(on('24/7', MON).hours).toEqual(['00:00–24:00']);
    expect(on('Mo-Fr 09:00-17:00; Sa,Su off', SUN).hours).toEqual([]);
    expect(on('Mo-Su 08:00-20:00; Dec 25 off', '2026-12-25').hours).toEqual([]);
    expect(on('Sa', SAT).hours).toEqual(['00:00–24:00']);
  });

  it('sezony: miesiące, zakres dat i zakres przez Nowy Rok', () => {
    const seasonal = 'Apr-Oct 09:00-19:00; Nov-Mar 09:00-17:00';
    expect(on(seasonal, '2026-07-15').hours).toEqual(['09:00–19:00']);
    expect(on(seasonal, '2026-12-26').hours).toEqual(['09:00–17:00']);
    expect(on(seasonal, '2027-01-05').hours).toEqual(['09:00–17:00']);
    expect(on('May 15-Sep 15 10:00-18:00', '2026-09-16').hours).toEqual([]);
    expect(on('Dec 24-26 off; Mo-Su 10:00-16:00', SAT).hours).toEqual(['10:00–16:00']);
    expect(on('Mo-Su 10:00-16:00; Dec 24-26 off', SAT).hours).toEqual([]);
  });

  it('miesiąc z godziną nie myli godziny z dniem miesiąca', () => {
    expect(on('Apr 09:00-18:00', '2026-04-10').hours).toEqual(['09:00–18:00']);
  });

  it('święta: PH off i PH jako alternatywa dnia; bez wiedzy o święcie — przybliżone', () => {
    const raw = 'Mo-Sa 10:00-18:00; PH off';
    expect(on(raw, MON, { publicHoliday: true })).toEqual({ hours: [], approximate: false });
    expect(on(raw, MON, { publicHoliday: false })).toEqual({ hours: ['10:00–18:00'], approximate: false });
    expect(on(raw, MON)).toEqual({ hours: ['10:00–18:00'], approximate: true });
    expect(on('Mo-Sa 10:00-18:00; Su,PH 11:00-15:00', MON, { publicHoliday: true }).hours).toEqual(['11:00–15:00']);
    expect(on('Mo-Sa 10:00-18:00, PH off', MON, { publicHoliday: true }).hours).toEqual([]);
  });

  it('słońce: wschód–zachód z przesunięciem; bez współrzędnych przybliżone', () => {
    const sun = { sunrise: 7 * 60 + 40, sunset: 15 * 60 + 50 };
    expect(on('sunrise-sunset', MON, { sun })).toEqual({ hours: ['07:40–15:50'], approximate: false });
    expect(on('Mo-Su 08:00-(sunset-01:00)', MON, { sun }).hours).toEqual(['08:00–14:50']);
    expect(on('sunrise-sunset', MON).approximate).toBe(true);
  });

  it('otwarty koniec, n-ty dzień tygodnia i unknown są przybliżone', () => {
    expect(on('Mo-Su 18:00+', MON)).toEqual({ hours: ['18:00–24:00'], approximate: true });
    expect(on('Su[1] 10:00-12:00', SUN).approximate).toBe(true);
    expect(on('Mo-Fr 09:00-17:00 unknown', MON).approximate).toBe(true);
  });

  it('półpauza i komentarz w cudzysłowie', () => {
    expect(on('Mo-Fr 09:00–17:00 "w sezonie dłużej"', MON).hours).toEqual(['09:00–17:00']);
  });

  it('tekst spoza składni OSM → null (silnik weźmie go jako przybliżony)', () => {
    expect(parseOpeningHours('09:00–19:00, zimą do 17:00')).toBeNull();
    expect(parseOpeningHours('codziennie')).toBeNull();
    expect(parseOpeningHours('')).toBeNull();
  });

  it('minuty poza godzinami — najlepiej pasujący przedział', () => {
    const opening = { intervals: [[600, 780], [840, 1080]] as [number, number][], approximate: false };
    expect(minutesOutside(opening, 620, 700)).toBe(0);
    expect(minutesOutside(opening, 760, 820)).toBe(40);
    expect(minutesOutside({ intervals: [], approximate: false }, 600, 660)).toBe(60);
  });
});
