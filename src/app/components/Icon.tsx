const paths = {
  board: 'M3 4h5v16H3zM10 4h5v10h-5zM17 4h4v7h-4z',
  check: 'M4 12l5 5L20 6',
  factory: 'M3 20V10l5 3V10l5 3V6h3l1-3h2l1 3v14z',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  gear: 'M12 9a3 3 0 100 6 3 3 0 000-6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1',
  back: 'M15 5l-7 7 7 7',
  clip: 'M8 12l6-6a3 3 0 014 4l-8 8a5 5 0 01-7-7l7-7',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  send: 'M4 12l16-8-6 16-2-7z',
  plus: 'M12 5v14M5 12h14'
}

export function Icon({ name, size = 16 }: { name: keyof typeof paths; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  )
}
