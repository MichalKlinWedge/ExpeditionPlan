/**
 * Proste ikony liniowe (SVG, 24×24, kolor z `currentColor`) — bez zewnętrznej biblioteki.
 * Rysowane prostymi kształtami, żeby pasowały do motywu „Kompas i mapa”.
 */

type Props = { className?: string };

function Svg({ className = "size-5", children }: Props & { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {children}
    </svg>
  );
}

export const CompassIcon = (props: Props) => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M15.5 8.5 13.4 13.4 8.5 15.5 10.6 10.6Z" fill="currentColor" fillOpacity={0.25} />
    <path d="M12 3v1.5M12 19.5V21M3 12h1.5M19.5 12H21" />
  </Svg>
);

export const RouteIcon = (props: Props) => (
  <Svg {...props}>
    <circle cx="6" cy="18" r="2" />
    <circle cx="18" cy="6" r="2" />
    <path d="M8 18h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7" />
  </Svg>
);

/** Szlak: kręta przerywana droga z chorągiewką na końcu („Trasy”). */
export const TrailIcon = (props: Props) => (
  <Svg {...props}>
    <path d="M5 20c2-4 7-3 7-7s-5-3-4-7" strokeDasharray="2.5 2.5" />
    <path d="M8 6V2.5l5 1.8-5 1.7" />
    <circle cx="5" cy="20" r="1.5" />
  </Svg>
);

export const TicketIcon = (props: Props) => (
  <Svg {...props}>
    <path d="M4 7a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v3a2 2 0 0 0 0 4v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-3a2 2 0 0 0 0-4Z" />
    <path d="M14 6v12" strokeDasharray="2 2" />
  </Svg>
);

export const InfoIcon = (props: Props) => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </Svg>
);

export const SparkIcon = (props: Props) => (
  <Svg {...props}>
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z" />
    <path d="M19 15l.7 1.8 1.8.7-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7Z" />
  </Svg>
);

export const NoteIcon = (props: Props) => (
  <Svg {...props}>
    <path d="M6 3h9l4 4v14H6Z" />
    <path d="M14 3v5h5M9 13h6M9 17h4" />
  </Svg>
);

export const DownloadIcon = (props: Props) => (
  <Svg {...props}>
    <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
  </Svg>
);

