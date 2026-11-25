/* Apply the saved theme before first paint, so the page never flashes the wrong colours. */
(function () {
  'use strict';
  var theme = null;
  try { theme = localStorage.getItem('sat:theme') || localStorage.getItem('cti-analyst:theme'); } catch (e) { /* storage blocked */ }
  if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);
}());
