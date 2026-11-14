/**
 * Własne zdjęcie z dysku przed wgraniem do publicznego `guide_photos` (opisy miejsc, uwagi punktu):
 * zmniejszone w przeglądarce, bez EXIF.
 */

/** Najdłuższy bok wgrywanego zdjęcia: wystarcza na pełny ekran pokazu, a plik ma kilkaset kB. */
export const OWN_PHOTO_PX = 1920;

/** Zdjęcie z dysku → JPEG najwyżej `OWN_PHOTO_PX` (bez EXIF, więc bez położenia z aparatu). */
export async function ownPhotoJpeg(file: File): Promise<Blob | string> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, OWN_PHOTO_PX / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    return blob ?? "Nie udało się przygotować zdjęcia.";
  } catch {
    return "Nie da się odczytać tego pliku jako zdjęcia (JPG, PNG albo WebP).";
  }
}
