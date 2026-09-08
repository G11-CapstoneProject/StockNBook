"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import RoleSidebar from "@/components/sidebar/RoleSidebar";
import RequirePermission from "@/components/permissions/RequirePermission";
import { QRCodeCanvas } from "qrcode.react";
import {
    Check,
    Copy,
    CreditCard,
    Download,
    ExternalLink,
    Link2,
    QrCode,
    RefreshCw,
    Save,
    Store,
} from "lucide-react";

function makeSlug(value: string) {
    return value
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-");
}

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

export default function SettingsPage() {
    const [mounted, setMounted] = useState(false);
    const [storeName, setStoreName] = useState("Store Name");
    const [storeSlug, setStoreSlug] = useState("");
    const [role, setRole] = useState("");
    const [branchId, setBranchId] = useState("");
    const [branchName, setBranchName] = useState("");
    const [copied, setCopied] = useState(false);
    const [saved, setSaved] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [currentDateTime, setCurrentDateTime] = useState<Date | null>(null);

    const qrContainerRef = useRef<HTMLDivElement>(null);

    const isOwner = role === "owner";

    const loadSettings = useCallback(() => {
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

        const generatedSlug = savedSlug || makeSlug(savedStoreName);

        if (generatedSlug && !savedSlug) {
            sessionStorage.setItem("store_slug", generatedSlug);
        }

        setStoreName(savedStoreName);
        setStoreSlug(generatedSlug);
        setRole(savedRole);
        setBranchId(savedBranchId);
        setBranchName(savedBranchName);
        setMounted(true);
    }, []);

    useEffect(() => {
        const frame = window.requestAnimationFrame(loadSettings);

        return () => window.cancelAnimationFrame(frame);
    }, [loadSettings]);

    useEffect(() => {
        const updateDateTime = () => setCurrentDateTime(new Date());

        updateDateTime();
        const timer = window.setInterval(updateDateTime, 30_000);

        return () => window.clearInterval(timer);
    }, []);

    const branchSlug = useMemo(() => {
        return branchName ? makeSlug(branchName) : "";
    }, [branchName]);

    const bookingLink = useMemo(() => {
        if (!storeSlug || !mounted) return "";

        if ((role === "manager" || role === "staff") && branchId) {
            return `${window.location.origin}/book/${storeSlug}?branchId=${branchId}`;
        }

        if (role === "owner") {
            return `${window.location.origin}/book/${storeSlug}`;
        }

        return "";
    }, [branchId, mounted, role, storeSlug]);

    const handleRefresh = () => {
        setIsRefreshing(true);
        loadSettings();

        window.setTimeout(() => {
            setIsRefreshing(false);
        }, 250);
    };

    const handleSave = () => {
        const cleanedName = storeName.trim();
        const cleanedSlug = makeSlug(storeSlug || cleanedName);

        if (!cleanedName || !cleanedSlug) {
            alert("Please enter a business name and store slug.");
            return;
        }

        setIsSaving(true);

        sessionStorage.setItem("store_name", cleanedName);
        sessionStorage.setItem("stocknbook_store_name", cleanedName);
        sessionStorage.setItem("store_slug", cleanedSlug);
        sessionStorage.setItem("slug", cleanedSlug);

        setStoreName(cleanedName);
        setStoreSlug(cleanedSlug);
        setSaved(true);

        window.setTimeout(() => {
            setSaved(false);
            setIsSaving(false);
        }, 900);
    };

    const handleCopy = async () => {
        if (!bookingLink) return;

        try {
            await navigator.clipboard.writeText(bookingLink);
            setCopied(true);

            window.setTimeout(() => setCopied(false), 2000);
        } catch (error) {
            console.error("Copy failed:", error);
            alert("Failed to copy the booking link.");
        }
    };

    const downloadQR = () => {
        const canvas =
            qrContainerRef.current?.querySelector<HTMLCanvasElement>("canvas");

        if (!canvas) return;

        const link = document.createElement("a");
        link.href = canvas.toDataURL("image/png");
        link.download = `${branchSlug || storeSlug || "booking"}-qr.png`;
        link.click();
    };

    const handlePreview = () => {
        if (!bookingLink) return;

        window.open(bookingLink, "_blank", "noopener,noreferrer");
    };

    if (!mounted) {
        return null;
    }

    return (
        <RequirePermission>
            <div
                className="flex min-h-screen font-sans text-[#1A1220]"
                style={{ backgroundColor: "#FDFAF4" }}
            >
                <RoleSidebar />

                <main className="min-w-0 flex-1 overflow-y-auto">
                    <header className="sticky top-0 z-20 border-b border-[#E9E0EF] bg-[#FFFDF8]/95 backdrop-blur">
                        <div className="flex min-h-[72px] flex-wrap items-center justify-between gap-4 px-6 py-3">
                            <h1 className="text-[25px] font-bold text-[#1A1220]">
                                Settings
                            </h1>

                            <div className="flex items-center gap-2.5">
                                <span className="inline-flex h-[42px] items-center rounded-xl border border-[#E6DDF0] bg-white px-3.5 text-sm font-semibold text-[#2B174C] shadow-sm">
                                    {currentDateTime
                                        ? formatCurrentDateTime(currentDateTime)
                                        : "Loading date..."}
                                </span>

                                <button
                                    type="button"
                                    onClick={handleRefresh}
                                    disabled={isRefreshing}
                                    aria-label="Refresh settings"
                                    title="Refresh settings"
                                    className="inline-flex h-[42px] items-center gap-2 rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31] disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    <RefreshCw
                                        size={16}
                                        className={
                                            isRefreshing ? "animate-spin" : ""
                                        }
                                    />
                                    Refresh
                                </button>
                            </div>
                        </div>
                    </header>

                    <section className="space-y-4 px-6 py-4">
                        {isOwner ? (
                            <OwnerSettings
                                storeName={storeName}
                                storeSlug={storeSlug}
                                setStoreName={setStoreName}
                                setStoreSlug={setStoreSlug}
                                isSaving={isSaving}
                                saved={saved}
                                onSave={handleSave}
                                bookingLink={bookingLink}
                                copied={copied}
                                qrContainerRef={qrContainerRef}
                                onCopy={() => void handleCopy()}
                                onPreview={handlePreview}
                                onDownloadQR={downloadQR}
                            />
                        ) : (
                            <BranchSettings
                                storeName={storeName}
                                storeSlug={storeSlug}
                                branchName={branchName}
                                branchSlug={branchSlug}
                                bookingLink={bookingLink}
                                copied={copied}
                                qrContainerRef={qrContainerRef}
                                onCopy={() => void handleCopy()}
                                onPreview={handlePreview}
                                onDownloadQR={downloadQR}
                            />
                        )}
                    </section>
                </main>
            </div>
        </RequirePermission>
    );
}

