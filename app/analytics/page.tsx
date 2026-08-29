"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import RoleSidebar from "@/components/sidebar/RoleSidebar";
import RequirePermission from "@/components/permissions/RequirePermission";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { AnalyticsLoadingScreen } from "@/components/analytics/_shared";
import OwnerAnalytics from "@/components/analytics/OwnerAnalytics";
import ManagerAnalytics from "@/components/analytics/ManagerAnalytics";
import StaffAnalytics from "@/components/analytics/StaffAnalytics";
import PlanFeatureGate from "@/components/permissions/PlanFeatureGate";

function formatCurrentDateTime(value: Date) {
    const dateLabel = value.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
    });

    const timeLabel = value
        .toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
        })
        .toLowerCase();

    return `${dateLabel} | ${timeLabel}`;
}

export default function AnalyticsPage() {
    const { user, loading: userLoading } = useCurrentUser();
    const router = useRouter();
    const [currentDateTime, setCurrentDateTime] = useState<Date | null>(null);

    const currentUser = user as {
        role?: string;
        permissions?: Record<string, boolean | string>;
    } | null;

    const role = String(currentUser?.role || "").trim().toLowerCase();
    const hasAnalyticsAccess = currentUser?.permissions?.analytics === true;

    useEffect(() => {
        const updateTime = () => setCurrentDateTime(new Date());

        updateTime();
        const timer = window.setInterval(updateTime, 30_000);

        return () => window.clearInterval(timer);
    }, []);

    useEffect(() => {
        if (userLoading || !currentUser) return;

        if (role === "staff" && !hasAnalyticsAccess) {
            router.push("/dashboard");
        }
    }, [userLoading, currentUser, role, hasAnalyticsAccess, router]);

    if (userLoading) {
        return <AnalyticsLoadingScreen />;
    }

    if (!user) {
        return null;
    }

    const subtitle =
        role === "owner"
            ? "Track sales performance, customer demand, and business insights across branches"
            : role === "staff"
                ? "Review analytics and performance insights for your assigned branch"
                : "Review sales performance, customer demand, and branch insights";

    return (
        <RequirePermission>
            <div className="flex min-h-screen bg-[#FDFAF4] font-sans text-[#1A1220]">
                <RoleSidebar />

                <main className="min-w-0 flex-1 overflow-y-auto">
                    <header className="sticky top-0 z-20 border-b border-[#E9E0EF] bg-[#FFFDF8]/95 backdrop-blur">
                        <div className="flex min-h-[72px] flex-wrap items-center justify-between gap-4 px-6 py-3">
                            <div>
                                <div className="flex flex-wrap items-center gap-2.5">
                                    <h1 className="text-[25px] font-bold text-[#1A1220]">
                                        Analytics &amp; Forecasting
                                    </h1>
                                    <span className="inline-flex h-[34px] items-center rounded-xl border border-[#E7D9FF] bg-[#FAF6FF] px-3 text-xs font-semibold text-[#5E32A7]">
                                        Premium Feature
                                    </span>
                                </div>
                                <p className="mt-0.5 text-xs text-[#7A6A84]">
                                    {subtitle}
                                </p>
                            </div>

                            <div className="flex items-center gap-2.5">
                                <span className="inline-flex h-[42px] items-center rounded-xl border border-[#E6DDF0] bg-white px-3.5 text-sm font-semibold text-[#2B174C] shadow-sm">
                                    {currentDateTime
                                        ? formatCurrentDateTime(currentDateTime)
                                        : "Loading date..."}
                                </span>

                                <button
                                    type="button"
                                    onClick={() => window.location.reload()}
                                    className="inline-flex h-[42px] items-center gap-2 rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31]"
                                >
                                    <RefreshCw size={16} />
                                    Refresh
                                </button>
                            </div>
                        </div>
                    </header>

                    <section className="px-6 py-4">
                        <PlanFeatureGate feature="analytics">
                            {role === "owner" ? (
                                <OwnerAnalytics />
                            ) : role === "manager" ? (
                                <ManagerAnalytics />
                            ) : hasAnalyticsAccess ? (
                                <StaffAnalytics />
                            ) : null}
                        </PlanFeatureGate>
                    </section>
                </main>
            </div>
        </RequirePermission>
    );
}
