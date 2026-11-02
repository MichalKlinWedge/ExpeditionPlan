"use client";

/** „Drukuj / zapisz PDF” — okno drukowania przeglądarki (tam wybór „Zapisz jako PDF”). */
export function PrintButton() {
  return (
    <button onClick={() => window.print()} className="btn-primary">
      Drukuj / zapisz PDF
    </button>
  );
}
