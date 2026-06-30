"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import {
    CalendarDays,
    Clock3,
    Package2,
    Check,
    Sparkles,
    X,
    Copy,
    Search,
    Clock,
    MapPin,
    Palette,
    RefreshCw,
    AlertCircle,
    Trash2,
} from "lucide-react";

const STORE_MESSENGER = "your.page.username";

// ─── Types ────────────────────────────────────────────────────────────────────

type PackageInclusion = {
    productId: number;
    productName: string;
    quantity: number;
    unitSalesPrice: number;
    lineValue: number;
};

type PackageItem = {
    id: number;
    branch_id?: number | null;
    branchId?: number | null;
    name: string;
    category?: string;
    description: string;
    original_value: number;
    discount_type: "amount" | "percentage";
    discount_value: number;
    package_price: number;
    duration: string;
    status: "Active" | "Inactive";
    inclusions: PackageInclusion[];
};

type ProductVariant = {
    id: number;
    productId?: number;
    product_id?: number;
    variantValues?: Record<string, string> | string;
    variant_values?: Record<string, string> | string;
    stock: number;
    salesPrice?: number;
    sales_price?: number;
};

type InventoryProduct = {
    id: number;
    branchId?: number | null;
    branch_id?: number | null;
    name: string;
    category?: string;
    categoryName?: string;
    category_name?: string;
    salesPrice?: number;
    sales_price?: number;
    stock?: number;
    hasVariants?: boolean;
    has_variants?: boolean;
    variants?: ProductVariant[];
};

type CustomInventoryItem = {
    key: string;
    productId: number;
    variantId?: number | null;
    productName: string;
    variantName?: string;
    displayName: string;
    category: string;
    salesPrice: number;
    stock: number;
};

type SelectedCustomItem = CustomInventoryItem & {
    quantity: number;
};

type Store = {
    id: number;
    store_name: string;
    slug: string;
};

type Booking = {
    bookingReference: string;
    bookingType: string;
    name: string;
    facebookName: string;
    phone: string;
    email: string;
    date: string;
    eventTime: string;
    eventType: string;
    package: string;
    customOrder: string;
    theme: string;
    venue: string;
    notes: string;
    status: string;
    createdAt: string;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const categories = [
    "All",
    "Birthday",
    "Debut",
    "Anniversary",
    "Wedding",
    "Corporate",
    "Kids Party",
    "Baby Shower",
    "Christening",
    "Graduation",
    "Other",
];

const STATUS_MAP: Record<string, { color: string; icon: React.ReactNode }> = {
    "Pending Review": { color: "border border-[#F4D79A] bg-[#FFF8E8] text-[#A56607]", icon: <Clock size={13} /> },
    "Confirmed":      { color: "border border-[#C9D9FB] bg-[#EEF4FF] text-[#1D4ED8]", icon: <Check size={13} /> },
    "Preparing":      { color: "border border-[#D8CBE7] bg-[#F7F1FF] text-[#4E2C66]", icon: <Clock size={13} /> },
    "Completed":      { color: "border border-[#B7E9C8] bg-[#EDFBF1] text-[#138342]", icon: <Check size={13} /> },
    "Cancelled":      { color: "border border-[#F2C4C4] bg-[#FFF0F0] text-[#C32F2F]", icon: <X size={13} /> },
};

const TIMELINE_STEPS = ["Pending Review", "Confirmed", "Preparing", "Completed"];

function getPackageCoverImage(
    pkg: Pick<PackageItem, "name" | "description" | "category">
) {
    const source = `${pkg.category || ""} ${pkg.name} ${pkg.description || ""}`.toLowerCase();

    if (source.includes("wedding")) {
        return "https://images.unsplash.com/photo-1519167758481-83f550bb49b3?auto=format&fit=crop&w=1200&q=88";
    }
    if (source.includes("graduation")) {
        return "https://images.unsplash.com/photo-1523580494863-6f3031224c94?auto=format&fit=crop&w=1200&q=88";
    }
    if (source.includes("baby") || source.includes("christening") || source.includes("baptism")) {
        return "https://images.unsplash.com/photo-1519710164239-da123dc03ef4?auto=format&fit=crop&w=1200&q=88";
    }
    if (source.includes("corporate")) {
        return "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=1200&q=88";
    }
    if (source.includes("birthday") || source.includes("debut") || source.includes("kids")) {
        return "https://images.unsplash.com/photo-1530103862676-de8c9debad1d?auto=format&fit=crop&w=1200&q=88";
    }
    if (source.includes("anniversary")) {
        return "https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=1200&q=88";
    }
    return "https://images.unsplash.com/photo-1507504031003-b417219a0fde?auto=format&fit=crop&w=1200&q=88";
}

function parseVariantValues(
    value: ProductVariant["variantValues"] | ProductVariant["variant_values"]
) {
    if (!value) return {};

    if (typeof value === "string") {
        try {
            return JSON.parse(value) as Record<string, string>;
        } catch {
            return {};
        }
    }

    return value;
}

function getVariantLabel(variant: ProductVariant) {
    const values = parseVariantValues(
        variant.variantValues ?? variant.variant_values
    );

    const label = Object.values(values)
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .join(", ");

    return label || `Variant #${variant.id}`;
}

function buildCustomInventoryItems(
    products: InventoryProduct[],
    selectedBranchId?: number | null
): CustomInventoryItem[] {
    return products.flatMap<CustomInventoryItem>(
        (product): CustomInventoryItem[] => {
            const productBranchId = Number(product.branchId ?? product.branch_id ?? 0);

            if (
                selectedBranchId &&
                productBranchId &&
                productBranchId !== selectedBranchId
            ) {
                return [];
            }

            const category =
                product.category ||
                product.categoryName ||
                product.category_name ||
                "Other";

            const variants = Array.isArray(product.variants)
                ? product.variants
                : [];

            const hasVariants =
                Boolean(product.hasVariants ?? product.has_variants) &&
                variants.length > 0;

            if (hasVariants) {
                return variants.map((variant) => {
                    const variantLabel = getVariantLabel(variant);
                    const price = Number(
                        variant.salesPrice ??
                        variant.sales_price ??
                        product.salesPrice ??
                        product.sales_price ??
                        0
                    );

                    return {
                        key: `product:${product.id}:variant:${variant.id}`,
                        productId: product.id,
                        variantId: Number(variant.id),
                        productName: product.name,
                        variantName: variantLabel,
                        displayName: `${product.name} — ${variantLabel}`,
                        category,
                        salesPrice: price,
                        stock: Number(variant.stock || 0),
                    };
                });
            }

            return [
                {
                    key: `product:${product.id}:regular`,
                    productId: product.id,
                    variantId: null,
                    productName: product.name,
                    displayName: product.name,
                    category,
                    salesPrice: Number(product.salesPrice ?? product.sales_price ?? 0),
                    stock: Number(product.stock || 0),
                },
            ];
        });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
    const s = STATUS_MAP[status] || { color: "border border-[#E6DDF0] bg-[#FFFDF8] text-[#5F4E75]", icon: <Clock size={13} /> };
    return (
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${s.color}`}>
            {s.icon} {status}
        </span>
    );
}

function StatusTimeline({ status }: { status: string }) {
    const isCancelled = status === "Cancelled";
    const currentIndex = TIMELINE_STEPS.indexOf(status);

    if (isCancelled) {
        return (
            <div className="rounded-xl bg-red-50 p-3 text-center text-sm font-medium text-red-600">
                This booking has been cancelled.
            </div>
        );
    }

    return (
        <div className="flex items-start justify-between gap-2">
            {TIMELINE_STEPS.map((step, i) => {
                const done = i <= currentIndex;
                return (
                    <div key={step} className="flex flex-1 flex-col items-center gap-1">
                        <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                            done ? "bg-purple-600 text-white" : "bg-gray-100 text-gray-400"
                        }`}>
                            {done ? <Check size={13} /> : i + 1}
                        </div>
                        <p className={`text-center text-[10px] font-medium leading-tight ${
                            done ? "text-purple-600" : "text-gray-400"
                        }`}>
                            {step}
                        </p>
                    </div>
                );
            })}
        </div>
    );
}

