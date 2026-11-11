import { routeLinkLabel, routeLinkSite } from "@expeditionplan/core";
import Image from "next/image";
import type { AnchorHTMLAttributes } from "react";

import { RouteIcon } from "@/components/icons";

/** Ikona serwisu przy linku trasy (favikony zapisane w `public/route-icons`, strona nie łączy się z serwisem). */
const ROUTE_SITE_ICON = { mapy: "/route-icons/mapy.png", google: "/route-icons/google-maps.png" } as const;

/**
 * Link do trasy w zewnętrznej mapie jako ikona serwisu (mapy.com, Google Maps, inaczej ogólna ikona trasy);
 * nazwa serwisu w podpowiedzi. Wspólny dla planu dnia i karty punktu.
 */
export function RouteSiteLink({ url, label = routeLinkLabel(url), className = "", ...rest }: { url: string; label?: string } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  const site = routeLinkSite(url);
  return (
    <a href={url} target="_blank" rel="noreferrer" title={label} aria-label={label} {...rest} className={`btn-mini btn-icon ${className}`}>
      {site === null ? <RouteIcon className="size-3.5" /> : <Image src={ROUTE_SITE_ICON[site]} alt="" width={14} height={14} unoptimized className="size-3.5" />}
    </a>
  );
}
