/* Inline SVG icon set — stroke-based outline icons plus solid variants for the
   active bottom-nav item. Usage: Icons.svg('heart', 22)  */
(function () {
  'use strict';

  var STROKE = {
    /* Bottom navigation */
    home: '<path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19v-8.5Z"/>',
    grid: '<rect x="4" y="4" width="7" height="7" rx="1.6"/><rect x="13" y="4" width="7" height="7" rx="1.6"/><rect x="4" y="13" width="7" height="7" rx="1.6"/><rect x="13" y="13" width="7" height="7" rx="1.6"/>',
    food: '<path d="M5 10h14l-1.2 8.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8L5 10Z"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10"/><path d="M9.5 13.5h5"/>',
    ticket: '<path d="M3 9.5V7a1.5 1.5 0 0 1 1.5-1.5h15A1.5 1.5 0 0 1 21 7v2.5a2.5 2.5 0 0 0 0 5V17a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17v-2.5a2.5 2.5 0 0 0 0-5Z"/><path d="M9.5 9v6"/>',
    user: '<circle cx="12" cy="8" r="3.6"/><path d="M4.8 20c.9-3.6 3.8-5.4 7.2-5.4S18.3 16.4 19.2 20"/>',

    /* Account rows */
    heart: '<path d="M12 20s-7.5-4.4-7.5-9.3A4.2 4.2 0 0 1 12 8a4.2 4.2 0 0 1 7.5 2.7C19.5 15.6 12 20 12 20Z"/>',
    card: '<rect x="3" y="6" width="18" height="12" rx="2.4"/><path d="M3 10.5h18"/><path d="M6.5 14.5h3"/>',
    bell: '<path d="M6.5 10a5.5 5.5 0 0 1 11 0c0 4 1.5 5.5 1.5 5.5H5S6.5 14 6.5 10Z"/><path d="M10 18.5a2.2 2.2 0 0 0 4 0"/>',
    shield: '<path d="M12 3.5l7 2.8v5.4c0 4.3-3 7-7 8.8-4-1.8-7-4.5-7-8.8V6.3l7-2.8Z"/><path d="M9.2 12.2l2 2 3.6-3.8"/>',
    doc: '<rect x="4.5" y="3.5" width="15" height="17" rx="2.4"/><path d="M8.5 8.5h7"/><path d="M8.5 12h7"/><path d="M8.5 15.5h4"/>',
    eye: '<path d="M2.8 12S6 6.6 12 6.6 21.2 12 21.2 12 18 17.4 12 17.4 2.8 12 2.8 12Z"/><circle cx="12" cy="12" r="2.8"/>',
    file: '<path d="M13.5 3.5H7A2 2 0 0 0 5 5.5v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9l-5.5-5.5Z"/><path d="M13.5 3.5V9H19"/>',
    lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2.2"/><path d="M8.2 10.5V8a3.8 3.8 0 0 1 7.6 0v2.5"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.4 2.3 3.6 5.2 3.6 8.5S14.4 18.2 12 20.5c-2.4-2.3-3.6-5.2-3.6-8.5S9.6 5.8 12 3.5Z"/>',
    logout: '<path d="M14.5 8V5.8A1.8 1.8 0 0 0 12.7 4H6.3A1.8 1.8 0 0 0 4.5 5.8v12.4A1.8 1.8 0 0 0 6.3 20h6.4a1.8 1.8 0 0 0 1.8-1.8V16"/><path d="M10 12h9.5"/><path d="M17 9.2 19.8 12 17 14.8"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><circle cx="12" cy="8" r=".9" fill="currentColor" stroke="none"/>',

    /* Navigation & actions */
    'chevron-right': '<path d="M9.5 5.5 16 12l-6.5 6.5"/>',
    'chevron-left': '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
    'chevron-down': '<path d="M5.5 9.5 12 16l6.5-6.5"/>',
    'arrow-left': '<path d="M20 12H4.5"/><path d="M10.5 5.5 4 12l6.5 6.5"/>',
    'arrow-right': '<path d="M4 12h15.5"/><path d="M13.5 5.5 20 12l-6.5 6.5"/>',
    close: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    check: '<path d="M5 12.8 9.6 17.5 19 7.5"/>',
    edit: '<path d="M4.5 19.5h4l10-10a2.1 2.1 0 0 0-3-3l-10 10v3Z"/><path d="M14 6.5l3 3"/>',
    share: '<circle cx="17.5" cy="6" r="2.6"/><circle cx="6.5" cy="12" r="2.6"/><circle cx="17.5" cy="18" r="2.6"/><path d="M15.2 7.3 8.9 10.7"/><path d="M8.9 13.3l6.3 3.4"/>',
    trash: '<path d="M4.5 7h15"/><path d="M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7"/><path d="M6.5 7l.9 12A1.6 1.6 0 0 0 9 20.5h6a1.6 1.6 0 0 0 1.6-1.5l.9-12"/>',
    filter: '<path d="M4 6.5h16"/><path d="M7 12h10"/><path d="M10 17.5h4"/>',
    qr: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.4"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.4"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.4"/><path d="M14 14h2.5v2.5H14z" fill="currentColor" stroke="none"/><path d="M17.5 17.5H20V20h-2.5z" fill="currentColor" stroke="none"/>',
    refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.4-5.5"/><path d="M19.8 4.5V9h-4.5"/>',

    /* Content */
    star: '<path d="m12 4.5 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.6-4.8 2.6.9-5.4L4.2 10.2l5.4-.8L12 4.5Z"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3.2 2"/>',
    calendar: '<rect x="4" y="6" width="16" height="14.5" rx="2.2"/><path d="M4 10.5h16"/><path d="M8.5 3.5V7"/><path d="M15.5 3.5V7"/>',
    'map-pin': '<path d="M12 21s6.5-5.6 6.5-10.4A6.5 6.5 0 0 0 5.5 10.6C5.5 15.4 12 21 12 21Z"/><circle cx="12" cy="10.4" r="2.4"/>',
    play: '<path d="M8.5 5.5 18 12l-9.5 6.5v-13Z"/>',
    sofa: '<path d="M5.5 11V8.2A2.2 2.2 0 0 1 7.7 6h8.6a2.2 2.2 0 0 1 2.2 2.2V11"/><path d="M4 13.2a2 2 0 0 1 4 0V16h8v-2.8a2 2 0 0 1 4 0V18a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18v-4.8Z"/>',
    popcorn: '<path d="M7 9.5h10l-1 10.5H8L7 9.5Z"/><path d="M7 9.5a2 2 0 0 1 .6-3.4A2.2 2.2 0 0 1 12 5a2.2 2.2 0 0 1 4.4 1.1A2 2 0 0 1 17 9.5"/>',
    wallet: '<rect x="3.5" y="6.5" width="17" height="12" rx="2.4"/><path d="M16 12.5h2.5"/><path d="M3.5 10h17"/>',
    bank: '<path d="M4 10 12 5l8 5"/><path d="M6 10v8"/><path d="M18 10v8"/><path d="M10 10v8"/><path d="M14 10v8"/><path d="M4 19.5h16"/>',
    cash: '<rect x="3" y="7" width="18" height="10" rx="2"/><circle cx="12" cy="12" r="2.4"/>',
    seat: '<path d="M6 10V7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v3"/><path d="M5 11.5h14v5.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 17v-5.5Z"/>',
    gift: '<rect x="4" y="9" width="16" height="11" rx="1.8"/><path d="M4 13h16"/><path d="M12 9v11"/><path d="M12 9c-2.5 0-4-1-4-2.4A2 2 0 0 1 12 6a2 2 0 0 1 4 .6C16 8 14.5 9 12 9Z"/>',
    sparkle: '<path d="m12 4 1.7 4.6 4.6 1.7-4.6 1.7L12 16.6l-1.7-4.6L5.7 10.3l4.6-1.7L12 4Z"/><path d="M18.5 16.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2Z"/>',
    tag: '<path d="M11 4H5.5A1.5 1.5 0 0 0 4 5.5V11l8.5 8.5a1.5 1.5 0 0 0 2.1 0l5-5a1.5 1.5 0 0 0 0-2.1L11 4Z"/><circle cx="8" cy="8" r="1.3"/>',
    phone: '<path d="M7.5 4.5h2l1.5 4-2 1.5a10 10 0 0 0 5 5l1.5-2 4 1.5v2a2 2 0 0 1-2 2A14.5 14.5 0 0 1 5.5 6.5a2 2 0 0 1 2-2Z"/>',
    mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2.2"/><path d="m4.5 7.5 7.5 5.5 7.5-5.5"/>',
    cake: '<path d="M5 20.5h14"/><path d="M5.5 15.5c1.5 1.5 3 0 4.3 0s2.7 1.5 4.3 0 2.4 0 3.9 0"/><path d="M5 20.5v-6.2A2.3 2.3 0 0 1 7.3 12h9.4a2.3 2.3 0 0 1 2.3 2.3v6.2"/><path d="M12 12V8.5"/><circle cx="12" cy="6.5" r="1.1"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2"/><path d="M12 19v2"/><path d="M3 12h2"/><path d="M19 12h2"/><path d="m5.6 5.6 1.4 1.4"/><path d="m17 17 1.4 1.4"/><path d="m18.4 5.6-1.4 1.4"/><path d="m7 17-1.4 1.4"/>',
    'alert-circle': '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v5"/><circle cx="12" cy="16" r=".9" fill="currentColor" stroke="none"/>',
    'ticket-check': '<path d="M3 9.5V7a1.5 1.5 0 0 1 1.5-1.5h15A1.5 1.5 0 0 1 21 7v2.5a2.5 2.5 0 0 0 0 5V17a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17v-2.5a2.5 2.5 0 0 0 0-5Z"/><path d="m8.5 12 2 2 4-4.5"/>',
    inbox: '<path d="M3.5 12.5 6 6h12l2.5 6.5v5a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5v-5Z"/><path d="M3.5 12.5H9a3 3 0 0 0 6 0h5.5"/>',
    building: '<rect x="5" y="3.5" width="14" height="17" rx="1.8"/><path d="M9 7.5h2"/><path d="M13 7.5h2"/><path d="M9 11.5h2"/><path d="M13 11.5h2"/><path d="M10.5 20.5v-4h3v4"/>',
    users: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3 19c.7-3 2.9-4.6 6-4.6s5.3 1.6 6 4.6"/><path d="M16 6.2a3.2 3.2 0 0 1 0 6.1"/><path d="M17.5 14.8c2 .6 3.2 2 3.6 4.2"/>',
    projector: '<rect x="3" y="8" width="18" height="9.5" rx="2.2"/><circle cx="9" cy="12.7" r="2.5"/><path d="M15 11h3"/><path d="M6.5 17.5V19"/><path d="M17.5 17.5V19"/>',
    chart: '<path d="M4 20V4"/><path d="M4 20h16"/><path d="M8 20v-6"/><path d="M12.5 20V9"/><path d="M17 20v-9.5"/>',
  };

  var SOLID = {
    home: '<path d="M11.3 3.3a1.1 1.1 0 0 1 1.4 0l7.5 6.2c.3.2.4.5.4.9V19a2 2 0 0 1-2 2h-4v-5.2a2.6 2.6 0 0 0-5.2 0V21h-4a2 2 0 0 1-2-2v-8.6c0-.4.1-.7.4-.9l7.5-6.2Z"/>',
    grid: '<rect x="3.5" y="3.5" width="7.6" height="7.6" rx="2"/><rect x="12.9" y="3.5" width="7.6" height="7.6" rx="2"/><rect x="3.5" y="12.9" width="7.6" height="7.6" rx="2"/><rect x="12.9" y="12.9" width="7.6" height="7.6" rx="2"/>',
    food: '<path d="M4.4 9.6h15.2l-1.3 9a2.6 2.6 0 0 1-2.6 2.2H8.3a2.6 2.6 0 0 1-2.6-2.2l-1.3-9Z"/><path d="M8.6 8.1V7.4a3.4 3.4 0 0 1 6.8 0v.7h-1.8v-.7a1.6 1.6 0 0 0-3.2 0v.7H8.6Z"/>',
    ticket: '<path d="M4.5 4.5h6v1a1 1 0 0 0 2 0v-1h7A1.5 1.5 0 0 1 21 6v3.2a2.8 2.8 0 0 0 0 5.6V18a1.5 1.5 0 0 1-1.5 1.5h-7v-1a1 1 0 0 0-2 0v1h-6A1.5 1.5 0 0 1 3 18v-3.2a2.8 2.8 0 0 0 0-5.6V6a1.5 1.5 0 0 1 1.5-1.5Zm7 4.3a1 1 0 0 0-2 0v1.4a1 1 0 0 0 2 0V8.8Zm0 4.4a1 1 0 0 0-2 0v1.4a1 1 0 0 0 2 0v-1.4Z"/>',
    user: '<circle cx="12" cy="7.8" r="4.1"/><path d="M12 13.8c-4 0-7 2.3-7.9 6.1a.9.9 0 0 0 .9 1.1h14a.9.9 0 0 0 .9-1.1c-.9-3.8-3.9-6.1-7.9-6.1Z"/>',
  };

  function svg(name, size, opts) {
    var o = opts || {};
    var body = o.solid ? SOLID[name] : STROKE[name];
    var solid = Boolean(o.solid && SOLID[name]);
    if (!body) body = STROKE[name] || STROKE.info;
    var s = size || 22;
    return (
      '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" aria-hidden="true" focusable="false" ' +
      'fill="' + (solid ? 'currentColor' : 'none') + '" ' +
      'stroke="' + (solid ? 'none' : 'currentColor') + '" ' +
      'stroke-width="' + (o.weight || 1.7) + '" stroke-linecap="round" stroke-linejoin="round">' +
      body +
      '</svg>'
    );
  }

  window.Icons = { svg: svg, names: Object.keys(STROKE) };
})();
