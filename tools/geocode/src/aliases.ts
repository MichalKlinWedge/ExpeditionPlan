/**
 * Podpowiedzi nazw dla geokodera: plany mają polskie egzonimy i transkrypcje (Marakesz, Uszguli,
 * Kutubijja), których OSM nie zna. To tylko zapytania — współrzędne i tak pochodzą z OSM.
 * Wniosek dla PoC-1: import AI powinien zwracać obok nazwy polskiej nazwę lokalną/angielską.
 */
export const ALIASES: Record<string, Record<string, string[]>> = {
  barcelona: {
    'bcn-t2': ['Aeroport T2', 'Barcelona Airport Terminal 2', 'Aeroport de Barcelona Terminal 2'],
    katedra: ['Catedral de Barcelona'],
    'muzeum-picassa': ['Museu Picasso'],
    'fira-santa-llucia': ['Fira de Santa Llúcia'],
    'barca-store-stadion': ['Barça Store Spotify Camp Nou', 'FC Botiga Megastore'],
    'stadion-olimpijski': ['Estadi Olímpic Lluís Companys'],
    'gran-vista': ['Carrer de la Gran Vista, Barcelona'],
  },
  gruzja: {
    szekwetili: ['Shekvetili'],
    hacwali: ['Hatsvali'],
    'lodowiec-czalaadi': ['Chalaadi Glacier'],
    'muzeum-swanetii': ['Svaneti Museum of History and Ethnography'],
    uszguli: ['Ushguli'],
    'lodowiec-szchara': ['Shkhara Glacier'],
    'jeziora-koruldi': ['Koruldi Lakes'],
    'wodospad-uszba': ['Ushba Waterfall'],
    tetnuldi: ['Tetnuldi'],
    'kanion-martwili': ['Martvili Canyon'],
    tsitsinatela: ['Tsitsinatela, Shekvetili'],
    'zapora-inguri': ['Enguri Dam'],
    'park-kolchidy': ['Kolkheti National Park'],
    'rzeka-aczariscchali': ['Acharistskali'],
    'wodospad-machuncety': ['Makhuntseti Waterfall'],
    'jaskinia-prometeusza': ['Prometheus Cave'],
    'park-dendrologiczny': ['Shekvetili Dendrological Park'],
    'winterfell-mestia': ['Winterfell, Mestia'],
    'deltahotel-ureki': ['Delta Hotel, Ureki'],
  },
  maroko: {
    'p-marakesz': ['Marrakech'],
    'p-sixt-aga': ['Agadir Al Massira Airport'],
    'p-el-badi': ['El Badi Palace'],
    'p-kutubijja': ['Koutoubia Mosque'],
    'p-medersa': ['Ben Youssef Madrasa'],
    'p-saadyci': ['Saadian Tombs'],
    'p-majorelle': ['Jardin Majorelle'],
    'p-suki': ['Souk Semmarine'],
    'p-skala-ville': ['Skala de la Ville'],
    'p-port-essaouira': ["Port d'Essaouira"],
    'p-medyna-essaouira': ['Medina of Essaouira', "Médina d'Essaouira"],
    'p-plaza-essaouira': ["Plage d'Essaouira"],
    // Plaża przy wsi Tamri: wieś jest dokładnością wystarczającą dla plaży.
    'p-tamri': ['Tamri'],
    'p-agafay': ['Agafay'],
  },
};
