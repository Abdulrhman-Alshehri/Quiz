// Same rules as join_session in the database, so people see problems before sending.
export const NAME_MAX = 30;

export function normalizeName(raw) {
  return String(raw || '').trim().replace(/\s+/g, ' ');
}

export function validateName(raw) {
  const name = normalizeName(raw);
  if (!name) return 'NAME_REQUIRED';
  if (name.length > NAME_MAX) return 'NAME_TOO_LONG';
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) return 'NAME_INVALID';
  return null;
}