function OwnerSettings({
                           storeName,
                           storeSlug,
                           setStoreName,
                           setStoreSlug,
                           isSaving,
                           saved,
                           onSave,
                           bookingLink,
                           copied,
                           qrContainerRef,
                           onCopy,
                           onPreview,
                           onDownloadQR,
                       }: {
    storeName: string;
    storeSlug: string;
    setStoreName: (value: string) => void;
    setStoreSlug: (value: string) => void;
    isSaving: boolean;
    saved: boolean;
    onSave: () => void;
    bookingLink: string;
    copied: boolean;
    qrContainerRef: React.RefObject<HTMLDivElement | null>;
    onCopy: () => void;
    onPreview: () => void;
    onDownloadQR: () => void;
}) {
    return (
        <>
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
                <section className="rounded-[14px] border border-[#E6DDF0] bg-white p-5 shadow-sm">
                    <SettingsCardHeading
                        icon={<Store size={18} />}
                        title="Business Information"
                        detail="Update the business details used across your booking page and operations."
                    />

                    <div className="mt-5 space-y-4">
                        <FieldLabel label="Business Name">
                            <input
                                type="text"
                                value={storeName}
                                onChange={(event) =>
                                    setStoreName(event.target.value)
                                }
                                placeholder="Enter your business name"
                                className="h-[42px] w-full rounded-xl border border-[#E6DDF0] bg-[#FFFDF8] px-3 text-sm text-[#1A1220] outline-none placeholder:text-[#9B8AAA] transition focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10"
                            />
                        </FieldLabel>

                        <FieldLabel
                            label="Store Slug"
                            detail="Used in your public booking page URL."
                        >
                            <input
                                type="text"
                                value={storeSlug}
                                onChange={(event) =>
                                    setStoreSlug(event.target.value)
                                }
                                placeholder="store-slug"
                                className="h-[42px] w-full rounded-xl border border-[#E6DDF0] bg-[#FFFDF8] px-3 text-sm text-[#1A1220] outline-none placeholder:text-[#9B8AAA] transition focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10"
                            />
                        </FieldLabel>

                        <button
                            type="button"
                            onClick={onSave}
                            disabled={isSaving}
                            className="inline-flex h-[42px] w-full items-center justify-center gap-2 rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {saved ? <Check size={16} /> : <Save size={16} />}
                            {isSaving
                                ? "Saving..."
                                : saved
                                    ? "Saved"
                                    : "Save Changes"}
                        </button>

                        <p className="text-center text-xs text-[#7A6A84]">
                            Changes are saved for your current signed-in session.
                        </p>
                    </div>
                </section>

                <section className="rounded-[14px] border border-[#E6DDF0] bg-white p-5 shadow-sm">
                    <SettingsCardHeading
                        icon={<CreditCard size={18} />}
                        title="Subscription & Billing"
                        detail="Review your current plan and account billing options."
                    />

                    <div className="mt-5 space-y-3">
                        <div className="rounded-xl border border-[#E6DDF0] bg-[#F7F1FF] p-4">
                            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#806A8C]">
                                Current Plan
                            </p>
                            <p className="mt-2 text-[18px] font-bold text-[#1A1220]">
                                Pro Plan
                            </p>
                            <p className="mt-1 text-sm font-medium text-[#5F4E75]">
                                ₱2,999 / month
                            </p>
                        </div>

                        <BillingRow
                            title="Manage Subscription"
                            detail="Change or review your current plan."
                        />
                        <BillingRow
                            title="View Invoices"
                            detail="Review past billing records and receipts."
                        />
                    </div>
                </section>
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
                <section className="rounded-[14px] border border-[#E6DDF0] bg-white p-5 shadow-sm">
                    <SettingsCardHeading
                        icon={<Link2 size={18} />}
                        title="Store Booking Link"
                        detail="Share this link so customers can book with any of your branches."
                    />

                    <div className="mt-5 rounded-xl border border-[#E6DDF0] bg-[#FFFDF8] p-3">
                        <p className="break-all font-mono text-xs leading-5 text-[#4E2C66]">
                            {bookingLink ||
                                "No store booking link available yet."}
                        </p>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-3">
                        <button
                            type="button"
                            onClick={onCopy}
                            disabled={!bookingLink}
                            className="inline-flex h-[42px] items-center justify-center gap-2 rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {copied ? <Check size={16} /> : <Copy size={16} />}
                            {copied ? "Copied" : "Copy Link"}
                        </button>

                        <button
                            type="button"
                            onClick={onPreview}
                            disabled={!bookingLink}
                            className="inline-flex h-[42px] items-center justify-center gap-2 rounded-xl border border-[#E6DDF0] bg-white px-4 text-sm font-semibold text-[#2B174C] transition hover:bg-[#F7F1FF] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <ExternalLink size={16} />
                            Preview
                        </button>
                    </div>
                </section>

                <section className="rounded-[14px] border border-[#E6DDF0] bg-white p-5 shadow-sm">
                    <SettingsCardHeading
                        icon={<QrCode size={18} />}
                        title="Store QR Code"
                        detail="Customers can scan this code to open your store's booking page."
                    />

                    <div
                        ref={qrContainerRef}
                        className="mt-5 flex min-h-[228px] items-center justify-center rounded-xl border border-dashed border-[#D8CBE7] bg-[#FFFDF8] p-5"
                    >
                        {bookingLink ? (
                            <QRCodeCanvas value={bookingLink} size={148} />
                        ) : (
                            <p className="text-sm text-[#9B8AAA]">
                                No booking link available.
                            </p>
                        )}
                    </div>

                    <button
                        type="button"
                        onClick={onDownloadQR}
                        disabled={!bookingLink}
                        className="mt-4 inline-flex h-[42px] w-full items-center justify-center gap-2 rounded-xl border border-[#E6DDF0] bg-white px-4 text-sm font-semibold text-[#2B174C] transition hover:bg-[#F7F1FF] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <Download size={16} />
                        Download QR
                    </button>
                </section>
            </div>
        </>
    );
}

