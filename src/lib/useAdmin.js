import { useCallback, useState } from 'react';
import { clearAdminToken, getAdminToken, saveAdminToken } from './storage';

export function useAdminToken() {
  const [admin, setAdmin] = useState(() => getAdminToken());
  const signIn = useCallback((token, expiresAt) => {
    saveAdminToken(token, expiresAt);
    setAdmin({ token, expiresAt });
  }, []);
  const signOut = useCallback(() => {
    clearAdminToken();
    setAdmin(null);
  }, []);
  return { admin, signIn, signOut };
}
