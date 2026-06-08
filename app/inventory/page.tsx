"use client";

import { useState } from "react";
import RoleSidebar from "@/components/sidebar/RoleSidebar";
import RequirePermission from "@/components/permissions/RequirePermission";
import OwnerInventory from "@/components/inventory/OwnerInventory";
import ManagerInventory from "@/components/inventory/ManagerInventory";
import StaffInventory from "@/components/inventory/StaffInventory";

export default function InventoryPage() {
    const [role] = useState(() =>
        typeof window !== "undefined"
            ? (sessionStorage.getItem("role") || "").toLowerCase()
            : ""
    );

    return (
        <RequirePermission permission="inventory">
            <div
                className="flex min-h-screen text-[#1A1220]"
                style={{
                    backgroundColor: "#FDFAF4",
                    fontFamily: "Georgia, 'Times New Roman', serif",
                }}
            >
                <RoleSidebar />

                <main className="min-w-0 flex-1 overflow-x-hidden">
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