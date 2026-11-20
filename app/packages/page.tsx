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
            <div className="flex min-h-screen bg-[#FDFAF4] font-sans text-[#1A1220] lg:h-dvh lg:overflow-hidden lg:[&>aside]:min-h-0 lg:[&>aside]:max-h-dvh lg:[&>aside]:overflow-y-auto lg:[&>aside]:[scrollbar-width:none] lg:[&>aside::-webkit-scrollbar]:hidden">
                <RoleSidebar />
                <main className="flex min-w-0 flex-1 flex-col overflow-y-auto lg:h-dvh lg:min-h-0">
                    <ModulePageSkeleton variant="packages" />
                </main>
            </div>
        );
    }

    if (!user) return null;

    return (
        <RequirePermission permission="packages">
            <div className="flex min-h-screen bg-[#FDFAF4] font-sans text-[#1A1220] lg:h-dvh lg:overflow-hidden lg:[&>aside]:min-h-0 lg:[&>aside]:max-h-dvh lg:[&>aside]:overflow-y-auto lg:[&>aside]:[scrollbar-width:none] lg:[&>aside::-webkit-scrollbar]:hidden">
                <RoleSidebar />
                <main className="flex min-w-0 flex-1 flex-col overflow-y-auto lg:h-dvh lg:min-h-0">
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