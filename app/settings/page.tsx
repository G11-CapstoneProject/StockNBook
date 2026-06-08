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

        // Manager/staff get a branch-specific booking link
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
                    <div className="mb-6">
                        <p className="text-xl font-semibold text-[#1f2a44]">Settings</p>
                        <p className="text-sm text-gray-500">
                            {isOwner
                                ? "Manage your business information and billing."
                                : "View business information and branch booking details."}
                        </p>
                    </div>

                    {/* ─── OWNER LAYOUT ─────────────────────────────────────── */}
                    {isOwner && (
                        <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
                            {/* Business Information Section (Owner Only - Editable) */}
                            <section className="rounded-2xl bg-white p-6 shadow-sm">
                                <div className="mb-5 flex items-start gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-100 text-lg text-purple-600">
                                        🏪
                                    </div>

                                    <div>
                                        <h2 className="text-sm font-semibold text-[#1f2a44]">
                                            Business Information
                                        </h2>
                                        <p className="mt-1 text-xs text-gray-500">
                                            Edit your business details. These are used across your booking page and operations.
                                        </p>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <div>
                                        <label className="mb-2 block text-xs font-medium text-gray-500">
                                            Business Name
                                        </label>
                                        <input
                                            type="text"
                                            value={storeName}
                                            onChange={(e) => setStoreName(e.target.value)}
                                            placeholder="Enter your business name"
                                            className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900 placeholder-gray-400 outline-none focus:border-purple-400 focus:ring-1 focus:ring-purple-200"
                                        />
                                    </div>

                                    <div>
                                        <label className="mb-2 block text-xs font-medium text-gray-500">
                                            Store Slug
                                        </label>
                                        <input
                                            type="text"
                                            value={storeSlug}
                                            onChange={(e) => setStoreSlug(e.target.value)}
                                            placeholder="store-slug"
                                            className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900 placeholder-gray-400 outline-none focus:border-purple-400 focus:ring-1 focus:ring-purple-200"
                                        />
                                        <p className="mt-1 text-xs text-gray-400">
                                            Used in your booking page URL
                                        </p>
                                    </div>

                                    <button className="w-full rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-purple-700">
                                        Save Changes
                                    </button>
                                </div>
                            </section>

                            {/* Subscription / Billing Section (Owner Only) */}
                            <section className="rounded-2xl bg-white p-6 shadow-sm">
                                <div className="mb-5 flex items-start gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-lg text-blue-600">
                                        💳
                                    </div>

                                    <div>
                                        <h2 className="text-sm font-semibold text-[#1f2a44]">
                                            Subscription / Billing
                                        </h2>
                                        <p className="mt-1 text-xs text-gray-500">
                                            Manage your plan and billing information.
                                        </p>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <div className="rounded-xl bg-blue-50 p-4">
                                        <p className="text-xs font-semibold text-blue-900">Current Plan</p>
                                        <p className="mt-1 text-sm font-bold text-blue-600">Pro Plan</p>
                                        <p className="mt-1 text-xs text-blue-700">₱2,999/month</p>
                                    </div>

                                    <button className="w-full rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-900 transition hover:bg-gray-50">
                                        Manage Subscription
                                    </button>

                                    <button className="w-full rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-900 transition hover:bg-gray-50">
                                        View Invoices
                                    </button>
                                </div>
                            </section>
                        </div>
                    )}

                    {/* ─── MANAGER / STAFF LAYOUT ─────────────────────────────── */}
                    {!isOwner && (
                        <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
                            {/* Business Information Section (Read-only for Manager/Staff) */}
                            <section className="rounded-2xl bg-white p-6 shadow-sm">
                                <div className="mb-5 flex items-start gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-100 text-lg text-purple-600">
                                        🏪
                                    </div>

                                    <div>
                                        <h2 className="text-sm font-semibold text-[#1f2a44]">
                                            Business Information
                                        </h2>
                                        <p className="mt-1 text-xs text-gray-500">
                                            Read-only business details from the owner.
                                        </p>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <div>
                                        <label className="mb-2 block text-xs font-medium text-gray-500">
                                            Business Name
                                        </label>
                                        <input
                                            readOnly
                                            value={storeName}
                                            className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700 outline-none"
                                        />
                                    </div>

                                    <div>
                                        <label className="mb-2 block text-xs font-medium text-gray-500">
                                            Store Slug
                                        </label>
                                        <input
                                            readOnly
                                            value={storeSlug}
                                            className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700 outline-none"
                                        />
                                    </div>

                                    <div>
                                        <label className="mb-2 block text-xs font-medium text-gray-500">
                                            Your Branch
                                        </label>
                                        <input
                                            readOnly
                                            value={branchName || "Assigned Branch"}
                                            className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700 outline-none"
                                        />
                                    </div>

                                    <div>
                                        <label className="mb-2 block text-xs font-medium text-gray-500">
                                            Branch Slug
                                        </label>
                                        <input
                                            readOnly
                                            value={branchSlug}
                                            className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700 outline-none"
                                        />
                                    </div>
                                </div>
                            </section>

                            {/* Booking Link Section (Manager/Staff) */}
                            <section className="rounded-2xl bg-white p-6 shadow-sm">
                                <div className="mb-5 flex items-start gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-100 text-lg text-green-600">
                                        🔗
                                    </div>

                                    <div>
                                        <h2 className="text-sm font-semibold text-[#1f2a44]">
                                            Booking Link
                                        </h2>
                                        <p className="mt-1 text-xs text-gray-500">
                                            Share this link with customers so bookings go to your branch.
                                        </p>
                                    </div>
                                </div>

                                <div className="rounded-xl border border-gray-200 bg-[#fafafa] px-4 py-3 text-xs text-gray-700 font-mono break-all">
                                    {bookingLink || "No branch booking link available yet."}
                                </div>

                                {branchName && (
                                    <p className="mt-3 text-xs text-gray-500">
                                        Branch:{" "}
                                        <span className="font-semibold text-[#1f2a44]">
                                            {branchName}
                                        </span>
                                    </p>
                                )}

                                <div className="mt-4 flex flex-wrap gap-2">
                                    <button
                                        onClick={handleCopy}
                                        disabled={!bookingLink}
                                        className="rounded-lg bg-purple-500 px-4 py-2 text-xs font-medium text-white transition hover:bg-purple-600 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        {copied ? "Copied!" : "Copy Link"}
                                    </button>

                                    <button
                                        onClick={handlePreview}
                                        disabled={!bookingLink}
                                        className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-[#1f2a44] transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        Preview
                                    </button>
                                </div>
                            </section>
                        </div>
                    )}

                    {/* ─── QR CODE & SHARING TIPS (Manager/Staff Only) ─────────── */}
                    {!isOwner && (
                        <div className="mt-5 grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
                            {/* QR Code Section */}
                            <section className="rounded-2xl bg-white p-6 shadow-sm">
                                <h3 className="mb-3 text-sm font-semibold text-[#1f2a44]">
                                    QR Code
                                </h3>

                                <div className="flex min-h-48 items-center justify-center rounded-xl border border-dashed border-gray-200 bg-[#fafafa]">
                                    <div className="text-center">
                                        {bookingLink ? (
                                            <QRCodeCanvas value={bookingLink} size={140} />
                                        ) : (
                                            <p className="text-xs text-gray-400">
                                                No link available
                                            </p>
                                        )}

                                        <p className="mt-3 text-xs text-gray-500">
                                            Scan to open your branch public booking page.
                                        </p>
                                    </div>
                                </div>

                                <button
                                    type="button"
                                    onClick={downloadQR}
                                    disabled={!bookingLink}
                                    className="mt-3 w-full rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-[#1f2a44] transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    Download QR
                                </button>
                            </section>

                            {/* Sharing Tips Section */}
                            <section className="rounded-2xl bg-white p-6 shadow-sm">
                                <h3 className="mb-3 text-sm font-semibold text-[#1f2a44]">
                                    Sharing Tips
                                </h3>

                                <div className="space-y-3 text-sm text-gray-600">
                                    <div className="rounded-xl bg-[#fafafa] px-4 py-3">
                                        <p className="font-semibold text-gray-900">📱 Social Media</p>
                                        <p className="mt-1 text-xs">
                                            Add your branch booking link to your Facebook page bio or pinned post.
                                        </p>
                                    </div>

                                    <div className="rounded-xl bg-[#fafafa] px-4 py-3">
                                        <p className="font-semibold text-gray-900">💬 Direct Messages</p>
                                        <p className="mt-1 text-xs">
                                            Send the link directly to customers who inquire by chat or messenger.
                                        </p>
                                    </div>

                                    <div className="rounded-xl bg-[#fafafa] px-4 py-3">
                                        <p className="font-semibold text-gray-900">📸 QR Code</p>
                                        <p className="mt-1 text-xs">
                                            Use the QR code for walk-in customers or printed displays at your venue.
                                        </p>
                                    </div>

                                    <div className="rounded-xl bg-[#fafafa] px-4 py-3">
                                        <p className="font-semibold text-gray-900">✅ Preview First</p>
                                        <p className="mt-1 text-xs">
                                            Preview the page before sharing to ensure your branch link is correct.
                                        </p>
                                    </div>
                                </div>
                            </section>
                        </div>
                    )}
                </main>
            </div>
        </RequirePermission>
    );
}
