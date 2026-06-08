"use client";

import RequirePermission from "@/components/permissions/RequirePermission";
import OwnerDashboard from "@/components/dashboard/OwnerDashboard";
import ManagerDashboard from "@/components/dashboard/ManagerDashboard";
import StaffDashboard from "@/components/dashboard/StaffDashboard";
import { useCurrentUser } from "@/hooks/useCurrentUser";

export default function DashboardPage() {
    const { user, loading } = useCurrentUser();

    if (loading) {
        return (
            <main className="flex min-h-screen items-center justify-center bg-[#FDFAF4] text-[#1A1220]">
                <p className="text-sm text-[#7A6E88]">Loading dashboard...</p>
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
                <div className="min-w-0 flex-1 overflow-x-hidden">
                    {user.role === "owner" && <OwnerDashboard />}
                    {user.role === "manager" && <ManagerDashboard />}
                    {user.role === "staff" && <StaffDashboard />}
                </div>
            </div>
        </RequirePermission>
    );
}