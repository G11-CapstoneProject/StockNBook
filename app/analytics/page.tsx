"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { AnalyticsLoadingScreen } from "@/components/analytics/_shared";
import OwnerAnalytics from "@/components/analytics/OwnerAnalytics";
import ManagerAnalytics from "@/components/analytics/ManagerAnalytics";
import StaffAnalytics from "@/components/analytics/StaffAnalytics";

export default function AnalyticsPage() {
    const { user, loading } = useCurrentUser();
    const router = useRouter();

    const currentUser = user as {
        role?: string;
        permissions?: Record<string, boolean | string>;
    } | null;

    const role = String(currentUser?.role || "").trim().toLowerCase();
    const hasAnalyticsAccess = currentUser?.permissions?.analytics === true;

    useEffect(() => {
        if (loading || !currentUser) return;

        if (role === "staff" && !hasAnalyticsAccess) {
            router.push("/dashboard");
        }
    }, [loading, currentUser, role, hasAnalyticsAccess, router]);

    if (loading) {
        return <AnalyticsLoadingScreen />;
    }

    if (!user) {
        return null;
    }

    if (role === "owner") {
        return <OwnerAnalytics />;
    }

    if (role === "manager") {
        return <ManagerAnalytics />;
    }

    if (!hasAnalyticsAccess) {
        return null;
    }

    return <StaffAnalytics />;
}