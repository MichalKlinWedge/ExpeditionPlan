import { describe, expect, it } from 'vitest';

import { parseModelList } from '../gemini.ts';
import { isModelName, normalizeModel } from '../models.ts';

describe('normalizeModel', () => {
  it('robi identyfikator z nazwy ze strony Google', () => {
    // Dokładnie to wpisane w ustawieniach kończyło się odmową „unexpected model name format”.
    expect(normalizeModel('Gemini 3.5 Flash-Lite')).toBe('gemini-3.5-flash-lite');
  });

  it('zdejmuje przedrostek zasobu', () => {
    expect(normalizeModel('models/gemini-2.5-flash')).toBe('gemini-2.5-flash');
  });

  it('nie rusza poprawnej nazwy', () => {
    expect(normalizeModel('gemini-3.1-flash-lite-preview')).toBe('gemini-3.1-flash-lite-preview');
  });

  it('radzi sobie z nadmiarem spacji i myślników', () => {
    expect(normalizeModel('  Gemini  3 Flash  ')).toBe('gemini-3-flash');
    expect(normalizeModel('gemini_2.5_flash')).toBe('gemini-2.5-flash');
    expect(normalizeModel('-gemini--flash-')).toBe('gemini-flash');
  });

  it('z pustego nie robi nazwy', () => {
    expect(normalizeModel('   ')).toBe('');
  });
});

describe('isModelName', () => {
  it('przepuszcza identyfikatory', () => {
    expect(isModelName('gemini-3.5-flash-lite')).toBe(true);
    expect(isModelName('gemini-flash-latest')).toBe(true);
  });

  it('odrzuca to, czego API nie przyjmie', () => {
    expect(isModelName('')).toBe(false);
    expect(isModelName('Gemini 3.5 Flash-Lite')).toBe(false);
    expect(isModelName('gemini-2.5-flash (preview)')).toBe(false);
    expect(isModelName('models/gemini-2.5-flash')).toBe(false);
  });
});

describe('parseModelList', () => {
  const row = (name: string, methods: string[] = ['generateContent']) => ({
    name,
    displayName: name.replace('models/', ''),
    supportedGenerationMethods: methods,
  });

  it('czyta identyfikator i nazwę', () => {
    expect(
      parseModelList({
        models: [{ name: 'models/gemini-3.5-flash-lite', displayName: 'Gemini 3.5 Flash-Lite' }],
      }),
    ).toEqual([{ id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite' }]);
  });

  it('pomija modele od innej roboty niż tekst', () => {
    const models = parseModelList({
      models: [row('models/gemini-3-flash'), row('models/text-embedding-004', ['embedContent'])],
    });
    expect(models.map((model) => model.id)).toEqual(['gemini-3-flash']);
  });

  it('bez spisu metod odsiewa po nazwie, zamiast zwracać pustą listę', () => {
    const models = parseModelList({
      models: [
        { name: 'models/gemini-3-flash' },
        { name: 'models/imagen-4' },
        { name: 'models/gemini-embedding-001' },
      ],
    });
    expect(models.map((model) => model.id)).toEqual(['gemini-3-flash']);
  });

  it('zapowiedzi schodzą na dół listy', () => {
    const models = parseModelList({
      models: [row('models/gemini-3.5-flash-preview'), row('models/gemini-2.5-flash')],
    });
    expect(models.map((model) => model.id)).toEqual([
      'gemini-2.5-flash',
      'gemini-3.5-flash-preview',
    ]);
  });

  it('powtórzony model wchodzi raz', () => {
    const models = parseModelList({ models: [row('models/gemini-3-flash'), row('gemini-3-flash')] });
    expect(models).toHaveLength(1);
  });

  it('bez nazwy nic nie wchodzi, a pusta odpowiedź nie wywraca', () => {
    expect(parseModelList(null)).toEqual([]);
    expect(parseModelList({})).toEqual([]);
    expect(parseModelList({ models: [{ displayName: 'Bez nazwy' }] })).toEqual([]);
  });
});
