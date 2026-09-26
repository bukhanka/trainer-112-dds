/** Small line icons of the workstation, drawn inline so the stand works offline. */
type P = { className?: string; title?: string };

const svg = (path: React.ReactNode, viewBox = "0 0 24 24") =>
  function Icon({ className = "h-4 w-4", title }: P) {
    return (
      <svg viewBox={viewBox} className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true} role={title ? "img" : undefined}>
        {title ? <title>{title}</title> : null}
        {path}
      </svg>
    );
  };

export const ChevronDown = svg(<path d="m6 9 6 6 6-6" />);
export const ChevronUp = svg(<path d="m6 15 6-6 6 6" />);
export const ChevronLeft = svg(<path d="m15 6-6 6 6 6" />);
export const ChevronRight = svg(<path d="m9 6 6 6-6 6" />);
export const Bookmark = svg(<path d="M6 3h12v18l-6-4-6 4z" fill="currentColor" stroke="none" />);
export const Bolt = svg(<path d="M13 2 4 14h7l-1 8 9-12h-7z" fill="currentColor" stroke="none" />);
export const Stopwatch = svg(
  <>
    <circle cx="12" cy="13" r="8" />
    <path d="M12 9v4l2 2M10 2h4M12 2v3" />
  </>,
);
export const Clipboard = svg(
  <>
    <rect x="5" y="4" width="14" height="18" rx="2" fill="currentColor" stroke="none" />
    <rect x="9" y="2" width="6" height="4" rx="1" fill="currentColor" stroke="none" />
    <path d="M8.5 11h7M8.5 15h7" stroke="#2f353a" />
  </>,
);
export const MapPinOff = svg(
  <>
    <path d="M12 21s-6-5.5-6-11a6 6 0 0 1 10.3-4.2M18 10c0 5.5-6 11-6 11" />
    <path d="m3 3 18 18" />
  </>,
);
export const Search = svg(
  <>
    <circle cx="10" cy="10" r="6" />
    <path d="m21 21-6.5-6.5" />
  </>,
);
export const Monitor = svg(
  <>
    <rect x="3" y="4" width="18" height="12" rx="1" />
    <path d="M8 20h8M12 16v4" />
  </>,
);
export const Gear = svg(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
  </>,
);
export const Help = svg(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 1-1 1.7M12 17h.01" />
  </>,
);
export const Runner = svg(
  <>
    <circle cx="14" cy="4" r="2" />
    <path d="m7 21 3-6 3 2v5M6 11l3-3h4l3 4 3 1M10 8l-1 5" />
  </>,
);
export const Phone = svg(
  <path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2" fill="currentColor" stroke="none" />,
);
export const HandsetDown = svg(
  <path d="M3 13c5-5 13-5 18 0l-2 3-3.5-1.5V12a10 10 0 0 0-7 0v2.5L5 16z" fill="currentColor" stroke="none" />,
);
export const Chat = svg(<path d="M4 4h16v12H8l-4 4z" fill="currentColor" stroke="none" />);
export const Pencil = svg(<path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" />);
export const Warning = svg(
  <>
    <path d="M12 3 2 20h20z" fill="currentColor" stroke="none" />
    <path d="M12 9v5M12 17h.01" stroke="#ec653b" />
  </>,
);
export const Close = svg(<path d="M6 6l12 12M18 6 6 18" />);
export const Check = svg(<path d="m5 12 5 5 9-10" />);
export const Exclaim = svg(
  <>
    <rect x="4" y="3" width="16" height="15" rx="1" fill="currentColor" stroke="none" />
    <path d="M12 6v6M12 15h.01" stroke="#2f353a" />
    <path d="m8 18 0 3 4-3" fill="currentColor" stroke="none" />
  </>,
);
export const ExpandV = svg(<path d="m8 7 4-4 4 4M8 17l4 4 4-4" />);
export const CollapseV = svg(<path d="m8 3 4 4 4-4M8 21l4-4 4 4" />);
export const Chain = svg(<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />);
export const Keypad = svg(
  <>
    {[5, 12, 19].flatMap((x) => [5, 12, 19].map((y) => <circle key={`${x}${y}`} cx={x} cy={y} r="1.6" fill="currentColor" stroke="none" />))}
  </>,
);
export const Book = svg(<path d="M4 4h11a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3zM18 20h2V6M8 8h6" />);
export const List = svg(<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />);
