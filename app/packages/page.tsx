"use client";

import RoleSidebar from "@/components/sidebar/RoleSidebar";
import OwnerPackages from "@/components/packages/OwnerPackages";
import ManagerPackages from "@/components/packages/ManagerPackages";
import StaffPackages from "@/components/packages/StaffPackages";
import RequirePermission from "@/components/permissions/RequirePermission";
import { ModulePageSkeleton } from "@/components/loading/ModuleSkeletons";
import { useCurrentUser } from "@/hooks/useCurrentUser";

export default function PackagesPage() {
    const { user, loading } = useCurrentUser();
    const role = String((user as { role?: string } | null)?.role || "").toLowerCase();

    if (loading) {
        return (
            <div className="flex min-h-screen bg-[#FDFAF4] font-sans text-[#1A1220]">
                <RoleSidebar />
                <main className="min-w-0 flex-1 overflow-y-auto">
                    <ModulePageSkeleton variant="packages" />
                </main>
            </div>
        );
    }

    if (!user) return null;

    return (
        <RequirePermission permission="packages">
            <div className="flex min-h-screen bg-[#FDFAF4] font-sans text-[#1A1220]">
                <RoleSidebar />
                <main className="min-w-0 flex-1 overflow-y-auto">
                    {role === "owner" ? (
                        <OwnerPackages />
                    ) : role === "manager" ? (
                        <ManagerPackages />
                    ) : (
                        <StaffPackages />
                    )}
                </main>
            </div>
        </RequirePermission>
    );
}