export const PlusIcon = (props: Props) => (
  <Svg {...props}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const PeakIcon = (props: Props) => (
  <Svg {...props}>
    <path d="M3 19 9.5 8l3.5 6 2-3 6 8Z" />
    <path d="m8 10.5 1.5 1 1.5-1" />
  </Svg>
);

export const PencilIcon = (props: Props) => (
  <Svg {...props}>
    <path d="M4 20h4L19 9l-4-4L4 16Z" />
    <path d="m13.5 6.5 4 4" />
  </Svg>
);

export const ArrowUpIcon = (props: Props) => (
  <Svg {...props}>
    <path d="M12 19V5" />
    <path d="m6 11 6-6 6 6" />
  </Svg>
);

export const ArrowDownIcon = (props: Props) => (
  <Svg {...props}>
    <path d="M12 5v14" />
    <path d="m6 13 6 6 6-6" />
  </Svg>
);

export const PeopleIcon = (props: Props) => (
  <Svg {...props}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
    <circle cx="17" cy="9" r="2.4" />
    <path d="M15.5 14.2A4.5 4.5 0 0 1 20.5 19" />
  </Svg>
);

export const CompareIcon = (props: Props) => (
  <Svg {...props}>
    <rect x="3" y="4" width="7" height="16" rx="1.5" />
    <rect x="14" y="4" width="7" height="16" rx="1.5" />
    <path d="M10 12h4M12.5 10.5 14 12l-1.5 1.5" />
  </Svg>
);

export const VaultIcon = (props: Props) => (
  <Svg {...props}>
    <rect x="3.5" y="5" width="17" height="14" rx="2" />
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 8.8V7.5M12 16.5v-1.3M15.2 12h1.3M7.5 12h1.3M7 19v1.5M17 19v1.5" />
  </Svg>
);

export const BallotIcon = (props: Props) => (
  <Svg {...props}>
    <path d="M4 14h16v6H4z" />
    <path d="M7 14V5h10v9" />
    <path d="m9.5 9.5 2 2 3.5-4" />
  </Svg>
);

export const FlagIcon = (props: Props) => (
  <Svg {...props}>
    <path d="M5 21V4" />
    <path d="M5 4h11l-2 4 2 4H5" />
  </Svg>
);

export const ListIcon = (props: Props) => (
  <Svg {...props}>
    <path d="M9 6h11M9 12h11M9 18h11" />
    <path d="M4 6h.01M4 12h.01M4 18h.01" />
  </Svg>
);

export const ShieldIcon = (props: Props) => (
  <Svg {...props}>
    <path d="M12 3 5 6v5c0 4.4 3 8.3 7 10 4-1.7 7-5.6 7-10V6Z" />
    <path d="m9 12 2 2 4-4" />
  </Svg>
);

export const PrinterIcon = (props: Props) => (
  <Svg {...props}>
    <path d="M7 9V3.5h10V9" />
    <rect x="3.5" y="9" width="17" height="8" rx="1.5" />
    <path d="M7 14h10v6.5H7Z" />
    <path d="M17 11.5h.01" />
  </Svg>
);

export const BookIcon = (props: Props) => (
  <Svg {...props}>
    <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v15H5.5A1.5 1.5 0 0 0 4 20.5Z" />
    <path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v15h5.5a1.5 1.5 0 0 1 1.5 1.5Z" />
    <path d="M7 8h2M15 8h2M15 11h2" />
  </Svg>
);

export const ArticleIcon = (props: Props) => (
  <Svg {...props}>
    <rect x="5" y="3.5" width="14" height="17" rx="2" />
    <path d="M8.5 8h7M8.5 12h7M8.5 16h4" />
  </Svg>
);

export const MealIcon = (props: Props) => (
  <Svg {...props}>
    <path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10" />
    <path d="M17 21V3c-2 1.5-3 4-3 7v3h3" />
  </Svg>
);

export const CartIcon = (props: Props) => (
  <Svg {...props}>
    <path d="M3 4h2l2.4 11h10.2L20 8H6.2" />
    <path d="M9.5 20h.01M17 20h.01" />
  </Svg>
);

export const BackpackIcon = (props: Props) => (
  <Svg {...props}>
    <path d="M6 10a6 6 0 0 1 12 0v9a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2Z" />
    <path d="M9 4.8V4a3 3 0 0 1 6 0v.8" />
    <path d="M9 17v-3h6v3" />
  </Svg>
);

export const PinIcon = (props: Props) => (
  <Svg {...props}>
    <path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21Z" />
    <circle cx="12" cy="9.5" r="2.5" />
  </Svg>
);

/** Strona w sieci (link zewnętrzny, `btn-web`). */
export const GlobeIcon = (props: Props) => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3Z" />
  </Svg>
);

export const PhoneIcon = (props: Props) => (
  <Svg {...props}>
    <path d="M5 4h3l1.5 4-2 1.2a11 11 0 0 0 5.3 5.3l1.2-2 4 1.5v3a2 2 0 0 1-2 2A15 15 0 0 1 3 6a2 2 0 0 1 2-2Z" />
  </Svg>
);

export const MicIcon = (props: Props) => (
  <Svg {...props}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6" />
  </Svg>
);

export const FilmIcon = (props: Props) => (
  <Svg {...props}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m10 9.5 4.5 2.5-4.5 2.5Z" fill="currentColor" fillOpacity={0.25} />
    <path d="M3 9h2M3 15h2M19 9h2M19 15h2" />
  </Svg>
);

export const ClapperIcon = (props: Props) => (
  <Svg {...props}>
    <rect x="3" y="9" width="18" height="11" rx="2" />
    <path d="m3.5 9 1-4 16 2.5-1 3" />
    <path d="m8 5.5 2 3M13 6.3l2 3" />
  </Svg>
);

export const SpeakerIcon = (props: Props) => (
  <Svg {...props}>
    <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4Z" fill="currentColor" fillOpacity={0.25} />
    <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
  </Svg>
);

export const TrashIcon = (props: Props) => (
  <Svg {...props}>
    <path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13" />
    <path d="M10 11v5.5M14 11v5.5" />
  </Svg>
);

/** „Zmień”: wybór z listy (jak strzałki pola wyboru). */
export const SelectIcon = (props: Props) => (
  <Svg {...props}>
    <path d="m8 9 4-4 4 4M8 15l4 4 4-4" />
  </Svg>
);

export const CloseIcon = (props: Props) => (
  <Svg {...props}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);
