import type { ReactNode } from "react";

import { IconAction } from "@/components/icon-action";

/**
 * Belka tytułowa okna dialogowego (`card dialog`): tytuł (i podpis pod nim) z krzyżykiem przy prawej krawędzi.
 * Każde okno zamyka się tak samo — krzyżykiem, Escape, a okno bez formularza także kliknięciem w tło.
 */
export function DialogTitle({ children, onClose, disabled = false }: { children: ReactNode; onClose: () => void; disabled?: boolean }) {
  return (
    <div className="card-title flex items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-0.5">{children}</div>
      <IconAction kind="close" tip="Zamknij" onClick={onClose} disabled={disabled} />
    </div>
  );
}
