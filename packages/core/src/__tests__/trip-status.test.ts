import { describe, expect, it } from 'vitest';

import { isPostponed, tripSections } from '../trip-status.ts';

const trip = (id: string, start_date: string, end_date: string, status: string | null = 'planning') => ({ id, start_date, end_date, status });

describe('wyjazdy odłożone', () => {
  it('odłożony jest w swojej sekcji bez względu na datę: ani przed nami, ani w archiwum', () => {
    const { ahead, postponed, archive } = tripSections(
      [
        trip('stary', '2026-01-01', '2026-01-05'),
        trip('nie-wypalil', '2026-03-01', '2026-03-05', 'postponed'),
        trip('trwa', '2026-11-01', '2026-11-10'),
        trip('kiedys', '2027-05-01', '2027-05-05', 'postponed'),
        trip('nowszy', '2026-06-01', '2026-06-05'),
        trip('bez-statusu', '2026-12-01', '2026-12-05', null),
      ],
      '2026-11-04',
    );
    expect(ahead.map((each) => each.id)).toEqual(['trwa', 'bez-statusu']);
    expect(postponed.map((each) => each.id)).toEqual(['nie-wypalil', 'kiedys']);
    expect(archive.map((each) => each.id)).toEqual(['nowszy', 'stary']);
  });

  it('szkice AI są tylko w swojej sekcji, także po terminie i odłożone', () => {
    const draft = (id: string, start: string, end: string, status?: string) => ({ ...trip(id, start, end, status), title: `Szkic AI: ${id}` });
    const { ahead, postponed, archive, drafts } = tripSections(
      [
        { ...trip('izery', '2026-12-11', '2026-12-13'), title: 'Zimowe Izery' },
        draft('przed-nami', '2026-12-11', '2026-12-13'),
        draft('po-terminie', '2026-01-01', '2026-01-05'),
        draft('odlozony', '2026-03-01', '2026-03-05', 'postponed'),
      ],
      '2026-11-04',
    );
    expect(ahead.map((each) => each.id)).toEqual(['izery']);
    expect(postponed).toEqual([]);
    expect(archive).toEqual([]);
    expect(drafts.map((each) => each.id)).toEqual(['po-terminie', 'odlozony', 'przed-nami']);
  });

  it('rozpoznaje tylko status „postponed”', () => {
    expect(isPostponed({ status: 'postponed' })).toBe(true);
    expect(isPostponed({ status: 'archived' })).toBe(false);
    expect(isPostponed({ status: null })).toBe(false);
    expect(isPostponed({})).toBe(false);
  });
});
