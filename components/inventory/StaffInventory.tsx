"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useInventoryController } from "@/hooks/useInventory";
import { ModuleSkeleton } from "@/components/loading/ModuleSkeletons";
import {
    BranchInventoryView,
    InventoryDialogs,
} from "./_shared";

function formatCurrentDateTime(value: Date) {
    const dateLabel = value.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
    });

    const timeLabel = value
        .toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
        })
        .toLowerCase();

    return `${dateLabel} | ${timeLabel}`;
}

export default function StaffInventory() {
    const inv = useInventoryController();
    const [currentDateTime, setCurrentDateTime] = useState<Date | null>(null);

    useEffect(() => {
        const updateDateTime = () => setCurrentDateTime(new Date());

        updateDateTime();
        const timer = window.setInterval(updateDateTime, 30_000);

        return () => {
            window.clearInterval(timer);
        };
    }, []);

    const branchBadge = inv.assignedBranchName || "Assigned Branch";

    return (
        <>
            <header className="sticky top-0 z-20 border-b border-[#E9E0EF] bg-[#FFFDF8]/95 font-sans backdrop-blur">
                <div className="flex items-center justify-between px-6 py-3">
                    <div className="flex items-center gap-3">
                        <h1 className="text-[25px] font-bold text-[#1A1220]">
                            Inventory
                        </h1>

                        <span className="rounded-lg bg-[#EFE8F8] px-3.5 py-1.5 text-sm font-medium text-[#4E2C66]">
                            {branchBadge}
                        </span>
                    </div>

                    <div className="flex items-center gap-2.5">
                        <span className="inline-flex h-[42px] items-center rounded-xl border border-[#E6DDF0] bg-white px-3.5 text-sm font-semibold text-[#2B174C] shadow-sm">
                            {currentDateTime
                                ? formatCurrentDateTime(currentDateTime)
                                : "Loading date..."}
                        </span>

                        <button
                            type="button"
                            onClick={() => void inv.refreshAll()}
                            aria-label="Refresh inventory"
                            title="Refresh inventory"
                            className="inline-flex h-[42px] items-center gap-2 rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31]"
                        >
                            <RefreshCw size={16} className={inv.refreshing ? "animate-spin" : ""} />
                            {inv.refreshing ? "Refreshing..." : "Refresh"}
                        </button>

                    </div>
                </div>
            </header>

            <section className="px-5 py-5">
                {inv.loading ? (
                    <ModuleSkeleton variant="inventory" />
                ) : (
                    <BranchInventoryView inv={inv} title="Products" />
                )}
            </section>

            <InventoryDialogs inv={inv} />
        </>
    );
}