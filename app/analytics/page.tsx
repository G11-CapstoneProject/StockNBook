"use client";

import { useCurrentUser } from "@/hooks/useCurrentUser";
import { AnalyticsLoadingScreen } from "@/components/analytics/_shared";
import OwnerAnalytics from "@/components/analytics/OwnerAnalytics";
import ManagerAnalytics from "@/components/analytics/ManagerAnalytics";
import StaffAnalytics from "@/components/analytics/StaffAnalytics";

export default function AnalyticsPage() {
    const { user, loading } = useCurrentUser();

    if (loading) {
        return <AnalyticsLoadingScreen />;
    }

    if (!user) {
        return null;
    }

    const currentUser = user as {
        role?: string;
    };

    const role = String(currentUser.role || "").trim().toLowerCase();

    if (role === "owner") {
        return <OwnerAnalytics />;
    }

    if (role === "manager") {
        return <ManagerAnalytics />;
    }

    return <StaffAnalytics />;
}
