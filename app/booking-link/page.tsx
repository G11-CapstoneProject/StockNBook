"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";

export default function BookingLinkPage() {
    const [mounted, setMounted] = useState(false);
    const [storeName, setStoreName] = useState("Store Name");
    const [storeSlug, setStoreSlug] = useState("");
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        const frame = window.requestAnimationFrame(() => {
            const savedStoreName =
                localStorage.getItem("store_name") ||
                localStorage.getItem("stocknbook_store_name") ||
                "Store Name";

            const savedSlug =
                localStorage.getItem("store_slug") ||
                localStorage.getItem("slug");

            const generatedSlug = savedSlug
                ? savedSlug
                : savedStoreName
                    .toLowerCase()
                    .trim()
                    .replace(/[^a-z0-9\s-]/g, "")
                    .replace(/\s+/g, "-")
                    .replace(/-+/g, "-");

            if (generatedSlug && !savedSlug) {
                localStorage.setItem("store_slug", generatedSlug);
            }

            setStoreName(savedStoreName);
            setStoreSlug(generatedSlug);
            setMounted(true);
        });

        return () => window.cancelAnimationFrame(frame);
    }, []);

    const bookingLink = useMemo(() => {
        if (!storeSlug || !mounted) return "";
        return `${window.location.origin}/book/${storeSlug}`;
    }, [storeSlug, mounted]);

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
        <div className="flex min-h-screen bg-[#f5f6f8]">
            <aside className="flex min-h-screen w-52 flex-col justify-between bg-linear-to-b from-[#5f6ee7] to-[#d786e8] text-white">
                <div>
                    <div className="px-3 pt-3">
                        <div className="rounded-xl bg-white/10 px-3 py-2 backdrop-blur-sm">
                            <h1 className="text-sm font-bold">StockNBook</h1>
                        </div>

                        <div className="mt-2 rounded-xl bg-white/10 px-3 py-2 backdrop-blur-sm">
                            <p className="text-xs font-semibold text-white">{storeName}</p>
                            <p className="mt-1 text-[9px] uppercase tracking-[0.15em] text-white/60">
                                Store Owner
                            </p>
                        </div>
                    </div>

                    <nav className="mt-3 px-2 pb-4">
                        <p className="mb-1 px-2 text-[9px] uppercase tracking-[0.15em] text-white/50">
                            Core
                        </p>

                        <div className="space-y-1">
                            <Link
                                href="/admin"
                                className="block rounded-lg px-3 py-2 text-xs text-white/90 hover:bg-white/10"
                            >
                                Dashboard
                            </Link>

                            <Link
                                href="/bookings"
                                className="block rounded-lg px-3 py-2 text-xs text-white/90 hover:bg-white/10"
                            >
                                Bookings
                            </Link>

                            <div className="rounded-lg px-3 py-2 text-xs text-white/90 hover:bg-white/10">
                                Calendar
                            </div>
                        </div>

                        <p className="mb-1 mt-3 px-2 text-[9px] uppercase tracking-[0.15em] text-white/50">
                            Business
                        </p>

                        <div className="space-y-1">
                            <Link
                                href="/inventory"
                                className="block rounded-lg px-3 py-2 text-xs text-white/90 hover:bg-white/10"
                            >
                                Inventory
                            </Link>

                            <Link
                                href="/pos"
                                className="block rounded-lg px-3 py-2 text-xs text-white/90 hover:bg-white/10"
                            >
                                Sales / POS
                            </Link>
                        </div>

                        <p className="mb-1 mt-3 px-2 text-[9px] uppercase tracking-[0.15em] text-white/50">
                            Analytics
                        </p>

                        <div className="space-y-1">
                            <div className="rounded-lg px-3 py-2 text-xs text-white/90 hover:bg-white/10">
                                Reports
                            </div>
                        </div>

                        <p className="mb-1 mt-3 px-2 text-[9px] uppercase tracking-[0.15em] text-white/50">
                            System
                        </p>

                        <div className="space-y-1">
                            <Link
                                href="/booking-link"
                                className="block rounded-lg bg-white/20 px-3 py-2 text-xs font-medium"
                            >
                                Booking Link
                            </Link>

                            <div className="rounded-lg px-3 py-2 text-xs text-white/90 hover:bg-white/10">
                                Settings
                            </div>
                        </div>
                    </nav>
                </div>

                <div className="px-2 pb-3">
                    <Link
                        href="/"
                        className="block rounded-lg px-3 py-2 text-xs text-white/90 hover:bg-white/10"
                    >
                        Logout
                    </Link>
                </div>
            </aside>

            <main className="flex-1 p-5">
                <div className="mb-6">
                    <p className="text-lg font-bold text-[#1f2a44]">Booking Link</p>
                    <p className="text-sm text-black">
                        {new Date().toLocaleDateString("en-US", {
                            weekday: "long",
                            month: "long",
                            day: "numeric",
                            year: "numeric",
                        })}
                    </p>
                </div>

                <section className="mb-5 rounded-2xl border border-purple-100 bg-white p-5 shadow-sm">
                    <div className="mb-4 flex items-start gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-100 text-lg text-purple-600">
                            🔗
                        </div>

                        <div>
                            <h2 className="text-sm font-semibold text-[#1f2a44]">
                                Your Booking Link
                            </h2>
                            <p className="mt-1 text-xs text-gray-500">
                                Share this with customers so they can book with your store anytime.
                            </p>
                        </div>
                    </div>

                    <div className="rounded-xl border border-gray-200 bg-[#fafafa] px-4 py-3 text-sm text-gray-700">
                        {bookingLink || "No booking link available yet."}
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                        <button
                            onClick={handleCopy}
                            disabled={!bookingLink}
                            className="rounded-lg bg-purple-500 px-4 py-2 text-xs font-medium text-white hover:bg-purple-600 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {copied ? "Copied!" : "Copy Link"}
                        </button>

                        <button
                            onClick={handlePreview}
                            disabled={!bookingLink}
                            className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-[#1f2a44] hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            Preview
                        </button>

                        <button
                            type="button"
                            className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-[#1f2a44] hover:bg-gray-50"
                        >
                            QR Code
                        </button>
                    </div>
                </section>

                <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr]">
                    <section className="rounded-2xl bg-white p-5 shadow-sm">
                        <h3 className="mb-3 text-sm font-semibold text-[#1f2a44]">QR Code</h3>

                        <div className="flex min-h-45 items-center justify-center rounded-xl border border-dashed border-gray-200 bg-[#fafafa]">
                            <div className="text-center">
                                {bookingLink ? (
                                    <QRCodeCanvas value={bookingLink} size={120} />
                                ) : (
                                    <p className="text-xs text-gray-400">No link available</p>
                                )}

                                <p className="mt-3 text-xs text-gray-500">
                                    QR code preview can go here
                                </p>
                            </div>
                        </div>

                        <button
                            type="button"
                            onClick={downloadQR}
                            className="mt-3 rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-[#1f2a44] hover:bg-gray-50"
                        >
                            Download QR
                        </button>
                    </section>

                    <section className="rounded-2xl bg-white p-5 shadow-sm">
                        <h3 className="mb-3 text-sm font-semibold text-[#1f2a44]">
                            Sharing Tips
                        </h3>

                        <div className="space-y-3 text-sm text-gray-600">
                            <div className="rounded-xl bg-[#fafafa] px-4 py-3">
                                Add your booking link to your Facebook page bio or pinned post.
                            </div>

                            <div className="rounded-xl bg-[#fafafa] px-4 py-3">
                                Send the link directly to customers who inquire by chat.
                            </div>

                            <div className="rounded-xl bg-[#fafafa] px-4 py-3">
                                Use the QR code for walk-in customers or printed displays.
                            </div>

                            <div className="rounded-xl bg-[#fafafa] px-4 py-3">
                                Preview the page first before sharing to make sure your slug is correct.
                            </div>
                        </div>
                    </section>
                </div>
            </main>
        </div>
    );
}