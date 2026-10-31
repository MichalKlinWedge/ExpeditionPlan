import { File, Paths } from 'expo-file-system';

import { WALK_POINTS, type WalkPoint } from './data';

/** Punkty spaceru: domyślne (Wrocław) + dodane na miejscu przyciskiem „Dodaj tutaj”. */

export type Point = WalkPoint & { radius?: number };

const pointsFile = () => new File(Paths.document, 'poc3-points.json');

export async function walkPoints(): Promise<Point[]> {
  const file = pointsFile();
  const added: Point[] = file.exists ? JSON.parse(await file.text()) : [];
  return [...WALK_POINTS, ...added];
}

export async function addPoint(point: Point): Promise<void> {
  const file = pointsFile();
  const added: Point[] = file.exists ? JSON.parse(await file.text()) : [];
  if (!file.exists) file.create();
  await file.write(JSON.stringify([...added, point]));
}

export function clearAddedPoints(): void {
  const file = pointsFile();
  if (file.exists) file.delete();
}
