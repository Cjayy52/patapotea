import React from 'react';

const base = {
  width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
};

export const Plane = (p) => (
  <svg {...base} {...p}>
    <path d="M21 12 3.5 5.2l4.1 5.1L4 14.6l4.7-1.3L12 19l2.1-5.7L21 12Z" fill="currentColor" stroke="none" />
  </svg>
);

export const PlaneOutline = (p) => (
  <svg {...base} {...p}>
    <path d="m21 12-17.5-6.8 4.1 5.1L4 14.6l4.7-1.3L12 19l2.1-5.7L21 12Z" />
  </svg>
);

export const Volume = (p) => (
  <svg {...base} {...p}>
    <path d="M11 5 6 9H3v6h3l5 4V5Z" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
  </svg>
);

export const VolumeOff = (p) => (
  <svg {...base} {...p}>
    <path d="M11 5 6 9H3v6h3l5 4V5Z" />
    <path d="m16 9 5 6M21 9l-5 6" />
  </svg>
);

export const Dashboard = (p) => (
  <svg {...base} {...p}>
    <rect x="3" y="3" width="7" height="9" rx="1.5" />
    <rect x="14" y="3" width="7" height="5" rx="1.5" />
    <rect x="14" y="12" width="7" height="9" rx="1.5" />
    <rect x="3" y="16" width="7" height="5" rx="1.5" />
  </svg>
);

export const Shield = (p) => (
  <svg {...base} {...p}>
    <path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3Z" />
    <path d="m9.2 12 2 2 3.6-4" />
  </svg>
);

export const Bolt = (p) => (
  <svg {...base} {...p}>
    <path d="M13 2 4.5 13.5H11L9.5 22 19 10h-6.5L13 2Z" />
  </svg>
);

export const History = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);

export const User = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="8" r="3.4" />
    <path d="M4.8 20a7.4 7.4 0 0 1 14.4 0" />
  </svg>
);

export const Logout = (p) => (
  <svg {...base} {...p}>
    <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
    <path d="m10 8-4 4 4 4M6 12h9" />
  </svg>
);

export const Login = (p) => (
  <svg {...base} {...p}>
    <path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3" />
    <path d="m14 8 4 4-4 4M18 12H9" />
  </svg>
);

export const Check = (p) => (
  <svg {...base} {...p}>
    <path d="m4.5 12.5 5 5 10-11" />
  </svg>
);

export const Alert = (p) => (
  <svg {...base} {...p}>
    <path d="M12 3.5 2.6 20h18.8L12 3.5Z" />
    <path d="M12 9v5M12 17.2v.3" />
  </svg>
);

export const Close = (p) => (
  <svg {...base} {...p}>
    <path d="m6 6 12 12M18 6 6 18" />
  </svg>
);

export const Coin = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5v9M14.6 9.4c-.5-.8-1.5-1.2-2.6-1.2-1.4 0-2.4.7-2.4 1.8 0 2.4 5.2 1.3 5.2 3.8 0 1.2-1.1 2-2.8 2-1.2 0-2.2-.4-2.8-1.3" />
  </svg>
);

export const Refresh = (p) => (
  <svg {...base} {...p}>
    <path d="M20 11a8 8 0 1 0-.6 4" />
    <path d="M20 4v7h-7" />
  </svg>
);

export const ArrowRight = (p) => (
  <svg {...base} {...p}>
    <path d="M4 12h16M14 6l6 6-6 6" />
  </svg>
);

export const Lock = (p) => (
  <svg {...base} {...p}>
    <rect x="4.5" y="10" width="15" height="10.5" rx="2" />
    <path d="M8 10V7.5a4 4 0 0 1 8 0V10" />
  </svg>
);

export const Mail = (p) => (
  <svg {...base} {...p}>
    <rect x="2.8" y="5" width="18.4" height="14" rx="2.4" />
    <path d="m3.4 6.6 8.6 6.4 8.6-6.4" />
  </svg>
);

export const Trend = (p) => (
  <svg {...base} {...p}>
    <path d="m3 17 6-6 4 4 8-9" />
    <path d="M15 6h6v6" />
  </svg>
);

export const Ticket = (p) => (
  <svg {...base} {...p}>
    <path d="M3 9a2 2 0 0 0 0 6v3h18v-3a2 2 0 0 1 0-6V6H3v3Z" />
    <path d="M13 6v12" strokeDasharray="2 3" />
  </svg>
);

export const Sparkle = (p) => (
  <svg {...base} {...p}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
  </svg>
);
