"use client";

import RoleSidebar from "@/components/sidebar/RoleSidebar";
import RequirePermission from "@/components/permissions/RequirePermission";
import OwnerDashboard from "@/components/dashboard/OwnerDashboard";
import ManagerDashboard from "@/components/dashboard/ManagerDashboard";
import StaffDashboard from "@/components/dashboard/StaffDashboard";
import { useCurrentUser } from "@/hooks/useCurrentUser";

export default function DashboardPage() {
    const { user, loading } = useCurrentUser();

    if (loading) {
        return (
            <main className="flex min-h-screen bg-[#FDFAF4] text-[#1A1220]" aria-busy="true">
                <aside className="hidden w-[236px] shrink-0 border-r border-[#2E1B48] bg-[#24103E] p-5 md:block">
                    <div className="h-10 w-36 animate-pulse rounded-lg bg-white/10" />
                    <div className="mt-10 space-y-3">
                        {[0, 1, 2, 3, 4, 5].map((item) => (
                            <div key={item} className="h-9 animate-pulse rounded-lg bg-white/10" />
                        ))}
                    </div>
                </aside>

                <section className="min-w-0 flex-1">
                    <div className="h-[88px] border-b border-[#E9E0EF] bg-[#FFFDF8] px-6 py-5">
                        <div className="h-7 w-52 animate-pulse rounded-lg bg-[#EEE8F1]" />
                        <div className="mt-2 h-3 w-72 max-w-full animate-pulse rounded bg-[#F3EEF5]" />
                    </div>
                    <div className="space-y-4 px-6 py-5">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                            {[0, 1, 2, 3].map((item) => (
                                <div key={item} className="h-[122px] animate-pulse rounded-2xl border border-[#E9E0EF] bg-white shadow-sm" />
                            ))}
                        </div>
                        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                            <div className="h-[310px] animate-pulse rounded-2xl border border-[#E9E0EF] bg-white shadow-sm" />
                            <div className="h-[310px] animate-pulse rounded-2xl border border-[#E9E0EF] bg-white shadow-sm" />
                        </div>
                    </div>
                </section>
            </main>
        );
    }

    if (!user) {
        return null;
    }

    return (
        <RequirePermission>
            <div
                style={{
                    backgroundColor: "#FDFAF4",
                    fontFamily: "Georgia, 'Times New Roman', serif",
                }}
                className="flex min-h-screen overflow-x-hidden text-[#1A1220]"
            >
                <RoleSidebar />

                <div className="min-w-0 flex-1 overflow-x-hidden stocknbook-dashboard-content">
                    {user.role === "owner" && <OwnerDashboard />}
                    {user.role === "manager" && <ManagerDashboard />}
                    {user.role === "staff" && <StaffDashboard />}
                </div>
            </div>
        </RequirePermission>
    );
}
