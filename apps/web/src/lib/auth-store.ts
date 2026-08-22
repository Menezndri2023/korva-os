import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AuthUser {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
}

interface AuthState {
  /** In-memory only — never persisted. Reset to null on every full page load; recovered via
   *  the HttpOnly refresh cookie by useAuthBootstrap(). */
  accessToken: string | null;
  user: AuthUser | null;
  activeOrganizationId: string | null;
  /** True once the initial silent-refresh attempt (see useAuthBootstrap) has resolved. */
  bootstrapped: boolean;
  setSession: (input: { accessToken: string; user: AuthUser }) => void;
  setAccessToken: (accessToken: string | null) => void;
  setActiveOrganization: (organizationId: string) => void;
  setBootstrapped: (value: boolean) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      user: null,
      activeOrganizationId: null,
      bootstrapped: false,
      setSession: ({ accessToken, user }) => set({ accessToken, user }),
      setAccessToken: (accessToken) => set({ accessToken }),
      setActiveOrganization: (organizationId) => set({ activeOrganizationId: organizationId }),
      setBootstrapped: (value) => set({ bootstrapped: value }),
      clear: () => set({ accessToken: null, user: null, activeOrganizationId: null }),
    }),
    {
      name: "korva-auth",
      // The access token lives in memory only, and the refresh token never enters this store
      // at all (it's an HttpOnly cookie set by the API) — only non-sensitive UX state is
      // persisted. This also self-heals any pre-existing browser that still has an old
      // access/refresh token in this same localStorage key from before this change: the next
      // write (triggered by useAuthBootstrap on load) overwrites the stored blob with this
      // shape, dropping the stale token fields entirely.
      partialize: (state) => ({
        user: state.user,
        activeOrganizationId: state.activeOrganizationId,
      }),
    },
  ),
);
