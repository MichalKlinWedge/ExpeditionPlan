import type { ButtonHTMLAttributes } from "react";

import { ArrowDownIcon, ArrowUpIcon, CloseIcon, PencilIcon, SelectIcon, TrashIcon } from "@/components/icons";

/**
 * Działanie przy wierszu jako sama ikona z dymkiem (`title`, też `aria-label`): ołówek = edycja,
 * kosz = usuwanie, strzałki wyboru = zmiana, krzyżyk = zamknięcie otwartej edycji. Wygląd `btn-mini`.
 */

const KIND = {
  edit: { Icon: PencilIcon, tip: "edycja" },
  remove: { Icon: TrashIcon, tip: "usuwanie" },
  change: { Icon: SelectIcon, tip: "zmiana" },
  close: { Icon: CloseIcon, tip: "zamknij" },
  up: { Icon: ArrowUpIcon, tip: "wyżej" },
  down: { Icon: ArrowDownIcon, tip: "niżej" },
} as const;

export type IconActionKind = keyof typeof KIND;

export function IconAction({ kind, tip, className, ...rest }: { kind: IconActionKind; tip?: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const { Icon, tip: fallback } = KIND[kind];
  const label = tip ?? fallback;
  return (
    <button type="button" title={label} aria-label={label} {...rest} className={["btn-mini btn-icon", kind === "remove" ? "btn-mini-danger" : "", className ?? ""].filter(Boolean).join(" ")}>
      <Icon className="size-3.5" />
    </button>
  );
}
