import { describe, expect, it } from 'vitest';

import { googleLinkVias, resolveGoogleLink } from '../google-link.ts';
import { orsRoute } from '../routing.ts';

const redirect = (location: string) => new Response(null, { status: 302, headers: { location } });

describe('link Google do trasy', () => {
  it('skrócony link: jedno zapytanie HEAD bez przechodzenia na stronę, tylko nagłówek Location', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return redirect('https://www.google.com/maps/dir/42.1,42.4/42.2,42.45/42.16,42.36/@42.1,42.3,12z/data=!4m2!4m1!3e0');
    }) as typeof fetch;
    const result = await googleLinkVias('https://maps.app.goo.gl/abc', { fetchImpl });
    expect(result).toEqual({ vias: [{ lat: 42.2, lng: 42.45 }], status: 'vias' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.init).toMatchObject({ method: 'HEAD', redirect: 'manual' });
  });

  it('przekierowanie poza Mapy Google albo błąd sieci: nie rozwinięty', async () => {
    const elsewhere = (async () => redirect('https://example.com/phish')) as typeof fetch;
    expect(await resolveGoogleLink('https://maps.app.goo.gl/abc', { fetchImpl: elsewhere })).toBeNull();
    const broken = (async () => {
      throw new Error('offline');
    }) as typeof fetch;
    expect(await googleLinkVias('https://maps.app.goo.gl/abc', { fetchImpl: broken })).toEqual({ vias: [], status: 'unresolved' });
    expect(await googleLinkVias('https://mapy.com/s/abc')).toEqual({ vias: [], status: 'not_google' });
  });

  it('ORS dostaje punkty pośrednie między startem a celem', async () => {
    let body: { coordinates: number[][]; radiuses: number[] } | undefined;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ routes: [{ summary: { distance: 13500, duration: 1080 } }] }), { status: 200 });
    }) as typeof fetch;
    const route = await orsRoute('klucz', fetchImpl)({ lat: 42.1, lng: 42.4 }, { lat: 42.16, lng: 42.36 }, 'driving-car', [{ lat: 42.2, lng: 42.45 }]);
    expect(route?.distanceKm).toBe(13.5);
    expect(body?.coordinates).toEqual([
      [42.4, 42.1],
      [42.45, 42.2],
      [42.36, 42.16],
    ]);
    expect(body?.radiuses).toHaveLength(3);
  });
});
