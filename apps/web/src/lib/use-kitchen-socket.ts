"use client";

import { useEffect } from "react";
import { io } from "socket.io-client";
import { useAuthStore } from "@/lib/auth-store";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
// The kitchen gateway is mounted at the HTTP server's root (NestJS's setGlobalPrefix only
// applies to REST controllers, not WebSocket gateways) — strip the /api/v1 suffix every REST
// call uses to get back to the bare origin the socket needs to connect to.
const SOCKET_ORIGIN = API_URL.replace(/\/api\/v1\/?$/, "");

/** Subscribes to the /kitchen namespace and calls `onChange` every time the server signals
 *  something changed — the caller decides what to do (typically invalidate a react-query key
 *  and let the normal REST fetch pick up the new state; see kitchen.gateway.ts's own doc
 *  comment for why the socket carries no payload of its own). No-ops until both an access
 *  token and an active organization are known. */
export function useKitchenSocket(onChange: () => void) {
  const accessToken = useAuthStore((state) => state.accessToken);
  const activeOrganizationId = useAuthStore((state) => state.activeOrganizationId);

  useEffect(() => {
    if (!accessToken || !activeOrganizationId) return;

    const socket = io(`${SOCKET_ORIGIN}/kitchen`, {
      auth: { token: accessToken, organizationId: activeOrganizationId },
      reconnectionDelay: 2000,
    });
    socket.on("kitchen.changed", onChange);

    return () => {
      socket.close();
    };
    // onChange is intentionally not a dependency: callers typically pass a fresh closure each
    // render, and reconnecting the socket on every render (rather than only when the token/org
    // actually changes) would thrash the connection for no reason. The socket always calls
    // whatever `onChange` was most recently in scope via the closure captured when this effect
    // last ran.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, activeOrganizationId]);
}
