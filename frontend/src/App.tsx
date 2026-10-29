import React, { useCallback, useState } from 'react';
import { sessionStore } from './api';
import type { StoredSession } from './types';
import { LoginPage } from './components/LoginPage';
import { ClinicianPortal } from './components/ClinicianPortal';
import { PatientPortal } from './components/PatientPortal';

/** Front door: log in as a clinician or as a patient, then open that portal. */
export const App: React.FC = () => {
  const [session, setSession] = useState<StoredSession | null>(() => sessionStore.get());
  const [newCode, setNewCode] = useState<string | null>(null);

  const loggedIn = useCallback((s: StoredSession, extra?: { newCode?: string }) => {
    sessionStore.set(s);
    setNewCode(extra?.newCode ?? null);
    setSession(s);
  }, []);

  const logout = useCallback(() => {
    sessionStore.clear();
    setNewCode(null);
    setSession(null);
  }, []);

  if (!session) return <LoginPage onLoggedIn={loggedIn} />;
  if (session.kind === 'clinician') {
    return <ClinicianPortal key={session.token} token={session.token} name={session.name} onLogout={logout} />;
  }
  return <PatientPortal key={session.token} token={session.token} name={session.name} newCode={newCode} onLogout={logout} />;
};
