import { useEffect, useState } from 'react';

// Hash routing (#/join, #/play, #/admin ...) so every link works on GitHub Pages,
// which cannot rewrite unknown paths to index.html.
export function parseHash(hash = window.location.hash) {
  const raw = hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  return { path: path || '/', query: new URLSearchParams(qs || '') };
}

export function useRoute() {
  const [route, setRoute] = useState(() => parseHash());
  useEffect(() => {
    const onChange = () => {
      setRoute(parseHash());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function navigate(to, { replace = false } = {}) {
  const target = to.startsWith('#') ? to : `#${to}`;
  if (replace) {
    window.history.replaceState(null, '', target);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    window.location.hash = target;
  }
}

export function appBaseUrl() {
  return `${window.location.origin}${window.location.pathname}`;
}

export function joinUrl(code) {
  return `${appBaseUrl()}#/join${code ? `?code=${encodeURIComponent(code)}` : ''}`;
}

export function screenUrl(code) {
  return `${appBaseUrl()}#/screen/${encodeURIComponent(code)}`;
}
