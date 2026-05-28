"use client";

import OwnerPackages from "@/components/packages/OwnerPackages";
import ManagerPackages from "@/components/packages/ManagerPackages";
import StaffPackages from "@/components/packages/StaffPackages";
import { useEffect, useState } from "react";

export default function PackagesPage() {
    // Role is null until determined on client
    const [role, setRole] = useState<"owner" | "manager" | "staff" | null>(null);

    useEffect(() => {
        const savedRole =
            (sessionStorage.getItem("role") as "owner" | "manager" | "staff") || "owner";
        setRole(savedRole);
    }, []);

    // Wait until the role is loaded from sessionStorage
    if (role === null) return null;

    return (
        <div
            style={{
                backgroundColor: "#FDFAF4",
                fontFamily: "Georgia, 'Times New Roman', serif",
            }}
            className="flex min-h-screen text-[#1A1220]"
        >
            <main className="flex-1 overflow-y-auto">
                {role === "owner" && <OwnerPackages />}
                {role === "manager" && <ManagerPackages />}
                {role === "staff" && <StaffPackages />}
            </main>
        </div>
    );
}