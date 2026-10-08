"use client";

import RequirePermission from "@/components/permissions/RequirePermission";
import RoleSidebar from "@/components/sidebar/RoleSidebar";
import OwnerPOS from "@/components/pos/OwnerPOS";
import ManagerPOS from "@/components/pos/ManagerPOS";
import StaffPOS from "@/components/pos/StaffPOS";
import { ModulePageSkeleton } from "@/components/loading/ModuleSkeletons";
import { usePOS } from "@/hooks/usePOS";

export default function POSPage() {
    const pos = usePOS();

    return (
        <RequirePermission permission="pos">
            {pos.loading ? (
                <div className="flex min-h-screen bg-[#FDFAF4] font-sans text-[#1A1220]">
                    <RoleSidebar />
                    <main className="min-w-0 flex-1 overflow-y-auto">
                        <ModulePageSkeleton variant="pos" />
                    </main>
                </div>
            ) : pos.isOwner ? (
                <OwnerPOS pos={pos} />
            ) : pos.role === "manager" ? (
                <ManagerPOS pos={pos} />
            ) : (
                <StaffPOS pos={pos} />
            )}
        </RequirePermission>
    );
}