function CancellationConfirmModal({
                                      isOpen,
                                      bookingReference,
                                      onConfirm,
                                      onCancel,
                                      isLoading,
                                  }: {
    isOpen: boolean;
    bookingReference: string;
    onConfirm: () => void;
    onCancel: () => void;
    isLoading: boolean;
}) {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-[18px] border border-[#E6DDF0] bg-white p-5 shadow-2xl">
                <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#FFF0F0] text-[#C32F2F]">
                        <AlertCircle size={20} />
                    </div>
                    <div className="flex-1">
                        <h3 className="text-[20px] font-bold text-[#1A1220]">
                            Cancel booking?
                        </h3>
                        <p className="mt-2 text-sm leading-6 text-[#7A6A84]">
                            Are you sure you want to cancel this booking? This action cannot be undone.
                        </p>
                        <p className="mt-3 rounded-xl border border-[#E6DDF0] bg-[#FFFDF8] px-3 py-2 text-xs font-mono text-[#5F4E75]">
                            Ref: {bookingReference}
                        </p>
                    </div>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    <button
                        onClick={onCancel}
                        disabled={isLoading}
                        className="inline-flex h-[42px] items-center justify-center rounded-xl border border-[#E6DDF0] bg-white px-4 text-sm font-semibold text-[#2B174C] transition hover:bg-[#F7F1FF] disabled:opacity-50"
                    >
                        Keep booking
                    </button>
                    <button
                        onClick={onConfirm}
                        disabled={isLoading}
                        className="inline-flex h-[42px] items-center justify-center rounded-xl bg-[#A33E20] px-4 text-sm font-semibold text-white transition hover:bg-[#883117] disabled:opacity-50"
                    >
                        {isLoading ? "Cancelling..." : "Cancel booking"}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── Inline Status Drawer ─────────────────────────────────────────────────────

type SearchMode = "ref" | "phone";

const POLL_INTERVAL = 30_000; // 30 seconds

function StatusDrawer({ onClose, storeId }: { onClose: () => void; storeId: number }) {
    const router = useRouter();
    const searchParams = useSearchParams();

    const [mode, setMode] = useState<SearchMode>("ref");
    const [refInput, setRefInput] = useState(() => searchParams.get("ref") || "");
    const [phoneInput, setPhoneInput] = useState(() => searchParams.get("phone") || "");
    const [dateInput, setDateInput] = useState(() => searchParams.get("edate") || "");

    const [booking, setBooking] = useState<Booking | null>(null);
    const [phoneBookings, setPhoneBookings] = useState<Booking[]>([]);
    const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
    const [loading, setLoading] = useState(false);
    const [polling, setPolling] = useState(false);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    const [error, setError] = useState("");

    // Cancellation state
    const [showCancelModal, setShowCancelModal] = useState(false);
    const [cancelLoading, setCancelLoading] = useState(false);
    const [cancelSuccess, setCancelSuccess] = useState(false);

    // Save ref to URL so it survives reload
    function saveRefToUrl(ref: string) {
        const url = new URL(window.location.href);
        url.searchParams.set("ref", ref);
        url.searchParams.delete("phone");
        url.searchParams.delete("edate");
        router.replace(url.pathname + url.search, { scroll: false });
    }

    function clearUrl() {
        const url = new URL(window.location.href);
        url.searchParams.delete("ref");
        url.searchParams.delete("phone");
        url.searchParams.delete("edate");
        router.replace(url.pathname + url.search, { scroll: false });
    }

    function reset() {
        setRefInput(""); setPhoneInput(""); setDateInput("");
        setBooking(null); setPhoneBookings([]); setSelectedBooking(null);
        setError(""); setLastUpdated(null);
        setShowCancelModal(false);
        setCancelSuccess(false);
        clearUrl();
    }

    function switchMode(m: SearchMode) { setMode(m); reset(); }

    // Core fetch by reference — used for initial search + polling
    const fetchByRef = useCallback(async (ref: string, silent = false) => {
        if (!silent) setLoading(true);
        else setPolling(true);
        try {
            const res = await fetch("/api/bookings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "get_booking_by_reference", bookingReference: ref }),
            });
            const data = await res.json();
            if (!res.ok || data.error) {
                if (!silent) setError("Booking not found. Check your reference number.");
                return;
            }
            setBooking(data.booking);
            setLastUpdated(new Date());
            setError("");
        } catch {
            if (!silent) setError("Something went wrong. Please try again.");
        } finally {
            if (!silent) setLoading(false);
            else setPolling(false);
        }
    }, []);

    // On mount — if ref in URL, auto-search and open drawer
    useEffect(() => {
        const ref = searchParams.get("ref");
        if (ref) {
            setMode("ref");
            setRefInput(ref);
            fetchByRef(ref);
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Auto-poll every 30s when a booking by ref is showing
    useEffect(() => {
        if (!booking?.bookingReference) return;
        const interval = setInterval(() => {
            fetchByRef(booking.bookingReference!, true);
        }, POLL_INTERVAL);
        return () => clearInterval(interval);
    }, [booking?.bookingReference, fetchByRef]);

    async function handleSearch() {
        setError("");
        setBooking(null);
        setPhoneBookings([]);
        setSelectedBooking(null);

        if (mode === "ref") {
            const val = refInput.trim().toUpperCase();
            if (!val) { setError("Please enter your booking reference number."); return; }
            saveRefToUrl(val);
            await fetchByRef(val);
        } else {
            const phone = phoneInput.trim();
            const date = dateInput.trim();
            if (!phone || !date) { setError("Please enter both your phone number and event date."); return; }
            setLoading(true);
            try {
                const res = await fetch("/api/bookings", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "get_bookings_by_phone", phone, storeId }),
                });
                const data = await res.json();
                const all: Booking[] = data.bookings || [];
                const matched = all.filter((b) => b.date?.slice(0, 10) === date);
                if (matched.length === 0) { setError("No booking found matching that phone number and event date."); return; }
                if (matched.length === 1) {
                    setSelectedBooking(matched[0]);
                    // Switch to ref polling for the found booking
                    if (matched[0].bookingReference) saveRefToUrl(matched[0].bookingReference);
                } else {
                    setPhoneBookings(matched);
                }
                setLastUpdated(new Date());
            } catch {
                setError("Something went wrong. Please try again.");
            } finally {
                setLoading(false);
            }
        }
    }

    // When user picks a booking from multiple results, start polling it
    function handleSelectBooking(b: Booking) {
        setSelectedBooking(b);
        if (b.bookingReference) saveRefToUrl(b.bookingReference);
    }

    // Handle cancellation
    async function handleConfirmCancellation() {
        if (!displayBooking?.bookingReference) return;

        setCancelLoading(true);
        try {
            const res = await fetch("/api/bookings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "cancel_booking",
                    bookingReference: displayBooking.bookingReference,
                }),
            });

            const data = await res.json();

            if (!res.ok) {
                setError(data.error || "Failed to cancel booking.");
                setShowCancelModal(false);
                setCancelLoading(false);
                return;
            }

            // Success: Update local booking status and show success message
            setBooking((prev) =>
                prev
                    ? { ...prev, status: "Cancelled" }
                    : null
            );
            setSelectedBooking((prev) =>
                prev
                    ? { ...prev, status: "Cancelled" }
                    : null
            );

            setCancelSuccess(true);
            setShowCancelModal(false);
        } catch (err) {
            setError("Error cancelling booking. Please try again.");
            setShowCancelModal(false);
        } finally {
            setCancelLoading(false);
        }
    }

    const displayBooking = booking ?? selectedBooking;

    // Check booking status for cancellation eligibility
    const canCancel = displayBooking?.status === "Pending Review" && !cancelSuccess;
    const isCompleted = displayBooking?.status === "Completed";
    const isConfirmedOrPreparing =
        (displayBooking?.status === "Confirmed" || displayBooking?.status === "Preparing") &&
        !cancelSuccess;

    return (
        <div className="border-b border-[#E6DDF0] bg-[#F7F1FF]/85 px-6 py-5">
            <div className="mx-auto max-w-7xl">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#806A8C]">
                            Booking tracker
                        </p>
                        <h2 className="mt-1 text-[20px] font-bold text-[#1A1220]">
                            Check your booking status
                        </h2>
                    </div>

                    <button
                        onClick={() => {
                            onClose();
                            clearUrl();
                        }}
                        className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#E6DDF0] bg-white text-[#806A8C] transition hover:bg-[#F0EAFE] hover:text-[#2B174C]"
                        aria-label="Close booking status"
                        type="button"
                    >
                        <X size={16} />
                    </button>
                </div>

                {/* Mode tabs */}
                <div className="mb-4 flex flex-wrap items-center gap-2">
                    <button
                        onClick={() => switchMode("ref")}
                        className={`rounded-xl px-3.5 py-2 text-xs font-semibold transition ${
                            mode === "ref"
                                ? "bg-[#2B174C] text-white shadow-sm"
                                : "border border-[#E6DDF0] bg-white text-[#5F4E75] hover:bg-[#F0EAFE]"
                        }`}
                    >
                        Search by reference no.
                    </button>
                    <button
                        onClick={() => switchMode("phone")}
                        className={`rounded-xl px-3.5 py-2 text-xs font-semibold transition ${
                            mode === "phone"
                                ? "bg-[#2B174C] text-white shadow-sm"
                                : "border border-[#E6DDF0] bg-white text-[#5F4E75] hover:bg-[#F0EAFE]"
                        }`}
                    >
                        I forgot my reference no.
                    </button>
                </div>

                {mode === "ref" && (
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                        <Search size={17} className="hidden shrink-0 text-[#4E2C66] sm:block" />
                        <input
                            value={refInput}
                            onChange={(e) => {
                                setRefInput(e.target.value.toUpperCase());
                                setError("");
                                setBooking(null);
                            }}
                            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                            placeholder="e.g. YUKA-2026-532001"
                            className="h-[42px] flex-1 rounded-xl border border-[#D8CBE7] bg-white px-3.5 text-sm font-mono tracking-widest text-[#1A1220] outline-none placeholder:font-sans placeholder:tracking-normal placeholder:text-[#9B8AAA] transition focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10"
                        />
                        <button
                            onClick={handleSearch}
                            disabled={loading}
                            className="inline-flex h-[42px] items-center justify-center rounded-xl bg-[#2B174C] px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31] disabled:opacity-60"
                        >
                            {loading ? "Searching…" : "Search"}
                        </button>
                    </div>
                )}

                {mode === "phone" && (
                    <div className="space-y-3">
                        <div className="flex items-center gap-3">
                            <Search size={17} className="hidden shrink-0 text-[#4E2C66] sm:block" />
                            <input
                                value={phoneInput}
                                onChange={(e) => {
                                    setPhoneInput(e.target.value);
                                    setError("");
                                    setPhoneBookings([]);
                                    setSelectedBooking(null);
                                }}
                                placeholder="Phone number used when booking (09XXXXXXXXX)"
                                className="h-[42px] flex-1 rounded-xl border border-[#D8CBE7] bg-white px-3.5 text-sm text-[#1A1220] outline-none placeholder:text-[#9B8AAA] transition focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10"
                            />
                        </div>
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                            <CalendarDays size={17} className="hidden shrink-0 text-[#4E2C66] sm:block" />
                            <input
                                type="date"
                                value={dateInput}
                                onChange={(e) => {
                                    setDateInput(e.target.value);
                                    setError("");
                                    setPhoneBookings([]);
                                    setSelectedBooking(null);
                                }}
                                className="h-[42px] flex-1 rounded-xl border border-[#D8CBE7] bg-white px-3.5 text-sm text-[#1A1220] outline-none transition focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10"
                            />
                            <button
                                onClick={handleSearch}
                                disabled={loading}
                                className="inline-flex h-[42px] items-center justify-center rounded-xl bg-[#2B174C] px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31] disabled:opacity-60"
                            >
                                {loading ? "Searching…" : "Search"}
                            </button>
                        </div>
                        <p className="text-xs text-[#7A6A84]">
                            Both your phone number and event date must match your booking.
                        </p>
                    </div>
                )}

                {error && <p className="mt-2 text-sm font-medium text-red-500">{error}</p>}

                {phoneBookings.length > 1 && !selectedBooking && (
                    <div className="mt-4 space-y-2">
                        <p className="text-xs font-semibold text-gray-500">Found {phoneBookings.length} bookings on that date — select one:</p>
                        {phoneBookings.map((b) => (
                            <button
                                key={b.bookingReference}
                                onClick={() => handleSelectBooking(b)}
                                className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-left transition hover:border-purple-300 hover:bg-purple-50"
                            >
                                <div className="flex items-center justify-between">
                                    <span className="font-mono text-sm font-bold text-purple-700">{b.bookingReference}</span>
                                    <StatusBadge status={b.status} />
                                </div>
                                <p className="mt-1 text-xs text-gray-500">
                                    {b.package ? b.package : b.customOrder ? "Custom request" : ""}
                                    {b.venue ? ` · ${b.venue}` : ""}
                                </p>
                            </button>
                        ))}
                    </div>
                )}

                {displayBooking && (
                    <div className="mt-4 rounded-2xl bg-white p-5 shadow-sm">
                        {phoneBookings.length > 1 && (
                            <button onClick={() => setSelectedBooking(null)} className="mb-3 flex items-center gap-1 text-xs font-medium text-purple-600 hover:underline">
                                ← Back to results
                            </button>
                        )}
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Booking Reference</p>
                                <p className="mt-0.5 text-xl font-black tracking-wide text-purple-700">{displayBooking.bookingReference}</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <StatusBadge status={displayBooking.status} />
                                {/* Manual refresh */}
                                <button
                                    onClick={() => fetchByRef(displayBooking.bookingReference!, false)}
                                    disabled={loading || polling}
                                    title="Refresh status"
                                    className="rounded-xl border border-gray-200 p-1.5 text-gray-400 hover:bg-gray-50 hover:text-purple-600 disabled:opacity-40"
                                >
                                    <RefreshCw size={13} className={polling ? "animate-spin" : ""} />
                                </button>
                            </div>
                        </div>

                        {/* Auto-poll indicator */}
                        <p className="mt-1 text-[10px] text-gray-400">
                            {polling ? "Checking for updates…" : lastUpdated ? `Last checked: ${lastUpdated.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" })} · Auto-updates every 30s` : ""}
                        </p>

                        <div className="mt-4">
                            <StatusTimeline status={displayBooking.status} />
                        </div>

                        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 border-t border-gray-100 pt-4 text-sm md:grid-cols-4">
                            <DetailItem label="Name" value={displayBooking.name} />
                            <DetailItem
                                label="Event Date"
                                value={new Date(displayBooking.date).toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" })}
                                icon={<CalendarDays size={13} className="text-purple-400" />}
                            />
                            {displayBooking.eventTime && <DetailItem label="Time" value={displayBooking.eventTime} icon={<Clock size={13} className="text-purple-400" />} />}
                            {displayBooking.venue && <DetailItem label="Venue" value={displayBooking.venue} icon={<MapPin size={13} className="text-purple-400" />} />}
                            {displayBooking.theme && <DetailItem label="Theme" value={displayBooking.theme} icon={<Palette size={13} className="text-purple-400" />} />}
                            {displayBooking.bookingType === "package" && displayBooking.package && <DetailItem label="Package" value={displayBooking.package} />}
                            {displayBooking.bookingType === "custom" && displayBooking.customOrder && <DetailItem label="Custom Request" value={displayBooking.customOrder} />}
                        </div>

                        {/* Status-based Cancel Section */}
                        {isCompleted ? (
                            <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-4">
                                <p className="font-semibold text-green-700">Booking Completed</p>
                                <p className="mt-1 text-sm text-green-600">
                                    Thank you for using our service. This booking has been marked as completed.
                                </p>
                            </div>
                        ) : isConfirmedOrPreparing ? (
                            <div className="mt-4 rounded-xl border border-orange-200 bg-orange-50 p-4">
                                <p className="font-semibold text-orange-700">Booking Cannot Be Cancelled</p>
                                <p className="mt-1 text-sm text-orange-600">
                                    This booking can no longer be cancelled because it has already been confirmed or is being prepared.
                                </p>
                            </div>
                        ) : canCancel ? (
                            <div className="mt-4 rounded-xl border border-yellow-200 bg-yellow-50 p-4">
                                <p className="mb-2 text-sm font-semibold text-yellow-800">
                                    Want to cancel this booking?
                                </p>
                                <p className="mb-3 text-xs text-yellow-700">
                                    Since your booking is still pending, you can cancel it.
                                </p>
                                <button
                                    onClick={() => setShowCancelModal(true)}
                                    className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700"
                                >
                                    <Trash2 size={14} />
                                    Cancel Booking
                                </button>
                            </div>
                        ) : displayBooking.status === "Cancelled" ? (
                            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4">
                                <p className="text-sm font-semibold text-red-600">✓ Booking Cancelled</p>
                                <p className="mt-1 text-xs text-red-500">
                                    Your booking has been cancelled.
                                </p>
                            </div>
                        ) : null}

                        <p className="mt-3 text-xs text-gray-400">
                            For follow-ups, contact the store with your booking reference number.
                        </p>
                        {/* Cancellation Modal */}
                        <CancellationConfirmModal
                            isOpen={showCancelModal}
                            bookingReference={displayBooking?.bookingReference || ""}
                            onConfirm={handleConfirmCancellation}
                            onCancel={() => setShowCancelModal(false)}
                            isLoading={cancelLoading}
                        />
                    </div>

                )}
            </div>
        </div>
    );
}

