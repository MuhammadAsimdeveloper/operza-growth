import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api } from './api';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface Agency {
  id: string;
  name: string;
}

export interface Location {
  id: string;
  name: string;
}

interface AuthState {
  user: AuthUser | null;
  agency: Agency | null;
  locations: Location[];
  activeLocation: Location | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

interface AuthActions {
  login: (email: string, password: string) => Promise<void>;
  signup: (data: { name: string; email: string; password: string; agencyName?: string }) => Promise<void>;
  logout: () => Promise<void>;
  switchLocation: (locationId: string) => void;
}

type AuthContextValue = AuthState & AuthActions;

const AuthContext = createContext<AuthContextValue | null>(null);

const ACTIVE_LOCATION_KEY = 'operza_active_location';

function parseSession(data: any): Pick<AuthState, 'user' | 'agency' | 'locations' | 'activeLocation'> {
  const user: AuthUser = data.user ?? { id: data.id ?? '', name: data.name ?? '', email: data.email ?? '', role: data.role ?? 'admin' };
  const agency: Agency = data.agency ?? { id: data.agencyId ?? '', name: data.agencyName ?? 'My Agency' };
  const locations: Location[] = data.locations ?? [];

  // Restore saved active location from localStorage, or pick the first
  const savedLocId = localStorage.getItem(ACTIVE_LOCATION_KEY);
  let activeLocation: Location | null = null;
  if (locations.length > 0) {
    activeLocation = locations.find((l) => l.id === savedLocId) ?? locations[0];
    localStorage.setItem(ACTIVE_LOCATION_KEY, activeLocation.id);
  }

  return { user, agency, locations, activeLocation };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    agency: null,
    locations: [],
    activeLocation: null,
    isAuthenticated: false,
    isLoading: true,
  });

  // Check session on mount
  useEffect(() => {
    let cancelled = false;
    api.auth
      .session()
      .then((data: any) => {
        if (cancelled) return;
        const parsed = parseSession(data);
        setState({
          ...parsed,
          isAuthenticated: true,
          isLoading: false,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setState((prev) => ({ ...prev, isLoading: false }));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await api.auth.login({ email, password });
    const parsed = parseSession(data);
    setState({
      ...parsed,
      isAuthenticated: true,
      isLoading: false,
    });
  }, []);

  const signup = useCallback(async (data: { name: string; email: string; password: string; agencyName?: string }) => {
    const res = await api.auth.signup(data);
    const parsed = parseSession(res);
    setState({
      ...parsed,
      isAuthenticated: true,
      isLoading: false,
    });
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.auth.logout();
    } catch {
      // Even if API call fails, clear local state
    }
    localStorage.removeItem(ACTIVE_LOCATION_KEY);
    setState({
      user: null,
      agency: null,
      locations: [],
      activeLocation: null,
      isAuthenticated: false,
      isLoading: false,
    });
  }, []);

  const switchLocation = useCallback((locationId: string) => {
    setState((prev) => {
      const loc = prev.locations.find((l) => l.id === locationId);
      if (!loc) return prev;
      localStorage.setItem(ACTIVE_LOCATION_KEY, loc.id);
      return { ...prev, activeLocation: loc };
    });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      login,
      signup,
      logout,
      switchLocation,
    }),
    [state, login, signup, logout, switchLocation],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
