"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Role = "owner" | "manager" | "staff";
type AccessLevel = "none" | "view" | "full";

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

function getAccessLevel(
    permissions: Record<string, boolean | string>,
    permission?: string
): AccessLevel {
    if (!permission) return "full";

    const directAccess = permissions[permission];

    const levelAccess =
        permissions[`${permission}_access`] ||
        (permission === "packages" ? permissions.package_access : undefined);

    if (directAccess !== true) return "none";

    if (levelAccess === "full") return "full";
    if (levelAccess === "view") return "view";
    if (levelAccess === "none") return "none";

    return "full";
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

    const permissions = getSessionPermissions();
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

