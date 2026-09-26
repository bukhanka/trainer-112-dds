/** Line icons drawn for the workstation (no icon font: the trainer works offline). */
type P = { className?: string };
const svg = (path: React.ReactNode, viewBox = "0 0 24 24") =>
  function Icon({ className = "h-5 w-5" }: P) {
    return (
      <svg viewBox={viewBox} className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {path}
      </svg>
    );
  };

export const IconPhone = svg(<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" fill="currentColor" stroke="none" />);
export const IconHangup = svg(
  <path d="M3 13.5c5-4.7 13-4.7 18 0l-2.4 2.6-3.2-1.6v-2.3a10 10 0 0 0-6.8 0v2.3l-3.2 1.6z" fill="currentColor" stroke="none" />,
);
export const IconSms = svg(
  <>
    <path d="M4 5h16v11H9l-5 4z" fill="currentColor" stroke="none" />
    <circle cx="9" cy="10.5" r="1" fill="#fff" stroke="none" />
    <circle cx="12" cy="10.5" r="1" fill="#fff" stroke="none" />
    <circle cx="15" cy="10.5" r="1" fill="#fff" stroke="none" />
  </>,
);
export const IconGlobe = svg(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
  </>,
);
export const IconPin = svg(<path d="M12 21s-6-6.2-6-11a6 6 0 1 1 12 0c0 4.8-6 11-6 11zm0-8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5" fill="currentColor" stroke="none" />);
export const IconQuestion = svg(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01" />
  </>,
);
export const IconMap = svg(
  <>
    <path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" />
    <path d="M9 4v14M15 6v14" />
  </>,
);
export const IconClose = svg(<path d="M6 6l12 12M18 6L6 18" />);
export const IconPlus = svg(<path d="M12 5v14M5 12h14" />);
export const IconLink = svg(
  <>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    <path d="M18 16v5M15.5 18.5h5" />
  </>,
);
export const IconStopwatch = svg(
  <>
    <circle cx="12" cy="13" r="8" />
    <path d="M12 9v4l2 2M10 2h4M12 2v3" />
  </>,
);
export const IconHand = svg(<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11m0-6.5a1.5 1.5 0 0 1 3 0V11m0-5a1.5 1.5 0 0 1 3 0v6m0-3a1.5 1.5 0 0 1 3 0v5a7 7 0 0 1-7 7h-1a7 7 0 0 1-5.6-2.8L4 15.5a1.6 1.6 0 0 1 2.5-2L8 15" />);
export const IconBell = svg(
  <>
    <path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4z" />
    <path d="M10 21h4" />
  </>,
);
export const IconAlert = svg(
  <>
    <path d="M4 4h16v12H9l-5 4z" />
    <path d="M12 7v4M12 13.5h.01" />
  </>,
);
export const IconTranslate = svg(
  <>
    <path d="M3 5h10M8 3v2m3 0c-1 4-4 7-7 8m3-5c1 2 3 4 6 5" />
    <path d="M13 21l4-9 4 9m-6.8-3h5.6" />
  </>,
);
export const IconCheck = svg(<path d="M5 12.5l4.5 4.5L19 7.5" />);
export const IconChevronUp = svg(<path d="M6 15l6-6 6 6" />);
export const IconSend = svg(<path d="M4 12l16-8-6 16-2.5-6.5z" />);
export const IconSpeaker = svg(
  <>
    <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" stroke="none" />
    <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />
  </>,
);
export const IconSpeakerOff = svg(
  <>
    <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" stroke="none" />
    <path d="M16 9l5 6M21 9l-5 6" />
  </>,
);
