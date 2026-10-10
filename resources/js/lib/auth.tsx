import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useLocation, useRouter } from '@tanstack/react-router';
import { useUser, useLogin, useRegister, useLogout } from './queries';

interface User {
  id: number;
  name: string;
  email: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string, remember?: boolean) => Promise<void>;
  register: (name: string, email: string, password: string, password_confirmation: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const isLoginPage = location.pathname === '/login';
  
  const { data: user, isLoading, refetch } = useUser({
    enabled: !isLoginPage,
  });
  const loginMutation = useLogin();
  const registerMutation = useRegister();
  const logoutMutation = useLogout();
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      setIsAuthenticated(!!user);
    }
  }, [user, isLoading]);

  const login = async (email: string, password: string, remember = false) => {
    await loginMutation.mutateAsync({ email, password, remember });
    await refetch();
    setIsAuthenticated(true);
  };

  const register = async (name: string, email: string, password: string, password_confirmation: string) => {
    await registerMutation.mutateAsync({ name, email, password, password_confirmation });
    await refetch();
    setIsAuthenticated(true);
  };

  const logout = async () => {
    await logoutMutation.mutateAsync();
    setIsAuthenticated(false);
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}