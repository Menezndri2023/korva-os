import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

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
  /** Set in a tab KORVA's administration opened on this business ("Voir son tableau de bord"):
   *  a read-only token, never refreshed, never written to this browser's saved session. */
  viewOnly: { expiresAt: string } | null;
  setSession: (input: { accessToken: string; user: AuthUser }) => void;
  setAccessToken: (accessToken: string | null) => void;
  setActiveOrganization: (organizationId: string) => void;
  setBootstrapped: (value: boolean) => void;
  enterViewMode: (input: {
    accessToken: string;
    user: AuthUser;
    organizationId: string;
    expiresAt: string;
  }) => void;
  clear: () => void;
}

/**
 * Once a tab has entered view mode it never writes the saved session again (for its whole life,
 * even after the view ends): localStorage is shared by every tab, and the administrator's own
 * session — or the owner's, on a shared computer — must not be overwritten by the view.
 */
let viewTab = false;
// `globalThis.localStorage?.`: absent during server rendering (and in some test runtimes), where
// there is simply no saved session — exactly what zustand's own default storage does.
const sessionStorageOfThisBrowser = createJSONStorage(() => ({
  getItem: (name: string) => globalThis.localStorage?.getItem(name) ?? null,
  setItem: (name: string, value: string) => {
    if (!viewTab) globalThis.localStorage?.setItem(name, value);
  },
  removeItem: (name: string) => {
    if (!viewTab) globalThis.localStorage?.removeItem(name);
  },
}));

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      user: null,
      activeOrganizationId: null,
      bootstrapped: false,
      viewOnly: null,
      setSession: ({ accessToken, user }) => set({ accessToken, user }),
      setAccessToken: (accessToken) => set({ accessToken }),
      setActiveOrganization: (organizationId) => set({ activeOrganizationId: organizationId }),
      setBootstrapped: (value) => set({ bootstrapped: value }),
      enterViewMode: ({ accessToken, user, organizationId, expiresAt }) => {
        viewTab = true;
        set({
          accessToken,
          user,
          activeOrganizationId: organizationId,
          bootstrapped: true,
          viewOnly: { expiresAt },
        });
      },
      clear: () => set({ accessToken: null, user: null, activeOrganizationId: null }),
    }),
    {
      name: "korva-auth",
      storage: sessionStorageOfThisBrowser,
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