function BranchSettings({
                            storeName,
                            storeSlug,
                            branchName,
                            branchSlug,
                            bookingLink,
                            copied,
                            qrContainerRef,
                            onCopy,
                            onPreview,
                            onDownloadQR,
                        }: {
    storeName: string;
    storeSlug: string;
    branchName: string;
    branchSlug: string;
    bookingLink: string;
    copied: boolean;
    qrContainerRef: React.RefObject<HTMLDivElement | null>;
    onCopy: () => void;
    onPreview: () => void;
    onDownloadQR: () => void;
}) {
    return (
        <>
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
                <section className="rounded-[14px] border border-[#E6DDF0] bg-white p-5 shadow-sm">
                    <SettingsCardHeading
                        icon={<Store size={18} />}
                        title="Business Information"
                        detail="Business details provided by the store owner."
                    />

                    <div className="mt-5 grid gap-4 sm:grid-cols-2">
                        <ReadOnlyField
                            label="Business Name"
                            value={storeName}
                        />
                        <ReadOnlyField label="Store Slug" value={storeSlug} />
                        <ReadOnlyField
                            label="Assigned Branch"
                            value={branchName || "Assigned Branch"}
                        />
                        <ReadOnlyField
                            label="Branch Slug"
                            value={branchSlug || "Not available"}
                        />
                    </div>
                </section>

                <section className="rounded-[14px] border border-[#E6DDF0] bg-white p-5 shadow-sm">
                    <SettingsCardHeading
                        icon={<Link2 size={18} />}
                        title="Branch Booking Link"
                        detail="Share this link so bookings are sent directly to your branch."
                    />

                    <div className="mt-5 rounded-xl border border-[#E6DDF0] bg-[#FFFDF8] p-3">
                        <p className="break-all font-mono text-xs leading-5 text-[#4E2C66]">
                            {bookingLink ||
                                "No branch booking link available yet."}
                        </p>
                    </div>

                    {branchName && (
                        <p className="mt-3 text-xs text-[#7A6A84]">
                            Booking destination:{" "}
                            <span className="font-semibold text-[#1A1220]">
                                {branchName}
                            </span>
                        </p>
                    )}

                    <div className="mt-4 grid grid-cols-2 gap-3">
                        <button
                            type="button"
                            onClick={onCopy}
                            disabled={!bookingLink}
                            className="inline-flex h-[42px] items-center justify-center gap-2 rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {copied ? <Check size={16} /> : <Copy size={16} />}
                            {copied ? "Copied" : "Copy Link"}
                        </button>

                        <button
                            type="button"
                            onClick={onPreview}
                            disabled={!bookingLink}
                            className="inline-flex h-[42px] items-center justify-center gap-2 rounded-xl border border-[#E6DDF0] bg-white px-4 text-sm font-semibold text-[#2B174C] transition hover:bg-[#F7F1FF] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <ExternalLink size={16} />
                            Preview
                        </button>
                    </div>
                </section>
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(290px,0.75fr)_minmax(0,1.25fr)]">
                <section className="rounded-[14px] border border-[#E6DDF0] bg-white p-5 shadow-sm">
                    <SettingsCardHeading
                        icon={<QrCode size={18} />}
                        title="Branch QR Code"
                        detail="Customers can scan this code to open your branch booking page."
                    />

                    <div
                        ref={qrContainerRef}
                        className="mt-5 flex min-h-[228px] items-center justify-center rounded-xl border border-dashed border-[#D8CBE7] bg-[#FFFDF8] p-5"
                    >
                        {bookingLink ? (
                            <QRCodeCanvas value={bookingLink} size={148} />
                        ) : (
                            <p className="text-sm text-[#9B8AAA]">
                                No booking link available.
                            </p>
                        )}
                    </div>

                    <button
                        type="button"
                        onClick={onDownloadQR}
                        disabled={!bookingLink}
                        className="mt-4 inline-flex h-[42px] w-full items-center justify-center gap-2 rounded-xl border border-[#E6DDF0] bg-white px-4 text-sm font-semibold text-[#2B174C] transition hover:bg-[#F7F1FF] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <Download size={16} />
                        Download QR
                    </button>
                </section>

                <section className="rounded-[14px] border border-[#E6DDF0] bg-white p-5 shadow-sm">
                    <h2 className="text-[16px] font-bold text-[#1A1220]">
                        Sharing Tips
                    </h2>
                    <p className="mt-1 text-xs text-[#7A6A84]">
                        Simple ways to make your branch booking page easier for
                        customers to find.
                    </p>

                    <div className="mt-5 grid gap-3 sm:grid-cols-2">
                        <TipCard
                            number="01"
                            title="Social Media"
                            detail="Add the booking link to your Facebook page bio or pin it in a post."
                        />
                        <TipCard
                            number="02"
                            title="Direct Messages"
                            detail="Send the link to customers who ask through chat or Messenger."
                        />
                        <TipCard
                            number="03"
                            title="QR Displays"
                            detail="Place the QR code in your store or on printed event materials."
                        />
                        <TipCard
                            number="04"
                            title="Preview First"
                            detail="Open the booking link before sharing to confirm the correct branch."
                        />
                    </div>
                </section>
            </div>
        </>
    );
}

