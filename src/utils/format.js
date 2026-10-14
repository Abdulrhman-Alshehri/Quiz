const number = new Intl.NumberFormat('en-US');

export function points(value) {
  return number.format(Math.round(value || 0));
}

export function seconds(ms) {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return '–';
  return `${(ms / 1000).toFixed(1)} s`;
}

export function percent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '–';
  const n = Number(value);
  return `${Number.isInteger(n) ? n : n.toFixed(1)}%`;
}

export function ordinal(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

export function dateTime(value) {
  const d = new Date(String(value || '').replace(/(\.\d{3})\d+/, '$1'));
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

export function fileStamp(date = new Date()) {
  const pad = (x) => String(x).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}
