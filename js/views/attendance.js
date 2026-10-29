// Attendance: Roll Call (student card scanning, rotating lecture QR, registers and records) inside Teacher’s Desk.
// It keeps its registers in this site's storage; Teacher’s Desk includes them in backups and in your account.
import { h } from '../ui.js';

export function renderAttendance(root) {
  const frame = h('iframe', { class: 'att-frame', src: 'attendance/index.html', title: 'Attendance', allow: 'camera; fullscreen; clipboard-write' });
  root.append(h('div', { class: 'att-wrap' }, frame));
  return null;
}
