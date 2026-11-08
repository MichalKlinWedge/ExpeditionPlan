import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { GuideContent } from '../guide.ts';
import { TripDocument } from '../schemas/trip-document.ts';
import { applyShowDraft, audioFits, droppedAudio, editShowText, narrationHash, readingMs, scenesToRecord, setShowAudio, ShowScript, showBrief, showScenes } from '../trip-show.ts';

const fixture = (slug: string) => TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL(`../../../../fixtures/plans/${slug}/plan.json`, import.meta.url)), 'utf8')));

const guide = (title: string, image: string): GuideContent => ({
  summary: `${title} to miejsce, które warto zobaczyć.`,
  facts: [],
  tips: [],
  images: [{ url: `https://upload.wikimedia.org/${image}.jpg`, thumbUrl: `https://upload.wikimedia.org/thumb/${image}.jpg`, title: `File:${image}.jpg`, author: 'Autor', license: 'CC BY-SA 4.0', sourceUrl: `https://commons.wikimedia.org/wiki/File:${image}.jpg` }],
  article: { title, url: `https://pl.wikipedia.org/wiki/${encodeURIComponent(title)}`, lang: 'pl', site: 'wikipedia' },
});

const base = { done: [], skipRefs: [], guideOf: () => null, today: '2020-01-01' };

describe('sceny pokazu', () => {
  it('wstęp, dzień po dniu i zakończenie dla każdego wyjazdu wzorcowego', () => {
    for (const slug of ['barcelona', 'chatka', 'dinara', 'gruzja', 'maroko']) {
      const doc = fixture(slug);
      const { scenes } = showScenes(doc, base);
      expect(scenes[0]!.key).toBe('intro');
      expect(scenes.at(-1)!.key).toBe('outro');
      expect(scenes.filter((scene) => scene.kind === 'day')).toHaveLength(doc.days.length);
      expect(new Set(scenes.map((scene) => scene.key)).size).toBe(scenes.length);
    }
  });

  it('zdjęcia z opisów miejsc trafiają do dnia raz i do podziękowań', () => {
    const doc = fixture('maroko');
    const sight = doc.items.find((item) => item.kind === 'visit' && item.dayRef !== undefined)!;
    const { scenes, credits } = showScenes(doc, { ...base, guideOf: (item) => (item.title === sight.title ? guide(sight.title, 'Foto') : null) });
    const withImage = scenes.filter((scene) => scene.images.length > 0);
    expect(withImage).toHaveLength(1);
    expect(withImage[0]!.images[0]!.url).toContain('/thumb/');
    expect(withImage[0]!.facts.some((fact) => fact.includes('warto zobaczyć'))).toBe(true);
    expect(credits.images).toEqual([expect.objectContaining({ author: 'Autor', license: 'CC BY-SA 4.0' })]);
    expect(credits.articles).toHaveLength(1);
  });

  it('po wyjeździe: zdjęcia z dziennika przed zdjęciami miejsc, wpisy w faktach, czas przeszły w danych dla AI', () => {
    const doc = fixture('maroko');
    const day = [...doc.days].sort((a, b) => a.date.localeCompare(b.date))[0]!;
    const input = { ...base, today: '2099-01-01', journal: [{ dayRef: day.ref, body: 'Dotarliśmy\nzmęczeni', photoUrl: 'https://example.com/a.jpg' }] };
    const { scenes } = showScenes(doc, input);
    const scene = scenes.find((each) => each.key === `day:${day.ref}`)!;
    expect(scene.images[0]).toEqual({ url: 'https://example.com/a.jpg', caption: 'Dotarliśmy' });
    expect(scene.facts).toContain('Wpis z dziennika: Dotarliśmy\nzmęczeni');
    expect(showBrief(doc, scenes, '2099-01-01').after).toBe(true);
    expect(showBrief(doc, scenes, '2000-01-01').after).toBe(false);
  });
});

describe('scenariusz lektora', () => {
  const scenes = [
    { key: 'intro', kind: 'intro' as const, heading: '', routeRefs: [], images: [], facts: [] },
    { key: 'day:a', kind: 'day' as const, heading: '', routeRefs: [], images: [], facts: [] },
    { key: 'outro', kind: 'outro' as const, heading: '', routeRefs: [], images: [], facts: [] },
  ];

  it('szkic AI nie nadpisuje tekstu poprawionego ręcznie i pomija obce klucze', () => {
    const audio = { path: 'x', hash: narrationHash('stary', 'Sulafat', 'm'), model: 'm', durationMs: 1 };
    const script = ShowScript.parse({ scenes: [{ key: 'intro', text: 'Mój wstęp', edited: true }, { key: 'day:a', text: 'stary', audio }] });
    expect(audioFits(script.scenes[1]!, 'Sulafat')).toBe(true);
    const next = applyShowDraft(script, scenes, { scenes: [{ key: 'intro', text: 'AI wstęp' }, { key: 'day:a', text: ' AI dzień ' }, { key: 'day:zz', text: 'obcy' }] });
    expect(next.scenes).toEqual([{ key: 'intro', text: 'Mój wstęp', edited: true }, { key: 'day:a', text: 'AI dzień', audio }]);
    expect(audioFits(next.scenes[1]!, 'Sulafat')).toBe(false);
  });

  it('poprawka ręczna zostawia stare nagranie do usunięcia; pusty tekst usuwa scenę i jej plik', () => {
    const audio = { path: 'x', hash: 'h', model: 'm', durationMs: 1 };
    const script = ShowScript.parse({ scenes: [{ key: 'intro', text: 'a', audio }] });
    expect(editShowText(script, 'intro', ' b ').scenes).toEqual([{ key: 'intro', text: 'b', edited: true, audio }]);
    expect(editShowText(script, 'intro', 'a')).toBe(script);
    expect(editShowText(script, 'intro', '  ').scenes).toEqual([]);
    expect(droppedAudio(script, editShowText(script, 'intro', ''))).toEqual(['x']);
    expect(droppedAudio(script, editShowText(script, 'intro', 'b'))).toEqual([]);
    expect(editShowText(script, 'outro', 'koniec').scenes.map((scene) => scene.key)).toEqual(['intro', 'outro']);
  });

  it('do nagrania idą sceny bez pasującego nagrania; zmiana głosu nagrywa wszystko od nowa', () => {
    const hash = narrationHash('a', 'Sulafat', 'm');
    const script = ShowScript.parse({ scenes: [{ key: 'intro', text: 'a', audio: { path: 'p', hash, model: 'm', durationMs: 1000 } }, { key: 'day:a', text: 'b' }] });
    expect(scenesToRecord(script)).toEqual(['day:a']);
    expect(scenesToRecord({ ...script, voice: 'Charon' })).toEqual(['intro', 'day:a']);
    expect(narrationHash('a ', 'Sulafat', 'm')).toBe(hash);
    expect(narrationHash('b', 'Sulafat', 'm')).not.toBe(hash);
  });

  it('nagranie nie trafia do sceny, której tekst zmienił się w trakcie nagrywania', () => {
    const script = ShowScript.parse({ scenes: [{ key: 'intro', text: 'nowy' }] });
    const audio = { path: 'p', hash: 'h', model: 'm', durationMs: 1000 };
    expect(setShowAudio(script, 'intro', audio, 'stary').scenes[0]!.audio).toBeUndefined();
    expect(setShowAudio(script, 'intro', audio, 'nowy').scenes[0]!.audio).toEqual(audio);
  });

  it('czas sceny bez nagrania', () => {
    expect(readingMs('krótko')).toBe(5000);
    expect(readingMs('x'.repeat(150))).toBe(10_000);
  });
});
