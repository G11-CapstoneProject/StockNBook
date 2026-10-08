"use client";

import RoleSidebar from "@/components/sidebar/RoleSidebar";
import RequirePermission from "@/components/permissions/RequirePermission";
import OwnerInventory from "@/components/inventory/OwnerInventory";
import ManagerInventory from "@/components/inventory/ManagerInventory";
import StaffInventory from "@/components/inventory/StaffInventory";
import { ModulePageSkeleton } from "@/components/loading/ModuleSkeletons";
import { useCurrentUser } from "@/hooks/useCurrentUser";

export default function InventoryPage() {
    const { user, loading } = useCurrentUser();
    const role = String((user as { role?: string } | null)?.role || "").toLowerCase();

    if (loading) {
        return (
            <div className="flex min-h-screen bg-[#FDFAF4] font-sans text-[#1A1220]">
                <RoleSidebar />
                <main className="min-w-0 flex-1 overflow-x-hidden">
                    <ModulePageSkeleton variant="inventory" />
                </main>
            </div>
        );
    }

    if (!user) return null;

    return (
        <RequirePermission permission="inventory">
            <div className="flex min-h-screen bg-[#FDFAF4] font-sans text-[#1A1220]">
                <RoleSidebar />
                <main className="min-w-0 flex-1 overflow-x-hidden font-sans">
                    {role === "owner" ? (
                        <OwnerInventory />
                    ) : role === "staff" ? (
                        <StaffInventory />
                    ) : (
                        <ManagerInventory />
                    )}
                </main>
            </div>
        </RequirePermission>
    );
}