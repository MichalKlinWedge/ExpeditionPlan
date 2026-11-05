import { describe, expect, it } from 'vitest';

import { htmlToText, isPublicAddress, menuLinks, robotsAllows, venueSiteProblem } from '../venue-page.ts';

describe('strona lokalu', () => {
  it('serwisy i złe adresy odpadają, własna strona przechodzi', () => {
    expect(venueSiteProblem('https://www.chata-pod-bukovcem.cz/')).toBeNull();
    expect(venueSiteProblem('http://pizzeria.example.com/menu')).toBeNull();
    for (const url of ['https://www.booking.com/hotel/pl/x.html', 'https://pl.tripadvisor.com/Restaurant', 'https://www.tripadvisor.co.uk/x', 'https://facebook.com/lokal', 'https://m.facebook.com/lokal', 'https://www.google.com/maps/place/x', 'https://maps.app.goo.gl/x', 'https://www.instagram.com/lokal']) {
      expect(venueSiteProblem(url), url).toContain('nie czytamy automatycznie');
    }
    expect(venueSiteProblem('nie-adres')).toContain('niepoprawny');
    expect(venueSiteProblem('file:///etc/passwd')).toContain('niepoprawny');
    expect(venueSiteProblem('https://nie-facebook.example.com/')).toBeNull();
  });

  it('tylko sieć publiczna', () => {
    for (const address of ['8.8.8.8', '93.184.216.34', '172.32.0.1', '100.128.0.1', '2606:4700::1111', '2a00:1450:4001::1']) expect(isPublicAddress(address), address).toBe(true);
    for (const address of ['127.0.0.1', '10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '198.18.0.1', '::1', '::', 'fe80::1', 'fc00::1', 'fd12::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '2001:db8::1', 'localhost']) expect(isPublicAddress(address), address).toBe(false);
    expect(isPublicAddress('::ffff:8.8.8.8')).toBe(true);
  });

  it('tekst bez skryptów, stylów i komentarzy, z encjami i wierszami', () => {
    const html = `<html><head><title>Nie</title><style>p{color:red}</style></head><body><!-- ukryte --><script>alert("x")</script>
      <h1>Pizzeria &amp; Bar</h1><p class="hidden-xs">Margherita&nbsp;32&#160;z&#322;</p>
      <table><tr><td>Zupa</td><td>18 &euro;</td></tr></table></body></html>`;
    expect(htmlToText(html)).toBe('Pizzeria & Bar\nMargherita 32 zł\nZupa 18 €');
  });

  it('link do menu: ta sama strona, najpierw po etykiecie, bez PDF-ów i obcych adresów', () => {
    const html = `<a href="/o-nas">O nas</a><a href="/oferta/menu-dnia">Oferta</a><a href="karta.html">Nasza karta</a><a href="/menu.pdf">Menu PDF</a>
      <a href="https://inny.example.com/menu">Menu</a><a href="mailto:a@b.pl">menu</a><a href="https://www.lokal.example.com/jidelni-listek">Jídelní lístek</a>`;
    expect(menuLinks(html, 'https://lokal.example.com/')).toEqual(['https://lokal.example.com/karta.html', 'https://www.lokal.example.com/jidelni-listek', 'https://lokal.example.com/oferta/menu-dnia']);
    expect(menuLinks('<a href="/o-nas">O nas</a>', 'https://lokal.example.com/')).toEqual([]);
  });

  it('robots.txt: reguły dla wszystkich, najdłuższa wygrywa, inne grupy się nie liczą', () => {
    const robots = 'User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /admin/\nDisallow: /menu\nAllow: /menu/dzis\n# koniec';
    expect(robotsAllows(robots, '/')).toBe(true);
    expect(robotsAllows(robots, '/admin/x')).toBe(false);
    expect(robotsAllows(robots, '/menu')).toBe(false);
    expect(robotsAllows(robots, '/menu/dzis')).toBe(true);
    expect(robotsAllows('User-agent: *\nDisallow: /', '/')).toBe(false);
    expect(robotsAllows('User-agent: *\nDisallow:', '/')).toBe(true);
    expect(robotsAllows('User-agent: Bingbot\nUser-agent: *\nDisallow: /', '/x')).toBe(false);
    expect(robotsAllows('', '/')).toBe(true);
  });
});
