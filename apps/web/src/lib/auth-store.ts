import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AuthUser {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
}

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: AuthUser | null;
  activeOrganizationId: string | null;
  setSession: (input: { accessToken: string; refreshToken: string; user: AuthUser }) => void;
  setActiveOrganization: (organizationId: string) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      activeOrganizationId: null,
      setSession: ({ accessToken, refreshToken, user }) => set({ accessToken, refreshToken, user }),
      setActiveOrganization: (organizationId) => set({ activeOrganizationId: organizationId }),
      clear: () => set({ accessToken: null, refreshToken: null, user: null, activeOrganizationId: null }),
    }),
    { name: "korva-auth" },
  ),
);
