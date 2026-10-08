"use client";

import { useCallback, useEffect, useState } from "react";

export type CurrentUser = {
    role: "owner" | "manager" | "staff";
    store_id?: number | string;
    store_name?: string;
    owner_name?: string;
    branch_id?: number | string;
    branch_name?: string;
    manager_id?: number | string;
    manager_name?: string;
    staff_id?: number | string;
    staff_name?: string;
    permissions?: Record<string, boolean | string>;
};

const REFRESH_INTERVAL = 15000;
const SHARED_RESPONSE_TTL = 2_000;

type CurrentUserResponse = {
    ok: boolean;
    status: number;
    data: CurrentUser & { error?: string };
};

/*
 * useCurrentUser is mounted by the dashboard page, role sidebar, permission
 * gates, and role dashboard components. A ref inside the hook only protects a
 * single component instance, so several instances could still request
 * /api/current-user at the same time. Keep one module-level request/result so
 * all hook instances share the same network call during a render/focus burst.
 */
let sharedRequest: Promise<CurrentUserResponse> | null = null;
let sharedRequestToken = "";
let sharedResult: CurrentUserResponse | null = null;
let sharedResultToken = "";
let sharedResultAt = 0;

function getToken() {
    if (typeof window === "undefined") return "";
    return sessionStorage.getItem("token") || localStorage.getItem("token") || "";
}

function getSessionUser(): CurrentUser | null {
    if (typeof window === "undefined") return null;

    const role = sessionStorage.getItem("role") as CurrentUser["role"] | null;

    if (!role) return null;

    let permissions: Record<string, boolean | string> = {};

    try {
        permissions = JSON.parse(sessionStorage.getItem("permissions") || "{}");
    } catch {
        permissions = {};
    }

    return {
        role,
        store_id: sessionStorage.getItem("store_id") || "",
        store_name: sessionStorage.getItem("store_name") || "",
        owner_name: sessionStorage.getItem("owner_name") || "",
        branch_id: sessionStorage.getItem("branch_id") || "",
        branch_name: sessionStorage.getItem("branch_name") || "",
        manager_id: sessionStorage.getItem("manager_id") || "",
        manager_name: sessionStorage.getItem("manager_name") || "",
        staff_id: sessionStorage.getItem("staff_id") || "",
        staff_name: sessionStorage.getItem("staff_name") || "",
        permissions,
    };
}

function syncUserToSession(user: CurrentUser) {
    if (typeof window === "undefined") return;

    sessionStorage.setItem("role", user.role || "");

    if (user.store_id) sessionStorage.setItem("store_id", String(user.store_id));
    if (user.store_name) sessionStorage.setItem("store_name", user.store_name);
    if (user.owner_name) sessionStorage.setItem("owner_name", user.owner_name);

    if (user.branch_id) sessionStorage.setItem("branch_id", String(user.branch_id));
    if (user.branch_name) sessionStorage.setItem("branch_name", user.branch_name);

    if (user.manager_id) sessionStorage.setItem("manager_id", String(user.manager_id));
    if (user.manager_name) sessionStorage.setItem("manager_name", user.manager_name);

    if (user.staff_id) sessionStorage.setItem("staff_id", String(user.staff_id));
    if (user.staff_name) sessionStorage.setItem("staff_name", user.staff_name);

    sessionStorage.setItem("permissions", JSON.stringify(user.permissions || {}));
}

function hasUserChanged(oldUser: CurrentUser | null, newUser: CurrentUser) {
    if (!oldUser) return true;
    return JSON.stringify(oldUser) !== JSON.stringify(newUser);
}

async function requestCurrentUser(
    token: string,
    force = false,
): Promise<CurrentUserResponse> {
    const now = Date.now();

    if (
        !force &&
        sharedResult &&
        sharedResultToken === token &&
        now - sharedResultAt < SHARED_RESPONSE_TTL
    ) {
        return sharedResult;
    }

    if (sharedRequest && sharedRequestToken === token) {
        return sharedRequest;
    }

    sharedRequestToken = token;

    const request = (async () => {
        const res = await fetch("/api/current-user", {
            method: "GET",
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/json",
            },
            cache: "no-store",
        });

        let data: CurrentUser & { error?: string };

        try {
            data = await res.json();
        } catch {
            throw new Error(
                `Current-user API returned an invalid response (${res.status})`,
            );
        }

        return {
            ok: res.ok,
            status: res.status,
            data,
        };
    })();

    sharedRequest = request;

    try {
        const result = await request;

        // Cache only successful identity responses. Authentication failures
        // should remain authoritative and network/server errors are handled by
        // the caller without replacing a valid session snapshot.
        if (result.ok) {
            sharedResult = result;
            sharedResultToken = token;
            sharedResultAt = Date.now();
        }

        return result;
    } finally {
        if (sharedRequest === request) {
            sharedRequest = null;
            sharedRequestToken = "";
        }
    }
}

export function useCurrentUser() {
    const [user, setUser] = useState<CurrentUser | null>(() => getSessionUser());
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const loadUser = useCallback(async (silent = false, force = false) => {
        const cachedUser = getSessionUser();

        if (cachedUser) {
            setUser(cachedUser);

            if (!silent) {
                setLoading(false);
            }
        } else if (!silent) {
            setLoading(true);
        }

        const token = getToken();

        if (!token) {
            setUser(null);
            setError("Missing token");

            if (!silent) {
                setLoading(false);
            }

            return;
        }

        try {
            const result = await requestCurrentUser(token, force);
            const data = result.data;

            if (!result.ok) {
                /*
                 * A real 401/403 means the server rejected the token.
                 * Other server failures should not erase a valid cached user.
                 */
                if (result.status === 401 || result.status === 403) {
                    setUser(null);
                    setError(data.error || "Unauthorized");
                } else {
                    setError(
                        data.error ||
                        `Failed to refresh user (${result.status})`,
                    );
                }

                return;
            }

            syncUserToSession(data);

            setUser((previousUser) => {
                if (hasUserChanged(previousUser, data)) {
                    window.dispatchEvent(
                        new Event("stocknbook-current-user-refreshed"),
                    );

                    return data;
                }

                return previousUser;
            });

            setError("");
        } catch (err) {
            /*
             * Network errors such as "Failed to fetch" should not wipe out
             * the cached logged-in user. Keep the cached session so pages can
             * continue using the correct account data.
             */
            const message =
                err instanceof Error
                    ? err.message
                    : "Failed to load user";

            console.warn("current-user refresh unavailable:", message);

            if (!cachedUser) {
                setUser(null);
                setError("Failed to load user");
            } else {
                setUser(cachedUser);
                setError("");
            }
        } finally {
            if (!silent) {
                setLoading(false);
            }
        }
    }, []);

    useEffect(() => {
        void loadUser(false);

        const refreshSilently = () => {
            void loadUser(true);
        };

        const refreshPermissions = () => {
            void loadUser(true, true);
        };

        const interval = window.setInterval(refreshSilently, REFRESH_INTERVAL);

        window.addEventListener("stocknbook-permissions-updated", refreshPermissions);
        window.addEventListener("focus", refreshSilently);

        return () => {
            window.clearInterval(interval);
            window.removeEventListener("stocknbook-permissions-updated", refreshPermissions);
            window.removeEventListener("focus", refreshSilently);
        };
    }, [loadUser]);

    return { user, loading, error, refreshUser: loadUser };
}