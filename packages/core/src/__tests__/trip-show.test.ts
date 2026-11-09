import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { GuideContent } from '../guide.ts';
import { TripDocument } from '../schemas/trip-document.ts';
import { applyShowDraft, audioFits, droppedAudio, editShowText, isShowMusicPath, narrationHash, readingMs, scenesToRecord, setShowAudio, ShowScript, showBrief, showMusicFile, showScenes } from '../trip-show.ts';

const fixture = (slug: string) => TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL(`../../../../fixtures/plans/${slug}/plan.json`, import.meta.url)), 'utf8')));

const guide = (title: string, image: string): GuideContent => ({
  summary: `${title} to miejsce, które warto zobaczyć.`,
  facts: [],
  tips: [],
  images: [{ url: `https://upload.wikimedia.org/${image}.jpg`, thumbUrl: `https://upload.wikimedia.org/thumb/${image}.jpg`, title: `File:${image}.jpg`, author: 'Autor', license: 'CC BY-SA 4.0', sourceUrl: `https://commons.wikimedia.org/wiki/File:${image}.jpg` }],
  article: { title, url: `https://pl.wikipedia.org/wiki/${encodeURIComponent(title)}`, lang: 'pl', site: 'wikipedia' },
});

const base = { done: [], skipRefs: [], guideOf: () => null, kind: 'preview' as const };

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

  it('film: zdjęcia z dziennika przed zdjęciami miejsc, wpisy w faktach, czas przeszły w danych dla AI', () => {
    const doc = fixture('maroko');
    const day = [...doc.days].sort((a, b) => a.date.localeCompare(b.date))[0]!;
    const journal = [
      { dayRef: day.ref, body: 'Dotarliśmy\nzmęczeni', photoUrl: 'https://example.com/a.jpg' },
      { body: 'Po powrocie: było warto', photoUrl: 'https://example.com/b.jpg' },
    ];
    const { scenes } = showScenes(doc, { ...base, kind: 'film', journal });
    const scene = scenes.find((each) => each.key === `day:${day.ref}`)!;
    expect(scene.images[0]).toEqual({ url: 'https://example.com/a.jpg', caption: 'Dotarliśmy' });
    expect(scene.facts).toContain('Wpis z dziennika: Dotarliśmy\nzmęczeni');
    const outro = scenes.at(-1)!;
    expect(outro.images).toEqual([{ url: 'https://example.com/b.jpg', caption: 'Po powrocie: było warto' }]);
    expect(outro.facts).toContain('Wpis z dziennika: Po powrocie: było warto');
    expect(showBrief(doc, scenes, 'film').after).toBe(true);
  });

  it('zapowiedź: bez dziennika i w czasie przyszłym, także po wyjeździe', () => {
    const doc = fixture('maroko');
    const day = [...doc.days].sort((a, b) => a.date.localeCompare(b.date))[0]!;
    const { scenes } = showScenes(doc, { ...base, journal: [{ dayRef: day.ref, body: 'Dotarliśmy', photoUrl: 'https://example.com/a.jpg' }] });
    expect(scenes.flatMap((scene) => scene.images)).toEqual([]);
    expect(scenes.flatMap((scene) => scene.facts).some((fact) => fact.startsWith('Wpis z dziennika'))).toBe(false);
    expect(showBrief(doc, scenes, 'preview').after).toBe(false);
  });

  it('film: dzień z wieloma zdjęciami z dziennika bierze ich do 10', () => {
    const doc = fixture('maroko');
    const day = [...doc.days].sort((a, b) => a.date.localeCompare(b.date))[0]!;
    const journal = Array.from({ length: 12 }, (_, at) => ({ dayRef: day.ref, body: `Zdjęcie ${at}`, photoUrl: `https://example.com/${at}.jpg` }));
    const { scenes } = showScenes(doc, { ...base, kind: 'film', journal });
    expect(scenes.find((each) => each.key === `day:${day.ref}`)!.images).toHaveLength(10);
  });
});

