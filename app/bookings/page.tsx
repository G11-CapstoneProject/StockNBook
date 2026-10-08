"use client";

import RoleSidebar from "@/components/sidebar/RoleSidebar";
import OwnerBookings from "@/components/bookings/BookingManagement/OwnerBookings";
import ManagerBookings from "@/components/bookings/BookingManagement/ManagerBookings";
import StaffBookings from "@/components/bookings/BookingManagement/StaffBookings";
import RequirePermission from "@/components/permissions/RequirePermission";
import { ModulePageSkeleton } from "@/components/loading/ModuleSkeletons";
import { useCurrentUser } from "@/hooks/useCurrentUser";

export default function BookingsPage() {
    const { user, loading } = useCurrentUser();
    const role = String((user as { role?: string } | null)?.role || "").toLowerCase();

    if (loading) {
        return (
            <div className="flex min-h-screen bg-[#FDFAF4] font-sans text-[#1A1220]">
                <RoleSidebar />
                <main className="min-w-0 flex-1 overflow-y-auto">
                    <ModulePageSkeleton variant="bookings" />
                </main>
            </div>
        );
    }

    if (!user) return null;

    return (
        <RequirePermission permission="bookings">
            <div className="flex min-h-screen bg-[#FDFAF4] font-sans text-[#1A1220]">
                <RoleSidebar />
                <main className="min-w-0 flex-1 overflow-y-auto">
                    {role === "owner" ? (
                        <OwnerBookings />
                    ) : role === "manager" ? (
                        <ManagerBookings />
                    ) : (
                        <StaffBookings />
                    )}
                </main>
            </div>
        </RequirePermission>
    );
}