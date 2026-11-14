import { GlobeIcon } from "@/components/icons";

/** Linki zewnętrzne jako przyciski `btn-web` (glob i nazwa strony, pełny adres w podpowiedzi). */
export function WebLinks({ links, className }: { links: readonly { label: string; url: string }[]; className?: string }) {
  if (links.length === 0) return null;
  return (
    <span className={`inline-flex flex-wrap items-center gap-1 ${className ?? ""}`}>
      {links.map((link) => (
        <a key={link.url} href={link.url} title={link.url} target="_blank" rel="noreferrer" className="btn-web">
          <GlobeIcon className="size-3.5" />
          {link.label}
        </a>
      ))}
    </span>
  );
}
