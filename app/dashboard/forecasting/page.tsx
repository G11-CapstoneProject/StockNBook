"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import RoleSidebar from "@/components/sidebar/RoleSidebar";
import RequirePermission from "@/components/permissions/RequirePermission";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import ManagerForecast from "@/components/forecasting/ManagerForecast";
import OwnerForecast from "@/components/forecasting/OwnerForecast";
import StaffForecast from "@/components/forecasting/staffForecast";
import {
    formatCurrentDateTime,
    useLiveForecasting,
} from "@/components/forecasting/_shared";

export default function ForecastingPage() {
    const { user, loading: userLoading } = useCurrentUser();
    const forecast = useLiveForecasting();
    const [currentDateTime, setCurrentDateTime] = useState<Date | null>(null);

    const role = String(
        (user as { role?: string } | null)?.role || ""
    ).toLowerCase();

    useEffect(() => {
        const updateTime = () => setCurrentDateTime(new Date());

        updateTime();
        const timer = window.setInterval(updateTime, 30_000);

        return () => window.clearInterval(timer);
    }, []);

    const subtitle =
        role === "owner"
            ? "Compare customer demand, seasonal patterns, and booking demand across branches"
            : role === "staff"
                ? "Review projected product demand and upcoming booking demand for your assigned branch"
                : "Review projected product demand, seasonal signals, and upcoming booking demand for your assigned branch";

    return (
        <RequirePermission>
            <div className="flex min-h-screen bg-[#FDFAF4] font-sans text-[#1A1220]">
                <RoleSidebar />

                <main className="min-w-0 flex-1 overflow-y-auto">
                    <header className="sticky top-0 z-20 border-b border-[#E9E0EF] bg-[#FFFDF8]/95 backdrop-blur">
                        <div className="flex min-h-[72px] flex-wrap items-center justify-between gap-4 px-6 py-3">
                            <div>
                                <h1 className="text-[25px] font-bold text-[#1A1220]">
                                    Demand Forecasting
                                </h1>
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
                                    onClick={() => void forecast.refresh()}
                                    disabled={forecast.loading}
                                    className="inline-flex h-[42px] items-center gap-2 rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31] disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    <RefreshCw
                                        size={16}
                                        className={
                                            forecast.loading ? "animate-spin" : ""
                                        }
                                    />
                                    Refresh
                                </button>
                            </div>
                        </div>
                    </header>

                    <section className="space-y-4 px-6 py-4">
                        {userLoading ? (
                            <div className="rounded-[14px] border border-[#E6DDF0] bg-white p-6 text-sm text-[#7A6A84] shadow-sm">
                                Loading your forecast access...
                            </div>
                        ) : role === "owner" ? (
                            <OwnerForecast {...forecast} />
                        ) : role === "staff" ? (
                            <StaffForecast {...forecast} />
                        ) : (
                            <ManagerForecast {...forecast} />
                        )}
                    </section>
                </main>
            </div>
        </RequirePermission>
    );
}
