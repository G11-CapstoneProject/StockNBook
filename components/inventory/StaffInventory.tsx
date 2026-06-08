"use client";

import { useInventoryController } from "@/hooks/useInventory";
import {
    BranchInventoryView,
    InventoryDialogs,
    PageHeader,
} from "./_shared";

export default function StaffInventory() {
    const inv = useInventoryController();

    return (
        <>
            <PageHeader
                title="Inventory"
                badge={inv.assignedBranchName || "Assigned Branch"}
                role={inv.role}
                onRefresh={() => window.location.reload()}
            />

            <section className="px-5 py-5">
                <BranchInventoryView inv={inv} title="Products" />
            </section>

            <InventoryDialogs inv={inv} />
        </>
    );
}