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
