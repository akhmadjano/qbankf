// Oddiy, chiziqli (stroke) uslubdagi SVG ikonkalar to'plami — emoji o'rniga ishlatiladi.
const ICON_PATHS = {
  'bar-chart': '<path d="M4 20V10"/><path d="M12 20V4"/><path d="M20 20v-7"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  'help-circle': '<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 1 1 4.7 2.4c-.6.5-1.2 1-1.2 1.9"/><path d="M12 17h.01"/>',
  trophy: '<circle cx="12" cy="8" r="5"/><path d="M8.5 13 7 22l5-3 5 3-1.5-9"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  'log-out': '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
  'check-circle': '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9"/>',
  'x-circle': '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5l5 5"/><path d="M14.5 9.5l-5 5"/>',
  star: '<path d="M12 2.5l3 6.5 7 .8-5.2 4.7 1.4 6.9L12 17.8 5.8 21.4l1.4-6.9L2 9.8l7-.8z"/>',
  x: '<path d="M18 6 6 18"/><path d="M6 6l12 12"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  pencil: '<path d="M4 20h4l10.5-10.5a2 2 0 0 0-3-3L5 17z"/><path d="M13 6l3 3"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/>',
  download: '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/>',
  upload: '<path d="M12 3v12"/><path d="M7 8l5-5 5 5"/><path d="M5 21h14"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  bookmark: '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
  flag: '<path d="M5 3v18"/><path d="M5 4h11l-2 4 2 4H5"/>',
  lightbulb: '<path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-4 10.5c.6.5 1 1.2 1 2v.5h6v-.5c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>',
  'chevron-left': '<path d="M15 6l-6 6 6 6"/>',
  'chevron-right': '<path d="M9 6l6 6-6 6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  home: '<path d="M3 9.5 12 3l9 6.5"/><path d="M5 10v9a1 1 0 0 0 1 1h3v-6h6v6h3a1 1 0 0 0 1-1v-9"/>',
  'book-open': '<path d="M2 4h7a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2z"/><path d="M22 4h-7a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h8z"/>',
  list: '<path d="M9 6h11"/><path d="M9 12h11"/><path d="M9 18h11"/><path d="M4.5 6h.01"/><path d="M4.5 12h.01"/><path d="M4.5 18h.01"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.3 3-5 6.5-5s6.5 1.7 6.5 5"/><path d="M16 8.5c1.4.3 2.5 1.4 2.5 3 0 1.3-.7 2.2-1.7 2.7"/><path d="M17.5 14.3c1.9.5 3 1.6 3 3.7v2"/>',
  layers: '<path d="M12 2.5 3 7.5l9 5 9-5z"/><path d="M3 12.5l9 5 9-5"/><path d="M3 17.5l9 5 9-5"/>',
  'refresh-cw': '<path d="M21 12a9 9 0 0 1-15.3 6.4L3 16"/><path d="M3 12a9 9 0 0 1 15.3-6.4L21 8"/><path d="M21 3v5h-5"/><path d="M3 21v-5h5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  shuffle: '<path d="M17 3h4v4"/><path d="M21 3l-7 7"/><path d="M3 21l6-6"/><path d="M3 3l5 5"/><path d="M13 13l8 8"/><path d="M21 21h-4v-4"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h12"/>',
  zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  medal: '<circle cx="12" cy="15" r="6"/><path d="M9 10 6 3h3l3 6 3-6h3l-3 7"/>',
  lock: '<rect x="4.5" y="11" width="15" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  heart: '<path d="M12 20.5s-7.5-4.6-10-9.3C.5 7.8 2.5 4.5 6 4.5c2 0 3.5 1 6 3.5 2.5-2.5 4-3.5 6-3.5 3.5 0 5.5 3.3 4 6.7-2.5 4.7-10 9.3-10 9.3z"/>',
};

function icon(name, size = 24, cls = '') {
  const inner = ICON_PATHS[name] || '';
  return `
    <svg
      class="icon ${cls}"
      width="${size}"
      height="${size}"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.2"
      stroke-linecap="round"
      stroke-linejoin="round"
      xmlns="http://www.w3.org/2000/svg">
      ${inner}
    </svg>
  `;
}