function SettingsCardHeading({
                                 icon,
                                 title,
                                 detail,
                             }: {
    icon: React.ReactNode;
    title: string;
    detail: string;
}) {
    return (
        <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#EFE8F8] text-[#4E2C66]">
                {icon}
            </div>

            <div>
                <h2 className="text-[16px] font-bold text-[#1A1220]">
                    {title}
                </h2>
                <p className="mt-0.5 text-xs leading-5 text-[#7A6A84]">
                    {detail}
                </p>
            </div>
        </div>
    );
}

function FieldLabel({
                        label,
                        detail,
                        children,
                    }: {
    label: string;
    detail?: string;
    children: React.ReactNode;
}) {
    return (
        <div>
            <label className="mb-2 block text-sm font-medium text-[#1A1220]">
                {label}
            </label>
            {children}
            {detail && (
                <p className="mt-1.5 text-xs text-[#7A6A84]">{detail}</p>
            )}
        </div>
    );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <p className="mb-2 text-sm font-medium text-[#1A1220]">{label}</p>
            <div
                title={value}
                className="flex h-[42px] items-center truncate rounded-xl border border-[#E6DDF0] bg-[#FFFDF8] px-3 text-sm text-[#5F4E75]"
            >
                {value}
            </div>
        </div>
    );
}

function BillingRow({ title, detail }: { title: string; detail: string }) {
    return (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-[#E6DDF0] bg-white px-4 py-3">
            <div>
                <p className="text-sm font-semibold text-[#1A1220]">{title}</p>
                <p className="mt-0.5 text-xs text-[#7A6A84]">{detail}</p>
            </div>

            <span className="shrink-0 rounded-lg border border-[#E6DDF0] bg-[#FFFDF8] px-2.5 py-1 text-xs font-semibold text-[#806A8C]">
                Soon
            </span>
        </div>
    );
}

function TipCard({
                     number,
                     title,
                     detail,
                 }: {
    number: string;
    title: string;
    detail: string;
}) {
    return (
        <div className="rounded-xl border border-[#E6DDF0] bg-[#FFFDF8] p-4">
            <span className="text-xs font-bold tracking-[0.12em] text-[#806A8C]">
                {number}
            </span>
            <p className="mt-2 text-sm font-semibold text-[#1A1220]">
                {title}
            </p>
            <p className="mt-1 text-xs leading-5 text-[#7A6A84]">{detail}</p>
        </div>
    );
}