function DetailItem({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
    return (
        <div className="flex flex-col gap-0.5">
            <span className="flex items-center gap-1 text-xs text-gray-400">
                {icon}{label}
            </span>
            <span className="text-sm font-semibold text-black">
                {value}
            </span>
        </div>
    );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CustomerBookingPage() {
    const params = useParams();
    const searchParams = useSearchParams();
    const slug = params?.slug as string;

    const branchIdFromUrl = searchParams.get("branchId");

    const packageRef = useRef<HTMLDivElement>(null);
    const formRef = useRef<HTMLDivElement>(null);

    const [store, setStore] = useState<Store | null>(null);
    const [packages, setPackages] = useState<PackageItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const [activeCategory, setActiveCategory] = useState("All");
    const [detailsPackage, setDetailsPackage] = useState<PackageItem | null>(null);

    const [showStatusDrawer, setShowStatusDrawer] = useState(() => !!searchParams.get("ref"));

    const [bookingType, setBookingType] = useState<"package" | "custom">("package");
    const [selectedPackage, setSelectedPackage] = useState("");
    const [customOrder, setCustomOrder] = useState("");

    const [inventoryItems, setInventoryItems] = useState<CustomInventoryItem[]>([]);
    const [loadingInventory, setLoadingInventory] = useState(false);
    const [inventorySearch, setInventorySearch] = useState("");
    const [inventoryCategory, setInventoryCategory] = useState("All");
    const [selectedCustomItems, setSelectedCustomItems] = useState<SelectedCustomItem[]>([]);
    const [customItemQty, setCustomItemQty] = useState<Record<string, number>>({});

    const [name, setName] = useState("");
    const [facebookName, setFacebookName] = useState("");
    const [phone, setPhone] = useState("");
    const [email, setEmail] = useState("");
    const [date, setDate] = useState("");
    const [eventTime, setEventTime] = useState("");
    const [eventType, setEventType] = useState("");
    const [theme, setTheme] = useState("");
    const [venue, setVenue] = useState("");
    const [notes, setNotes] = useState("");

    const [showSuccess, setShowSuccess] = useState(false);
    const [bookingReference, setBookingReference] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
    // Default branch for custom bookings
    const defaultBranchId = useMemo(() => {
        if (!store || packages.length === 0) return null;
        const pkgWithBranch = packages.find((p) => p.branch_id || p.branchId);
        return pkgWithBranch?.branch_id || pkgWithBranch?.branchId || null;
    }, [store, packages]);

    const customInventoryCategories = useMemo(() => {
        const uniqueCategories = Array.from(
            new Set(
                inventoryItems
                    .map((item) => item.category || "Other")
                    .filter(Boolean)
            )
        );

        return ["All", ...uniqueCategories];
    }, [inventoryItems]);

    const filteredInventoryItems = useMemo(() => {
        const query = inventorySearch.trim().toLowerCase();

        return inventoryItems.filter((item) => {
            const matchesSearch =
                !query ||
                item.displayName.toLowerCase().includes(query) ||
                item.category.toLowerCase().includes(query);

            const matchesCategory =
                inventoryCategory === "All" ||
                item.category.toLowerCase() === inventoryCategory.toLowerCase();

            return matchesSearch && matchesCategory;
        });
    }, [inventoryItems, inventorySearch, inventoryCategory]);

    const selectedCustomTotal = useMemo(() => {
        return selectedCustomItems.reduce(
            (sum, item) => sum + item.salesPrice * item.quantity,
            0
        );
    }, [selectedCustomItems]);

    const customOrderForSubmit = useMemo(() => {
        const selectedItemsText = selectedCustomItems
            .map(
                (item) =>
                    `${item.displayName} x ${item.quantity} = ${peso(
                        item.salesPrice * item.quantity
                    )}`
            )
            .join("\n");

        const requestText = customOrder.trim();

        if (selectedItemsText && requestText) {
            return `Selected inventory items:\n${selectedItemsText}\n\nAdditional request:\n${requestText}`;
        }

        if (selectedItemsText) {
            return `Selected inventory items:\n${selectedItemsText}`;
        }

        return requestText;
    }, [selectedCustomItems, customOrder]);


    function clearError(key: string) {
        setFieldErrors((prev) => ({ ...prev, [key]: "" }));
    }

    function getCustomQty(itemKey: string) {
        return customItemQty[itemKey] || 1;
    }

    function setCustomQtyForItem(itemKey: string, quantity: number) {
        const safeQty = Math.max(1, quantity || 1);

        setCustomItemQty((prev) => ({
            ...prev,
            [itemKey]: safeQty,
        }));
    }

    function addCustomItem(item: CustomInventoryItem) {
        const qty = getCustomQty(item.key);

        if (item.stock <= 0) return;

        setSelectedCustomItems((prev) => {
            const existing = prev.find((selected) => selected.key === item.key);
            const currentQty = existing?.quantity || 0;
            const nextQty = Math.min(currentQty + qty, item.stock);

            if (existing) {
                return prev.map((selected) =>
                    selected.key === item.key
                        ? { ...selected, quantity: nextQty }
                        : selected
                );
            }

            return [...prev, { ...item, quantity: nextQty }];
        });

        clearError("selection");
    }

    function updateSelectedCustomQty(itemKey: string, quantity: number) {
        setSelectedCustomItems((prev) =>
            prev.map((item) =>
                item.key === itemKey
                    ? {
                        ...item,
                        quantity: Math.min(Math.max(1, quantity), item.stock),
                    }
                    : item
            )
        );
    }

    function removeSelectedCustomItem(itemKey: string) {
        setSelectedCustomItems((prev) =>
            prev.filter((item) => item.key !== itemKey)
        );
    }

    function validateForm(): Record<string, string> {
        const errors: Record<string, string> = {};
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const maxDate = new Date(); maxDate.setFullYear(maxDate.getFullYear() + 2);

        const hasSelection =
            bookingType === "package"
                ? !!selectedPackage
                : selectedCustomItems.length > 0 || !!customOrder.trim();

        if (!hasSelection) {
            errors.selection =
                bookingType === "package"
                    ? "Please select a package."
                    : "Please select at least one inventory item or describe your custom request.";
        }

        if (bookingType === "custom" && !eventType.trim()) errors.eventType = "Event type is required.";

        if (!name.trim()) errors.name = "Full name is required.";
        else if (!/^[a-zA-Z\s.'-]+$/.test(name.trim())) errors.name = "Name should contain letters only.";

        if (!facebookName.trim()) errors.facebookName = "Messenger name is required.";

        if (!phone.trim()) errors.phone = "Phone number is required.";
        else if (!/^09\d{9}$/.test(phone.trim())) errors.phone = "Enter a valid PH number (09XXXXXXXXX).";

        if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errors.email = "Enter a valid email address.";

        if (!date) errors.date = "Event date is required.";
        else {
            const selected = new Date(date); selected.setHours(0, 0, 0, 0);
            if (selected < today) errors.date = "Event date must be a future date.";
            else if (selected > maxDate) errors.date = "Date is too far ahead. Max 2 years from now.";
        }

        if (!eventTime) errors.eventTime = "Event time is required.";
        if (!venue.trim()) errors.venue = "Venue is required.";
        if (!theme.trim()) errors.theme = "Theme / motif is required.";

        return errors;
    }

    const filteredPackages = useMemo(() => {
        if (activeCategory === "All") return packages;
        return packages.filter((pkg) => {
            const category = pkg.category || "";
            return (
                category.toLowerCase() === activeCategory.toLowerCase() ||
                pkg.name.toLowerCase().includes(activeCategory.toLowerCase())
            );
        });
    }, [packages, activeCategory]);

    useEffect(() => {
        if (!slug) return;
        const loadStore = async () => {
            try {
                const res = await fetch("/api/auth", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "get_store_by_slug", slug }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data?.error || "Failed to load store");
                setStore(data.store);
            } catch (err) {
                setError(err instanceof Error ? err.message : "Something went wrong");
            } finally {
                setLoading(false);
            }
        };
        loadStore();
    }, [slug]);

    useEffect(() => {
        if (!store) return;

        const fetchPackages = async () => {
            try {
                const res = await fetch("/api/packages", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        action: "get_packages",
                        store_id: store.id,
                        ...(branchIdFromUrl ? { branch_id: Number(branchIdFromUrl) } : {}),
                    }),
                });

                const data = await res.json();


                setPackages(
                    (data.packages || []).filter(
                        (p: PackageItem) => p.status === "Active"
                    )
                );
            } catch (err) {
                console.error("Error loading packages:", err);
                setPackages([]);
            } finally {
                setLoading(false);
            }
        };

        fetchPackages();
    }, [store, branchIdFromUrl]);

    useEffect(() => {
        if (!store) return;

        const storeId = store.id;

        async function fetchInventoryItems() {
            setLoadingInventory(true);

            try {
                const response = await fetch("/api/products", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        action: "get_public_products",
                        store_id: storeId,
                        ...(branchIdFromUrl
                            ? { branch_id: Number(branchIdFromUrl) }
                            : {}),
                    }),
                });

                const data = await response.json();
                const products = Array.isArray(data.products) ? data.products : [];

                setInventoryItems(
                    buildCustomInventoryItems(
                        products,
                        branchIdFromUrl ? Number(branchIdFromUrl) : null
                    )
                );
            } catch (err) {
                console.error("Error loading public inventory:", err);
                setInventoryItems([]);
            } finally {
                setLoadingInventory(false);
            }
        }

        void fetchInventoryItems();
    }, [store, branchIdFromUrl]);

    function peso(n: number) {
        return `₱${Number(n || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    const selectedPackageData = useMemo(() => {
        if (!selectedPackage) return null;

        return packages.find(
            (pkg) => `${pkg.name} - ${peso(pkg.package_price)}` === selectedPackage
        ) || null;
    }, [packages, selectedPackage]);

    function generateBookingReference() {
        const storePrefix = (store?.slug || "STORE").replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toUpperCase();
        const year = new Date().getFullYear();
        const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
        const token = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
        return `${storePrefix}-${year}-${token}`;
    }

    function handleSelectPackage(pkg: PackageItem) {
        setBookingType("package");
        setSelectedPackage(`${pkg.name} - ${peso(pkg.package_price)}`);
        clearError("selection");
        formRef.current?.scrollIntoView({ behavior: "smooth" });
    }

    function resetForm() {
        setBookingType("package");
        setSelectedPackage(""); setCustomOrder(""); setSelectedCustomItems([]); setCustomItemQty({}); setName(""); setFacebookName("");
        setPhone(""); setEmail(""); setDate(""); setEventTime("");
        setEventType(""); setTheme(""); setVenue(""); setNotes("");
    }

    async function handleSubmit() {
        if (!store) { alert("Store not found."); return; }

        const errors = validateForm();
        setFieldErrors(errors);
        if (Object.keys(errors).length > 0) {
            formRef.current?.scrollIntoView({ behavior: "smooth" });
            return;
        }

        const reference = generateBookingReference();

        // assign branchId correctly for both package and custom bookings
        const selectedBranchId =
            bookingType === "package"
                ? selectedPackageData?.branch_id || selectedPackageData?.branchId || null
                : defaultBranchId; // default branch for custom bookings

        const newBooking = {
            bookingReference: reference,
            bookingType,
            name: name.trim(),
            facebookName: facebookName.trim(),
            phone: phone.trim(),
            email: email.trim(),
            date,
            eventTime,
            eventType: bookingType === "package" ? "Based on selected package" : eventType.trim(),
            theme: theme.trim(),
            venue: venue.trim(),
            package: bookingType === "package" ? selectedPackage : "",
            customOrder: bookingType === "custom" ? customOrderForSubmit : "",
            notes: notes.trim(),
            status: "Pending Review",
        };

        try {
            setSubmitting(true);
            const response = await fetch("/api/bookings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "create_booking",
                    storeId: store.id,
                    branchId: selectedBranchId,
                    ...newBooking,
                    bookingItems:
                        bookingType === "custom"
                            ? selectedCustomItems.map((item) => ({
                                productId: item.productId,
                                variantId: item.variantId ?? null,
                                productName: item.productName,
                                variantName: item.variantName || "",
                                displayName: item.displayName,
                                category: item.category,
                                quantity: item.quantity,
                                salesPrice: item.salesPrice,
                            }))
                            : [],
                }),
            });
            const text = await response.text();
            if (!response.ok) { alert(`Submit failed: ${text}`); return; }

            setBookingReference(reference);
            setShowSuccess(true);
            sessionStorage.setItem("booker_phone", phone.trim());
            resetForm();
            setFieldErrors({});
        } catch (err) {
            console.warn("Booking submit error:", err);
            alert("Failed to submit booking. Please try again.");
        } finally {
            setSubmitting(false);
        }
    }

    async function copyReference() {
        if (!bookingReference) return;
        await navigator.clipboard.writeText(bookingReference);
        alert("Booking reference copied.");
    }

    if (loading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-[#FDFAF4] font-sans">
                <div className="rounded-[14px] border border-[#E6DDF0] bg-white px-5 py-4 text-sm font-semibold text-[#5F4E75] shadow-sm">Loading store...</div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-[#FDFAF4] px-6 font-sans">
                <div className="w-full max-w-md rounded-[18px] border border-[#F2C4C4] bg-white p-6 text-sm font-medium text-[#C32F2F] shadow-sm">{error}</div>
            </div>
        );
    }

    if (!store) {
        return <div className="flex min-h-screen items-center justify-center bg-[#FDFAF4] font-sans text-sm font-medium text-[#7A6A84]">Store not found</div>;
    }

    return (
        <div className="min-h-screen bg-[#FDFAF4] font-sans text-[#1A1220]">

            {/* ── Public booking header ── */}
            <header className="sticky top-0 z-50 border-b border-[#E9E0EF] bg-[#FFFDF8]/95 backdrop-blur">
                <div className="mx-auto flex min-h-[72px] max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-3">
                    <div className="min-w-0">
                        <h1 className="truncate text-[25px] font-bold text-[#1A1220]">
                            {store.store_name}
                        </h1>
                        <p className="mt-0.5 text-sm text-[#7A6A84]">
                            Event Packages &amp; Booking
                        </p>
                    </div>

                    <button
                        type="button"
                        onClick={() => setShowStatusDrawer((value) => !value)}
                        className={`inline-flex h-[42px] shrink-0 items-center gap-2 rounded-xl border px-4 text-sm font-semibold transition ${
                            showStatusDrawer
                                ? "border-[#2B174C] bg-[#2B174C] text-white shadow-sm"
                                : "border-[#D8CBE7] bg-[#F7F1FF] text-[#2B174C] hover:bg-[#F0EAFE]"
                        }`}
                    >
                        <Search size={16} />
                        Check booking status
                    </button>
                </div>
            </header>

            {/* ── Packages ── */}
            <section ref={packageRef} className="mx-auto max-w-7xl px-6 py-4">
                {/* Booking tracker appears directly above Categories. */}
                {showStatusDrawer && (
                    <div className="mb-3">
                        <StatusDrawer
                            storeId={store.id}
                            onClose={() => setShowStatusDrawer(false)}
                        />
                    </div>
                )}

                <div className="rounded-[14px] border border-[#E6DDF0] bg-white p-3 shadow-sm">
                    <div className="mb-2 flex items-center justify-between gap-3">
                        <h2 className="text-sm font-bold text-[#1A1220]">
                            Categories
                        </h2>

                        <span className="shrink-0 text-xs font-semibold text-[#806A8C]">
                            {categories.length - 1} categories
                        </span>
                    </div>

                    <div className="overflow-x-auto pb-1">
                        <div className="flex min-w-max gap-2">
                            {categories.map((category) => {
                                const active = activeCategory === category;

                                return (
                                    <button
                                        key={category}
                                        type="button"
                                        onClick={() => setActiveCategory(category)}
                                        className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                                            active
                                                ? "bg-[#2B174C] text-white shadow-sm"
                                                : "border border-[#E6DDF0] bg-white text-[#5F4E75] hover:bg-[#F7F1FF]"
                                        }`}
                                    >
                                        {category}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>

                <div className="mt-3 rounded-[14px] border border-[#E6DDF0] bg-white p-3 shadow-sm">
                    <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                            <h2 className="text-[16px] font-bold text-[#1A1220]">
                                Available Packages
                            </h2>
                            <p className="mt-0.5 text-xs text-[#7A6A84]">
                                Choose a package and customize the theme, color motif, or event details.
                            </p>
                        </div>

                        <span className="shrink-0 text-xs font-semibold text-[#806A8C]">
                            {filteredPackages.length} package{filteredPackages.length === 1 ? "" : "s"}
                        </span>
                    </div>

                    {filteredPackages.length === 0 ? (
                        <div className="flex min-h-[280px] items-center justify-center rounded-[14px] border border-dashed border-[#E6DDF0] bg-[#FFFCF7] px-5 text-center">
                            <div>
                                <div className="mb-3 flex justify-center">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#EFE8F8] text-[#4E2C66]">
                                        <Sparkles size={18} />
                                    </div>
                                </div>
                                <h3 className="text-sm font-semibold text-[#1A1220]">
                                    No packages found
                                </h3>
                                <p className="mt-1 text-xs leading-5 text-[#7A6A84]">
                                    Try another category or send a custom booking request below.
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                            {filteredPackages.map((pkg, index) => {
                                const featured = index === 1;

                                return (
                                    <article
                                        key={pkg.id}
                                        className="group overflow-hidden rounded-[18px] border border-[#E6DDF0] bg-white shadow-sm transition duration-200 hover:-translate-y-1 hover:border-[#D4C1E7] hover:shadow-md"
                                    >
                                        <div className="h-36 overflow-hidden bg-[#F5EEF6]">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img
                                                src={getPackageCoverImage(pkg)}
                                                alt={`${pkg.name} package`}
                                                className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                                            />
                                        </div>

                                        <div
                                            className={`px-4 py-4 text-white ${
                                                featured
                                                    ? "bg-[#C9951A]"
                                                    : "bg-[#2D1B4E]"
                                            }`}
                                        >
                                            <div className="min-w-0">
                                                <p className="min-h-[40px] text-[16px] font-semibold leading-5">
                                                    {pkg.name}
                                                </p>

                                                <p className="mt-1 text-[22px] font-bold leading-tight">
                                                    {peso(pkg.package_price)}
                                                </p>

                                                <p className="mt-1 text-xs leading-none text-white/80">
                                                    {pkg.category || "Event"} package
                                                </p>
                                            </div>
                                        </div>

                                        <div className="p-4">
                                            <p className="line-clamp-2 min-h-11 text-[13px] leading-5 text-[#7A6A84]">
                                                {pkg.description ||
                                                    "Event setup designed for a memorable celebration."}
                                            </p>

                                            <div className="mt-4 flex items-center gap-4 border-t border-[#EFE7F4] pt-3">
                                                <div className="flex items-center gap-1.5 text-xs text-[#7A6A84]">
                                                    <Package2 size={14} />
                                                    <span>
                                                        {pkg.inclusions.length}{" "}
                                                        {pkg.inclusions.length === 1
                                                            ? "Item"
                                                            : "Items"}
                                                    </span>
                                                </div>

                                                <div className="flex items-center gap-1.5 text-xs text-[#7A6A84]">
                                                    <Clock3 size={14} />
                                                    <span>{pkg.duration || "Flexible"}</span>
                                                </div>
                                            </div>

                                            <div className="mt-3 flex items-center justify-between border-t border-[#EFE7F4] pt-3">
                                                <button
                                                    type="button"
                                                    onClick={() => setDetailsPackage(pkg)}
                                                    className="text-xs font-semibold text-[#2B174C] transition hover:text-[#5B2FC6]"
                                                >
                                                    View details →
                                                </button>

                                                <button
                                                    type="button"
                                                    onClick={() => handleSelectPackage(pkg)}
                                                    className="text-xs font-semibold text-[#2B174C] transition hover:text-[#5B2FC6]"
                                                >
                                                    Select
                                                </button>
                                            </div>
                                        </div>
                                    </article>
                                );
                            })}
                        </div>
                    )}
                </div>
            </section>

            {/* ── Booking Form ── */}
            <section className="mx-auto max-w-7xl px-6 pb-16 sm:pb-20">
                <div
                    ref={formRef}
                    className="overflow-hidden rounded-[20px] border border-[#E6DDF0] bg-white shadow-sm"
                >
                    <div className="border-b border-[#E6DDF0] bg-[#FFFDF8] px-6 py-6 sm:px-8">
                        <div className="flex flex-wrap items-start gap-3">
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#EFE8F8] text-[#4E2C66]">
                                <CalendarDays size={20} />
                            </div>
                            <div>
                                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#806A8C]">
                                    Booking request
                                </p>
                                <h2 className="mt-1 text-[27px] font-bold tracking-[-0.02em] text-[#1A1220]">
                                    Book your event
                                </h2>
                                <p className="mt-2 max-w-2xl text-sm leading-6 text-[#7A6A84]">
                                    Submit your details and the store will review your request. Save your booking
                                    reference number to follow up or track the status at any time.
                                </p>
                            </div>
                        </div>
                    </div>

                    {showSuccess ? (
                        <div className="px-6 py-16 text-center sm:px-8">
                            <div className="mb-5 flex justify-center">
                                <div className="flex h-16 w-16 items-center justify-center rounded-full border border-[#B7E9C8] bg-[#EDFBF1] text-[#138342]">
                                    <Check size={30} />
                                </div>
                            </div>
                            <h3 className="text-[28px] font-bold tracking-[-0.02em] text-[#1A1220]">
                                Booking request submitted
                            </h3>
                            <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-[#7A6A84]">
                                Save your booking reference number below. You can check your status anytime using the
                                <strong className="text-[#2B174C]"> Track booking</strong> button at the top.
                            </p>

                            <div className="mx-auto mt-7 max-w-md rounded-[18px] border border-[#D8CBE7] bg-[#F7F1FF] p-5">
                                <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#806A8C]">
                                    Booking reference no.
                                </p>
                                <div className="mt-3 flex items-center justify-center gap-3">
                                    <p className="text-[22px] font-bold tracking-wide text-[#2B174C]">
                                        {bookingReference}
                                    </p>
                                    <button
                                        type="button"
                                        onClick={copyReference}
                                        className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#D8CBE7] bg-white text-[#2B174C] shadow-sm transition hover:bg-[#F0EAFE]"
                                        title="Copy reference number"
                                    >
                                        <Copy size={17} />
                                    </button>
                                </div>
                            </div>

                            <div className="mx-auto mt-5 max-w-lg rounded-xl border border-[#E6DDF0] bg-[#FFFDF8] p-4 text-sm leading-6 text-[#7A6A84]">
                                Your booking is now in the store&apos;s admin system for review. The store can confirm,
                                prepare, complete, or cancel the booking from their admin dashboard.
                            </div>

                            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
                                <button
                                    onClick={() => { setShowStatusDrawer(true); setShowSuccess(false); setBookingReference(""); }}
                                    className="inline-flex h-[42px] items-center justify-center rounded-xl border border-[#D8CBE7] bg-white px-5 text-sm font-semibold text-[#2B174C] transition hover:bg-[#F7F1FF]"
                                >
                                    Check Booking Status
                                </button>
                                <a
                                    href={`https://m.me/${STORE_MESSENGER}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex h-[42px] items-center justify-center rounded-xl bg-[#2B174C] px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31]"
                                >
                                    Continue on Messenger
                                </a>
                            </div>

                            <button
                                onClick={() => { setShowSuccess(false); setBookingReference(""); }}
                                className="mt-7 text-sm font-semibold text-[#806A8C] underline decoration-[#D8CBE7] underline-offset-4 transition hover:text-[#2B174C]"
                            >
                                Submit another booking
                            </button>
                        </div>
                    ) : (
                        <div className="grid gap-8 p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_360px]">

                            {/* ── Top error banner ── */}
                            {Object.keys(fieldErrors).some((k) => fieldErrors[k]) && (
                                <div className="col-span-full rounded-xl border border-[#F2C4C4] bg-[#FFF0F0] px-4 py-3 text-sm font-medium text-[#C32F2F]">
                                    Please fix the highlighted fields before submitting.
                                </div>
                            )}

                            <div>
                                {/* Booking Type */}
                                <div>
                                    <label className="mb-3 block text-sm font-semibold text-[#1A1220]">
                                        Booking type
                                    </label>
                                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                        <button
                                            type="button"
                                            onClick={() => { setBookingType("package"); clearError("selection"); }}
                                            className={`rounded-xl border p-4 text-left transition ${
                                                bookingType === "package"
                                                    ? "border-[#2B174C] bg-[#F7F1FF] shadow-sm"
                                                    : "border-[#E6DDF0] bg-white hover:bg-[#FFFDF8]"
                                            }`}
                                        >
                                            <div className="text-sm font-semibold text-[#1A1220]">
                                                Package booking
                                            </div>
                                            <div className="mt-1 text-xs leading-5 text-[#7A6A84]">
                                                Select from available packages
                                            </div>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => { setBookingType("custom"); clearError("selection"); }}
                                            className={`rounded-xl border p-4 text-left transition ${
                                                bookingType === "custom"
                                                    ? "border-[#2B174C] bg-[#F7F1FF] shadow-sm"
                                                    : "border-[#E6DDF0] bg-white hover:bg-[#FFFDF8]"
                                            }`}
                                        >
                                            <div className="text-sm font-semibold text-[#1A1220]">
                                                Custom request
                                            </div>
                                            <div className="mt-1 text-xs leading-5 text-[#7A6A84]">
                                                Personalized event setup
                                            </div>
                                        </button>
                                    </div>
                                </div>

                                {/* Package / Custom */}
                                <div className="mt-6">
                                    {bookingType === "package" ? (
                                        <>
                                            <label className="mb-3 block text-sm font-semibold text-[#1A1220]">
                                                Select package
                                            </label>
                                            <select
                                                value={selectedPackage}
                                                onChange={(e) => { setSelectedPackage(e.target.value); clearError("selection"); }}
                                                className={`h-[48px] w-full rounded-xl border bg-[#FFFDF8] px-3 text-sm text-[#1A1220] outline-none transition focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10 ${
                                                    fieldErrors.selection
                                                        ? "border-[#F2C4C4] bg-[#FFF0F0]"
                                                        : "border-[#E6DDF0]"
                                                }`}
                                            >
                                                <option value="">Choose a package</option>
                                                {packages.map((pkg) => (
                                                    <option key={pkg.id} value={`${pkg.name} - ${peso(pkg.package_price)}`}>
                                                        {pkg.name} - {peso(pkg.package_price)}
                                                    </option>
                                                ))}
                                            </select>
                                            {fieldErrors.selection && (
                                                <p className="mt-1.5 text-xs font-medium text-red-500">{fieldErrors.selection}</p>
                                            )}
                                        </>
                                    ) : (
                                        <>
                                            <div className="rounded-[16px] border border-[#E6DDF0] bg-white p-4 shadow-sm">
                                                <div className="mb-3">
                                                    <label className="block text-sm font-bold text-[#1A1220]">
                                                        Choose inventory items
                                                    </label>
                                                    <p className="mt-1 text-xs leading-5 text-[#7A6A84]">
                                                        Search available items and add them to your custom event request.
                                                    </p>
                                                </div>

                                                <div className="relative">
                                                    <Search
                                                        size={15}
                                                        className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#806A8C]"
                                                    />
                                                    <input
                                                        value={inventorySearch}
                                                        onChange={(event) => setInventorySearch(event.target.value)}
                                                        placeholder="Search inventory items..."
                                                        className="h-[44px] w-full rounded-xl border border-[#E6DDF0] bg-[#FFFDF8] px-3 pl-10 text-sm text-[#1A1220] outline-none placeholder:text-[#9B8AAA] transition focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10"
                                                    />
                                                </div>

                                                <div className="mt-3 overflow-x-auto pb-1">
                                                    <div className="flex min-w-max gap-2">
                                                        {customInventoryCategories.map((category) => {
                                                            const active = inventoryCategory === category;

                                                            return (
                                                                <button
                                                                    key={category}
                                                                    type="button"
                                                                    onClick={() => setInventoryCategory(category)}
                                                                    className={`rounded-xl px-3.5 py-2 text-xs font-semibold transition ${
                                                                        active
                                                                            ? "bg-[#2B174C] text-white shadow-sm"
                                                                            : "border border-[#E6DDF0] bg-white text-[#5F4E75] hover:bg-[#F7F1FF]"
                                                                    }`}
                                                                >
                                                                    {category}
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                </div>

                                                <div className="mt-3">
                                                    {loadingInventory ? (
                                                        <div className="rounded-xl border border-dashed border-[#E6DDF0] bg-[#FFFDF8] px-4 py-6 text-center text-sm text-[#7A6A84]">
                                                            Loading inventory items...
                                                        </div>
                                                    ) : filteredInventoryItems.length === 0 ? (
                                                        <div className="rounded-xl border border-dashed border-[#E6DDF0] bg-[#FFFDF8] px-4 py-6 text-center text-sm text-[#7A6A84]">
                                                            No inventory items found.
                                                        </div>
                                                    ) : (
                                                        <div className="overflow-hidden rounded-xl border border-[#E6DDF0] bg-white">
                                                            <div className="hidden grid-cols-[minmax(0,1.5fr)_140px_110px_115px_170px] gap-3 border-b border-[#E6DDF0] bg-[#FBF8FD] px-4 py-3 text-[11px] font-bold uppercase tracking-[0.08em] text-[#806A8C] md:grid">
                                                                <span>Item</span>
                                                                <span>Category</span>
                                                                <span>Price</span>
                                                                <span>Status</span>
                                                                <span>Quantity</span>
                                                            </div>

                                                            <div className="max-h-[420px] overflow-y-auto">
                                                                {filteredInventoryItems.map((item) => {
                                                                    const qty = getCustomQty(item.key);
                                                                    const unavailable = item.stock <= 0;

                                                                    return (
                                                                        <div
                                                                            key={item.key}
                                                                            className="border-b border-[#F1EAF5] px-4 py-4 last:border-b-0"
                                                                        >
                                                                            <div className="space-y-3 md:hidden">
                                                                                <div className="flex items-start justify-between gap-3">
                                                                                    <div className="min-w-0">
                                                                                        <p className="text-sm font-bold text-[#1A1220]">
                                                                                            {item.displayName}
                                                                                        </p>
                                                                                        <p className="mt-1 text-xs text-[#806A8C]">
                                                                                            {item.category}
                                                                                        </p>
                                                                                        <p className="mt-1 text-sm font-bold text-[#2B174C]">
                                                                                            {peso(item.salesPrice)}
                                                                                        </p>
                                                                                    </div>

                                                                                    <span
                                                                                        className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                                                                                            unavailable
                                                                                                ? "bg-[#FFF0F0] text-[#C32F2F]"
                                                                                                : item.stock <= 5
                                                                                                    ? "bg-[#FFF8E8] text-[#A56607]"
                                                                                                    : "bg-[#EDFBF1] text-[#138342]"
                                                                                        }`}
                                                                                    >
                                {unavailable
                                    ? "Unavailable"
                                    : item.stock <= 5
                                        ? "Low stock"
                                        : "Available"}
                            </span>
                                                                                </div>

                                                                                <div className="flex items-center gap-2">
                                                                                    <div className="flex h-[36px] items-center overflow-hidden rounded-lg border border-[#E6DDF0] bg-white">
                                                                                        <button
                                                                                            type="button"
                                                                                            disabled={unavailable}
                                                                                            onClick={() =>
                                                                                                setCustomQtyForItem(item.key, qty - 1)
                                                                                            }
                                                                                            className="h-full w-10 text-sm font-bold text-[#2B174C] disabled:opacity-40"
                                                                                        >
                                                                                            −
                                                                                        </button>

                                                                                        <span className="flex h-full min-w-10 items-center justify-center border-x border-[#E6DDF0] px-2 text-sm font-semibold">
                                    {qty}
                                </span>

                                                                                        <button
                                                                                            type="button"
                                                                                            disabled={unavailable || qty >= item.stock}
                                                                                            onClick={() =>
                                                                                                setCustomQtyForItem(item.key, qty + 1)
                                                                                            }
                                                                                            className="h-full w-10 text-sm font-bold text-[#2B174C] disabled:opacity-40"
                                                                                        >
                                                                                            +
                                                                                        </button>
                                                                                    </div>

                                                                                    <button
                                                                                        type="button"
                                                                                        disabled={unavailable}
                                                                                        onClick={() => addCustomItem(item)}
                                                                                        className="h-[36px] flex-1 rounded-lg bg-[#2B174C] px-3 text-sm font-semibold text-white transition hover:bg-[#1B0D31] disabled:cursor-not-allowed disabled:opacity-50"
                                                                                    >
                                                                                        Add
                                                                                    </button>
                                                                                </div>
                                                                            </div>

                                                                            <div className="hidden md:grid md:grid-cols-[minmax(0,1.5fr)_140px_110px_115px_170px] md:items-center md:gap-3">
                                                                                <div className="min-w-0">
                                                                                    <p className="text-sm font-bold leading-5 text-[#1A1220] break-words">
                                                                                        {item.displayName}
                                                                                    </p>
                                                                                </div>

                                                                                <p className="truncate text-sm text-[#806A8C]">
                                                                                    {item.category}
                                                                                </p>

                                                                                <p className="text-sm font-bold text-[#2B174C]">
                                                                                    {peso(item.salesPrice)}
                                                                                </p>

                                                                                <div>
                            <span
                                className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                                    unavailable
                                        ? "bg-[#FFF0F0] text-[#C32F2F]"
                                        : item.stock <= 5
                                            ? "bg-[#FFF8E8] text-[#A56607]"
                                            : "bg-[#EDFBF1] text-[#138342]"
                                }`}
                            >
                                {unavailable
                                    ? "Unavailable"
                                    : item.stock <= 5
                                        ? "Low stock"
                                        : "Available"}
                            </span>
                                                                                </div>

                                                                                <div className="flex items-center gap-2">
                                                                                    <div className="flex h-[36px] items-center overflow-hidden rounded-lg border border-[#E6DDF0] bg-white">
                                                                                        <button
                                                                                            type="button"
                                                                                            disabled={unavailable}
                                                                                            onClick={() =>
                                                                                                setCustomQtyForItem(item.key, qty - 1)
                                                                                            }
                                                                                            className="h-full w-9 text-sm font-bold text-[#2B174C] disabled:opacity-40"
                                                                                        >
                                                                                            −
                                                                                        </button>

                                                                                        <span className="flex h-full min-w-10 items-center justify-center border-x border-[#E6DDF0] px-2 text-sm font-semibold">
                                    {qty}
                                </span>

                                                                                        <button
                                                                                            type="button"
                                                                                            disabled={unavailable || qty >= item.stock}
                                                                                            onClick={() =>
                                                                                                setCustomQtyForItem(item.key, qty + 1)
                                                                                            }
                                                                                            className="h-full w-9 text-sm font-bold text-[#2B174C] disabled:opacity-40"
                                                                                        >
                                                                                            +
                                                                                        </button>
                                                                                    </div>

                                                                                    <button
                                                                                        type="button"
                                                                                        disabled={unavailable}
                                                                                        onClick={() => addCustomItem(item)}
                                                                                        className="h-[36px] rounded-lg bg-[#2B174C] px-4 text-sm font-semibold text-white transition hover:bg-[#1B0D31] disabled:cursor-not-allowed disabled:opacity-50"
                                                                                    >
                                                                                        Add
                                                                                    </button>
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>

                                                <div className="mt-4 rounded-xl border border-[#E6DDF0] bg-white">
                                                    <div className="border-b border-[#E6DDF0] px-3 py-2.5">
                                                        <p className="text-sm font-bold text-[#1A1220]">
                                                            Selected items
                                                        </p>
                                                        <p className="mt-0.5 text-xs text-[#7A6A84]">
                                                            You can still adjust quantity after adding.
                                                        </p>
                                                    </div>

                                                    {selectedCustomItems.length === 0 ? (
                                                        <p className="px-3 py-5 text-center text-xs text-[#7A6A84]">
                                                            No custom items added yet.
                                                        </p>
                                                    ) : (
                                                        <div className="divide-y divide-[#EFE7F4]">
                                                            {selectedCustomItems.map((item) => (
                                                                <div
                                                                    key={item.key}
                                                                    className="grid gap-3 px-3 py-3 sm:grid-cols-[minmax(0,1fr)_120px_110px_34px] sm:items-center"
                                                                >
                                                                    <div className="min-w-0">
                                                                        <p className="text-sm font-bold text-[#1A1220]">
                                                                            {item.displayName}
                                                                        </p>
                                                                        <p className="mt-0.5 text-xs text-[#7A6A84]">
                                                                            {item.category} · {peso(item.salesPrice)} each
                                                                        </p>
                                                                    </div>

                                                                    <div className="flex h-[34px] w-fit items-center overflow-hidden rounded-lg border border-[#E6DDF0] bg-white">
                                                                        <button
                                                                            type="button"
                                                                            onClick={() =>
                                                                                updateSelectedCustomQty(
                                                                                    item.key,
                                                                                    item.quantity - 1
                                                                                )
                                                                            }
                                                                            className="h-full w-8 text-sm font-bold text-[#2B174C]"
                                                                        >
                                                                            −
                                                                        </button>

                                                                        <span className="flex h-full min-w-9 items-center justify-center border-x border-[#E6DDF0] px-2 text-sm font-semibold">
                                    {item.quantity}
                                </span>

                                                                        <button
                                                                            type="button"
                                                                            disabled={item.quantity >= item.stock}
                                                                            onClick={() =>
                                                                                updateSelectedCustomQty(
                                                                                    item.key,
                                                                                    item.quantity + 1
                                                                                )
                                                                            }
                                                                            className="h-full w-8 text-sm font-bold text-[#2B174C] disabled:opacity-40"
                                                                        >
                                                                            +
                                                                        </button>
                                                                    </div>

                                                                    <p className="text-sm font-bold text-[#2B174C]">
                                                                        {peso(item.salesPrice * item.quantity)}
                                                                    </p>

                                                                    <button
                                                                        type="button"
                                                                        onClick={() => removeSelectedCustomItem(item.key)}
                                                                        className="flex h-8 w-8 items-center justify-center rounded-lg text-red-500 hover:bg-[#FFF0F0]"
                                                                    >
                                                                        <Trash2 size={15} />
                                                                    </button>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}

                                                    {selectedCustomItems.length > 0 && (
                                                        <div className="flex items-center justify-between border-t border-[#E6DDF0] bg-[#FFFDF8] px-3 py-3">
                                                            <div>
                                                                <span className="block text-xs font-semibold text-[#806A8C]">
                                                                    Estimated item subtotal
                                                                </span>
                                                                <span className="mt-0.5 block text-[11px] leading-4 text-[#9B8AAA]">
                                                                    Final amount will be confirmed after discussion.
                                                                </span>
                                                            </div>

                                                            <span className="text-sm font-bold text-[#2B174C]">
                                                                {peso(selectedCustomTotal)}
                                                            </span>
                                                        </div>
                                                    )}
                                                </div>

                                                {fieldErrors.selection && (
                                                    <p className="mt-2 text-xs font-medium text-red-500">
                                                        {fieldErrors.selection}
                                                    </p>
                                                )}
                                            </div>

                                            <div className="mt-5">
                                                <label className="mb-3 block text-sm font-semibold text-[#1A1220]">
                                                    Additional custom request
                                                </label>
                                                <textarea
                                                    value={customOrder}
                                                    onChange={(e) => {
                                                        setCustomOrder(e.target.value);
                                                        clearError("selection");
                                                    }}
                                                    placeholder="Theme details, colors, setup preferences, or special instructions..."
                                                    className="min-h-[110px] w-full resize-none rounded-xl border border-[#E6DDF0] bg-[#FFFDF8] p-3 text-sm text-[#1A1220] outline-none transition placeholder:text-[#9B8AAA] focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10"
                                                />
                                            </div>
                                        </>
                                    )}
                                </div>

                                {/* Contact & Event Details */}
                                <div className="mt-6 grid gap-5 md:grid-cols-2">
                                    <Input
                                        label="Full Name"
                                        value={name}
                                        onChange={(v) => { setName(v); clearError("name"); }}
                                        placeholder="Your full name"
                                        error={fieldErrors.name}
                                    />
                                    <Input
                                        label="Facebook / Messenger Name"
                                        value={facebookName}
                                        onChange={(v) => { setFacebookName(v); clearError("facebookName"); }}
                                        placeholder="Name used in Messenger"
                                        error={fieldErrors.facebookName}
                                    />
                                    <Input
                                        label="Phone Number"
                                        value={phone}
                                        onChange={(v) => { setPhone(v); clearError("phone"); }}
                                        placeholder="09XXXXXXXXX"
                                        error={fieldErrors.phone}
                                    />
                                    <Input
                                        label="Email Address"
                                        value={email}
                                        onChange={(v) => { setEmail(v); clearError("email"); }}
                                        placeholder="Optional"
                                        error={fieldErrors.email}
                                    />

                                    {/* Event Date */}
                                    <div>
                                        <label className="mb-3 block text-sm font-semibold text-[#1A1220]">
                                            Event date
                                        </label>
                                        <div className="relative">
                                            <CalendarDays size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#806A8C]" />
                                            <input
                                                type="date"
                                                value={date}
                                                onChange={(e) => { setDate(e.target.value); clearError("date"); }}
                                                className={`h-[48px] w-full rounded-xl border bg-[#FFFDF8] pl-11 pr-3 text-sm outline-none transition focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10 ${
                                                    date ? "text-[#1A1220]" : "text-[#9B8AAA]"
                                                } ${
                                                    fieldErrors.date
                                                        ? "border-[#F2C4C4] bg-[#FFF0F0]"
                                                        : "border-[#E6DDF0]"
                                                }`}
                                            />
                                        </div>
                                        {fieldErrors.date && (
                                            <p className="mt-1.5 text-xs font-medium text-red-500">{fieldErrors.date}</p>
                                        )}
                                    </div>

                                    {/* Event Time */}
                                    <div>
                                        <label className="mb-3 block text-sm font-semibold text-[#1A1220]">
                                            Event time
                                        </label>
                                        <input
                                            type="time"
                                            value={eventTime}
                                            onChange={(e) => { setEventTime(e.target.value); clearError("eventTime"); }}
                                            placeholder="--:--"
                                            className={`h-[48px] w-full rounded-xl border bg-[#FFFDF8] px-3 text-sm text-[#1A1220] outline-none transition focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10 ${
                                                fieldErrors.eventTime
                                                    ? "border-[#F2C4C4] bg-[#FFF0F0]"
                                                    : "border-[#E6DDF0]"
                                            } placeholder:text-[#9B8AAA]`}
                                        />
                                        {fieldErrors.eventTime && (
                                            <p className="mt-1.5 text-xs font-medium text-red-500">{fieldErrors.eventTime}</p>
                                        )}
                                    </div>
                                </div>

                                <div className="mt-6 grid gap-5 md:grid-cols-2">
                                    {bookingType === "custom" && (
                                        <Input
                                            label="Event Type"
                                            value={eventType}
                                            onChange={(v) => { setEventType(v); clearError("eventType"); }}
                                            placeholder="Birthday, Wedding, Corporate..."
                                            error={fieldErrors.eventType}
                                        />
                                    )}
                                    <Input
                                        label="Venue / Location"
                                        value={venue}
                                        onChange={(v) => { setVenue(v); clearError("venue"); }}
                                        placeholder="Home, restaurant, event hall..."
                                        error={fieldErrors.venue}
                                    />
                                </div>

                                {/* Theme */}
                                <div className="mt-6">
                                    <label className="mb-3 block text-sm font-semibold text-[#1A1220]">
                                        Theme / motif request
                                    </label>
                                    <textarea
                                        value={theme}
                                        onChange={(e) => { setTheme(e.target.value); clearError("theme"); }}
                                        placeholder="Example: pastel pink, safari, princess, floral, minimalist, blue and gold..."
                                        className={`min-h-[118px] w-full resize-none rounded-xl border bg-[#FFFDF8] p-3 text-sm outline-none transition focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10 ${
                                            theme ? "text-[#1A1220]" : "text-[#9B8AAA]"
                                        } ${
                                            fieldErrors.theme
                                                ? "border-[#F2C4C4] bg-[#FFF0F0]"
                                                : "border-[#E6DDF0]"
                                        }`}
                                    />
                                    {fieldErrors.theme && (
                                        <p className="mt-1.5 text-xs font-medium text-red-500">{fieldErrors.theme}</p>
                                    )}
                                    <p className="mt-2 text-xs leading-5 text-[#7A6A84]">
                                        You may request any theme, color motif, or design inspiration. Final design can be confirmed with the store.
                                    </p>
                                </div>

                                {/* Notes */}
                                <div className="mt-6">
                                    <label className="mb-3 block text-sm font-semibold text-[#1A1220]">
                                        Additional notes
                                    </label>
                                    <textarea
                                        value={notes}
                                        onChange={(e) => setNotes(e.target.value)}
                                        placeholder="Additional requests, backdrop text, celebrant name, age, delivery notes..."
                                        className={`min-h-[118px] w-full resize-none rounded-xl border border-[#E6DDF0] bg-[#FFFDF8] p-3 text-sm outline-none transition focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10 ${
                                            notes ? "text-[#1A1220]" : "text-[#9B8AAA]"
                                        }`}
                                    />
                                </div>
                            </div>

                            {/* Booking Summary Sidebar */}
                            <aside>
                                <div className="sticky top-24 overflow-hidden rounded-[18px] border border-[#E6DDF0] bg-white shadow-sm">
                                    <div className="bg-[#2B174C] px-5 py-5 text-white">
                                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-white/70">
                                            Your request
                                        </p>
                                        <h3 className="mt-1 text-[22px] font-bold">
                                            Booking summary
                                        </h3>
                                        <p className="mt-2 text-sm leading-5 text-white/75">
                                            Review your event details before submitting.
                                        </p>
                                    </div>

                                    <div className="p-5">
                                        <div className="space-y-4">
                                            <SummaryItem
                                                label="Booking type"
                                                value={
                                                    bookingType === "package"
                                                        ? "Package booking"
                                                        : "Custom request"
                                                }
                                            />
                                            {selectedPackage && (
                                                <SummaryItem
                                                    label="Package"
                                                    value={selectedPackage}
                                                />
                                            )}
                                            {bookingType === "custom" && selectedCustomItems.length > 0 && (
                                                <div className="rounded-xl border border-[#E6DDF0] bg-[#FFFDF8] p-3">
                                                    <div className="mb-2 flex items-center justify-between gap-3">
                                                        <p className="text-xs font-bold text-[#1A1220]">
                                                            Selected items
                                                        </p>
                                                        <span className="text-xs font-semibold text-[#806A8C]">
                {selectedCustomItems.length} item
                                                            {selectedCustomItems.length === 1 ? "" : "s"}
            </span>
                                                    </div>

                                                    <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
                                                        {selectedCustomItems.map((item) => (
                                                            <div
                                                                key={item.key}
                                                                className="rounded-lg border border-[#EFE7F4] bg-white px-3 py-2"
                                                            >
                                                                <div className="flex items-start justify-between gap-3">
                                                                    <div className="min-w-0">
                                                                        <p className="text-xs font-bold leading-5 text-[#1A1220] break-words">
                                                                            {item.displayName}
                                                                        </p>
                                                                        <p className="mt-0.5 text-[11px] text-[#806A8C]">
                                                                            Qty: {item.quantity} · {peso(item.salesPrice)} each
                                                                        </p>
                                                                    </div>

                                                                    <p className="shrink-0 text-xs font-bold text-[#2B174C]">
                                                                        {peso(item.salesPrice * item.quantity)}
                                                                    </p>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>

                                                    <div className="mt-3 border-t border-[#E6DDF0] pt-3">
                                                        <div className="flex items-center justify-between gap-4">
        <span className="text-xs font-semibold text-[#806A8C]">
            Estimated item subtotal
        </span>

                                                            <span className="text-sm font-bold text-[#2B174C]">
            {peso(selectedCustomTotal)}
        </span>
                                                        </div>

                                                        <p className="mt-1 text-[11px] leading-4 text-[#9B8AAA]">
                                                            Final amount will be confirmed after discussion.
                                                        </p>
                                                    </div>
                                                </div>
                                            )}

                                            {customOrder && bookingType === "custom" && (
                                                <SummaryItem
                                                    label="Additional request"
                                                    value={customOrder}
                                                />
                                            )}

                                            {name && (
                                                <SummaryItem
                                                    label="Customer"
                                                    value={name}
                                                />
                                            )}
                                            {facebookName && (
                                                <SummaryItem
                                                    label="Messenger name"
                                                    value={facebookName}
                                                />
                                            )}
                                            {bookingType === "custom" &&
                                                eventType && (
                                                    <SummaryItem
                                                        label="Event type"
                                                        value={eventType}
                                                    />
                                                )}
                                            {theme && (
                                                <SummaryItem
                                                    label="Theme / motif"
                                                    value={theme}
                                                />
                                            )}
                                            {venue && (
                                                <SummaryItem
                                                    label="Venue"
                                                    value={venue}
                                                />
                                            )}
                                            {date && (
                                                <SummaryItem
                                                    label="Date"
                                                    value={date}
                                                />
                                            )}
                                            {eventTime && (
                                                <SummaryItem
                                                    label="Event time"
                                                    value={eventTime}
                                                />
                                            )}
                                        </div>

                                        <div className="mt-5 rounded-xl border border-[#E6DDF0] bg-[#FFFDF8] p-3">
                                            <p className="text-xs font-semibold text-[#1A1220]">
                                                After submission
                                            </p>
                                            <p className="mt-1 text-xs leading-5 text-[#7A6A84]">
                                                Save your booking reference number, then use{" "}
                                                <span className="font-semibold text-[#2B174C]">
                                                    Track booking
                                                </span>{" "}
                                                to check the status anytime.
                                            </p>
                                        </div>

                                        <a
                                            href={`https://m.me/${STORE_MESSENGER}`}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="mt-5 inline-flex h-[42px] w-full items-center justify-center rounded-xl border border-[#D8CBE7] bg-white px-4 text-sm font-semibold text-[#2B174C] transition hover:bg-[#F7F1FF]"
                                        >
                                            Continue on Messenger
                                        </a>

                                        <button
                                            type="button"
                                            onClick={handleSubmit}
                                            disabled={submitting}
                                            className="mt-3 inline-flex h-[46px] w-full items-center justify-center rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31] disabled:cursor-not-allowed disabled:opacity-60"
                                        >
                                            {submitting
                                                ? "Submitting..."
                                                : "Submit booking request"}
                                        </button>
                                    </div>
                                </div>
                            </aside>
                        </div>
                    )}
                </div>
            </section>

            {/* ── Package Details Modal ── */}
            {detailsPackage && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm">
                    <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-[20px] border border-[#E6DDF0] bg-white p-5 shadow-2xl sm:p-6">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#806A8C]">
                                    Package details
                                </p>
                                <h2 className="mt-1 text-[26px] font-bold tracking-[-0.02em] text-[#1A1220]">
                                    {detailsPackage.name}
                                </h2>
                                <p className="mt-2 text-[26px] font-bold text-[#2B174C]">
                                    {peso(detailsPackage.package_price)}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setDetailsPackage(null)}
                                className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#E6DDF0] bg-white text-[#806A8C] transition hover:bg-[#F7F1FF] hover:text-[#2B174C]"
                                aria-label="Close package details"
                            >
                                <X size={18} />
                            </button>
                        </div>
                        <p className="mt-5 text-sm leading-6 text-[#7A6A84]">
                            {detailsPackage.description || "No description provided."}
                        </p>

                        <div className="mt-5 rounded-xl border border-[#E6DDF0] bg-[#FFFDF8] px-4 py-3 text-sm text-[#5F4E75]">
                            <span className="font-semibold text-[#1A1220]">Duration:</span>{" "}
                            {detailsPackage.duration || "Not set"}
                        </div>

                        <div className="mt-6">
                            <h3 className="text-[16px] font-bold text-[#1A1220]">
                                Package inclusions
                            </h3>
                            {detailsPackage.inclusions.length === 0 ? (
                                <p className="mt-3 rounded-xl border border-dashed border-[#E6DDF0] bg-[#FFFDF8] p-4 text-sm text-[#7A6A84]">
                                    No inclusions listed.
                                </p>
                            ) : (
                                <div className="mt-3 space-y-2">
                                    {detailsPackage.inclusions.map((item) => (
                                        <div
                                            key={item.productId}
                                            className="flex items-center justify-between gap-4 rounded-xl border border-[#E6DDF0] bg-[#FFFDF8] px-4 py-3"
                                        >
                                            <p className="text-sm font-semibold text-[#1A1220]">
                                                {item.productName}
                                            </p>
                                            <p className="shrink-0 text-xs font-semibold text-[#4E2C66]">
                                                × {item.quantity}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <p className="mt-6 rounded-xl border border-[#D8CBE7] bg-[#F7F1FF] p-4 text-sm leading-6 text-[#5F4E75]">
                            Themes and color motifs are customizable. Add your preferred
                            design direction in the booking form.
                        </p>

                        <button
                            type="button"
                            onClick={() => {
                                handleSelectPackage(detailsPackage);
                                setDetailsPackage(null);
                            }}
                            className="mt-6 inline-flex h-[46px] w-full items-center justify-center rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31]"
                        >
                            Select this package
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function Input({
                   label,
                   value,
                   onChange,
                   placeholder,
                   error,
               }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    error?: string;
}) {
    return (
        <div>
            <label className="mb-3 block text-sm font-semibold text-[#1A1220]">
                {label}
            </label>
            <input
                value={value}
                onChange={(event) => onChange(event.target.value)}
                placeholder={placeholder}
                className={`h-[48px] w-full rounded-xl border bg-[#FFFDF8] px-3 text-sm text-[#1A1220] outline-none placeholder:text-[#9B8AAA] transition focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10 ${
                    error
                        ? "border-[#F2C4C4] bg-[#FFF0F0]"
                        : "border-[#E6DDF0]"
                }`}
            />
            {error && (
                <p className="mt-1.5 text-xs font-medium text-[#C32F2F]">
                    {error}
                </p>
            )}
        </div>
    );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-start justify-between gap-4">
            <span className="shrink-0 text-xs font-medium text-[#806A8C]">
                {label}
            </span>
            <span className="max-w-[62%] text-right text-sm font-semibold leading-5 text-[#1A1220]">
                {value}
            </span>
        </div>
    );
}