describe('ujęcia sceny dnia', () => {
  it('trasy piesze z liczbami, liczby dnia i najważniejsze punkty na kartę', () => {
    for (const slug of ['chatka', 'dinara', 'gruzja', 'maroko', 'barcelona']) {
      const doc = fixture(slug);
      const { scenes } = showScenes(doc, base);
      for (const scene of scenes.filter((each) => each.kind === 'day')) {
        expect(scene.points.length).toBeLessThanOrEqual(7);
        for (const walk of scene.walks) {
          const item = doc.items.find((each) => each.ref === walk.refs[0])!;
          expect(item.kind === 'transport' || item.kind === 'activity' || item.activity?.trackRef !== undefined).toBe(true);
          expect(['Trasa piesza', 'Rowerem', 'Trasa']).toContain(walk.label);
        }
      }
    }
    const chatka = showScenes(fixture('chatka'), base).scenes.filter((scene) => scene.kind === 'day');
    expect(chatka[1]!.walks.map((walk) => walk.facts)).toContain('4,2 km · ↑ 170 m · 1 h 30 min');
    // „Zejście tą samą drogą” idzie śladem wejścia: bez drugiego ujęcia.
    expect(chatka[1]!.walks.map((walk) => walk.title)).not.toContain('Zejście tą samą drogą');
    expect(chatka[1]!.stats).toEqual(['autem 130 km', 'pieszo 10 km · ↑ 170 m']);
    // Trekking zapisany jako aktywność z kilometrami (bez śladu GPX) też jest trasą, z miejscem do przybliżenia.
    const gruzja = showScenes(fixture('gruzja'), base).scenes.filter((scene) => scene.kind === 'day');
    expect(gruzja.some((scene) => scene.walks.some((walk) => walk.label === 'Trasa' && walk.at !== undefined))).toBe(true);
  });
});

describe('scenariusz lektora', () => {
  const scenes = [
    { key: 'intro', kind: 'intro' as const, heading: '', routeRefs: [], images: [], stats: [], points: [], walks: [], facts: [] },
    { key: 'day:a', kind: 'day' as const, heading: '', routeRefs: [], images: [], stats: [], points: [], walks: [], facts: [] },
    { key: 'outro', kind: 'outro' as const, heading: '', routeRefs: [], images: [], stats: [], points: [], walks: [], facts: [] },
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

  it('podkład: zmieniony albo usunięty plik idzie do usunięcia, nagrania scen zostają', () => {
    const audio = { path: 'x', hash: 'h', model: 'm', durationMs: 1 };
    const script = ShowScript.parse({ scenes: [{ key: 'intro', text: 'a', audio }], music: { path: 't/muzyka-a.mp3', name: 'a.mp3' } });
    expect(script.music?.volume).toBe(0.5);
    expect(script.music?.skipS).toBe(0);
    expect(droppedAudio(script, { ...script, music: { path: 't/muzyka-b.mp3', name: 'b.mp3', volume: 0.5, skipS: 0 } })).toEqual(['t/muzyka-a.mp3']);
    const { music: _, ...without } = script;
    expect(droppedAudio(script, without)).toEqual(['t/muzyka-a.mp3']);
    expect(droppedAudio(script, { ...script, music: { ...script.music!, volume: 0.2 } })).toEqual([]);
  });

  it('plik podkładu: typ z przeglądarki albo rozszerzenie, inne formaty odpadają', () => {
    expect(showMusicFile('t', { name: 'Utwór.MP3', type: 'audio/mpeg' }, 'k1')).toEqual({ path: 't/muzyka-k1.mp3', contentType: 'audio/mpeg' });
    expect(showMusicFile('t', { name: 'a.m4a', type: 'audio/x-m4a' }, 'k1')).toEqual({ path: 't/muzyka-k1.m4a', contentType: 'audio/mp4' });
    expect(showMusicFile('t', { name: 'a.ogg', type: '' }, 'k1')).toEqual({ path: 't/muzyka-k1.ogg', contentType: 'audio/ogg' });
    expect(showMusicFile('t', { name: 'a.flac', type: 'audio/flac' }, 'k1')).toBeNull();
    expect(showMusicFile('t', { name: 'film.mp4', type: 'video/mp4' }, 'k1')).toBeNull();
    expect(isShowMusicPath('t', 't/muzyka-k1.mp3')).toBe(true);
    expect(isShowMusicPath('t', 'u/muzyka-k1.mp3')).toBe(false);
    expect(isShowMusicPath('t', 't/abc.wav')).toBe(false);
    expect(isShowMusicPath('t', 't/muzyka-k1xmp3')).toBe(false);
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
