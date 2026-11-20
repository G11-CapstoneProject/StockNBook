"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Role = "owner" | "manager" | "staff";
type AccessLevel = "none" | "view" | "full";

/*
 * Branch Managers receive every Manager-role module automatically once their
 * account is active (the backend enforces the same rule independently and
 * still limits Managers to their assigned branch). Owner-only pages use
 * `ownerOnly` and are never part of this set. Subscription-plan locks for
 * Analytics/Forecasting are enforced separately by PlanFeatureGate and the API.
 */
const MANAGER_ROLE_MODULES = new Set([
    "dashboard",
    "bookings",
    "inventory",
    "packages",
    "packages_manage",
    "pos",
    "reports",
    "analytics",
    "forecasting",
    "staff_management",
]);

function getSessionPermissions() {
    if (typeof window === "undefined") return {};

    try {
        return JSON.parse(sessionStorage.getItem("permissions") || "{}") as Record<
            string,
            boolean | string
        >;
    } catch {
        return {};
    }
}

/*
 * Each module's permission is stored as ONE value — "full" | "view" | "none"
 * (see permissionAccessLevel in the API / SetupScreen.tsx). Legacy boolean
 * `true`/`false` are also accepted for backwards compatibility.
 *
 * Previously this function required permissions[permission] to be the
 * literal boolean `true` AND looked for a separate `${permission}_access`
 * key that is never actually set anywhere in the app — so any module
 * granted "full" or "view" access (a string) was always read as "none",
 * and RequirePermission redirected the user back to /dashboard even
 * though the owner had granted access.
 */
function getAccessLevel(
    permissions: Record<string, boolean | string>,
    permission?: string
): AccessLevel {
    if (!permission) return "full";

    const value = permissions[permission];

    if (
        value === true ||
        value === "true" ||
        value === "full"
    ) {
        return "full";
    }

    if (
        value === "view" ||
        value === "view_only" ||
        value === "viewOnly"
    ) {
        return "view";
    }

    // Covers false, "none", undefined, null, "", etc.
    return "none";
}

function checkAccess(permission?: string, ownerOnly = false) {
    if (typeof window === "undefined") return false;

    const token = sessionStorage.getItem("token") || localStorage.getItem("token");
    const role = (sessionStorage.getItem("role") || "") as Role;

    if (!token) {
        return false;
    }

    if (ownerOnly) {
        return role === "owner";
    }

    if (role === "owner") {
        return true;
    }

    // Role-based Manager access: an older session snapshot with disabled
    // module flags must not hide an authorized Manager module.
    if (role === "manager" && (!permission || MANAGER_ROLE_MODULES.has(permission))) {
        return true;
    }

    const permissions = getSessionPermissions();

    // Existing managers may have legacy permission records without these two
    // fields. Treat missing fields as the original manager defaults, but never
    // override an explicit denial. PlanFeatureGate and backend API guards
    // still independently enforce the store's effective subscription tier.
    if (
        role === "manager" &&
        (permission === "analytics" || permission === "forecasting") &&
        !Object.prototype.hasOwnProperty.call(permissions, permission)
    ) {
        return true;
    }

    const accessLevel = getAccessLevel(permissions, permission);

    return accessLevel !== "none";
}

export default function RequirePermission({
                                              permission,
                                              ownerOnly = false,
                                              children,
                                          }: {
    permission?: string;
    ownerOnly?: boolean;
    children: React.ReactNode;
}) {
    const router = useRouter();

    const [mounted, setMounted] = useState(false);
    const [allowed, setAllowed] = useState(false);

    useEffect(() => {
        setMounted(true);

        const token = sessionStorage.getItem("token") || localStorage.getItem("token");
        const role = (sessionStorage.getItem("role") || "") as Role;

        if (!token) {
            setAllowed(false);
            router.push("/");
            return;
        }

        if (ownerOnly && role !== "owner") {
            setAllowed(false);
            router.push("/dashboard");
            return;
        }

        const isAllowed = checkAccess(permission, ownerOnly);

        if (!isAllowed) {
            setAllowed(false);
            router.push("/dashboard");
            return;
        }

        setAllowed(true);
    }, [router, permission, ownerOnly]);

    if (!mounted) return null;

    if (!allowed) return null;

    return <>{children}</>;
}