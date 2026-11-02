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
