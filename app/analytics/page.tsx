
"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BarChart3, RefreshCw } from "lucide-react";

import RoleSidebar from "@/components/sidebar/RoleSidebar";
import { useCurrentUser } from "@/hooks/useCurrentUser";

import OwnerAnalytics from "@/components/analytics/OwnerAnalytics";
import ManagerAnalytics from "@/components/analytics/ManagerAnalytics";
import StaffAnalytics from "@/components/analytics/StaffAnalytics";

import RequirePermission from "@/components/permissions/RequirePermission";
import PlanFeatureGate from "@/components/permissions/PlanFeatureGate";

export default function AnalyticsPage() {
    const router = useRouter();
    const { user, loading } = useCurrentUser();

    const [refreshing, setRefreshing] = useState(false);

    const role = String(user?.role || "").toLowerCase();

    const canViewAnalytics =
        role === "owner" ||
        role === "manager" ||
        (role === "staff" &&
            user?.permissions?.analytics === true);

    useEffect(() => {
        if (loading || !user) return;

        if (!canViewAnalytics) {
            router.replace("/dashboard");
        }
    }, [loading, user, canViewAnalytics, router]);

    const handleRefresh = useCallback(() => {
        setRefreshing(true);

        window.dispatchEvent(
            new Event("stocknbook-refresh-analytics")
        );

        // The workspace manages the actual API loading state.
        // This button only triggers the refresh event.
        setRefreshing(false);
    }, []);

    if (loading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-[#FDFAF4]">
                <p className="text-sm text-[#81718D]">
                    Loading Analytics...
                </p>
            </div>
        );
    }

    if (!user || !canViewAnalytics) {
        return null;
    }

    return (
        <RequirePermission permission="analytics">
            <PlanFeatureGate feature="analytics">
                <div className="flex min-h-screen bg-[#FDFAF4]">
                    <RoleSidebar />

                    <main className="min-w-0 flex-1 p-5 lg:p-8">
                        <div className="mx-auto max-w-7xl space-y-6">

                            {/* PAGE HEADER */}

                            <div className="flex flex-wrap items-center justify-between gap-4">
                                <div className="flex items-start gap-3">
                                    <div className="rounded-xl bg-[#EEE5F5] p-3 text-[#7651A5]">
                                        <BarChart3 size={22} />
                                    </div>

                                    <div>
                                        <h1 className="text-2xl font-bold text-[#302044]">
                                            Analytics
                                        </h1>

                                        <p className="mt-1 text-sm text-[#81718D]">
                                            Understand historical sales,
                                            product demand, bookings,
                                            packages, and branch performance.
                                        </p>
                                    </div>
                                </div>

                                <button
                                    type="button"
                                    onClick={handleRefresh}
                                    disabled={refreshing}
                                    className="flex items-center gap-2 rounded-lg border border-[#DDD2E8] bg-white px-4 py-2.5 text-sm font-semibold text-[#7651A5] transition hover:bg-[#F7F1FA] disabled:opacity-50"
                                >
                                    <RefreshCw
                                        size={16}
                                        className={
                                            refreshing
                                                ? "animate-spin"
                                                : ""
                                        }
                                    />

                                    Refresh Analytics
                                </button>
                            </div>

                            {/* ROLE-SPECIFIC ANALYTICS */}

                            {role === "owner" && (
                                <OwnerAnalytics />
                            )}

                            {role === "manager" && (
                                <ManagerAnalytics />
                            )}

                            {role === "staff" && (
                                <StaffAnalytics />
                            )}
                        </div>
                    </main>
                </div>
            </PlanFeatureGate>
        </RequirePermission>
    );
}
