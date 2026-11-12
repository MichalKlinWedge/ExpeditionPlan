import { useEffect, useState } from 'react';

/**
 * Tryb edycji telefonu — jedno ustawienie dla całej aplikacji (przełącznik na Start), zamiast
 * przycisku „Edytuj” w planie. Włączony pokazuje w planie przesuwanie, edycję, usuwanie i dodawanie
 * punktów (organizator i edytor, z internetem); wyłączony — sam podgląd. Zapamiętany na telefonie,
 * zmiana od razu widoczna na otwartych ekranach.
 */

const KEY = 'edit_mode';

const listeners = new Set<(value: boolean) => void>();

export function editModeOn(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function setEditModeOn(value: boolean): void {
  try {
    if (value) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    // Bez zapisu tryb wróci do podglądu przy następnym uruchomieniu.
  }
  for (const listener of listeners) listener(value);
}

export function useEditMode(): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(editModeOn);
  useEffect(() => {
    listeners.add(setValue);
    return () => void listeners.delete(setValue);
  }, []);
  return [value, setEditModeOn];
}
