"use client";

import { useEffect, useMemo, useState } from "react";
import RoleSidebar from "@/components/sidebar/RoleSidebar";
import RequirePermission from "@/components/permissions/RequirePermission";
import { QRCodeCanvas } from "qrcode.react";

function makeSlug(value: string) {
    return value
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-");
}

export default function SettingsPage() {
    const [mounted, setMounted] = useState(false);
    const [storeName, setStoreName] = useState("Store Name");
    const [storeSlug, setStoreSlug] = useState("");
    const [role, setRole] = useState("");
    const [branchId, setBranchId] = useState("");
    const [branchName, setBranchName] = useState("");
    const [copied, setCopied] = useState(false);

    const isOwner = role === "owner";

    useEffect(() => {
        const frame = window.requestAnimationFrame(() => {
            const savedStoreName =
                sessionStorage.getItem("store_name") ||
                sessionStorage.getItem("stocknbook_store_name") ||
                "Store Name";

            const savedSlug =
                sessionStorage.getItem("store_slug") ||
                sessionStorage.getItem("slug");

            const savedRole = (sessionStorage.getItem("role") || "").toLowerCase();

            const savedBranchId =
                sessionStorage.getItem("branch_id") ||
                sessionStorage.getItem("stocknbook_branch_id") ||
                "";

            const savedBranchName =
                sessionStorage.getItem("branch_name") ||
                sessionStorage.getItem("stocknbook_branch_name") ||
                "";

            const generatedSlug = savedSlug ? savedSlug : makeSlug(savedStoreName);

            if (generatedSlug && !savedSlug) {
                sessionStorage.setItem("store_slug", generatedSlug);
            }

            setStoreName(savedStoreName);
            setStoreSlug(generatedSlug);
            setRole(savedRole);
            setBranchId(savedBranchId);
            setBranchName(savedBranchName);
            setMounted(true);
        });

        return () => window.cancelAnimationFrame(frame);
    }, []);

    const branchSlug = useMemo(() => {
        if (!branchName) return "";
        return makeSlug(branchName);
    }, [branchName]);

    const bookingLink = useMemo(() => {
        if (!storeSlug || !mounted) return "";

        if ((role === "manager" || role === "staff") && branchId) {
            return `${window.location.origin}/book/${storeSlug}?branchId=${branchId}`;
        }

        return "";
    }, [storeSlug, mounted, role, branchId]);

    const handleCopy = async () => {
        if (!bookingLink) return;

        try {
            await navigator.clipboard.writeText(bookingLink);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (error) {
            console.error("Copy failed:", error);
            alert("Failed to copy link.");
        }
    };

    const downloadQR = () => {
        const canvas = document.querySelector("canvas") as HTMLCanvasElement | null;
        if (!canvas) return;

        const url = canvas.toDataURL("image/png");
        const link = document.createElement("a");
        link.href = url;
        link.download = "booking-qr.png";
        link.click();
    };

    const handlePreview = () => {
        if (!bookingLink) return;
        window.open(bookingLink, "_blank");
    };

    if (!mounted) {
        return null;
    }

    return (
        <RequirePermission>
            <div className="flex min-h-screen bg-[#f5f6f8]">
                <RoleSidebar />

                <main className="flex-1 p-6">
                    {/* (rest of your UI unchanged) */}
                    {/* ... keep everything exactly as you already had ... */}
                </main>
            </div>
        </RequirePermission>
    );
}