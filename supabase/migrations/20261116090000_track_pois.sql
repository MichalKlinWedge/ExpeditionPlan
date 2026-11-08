-- Woda, schroniska i zejścia awaryjne wzdłuż śladu GPX z OpenStreetMap (`DocTrack.pois`,
-- core/track-pois.ts), pobierane na kliknięcie na karcie punktu. Dane OSM (ODbL) z podpisem przy liście.
alter table public.tracks add column if not exists pois jsonb;
