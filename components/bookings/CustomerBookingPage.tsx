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
    inventoryKey?: string;
    productId: number;
    variantId?: number | null;
    productName: string;
    variantName?: string;
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
    down_payment_amount?: number;
    duration: string;
    status: "Active" | "Inactive";
    cover_image?: string;
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

type RentalCatalogItem = {
    id: number;
    name: string;
    dailyRate: number;
    physicallyAvailable: number;
};
type SelectedRentalItem = RentalCatalogItem & { quantity: number };


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
    eventEndDate?: string | null;
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
    pkg: Pick<PackageItem, "name" | "description" | "category" | "cover_image">
) {
    if (pkg.cover_image) {
        return pkg.cover_image;
    }

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
        <div className="fixed inset-0 z-[200] flex items-center justify-center overflow-y-auto bg-black/45 px-3 py-3 backdrop-blur-sm sm:px-4 sm:py-6">
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
    const [statementPhone,setStatementPhone] = useState("");
    const [statement,setStatement] = useState<null | {
        packageBase:number;salesSubtotal?:number;salesItems?:{name:string;variantName?:string;quantity:number;unitPrice:number;amount:number}[];
        rentalItems:{name:string;quantity:number;days:number;dailyRate:number;amount:number}[];
        deliveryFee:number;setupFee:number;agreedCharges:number;depositRequired:number;depositCollected:number;
        depositApplied:number;depositRefunded:number;depositHeld:number;claimBalance:number;
        booking:{agreedPrice:number|null;bookingPayments:number;balance:number};
    }>(null);
    const [statementError,setStatementError] = useState("");

    async function fetchStatement(ref:string){
        if(!/^09\d{9}$/.test(statementPhone.trim())){setStatementError('Enter the phone number used for this booking.');return;}
        try{
            const res=await fetch('/api/bookings',{method:'POST',headers:{'Content-Type':'application/json'},
                body:JSON.stringify({action:'get_public_booking_statement',bookingReference:ref,phone:statementPhone.trim()})});
            const json=await res.json();if(!res.ok)throw new Error(json.error||'Statement unavailable.');
            setStatement(json.statement);setStatementError('');
        }catch(err){setStatementError(err instanceof Error?err.message:'Cannot load statement.');}
    }

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
        setStatement(null);setStatementError('');setStatementPhone('');
        setError(""); setLastUpdated(null);
        setShowCancelModal(false);
        setCancelSuccess(false);
        clearUrl();
    }

    function switchMode(m: SearchMode) { setMode(m); reset(); }

    // Core fetch by reference — used for initial search + polling
    const fetchByRef = useCallback(async (ref: string, silent = false) => {
        if (!silent) {setLoading(true);setStatement(null);setStatementError('');}
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
                                label={displayBooking.eventEndDate && new Date(displayBooking.eventEndDate) > new Date(displayBooking.date) ? "Event Dates" : "Event Date"}
                                value={`${new Date(displayBooking.date).toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" })}${displayBooking.eventEndDate && new Date(displayBooking.eventEndDate) > new Date(displayBooking.date) ? ` – ${new Date(displayBooking.eventEndDate).toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" })}` : ""}`}
                                icon={<CalendarDays size={13} className="text-purple-400" />}
                            />
                            {displayBooking.eventTime && <DetailItem label="Time" value={displayBooking.eventTime} icon={<Clock size={13} className="text-purple-400" />} />}
                            {displayBooking.venue && <DetailItem label="Venue" value={displayBooking.venue} icon={<MapPin size={13} className="text-purple-400" />} />}
                            {displayBooking.theme && <DetailItem label="Theme" value={displayBooking.theme} icon={<Palette size={13} className="text-purple-400" />} />}
                            {displayBooking.bookingType === "package" && displayBooking.package && <DetailItem label="Package" value={displayBooking.package} />}
                            {displayBooking.bookingType === "custom" && displayBooking.customOrder && <DetailItem label="Custom Request" value={displayBooking.customOrder} />}
                        </div>

                        <div className="mt-4 rounded-xl border border-[#E6DDF0] bg-[#FFFDF8] p-4 text-sm">
                            <h4 className="font-bold text-[#2B174C]">Itemized booking statement</h4>
                            <p className="mt-1 text-xs text-[#806A8C]">Confirm your booking phone to view charges, payments and refundable deposit details. This is not an official tax invoice.</p>
                            <div className="mt-3 flex flex-wrap gap-2">
                                <input aria-label="Phone for booking statement" type="tel" value={statementPhone} onChange={e=>setStatementPhone(e.target.value)}
                                       placeholder="09XXXXXXXXX" className="min-w-0 flex-1 rounded-lg border border-[#E6DDF0] bg-white px-3 py-2"/>
                                <button type="button" onClick={()=>void fetchStatement(displayBooking.bookingReference!)} className="rounded-lg bg-[#2B174C] px-3 py-2 text-xs font-bold text-white">View breakdown</button>
                            </div>
                            {statementError&&<p role="alert" className="mt-2 text-xs text-red-600">{statementError}</p>}
                            {statement&&<div className="mt-3 space-y-2 border-t pt-3 text-xs text-[#2B174C]">
                                <div className="flex justify-between"><span>Package</span><strong>₱{Number(statement.packageBase).toFixed(2)}</strong></div>
                                {(statement.salesItems||[]).map((item,i)=><div key={`sale-${i}`} className="flex justify-between gap-2"><span>{item.name}{item.variantName?` (${item.variantName})`:""} · {item.quantity} × ₱{Number(item.unitPrice).toFixed(2)}</span><strong>₱{Number(item.amount).toFixed(2)}</strong></div>)}
                                {statement.rentalItems.map((item,i)=><div key={i} className="flex justify-between gap-2"><span>{item.name} · {item.quantity} × {item.days} day(s)</span><strong>₱{Number(item.amount).toFixed(2)}</strong></div>)}
                                <div className="flex justify-between"><span>Delivery / pickup</span><strong>₱{Number(statement.deliveryFee).toFixed(2)}</strong></div>
                                <div className="flex justify-between"><span>Setup</span><strong>₱{Number(statement.setupFee).toFixed(2)}</strong></div>
                                <div className="flex justify-between border-t pt-2 font-bold"><span>Saved itemized charge subtotal</span><strong>₱{Number(statement.agreedCharges).toFixed(2)}</strong></div>
                                <div className="flex justify-between"><span>Agreed booking charge</span><strong>{statement.booking.agreedPrice!=null?`₱${Number(statement.booking.agreedPrice).toFixed(2)}`:'Awaiting agreement'}</strong></div>
                                <div className="flex justify-between"><span>Booking payments recorded</span><strong>₱{Number(statement.booking.bookingPayments).toFixed(2)}</strong></div>
                                <div className="flex justify-between"><span>Booking balance</span><strong>₱{Number(statement.booking.balance).toFixed(2)}</strong></div>
                                <div className="flex justify-between"><span>Refundable security deposit required</span><strong>₱{Number(statement.depositRequired).toFixed(2)}</strong></div>
                                <div className="flex justify-between"><span>Deposit currently held</span><strong>₱{Number(statement.depositHeld).toFixed(2)}</strong></div>
                                <div className="flex justify-between"><span>Outstanding approved equipment claims</span><strong>₱{Number(statement.claimBalance).toFixed(2)}</strong></div>
                                <button type="button" onClick={()=>window.print()} className="rounded-lg border border-[#D8CBE7] px-3 py-2">Print statement</button>
                            </div>}
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

// Keep loading layouts the same size as the content to reduce layout shifts.
function PackageCardsSkeleton({ count = 6 }: { count?: number }) {
    return (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3" role="status" aria-label="Loading packages">
            {Array.from({ length: count }, (_, index) => (
                <div key={index} className="animate-pulse overflow-hidden rounded-[20px] border border-[#E6DDF0] bg-white">
                    <div className="h-44 bg-[#EEE8F3]" />
                    <div className="space-y-3 p-4 sm:p-5">
                        <div className="h-5 w-3/4 rounded bg-[#EEE8F3]" />
                        <div className="h-4 w-1/2 rounded bg-[#F1EBF5]" />
                        <div className="h-3 w-full rounded bg-[#F1EBF5]" />
                        <div className="h-3 w-5/6 rounded bg-[#F1EBF5]" />
                        <div className="h-9 w-1/2 rounded bg-[#EEE8F3]" />
                        <div className="flex gap-2 pt-2">
                            <div className="h-10 flex-1 rounded-xl bg-[#F1EBF5]" />
                            <div className="h-10 flex-1 rounded-xl bg-[#EEE8F3]" />
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}

function CustomerPortalSkeleton() {
    return (
        <div className="min-h-screen bg-[#FDFAF4] font-sans" role="status" aria-label="Loading customer booking portal">
            <div className="border-b border-[#E6DDF0] bg-white px-6 py-4">
                <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 animate-pulse">
                    <div className="space-y-3"><div className="h-7 w-52 rounded bg-[#EEE8F3]" /><div className="h-4 w-36 rounded bg-[#EEE8F3]" /></div>
                    <div className="h-10 w-36 rounded-xl bg-[#EEE8F3]" />
                </div>
            </div>
            <div className="mx-auto max-w-7xl space-y-4 px-6 py-5">
                <div className="h-16 animate-pulse rounded-xl border border-[#E6DDF0] bg-[#EEE8F3]" />
                <div className="rounded-xl border border-[#E6DDF0] bg-white p-4">
                    <div className="mb-4 h-10 w-full max-w-md animate-pulse rounded-xl bg-[#EEE8F3]" />
                    <PackageCardsSkeleton />
                </div>
                <div className="h-40 animate-pulse rounded-xl border border-[#E6DDF0] bg-[#EEE8F3]" />
            </div>
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
    const [packagesLoading, setPackagesLoading] = useState(true);
    const [packagesError, setPackagesError] = useState("");
    const [packageBranchFilter, setPackageBranchFilter] = useState("all");
    const [packageSearch, setPackageSearch] = useState("");
    const [visiblePackageCount, setVisiblePackageCount] = useState(12);
    const [branches, setBranches] = useState<{id:number;name:string}[]>([]);
    const [branchesLoading, setBranchesLoading] = useState(false);
    const [selectedCustomBranchId, setSelectedCustomBranchId] = useState<number | null>(null);
    const [branchesError, setBranchesError] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const [activeCategory, setActiveCategory] = useState("All");
    const [detailsPackage, setDetailsPackage] = useState<PackageItem | null>(null);
    const [showExpandedPackageImage, setShowExpandedPackageImage] = useState(false);

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
    const [rentalCatalog, setRentalCatalog] = useState<RentalCatalogItem[]>([]);
    const [rentalCatalogLoading, setRentalCatalogLoading] = useState(false);
    const [rentalCatalogError, setRentalCatalogError] = useState("");
    const [rentalSearch, setRentalSearch] = useState("");
    const [selectedRentalItems, setSelectedRentalItems] = useState<SelectedRentalItem[]>([]);
    const [rentalEndDate, setRentalEndDate] = useState("");
    const [eventDurationType, setEventDurationType] = useState<"single" | "multiple">("single");
    const [serviceDelivery, setServiceDelivery] = useState(false);
    const [serviceSetup, setServiceSetup] = useState(false);
    const [feePolicy, setFeePolicy] = useState({deliveryFee:0,setupFee:0,refundableDeposit:0,
        deliveryIncludedPackage:false,setupIncludedPackage:false});

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
    // Package identity and checkout branch must never be inferred from catalog order.
    const selectedPackageData = useMemo(() =>
            packages.find(p => String(p.id) === selectedPackage) || null,
        [packages, selectedPackage]);
    const urlBranchId = branchIdFromUrl && Number.isSafeInteger(Number(branchIdFromUrl)) && Number(branchIdFromUrl)>0
        ? Number(branchIdFromUrl) : null;
    const packageBranchId = selectedPackageData
        ? Number(selectedPackageData.branch_id ?? selectedPackageData.branchId ?? 0) || null : null;
    const customBranchId = bookingType === "package" ? packageBranchId : selectedCustomBranchId;
    const selectedBranchName = branches.find(b => b.id === customBranchId)?.name || "";
    const eventEndDate = eventDurationType === "multiple" ? rentalEndDate : date;
    const requestedEventDays = date && eventEndDate && eventEndDate >= date
        ? Math.round((Date.parse(`${eventEndDate}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86400000) + 1
        : 0;
    // Invalid or unusually long ranges must never generate a misleading quotation.
    const rentalDuration = requestedEventDays <= 30 && (eventDurationType === "single" || eventEndDate > date)
        ? requestedEventDays : 0;
    const todayForPicker = (() => {
        const now = new Date();
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        return now.toISOString().slice(0, 10);
    })();
    const estimatedDelivery = serviceDelivery && !(bookingType === "package" && feePolicy.deliveryIncludedPackage) ? feePolicy.deliveryFee : 0;
    const estimatedSetup = serviceSetup && !(bookingType === "package" && feePolicy.setupIncludedPackage) ? feePolicy.setupFee : 0;
    const estimatedBase = bookingType === "package" ? Number(selectedPackageData?.package_price || 0) : 0;
    // The custom product subtotal is a request estimate; Manager confirms its agreed price.
    const selectedRentalTotal = selectedRentalItems.reduce(
        (sum, item) => sum + item.dailyRate * item.quantity * rentalDuration, 0
    );

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

        const rentalText = selectedRentalItems.map(item =>
            `${item.name} x ${item.quantity} x ${rentalDuration} day(s) = ${peso(item.dailyRate * item.quantity * rentalDuration)}`
        ).join("\n");
        const requestText = [rentalText,customOrder.trim()].filter(Boolean).join("\n\n");

        if (selectedItemsText && requestText) {
            return `Selected inventory items:\n${selectedItemsText}\n\nAdditional request:\n${requestText}`;
        }

        if (selectedItemsText) {
            return `Selected inventory items:\n${selectedItemsText}`;
        }

        return requestText;
    }, [selectedCustomItems, selectedRentalItems, rentalDuration, customOrder]);


    useEffect(() => {
        setFeePolicy({deliveryFee:0,setupFee:0,refundableDeposit:0,
            deliveryIncludedPackage:false,setupIncludedPackage:false});
        if (!store || !customBranchId) return;
        let cancelled=false;
        void (async()=>{
            try {
                const res=await fetch('/api/bookings',{method:'POST',headers:{'Content-Type':'application/json'},
                    body:JSON.stringify({action:'get_public_booking_fees',storeId:store.id,branchId:customBranchId})});
                const data=await res.json();
                if(!res.ok)throw new Error(data.error||'Unable to load branch fees.');
                if(!cancelled && data.policy)setFeePolicy(data.policy);
            } catch { if(!cancelled)setFeePolicy({deliveryFee:0,setupFee:0,refundableDeposit:0,
                deliveryIncludedPackage:false,setupIncludedPackage:false}); }
        })();
        return ()=>{cancelled=true;};
    },[store,customBranchId]);

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
                : selectedCustomItems.length > 0 || selectedRentalItems.length > 0 || !!customOrder.trim();

        if (!hasSelection) {
            errors.selection =
                bookingType === "package"
                    ? "Please select a package."
                    : "Please select at least one inventory item or describe your custom request.";
        }

        if (bookingType === "custom" && !eventType.trim()) errors.eventType = "Event type is required.";
        if (!customBranchId || !branches.some(b => b.id === customBranchId))
            errors.selection = "Select a valid branch before booking.";
        if (bookingType === "package" && selectedPackage && !selectedPackageData)
            errors.selection = "Please select a current package.";
        if (eventDurationType === "multiple") {
            if (!date || !rentalEndDate) errors.rentalEndDate = "Choose both event dates.";
            else if (rentalEndDate <= date) errors.rentalEndDate = "End date must be after the event start date.";
            else if (requestedEventDays > 30) errors.rentalEndDate = "Events can span at most 30 calendar days.";
            else if (new Date(`${rentalEndDate}T12:00:00`) > maxDate)
                errors.rentalEndDate = "End date is too far ahead. Max 2 years from now.";
        }

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

    // General store URLs can browse packages across branches. Branch-specific links
    // stay scoped to their URL branch, including the package dropdown at checkout.
    const effectivePackageBranchFilter = urlBranchId ? String(urlBranchId) : packageBranchFilter;
    const packageCountsByBranch = useMemo(() => {
        const counts = new Map<number, number>();
        for (const pkg of packages) {
            const branchId = Number(pkg.branch_id ?? pkg.branchId ?? 0);
            if (branchId > 0) counts.set(branchId, (counts.get(branchId) || 0) + 1);
        }
        return counts;
    }, [packages]);

    const filteredPackages = useMemo(() => {
        const search = packageSearch.trim().toLowerCase();
        return packages.filter((pkg) => {
            const packageBranch = Number(pkg.branch_id ?? pkg.branchId ?? 0);
            if (effectivePackageBranchFilter !== "all" && packageBranch !== Number(effectivePackageBranchFilter)) return false;
            if (activeCategory !== "All" &&
                (pkg.category || "").toLowerCase() !== activeCategory.toLowerCase() &&
                !pkg.name.toLowerCase().includes(activeCategory.toLowerCase())) return false;
            return !search || `${pkg.name} ${pkg.category || ""} ${pkg.description || ""}`.toLowerCase().includes(search);
        });
    }, [packages, activeCategory, effectivePackageBranchFilter, packageSearch]);

    useEffect(() => {
        setVisiblePackageCount(12);
    }, [activeCategory, effectivePackageBranchFilter, packageSearch]);

    function changePackageBranchFilter(next: string) {
        if (urlBranchId) return;
        setPackageBranchFilter(next);
        // Do not keep a package booked for Branch A when a customer switches to Branch B.
        if (next !== "all" && selectedPackageData && packageBranchId !== Number(next)) {
            setSelectedPackage("");
            setSelectedRentalItems([]);
        }
        clearError("selection");
    }

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
        let cancelled=false;
        setBranches([]);
        setBranchesError("");
        setBranchesLoading(true);
        void (async()=>{
            try {
                const response=await fetch('/api/bookings',{
                    method:'POST',headers:{'Content-Type':'application/json'},
                    body:JSON.stringify({action:'get_public_branches',storeId:store.id})});
                const data=await response.json();
                if(!response.ok)throw new Error(data.error||'Unable to load branches.');
                if(cancelled)return;
                const available=(data.branches||[]).map((b:{id:number;name:string})=>({id:Number(b.id),name:String(b.name)}));
                setBranches(available);
                if(urlBranchId && !available.some((b:{id:number})=>b.id===urlBranchId))
                    setBranchesError('This booking link specifies a branch that is not available for this store.');
            } catch(err){if(!cancelled)setBranchesError(err instanceof Error?err.message:'Unable to load branches.');}
            finally { if (!cancelled) setBranchesLoading(false); }
        })();
        return ()=>{cancelled=true;};
    },[store,urlBranchId]);

    useEffect(() => {
        // A branch-specific booking link locks Custom Booking to the specified branch.
        setSelectedCustomBranchId(urlBranchId);
        setPackageBranchFilter("all");
        setPackageSearch("");
        setSelectedCustomItems([]);
        setSelectedRentalItems([]);
    },[urlBranchId,store?.id]);

    useEffect(() => {
        if (!store) return;
        const controller = new AbortController();
        setPackagesLoading(true);
        setPackagesError("");
        setPackages([]);

        const fetchPackages = async () => {
            try {
                const res = await fetch("/api/packages", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    signal: controller.signal,
                    body: JSON.stringify({
                        action: "get_packages",
                        store_id: store.id,
                        ...(urlBranchId ? { branch_id: urlBranchId } : {}),
                    }),
                });
                if (!res.ok) throw new Error("Unable to load packages. Please try again.");
                const data = await res.json();
                if (controller.signal.aborted) return;
                if (data?.error) throw new Error("Unable to load packages. Please try again.");
                setPackages(
                    (Array.isArray(data.packages) ? data.packages : []).filter(
                        (p: PackageItem) => p.status === "Active" &&
                            (!urlBranchId || Number(p.branch_id ?? p.branchId) === urlBranchId)
                    )
                );
            } catch (err) {
                if (controller.signal.aborted) return;
                console.error("Error loading packages:", err);
                setPackagesError(err instanceof Error ? err.message : "Unable to load packages.");
                setPackages([]);
            } finally {
                if (!controller.signal.aborted) setPackagesLoading(false);
            }
        };

        void fetchPackages();
        return () => controller.abort();
    }, [store?.id, urlBranchId]);

    useEffect(() => {
        setRentalCatalog([]); setSelectedRentalItems([]); setRentalCatalogError("");
        setRentalCatalogLoading(false);
        if (!store || !customBranchId || !branches.some(b=>b.id===customBranchId)) return;
        let cancelled=false;
        setRentalCatalogLoading(true);
        (async () => {
            try {
                const response=await fetch('/api/bookings',{
                    method:'POST',headers:{'Content-Type':'application/json'},
                    body:JSON.stringify({action:'get_public_rental_catalog',storeId:store.id,branchId:customBranchId})
                });
                const data=await response.json();
                if(!response.ok)throw new Error(data.error||'Unable to load rental equipment.');
                if(cancelled)return;
                if(Number(data.branchId)!==customBranchId)throw new Error('Rental catalog branch mismatch.');
                setRentalCatalog(data.equipment||[]);
            }catch(error){if(!cancelled){setRentalCatalog([]);
                setRentalCatalogError(error instanceof Error ? error.message : 'Rental equipment unavailable.');}}
            finally { if (!cancelled) setRentalCatalogLoading(false); }
        })();
        return ()=>{cancelled=true;};
    },[store,customBranchId,branches]);

    useEffect(() => {
        setInventoryItems([]); setSelectedCustomItems([]);setCustomItemQty({});
        if (!store || !customBranchId || !branches.some(b=>b.id===customBranchId)) {
            setLoadingInventory(false);
            return;
        }
        let cancelled=false;
        setLoadingInventory(true);
        void (async()=>{
            try {
                const response=await fetch('/api/products',{
                    method:'POST',headers:{'Content-Type':'application/json'},
                    body:JSON.stringify({action:'get_public_products',store_id:store.id,branch_id:customBranchId})});
                const data=await response.json();
                if(!response.ok)throw new Error(data.error||'Unable to load public inventory.');
                if(!cancelled)setInventoryItems(buildCustomInventoryItems(
                    Array.isArray(data.products)?data.products:[],customBranchId));
            }catch(err){if(!cancelled){console.error('Public inventory:',err);setInventoryItems([]);}}
            finally{if(!cancelled)setLoadingInventory(false);}
        })();
        return ()=>{cancelled=true;};
    },[store,customBranchId,branches]);

    function peso(n: number) {
        return `₱${Number(n || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    function generateBookingReference() {
        const storePrefix = (store?.slug || "STORE").replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toUpperCase();
        const year = new Date().getFullYear();
        const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
        const token = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
        return `${storePrefix}-${year}-${token}`;
    }

    function handleSelectPackage(pkg: PackageItem) {
        setBookingType("package");
        setSelectedPackage(String(pkg.id));
        clearError("selection");
        formRef.current?.scrollIntoView({ behavior: "smooth" });
    }

    function resetForm() {
        setBookingType("package");
        setSelectedPackage(""); setCustomOrder(""); setSelectedCustomItems([]); setCustomItemQty({});
        setSelectedRentalItems([]); setRentalEndDate(""); setEventDurationType("single"); setServiceDelivery(false); setServiceSetup(false); setName(""); setFacebookName("");
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
        const selectedBranchId = customBranchId;
        if (!selectedBranchId || !branches.some(b=>b.id===selectedBranchId)) {
            alert('Please choose a valid booking branch.'); return;
        }

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
            package: bookingType === "package" ? selectedPackageData?.name || "" : "",
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
                    ...(bookingType === 'package' ? {packageId:Number(selectedPackageData?.id)} : {}),
                    rentalItems: selectedRentalItems.map(item => ({equipmentId:item.id,quantity:item.quantity,expectedDailyRate:item.dailyRate})),
                    eventEndDate: eventEndDate || undefined,
                    rentalEndDate: selectedRentalItems.length ? eventEndDate : undefined,
                    requestedServices:{delivery:serviceDelivery,setup:serviceSetup},
                    expectedFeePolicy:feePolicy,
                    expectedPackagePrice:bookingType==='package'?Number(selectedPackageData?.package_price||0):undefined,
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

    const detailsCoverImage = detailsPackage
        ? getPackageCoverImage(detailsPackage)
        : "";

    const detailsInclusionCount = detailsPackage?.inclusions?.length || 0;

    const detailsTotalIncludedUnits = (detailsPackage?.inclusions || []).reduce(
        (sum, item) => sum + Number(item.quantity || 0),
        0
    );

    const detailsTotalInclusionValue = (detailsPackage?.inclusions || []).reduce(
        (sum, item) => sum + Number(item.lineValue || 0),
        0
    );

    const detailsDiscountLabel = detailsPackage
        ? detailsPackage.discount_type === "percentage"
            ? `${Number(detailsPackage.discount_value || 0)}%`
            : peso(detailsPackage.discount_value || 0)
        : "";

    if (loading) return <CustomerPortalSkeleton />;

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

                {/* Occasion filters stay separate from package selection and checkout. */}
                <div className="rounded-[20px] border border-[#E6DDF0] bg-white px-4 py-4 shadow-sm sm:px-5">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <div>
                            <h2 className="text-[15px] font-bold text-[#1A1220]">Browse by occasion</h2>
                            <p className="mt-0.5 text-xs text-[#806A8C]">Find packages that match your celebration.</p>
                        </div>
                        <span className="rounded-full bg-[#F7F1FF] px-3 py-1 text-[11px] font-semibold text-[#5F4E75]">
                            {categories.length - 1} occasions
                        </span>
                    </div>
                    <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Filter packages by occasion">
                        {categories.map((category) => {
                            const active = activeCategory === category;
                            return (
                                <button
                                    key={category}
                                    type="button"
                                    aria-pressed={active}
                                    onClick={() => setActiveCategory(category)}
                                    className={`shrink-0 rounded-full border px-4 py-2 text-[13px] font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5B2FC6] ${
                                        active
                                            ? "border-[#2B174C] bg-[#2B174C] text-white shadow-sm"
                                            : "border-[#E6DDF0] bg-white text-[#5F4E75] hover:border-[#BDA9D2] hover:bg-[#F7F1FF]"
                                    }`}
                                >
                                    {category}
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div className="mt-4 rounded-[22px] border border-[#E6DDF0] bg-white p-4 shadow-sm sm:p-5">
                    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#F0EAFE] text-[#4E2C66]">
                                <Package2 size={20} />
                            </span>
                            <div>
                                <h2 className="text-[19px] font-bold tracking-tight text-[#1A1220]">Available packages</h2>
                                <p className="mt-1 text-xs leading-5 text-[#7A6A84]">
                                    Explore packages from this store&apos;s branches and choose the right one for your event.
                                </p>
                            </div>
                        </div>
                        <span className="rounded-full border border-[#E6DDF0] bg-[#F7F1FF] px-3 py-1.5 text-xs font-bold text-[#4E2C66]" aria-live="polite">
                            {packagesLoading ? "Loading..." : `${filteredPackages.length} ${filteredPackages.length === 1 ? "package" : "packages"}`}
                        </span>
                    </div>

                    <div className="mb-4 grid gap-3 rounded-2xl border border-[#EAE2F1] bg-[#FBF8FD] p-3 sm:grid-cols-[minmax(0,1fr)_minmax(220px,290px)] sm:items-end sm:p-4">
                        <div className="min-w-0">
                            <label htmlFor="public-package-search" className="mb-2 block text-xs font-bold text-[#4E2C66]">Search packages</label>
                            <div className="relative">
                                <Search size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#806A8C]" />
                                <input
                                    id="public-package-search"
                                    type="search"
                                    value={packageSearch}
                                    onChange={e => setPackageSearch(e.target.value)}
                                    placeholder="Search by name, category or description"
                                    className="h-11 w-full min-w-0 rounded-xl border border-[#E6DDF0] bg-white pl-10 pr-3 text-sm text-[#1A1220] outline-none placeholder:text-[#9B8AAA] focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10"
                                />
                            </div>
                        </div>
                        <div className="min-w-0">
                            <label htmlFor="package-branch-filter" className="mb-2 flex items-center gap-1.5 text-xs font-bold text-[#4E2C66]">
                                <MapPin size={14} /> Branch location
                            </label>
                            <select
                                id="package-branch-filter"
                                value={effectivePackageBranchFilter}
                                disabled={branchesLoading || !!urlBranchId || !!branchesError}
                                onChange={e => changePackageBranchFilter(e.target.value)}
                                className="h-11 w-full min-w-0 rounded-xl border border-[#E6DDF0] bg-white px-3 text-sm font-medium text-[#2B174C] outline-none focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10 disabled:cursor-not-allowed disabled:bg-[#F7F1FF]"
                            >
                                {!urlBranchId && <option value="all">All branches ({packages.length})</option>}
                                {branches.filter(b => !urlBranchId || b.id === urlBranchId).map(branch => (
                                    <option key={branch.id} value={String(branch.id)}>
                                        {branch.name} ({packageCountsByBranch.get(branch.id) || 0})
                                    </option>
                                ))}
                                {urlBranchId && !branches.some(b => b.id === urlBranchId) &&
                                    <option value={String(urlBranchId)}>Branch #{urlBranchId}</option>}
                            </select>
                        </div>
                    </div>

                    <div className="mb-4 flex min-h-7 flex-wrap items-center justify-between gap-2">
                        <p className="flex items-center gap-1.5 text-xs text-[#806A8C]" aria-live="polite">
                            <MapPin size={13} className="shrink-0" />
                            {urlBranchId || effectivePackageBranchFilter !== "all"
                                ? `Viewing ${branches.find(b => b.id === Number(effectivePackageBranchFilter))?.name || `Branch #${effectivePackageBranchFilter}`}`
                                : "Viewing packages across all branches"}
                            {!packagesLoading && ` · ${filteredPackages.length} results`}
                        </p>
                        {(activeCategory !== "All" || packageSearch.trim() || (!urlBranchId && effectivePackageBranchFilter !== "all")) && (
                            <button
                                type="button"
                                onClick={() => {
                                    setActiveCategory("All");
                                    setPackageSearch("");
                                    if (!urlBranchId) changePackageBranchFilter("all");
                                }}
                                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold text-[#4E2C66] hover:bg-[#F0EAFE] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#5B2FC6]"
                            >
                                <X size={13} /> Clear filters
                            </button>
                        )}
                    </div>
                    {urlBranchId && <p className="mb-3 rounded-lg bg-[#F7F1FF] px-3 py-2 text-xs text-[#5F4E75]">This booking link is assigned to a specific branch. Only its packages can be selected.</p>}
                    {branchesError && <p role="alert" className="mb-3 text-xs text-red-600">{branchesError}</p>}

                    {packagesLoading ? (
                        <PackageCardsSkeleton />
                    ) : packagesError ? (
                        <div role="alert" className="rounded-xl border border-[#F2C4C4] bg-[#FFF0F0] px-4 py-6 text-sm text-[#C32F2F]">{packagesError}</div>
                    ) : filteredPackages.length === 0 ? (
                        <div className="flex min-h-[260px] flex-col items-center justify-center rounded-[18px] border border-dashed border-[#D8CBE7] bg-[#FFFCF8] px-5 text-center">
                            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#F0EAFE] text-[#4E2C66]">
                                <Search size={20} />
                            </div>
                            <h3 className="text-base font-bold text-[#1A1220]">No matching packages</h3>
                            <p className="mt-1 max-w-sm text-xs leading-5 text-[#806A8C]">
                                Try another branch, category or search term. You can also send a custom booking request below.
                            </p>
                        </div>
                    ) : (
                        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                            {filteredPackages.slice(0, visiblePackageCount).map((pkg) => {
                                const chosen = selectedPackage === String(pkg.id);
                                const branchName = branches.find(b => b.id === Number(pkg.branch_id ?? pkg.branchId))?.name || `Branch #${pkg.branch_id ?? pkg.branchId}`;
                                const inclusionCount = pkg.inclusions?.length || 0;
                                return (
                                    <article
                                        key={pkg.id}
                                        className={`group flex h-full flex-col overflow-hidden rounded-[20px] border bg-white shadow-[0_2px_12px_rgba(43,23,76,0.05)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_9px_26px_rgba(43,23,76,0.11)] ${
                                            chosen ? "border-[#6B43A1] ring-2 ring-[#E9DDF7]" : "border-[#E6DDF0] hover:border-[#CBB6DF]"
                                        }`}
                                    >
                                        <div className="relative h-44 overflow-hidden bg-[#F5EEF6]">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img
                                                src={getPackageCoverImage(pkg)}
                                                alt={`${pkg.name} package`}
                                                loading="lazy"
                                                decoding="async"
                                                className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                                            />
                                            <span className="absolute left-3 top-3 max-w-[calc(100%-1.5rem)] truncate rounded-full border border-white/70 bg-white/95 px-3 py-1.5 text-[11px] font-bold text-[#4E2C66] shadow-sm">
                                                {pkg.category || "Event"}
                                            </span>
                                            {chosen && (
                                                <span className="absolute bottom-3 right-3 inline-flex items-center gap-1 rounded-full bg-[#2B174C] px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm">
                                                    <Check size={12} /> Selected
                                                </span>
                                            )}
                                        </div>

                                        <div className="flex flex-1 flex-col p-4 sm:p-5">
                                            <h3 className="line-clamp-2 min-h-[48px] text-[17px] font-bold leading-6 text-[#24153B]">
                                                {pkg.name}
                                            </h3>
                                            <p className="mt-2 flex min-w-0 items-center gap-1.5 text-xs font-semibold text-[#6B4E87]">
                                                <MapPin size={14} className="shrink-0" />
                                                <span className="truncate" title={branchName}>{branchName}</span>
                                            </p>
                                            <p className="mt-3 line-clamp-2 min-h-[40px] text-[13px] leading-5 text-[#7A6A84]">
                                                {pkg.description || "Event setup designed for a memorable celebration."}
                                            </p>
                                            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[#EFE7F4] pt-3 text-xs text-[#806A8C]">
                                                <span className="inline-flex items-center gap-1.5">
                                                    <Package2 size={14} /> {inclusionCount} {inclusionCount === 1 ? "included item" : "included items"}
                                                </span>
                                                <span className="inline-flex items-center gap-1.5">
                                                    <Clock3 size={14} /> {pkg.duration || "Flexible"}
                                                </span>
                                            </div>
                                            <div className="mt-auto pt-4">
                                                <div className="mb-4 rounded-xl bg-[#F8F4FC] px-3.5 py-3">
                                                    <p className="text-[11px] font-semibold text-[#806A8C]">Package price</p>
                                                    <p className="mt-0.5 text-[23px] font-bold tracking-tight text-[#2B174C]">{peso(pkg.package_price)}</p>
                                                </div>
                                                <div className="grid grid-cols-2 gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => setDetailsPackage(pkg)}
                                                        className="min-h-10 rounded-xl border border-[#D8CBE7] bg-white px-2.5 py-2 text-xs font-bold text-[#4E2C66] transition hover:bg-[#F7F1FF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5B2FC6]"
                                                    >
                                                        View details
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleSelectPackage(pkg)}
                                                        className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl bg-[#2B174C] px-2.5 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-[#45246F] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5B2FC6]"
                                                    >
                                                        {chosen ? <><Check size={14} /> Chosen</> : "Choose package"}
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </article>
                                );
                            })}
                        </div>
                    )}
                    {!packagesLoading && !packagesError && filteredPackages.length > visiblePackageCount && (
                        <div className="mt-6 flex flex-col items-center gap-2 border-t border-[#F0EAF5] pt-5">
                            <p className="text-xs text-[#806A8C]">Showing {visiblePackageCount} of {filteredPackages.length} matching packages</p>
                            <button
                                type="button"
                                onClick={() => setVisiblePackageCount(count => count + 12)}
                                className="rounded-xl border border-[#D8CBE7] bg-[#F7F1FF] px-6 py-2.5 text-sm font-semibold text-[#2B174C] transition hover:bg-[#F0EAFE]"
                            >
                                Show more packages ({filteredPackages.length - visiblePackageCount} remaining)
                            </button>
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
                                                {packages.filter(pkg => effectivePackageBranchFilter === "all" ||
                                                    Number(pkg.branch_id ?? pkg.branchId) === Number(effectivePackageBranchFilter)).map((pkg) => (
                                                    <option key={pkg.id} value={String(pkg.id)}>
                                                        {pkg.name} - {peso(pkg.package_price)} · {branches.find(b=>b.id===Number(pkg.branch_id??pkg.branchId))?.name||`Branch #${pkg.branch_id??pkg.branchId}`}
                                                    </option>
                                                ))}
                                            </select>
                                            {packagesLoading && <p className="mt-2 text-xs text-[#806A8C]">Loading package options...</p>}
                                            {selectedPackageData && (
                                                <p className="mt-2 text-xs text-[#806A8C]">Handled by: <strong>{selectedBranchName || `Branch #${packageBranchId}`}</strong></p>
                                            )}
                                            {fieldErrors.selection && (
                                                <p className="mt-1.5 text-xs font-medium text-red-500">{fieldErrors.selection}</p>
                                            )}

                                        </>
                                    ) : (
                                        <>
                                            <div className="mb-4 rounded-2xl border border-[#E6DDF0] bg-[#FFFDF8] p-4">
                                                <label htmlFor="public-booking-branch" className="mb-2 block text-sm font-semibold text-[#1A1220]">Select booking branch</label>
                                                <p className="mb-3 text-xs text-[#806A8C]">Sales products, rental equipment, services and booking assignment will use this branch.</p>
                                                <select id="public-booking-branch" value={selectedCustomBranchId||''}
                                                        disabled={!!urlBranchId} onChange={e=>{
                                                    const next=e.target.value?Number(e.target.value):null;
                                                    setSelectedCustomBranchId(next);
                                                    setSelectedCustomItems([]);setSelectedRentalItems([]);
                                                    clearError('selection');
                                                }}
                                                        className="h-12 w-full rounded-xl border border-[#E6DDF0] bg-white px-3 text-sm text-[#1A1220] disabled:bg-[#F7F1FF]">
                                                    <option value="">Choose a branch</option>
                                                    {branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
                                                </select>
                                                {branchesError && <p className="mt-2 text-xs text-red-600">{branchesError}</p>}
                                                {branchesLoading && <div role="status" aria-label="Loading branches" className="mt-3 h-3 w-44 animate-pulse rounded bg-[#EEE8F3]" />}
                                                {!branchesLoading && !branches.length && !branchesError && <p className="mt-2 text-xs text-[#806A8C]">No booking branches available.</p>}
                                            </div>
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
                                                        <div role="status" aria-label="Loading inventory items" className="space-y-2 rounded-xl border border-[#E6DDF0] bg-white p-3">
                                                            {[0, 1, 2, 3].map(index => <div key={index} className="h-12 animate-pulse rounded-lg bg-[#EEE8F3]" />)}
                                                        </div>
                                                    ) : filteredInventoryItems.length === 0 ? (
                                                        <div className="rounded-xl border border-dashed border-[#E6DDF0] bg-[#FFFDF8] px-4 py-6 text-center text-sm text-[#7A6A84]">
                                                            {customBranchId ? "No inventory items found for this branch." : "Select a branch to view available products."}
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

                                    {/* Shared event schedule for packages and custom requests. */}
                                    <div className="md:col-span-2 rounded-2xl border border-[#E6DDF0] bg-[#FFFDF8] p-4">
                                        <div className="mb-3 flex items-center gap-2">
                                            <CalendarDays size={18} className="text-[#4E2C66]" />
                                            <div>
                                                <h3 className="text-sm font-bold text-[#2B174C]">Event schedule</h3>
                                                <p className="mt-1 text-xs text-[#806A8C]">Select your event dates. Rental equipment uses these dates to calculate the estimated charge.</p>
                                            </div>
                                        </div>
                                        <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Event duration">
                                            <button type="button" aria-pressed={eventDurationType === "single"}
                                                    onClick={() => { setEventDurationType("single"); setRentalEndDate(""); clearError("rentalEndDate"); }}
                                                    className={`rounded-xl border px-4 py-2.5 text-sm font-semibold transition ${eventDurationType === "single" ? "border-[#2B174C] bg-[#2B174C] text-white" : "border-[#D8CBE7] bg-white text-[#2B174C] hover:bg-[#F7F1FF]"}`}>
                                                One-day event
                                            </button>
                                            <button type="button" aria-pressed={eventDurationType === "multiple"}
                                                    onClick={() => { setEventDurationType("multiple"); setRentalEndDate(prev => prev > date ? prev : ""); clearError("rentalEndDate"); }}
                                                    className={`rounded-xl border px-4 py-2.5 text-sm font-semibold transition ${eventDurationType === "multiple" ? "border-[#2B174C] bg-[#2B174C] text-white" : "border-[#D8CBE7] bg-white text-[#2B174C] hover:bg-[#F7F1FF]"}`}>
                                                Multi-day event
                                            </button>
                                        </div>
                                        <div className="grid gap-4 sm:grid-cols-2">
                                            <div>
                                                <label htmlFor="event-start-date" className="mb-2 block text-xs font-semibold text-[#2B174C]">{eventDurationType === "multiple" ? "Event start date" : "Event date"}</label>
                                                <input id="event-start-date" type="date" min={todayForPicker} value={date}
                                                       onChange={e => { const next = e.target.value; setDate(next); if (rentalEndDate && rentalEndDate <= next) setRentalEndDate(""); clearError("date"); clearError("rentalEndDate"); }}
                                                       className={`h-12 w-full rounded-xl border bg-white px-3 text-sm text-[#1A1220] outline-none focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10 ${fieldErrors.date ? "border-[#F2C4C4]" : "border-[#E6DDF0]"}`} />
                                                {fieldErrors.date && <p className="mt-1 text-xs text-red-600">{fieldErrors.date}</p>}
                                            </div>
                                            {eventDurationType === "multiple" && (
                                                <div>
                                                    <label htmlFor="event-end-date" className="mb-2 block text-xs font-semibold text-[#2B174C]">Event end date</label>
                                                    <input id="event-end-date" type="date" min={date ? new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10) : todayForPicker}
                                                           value={rentalEndDate}
                                                           max={date ? new Date(Date.parse(`${date}T00:00:00Z`) + 29 * 86400000).toISOString().slice(0, 10) : undefined}
                                                           onChange={e => { setRentalEndDate(e.target.value); clearError("rentalEndDate"); }}
                                                           className={`h-12 w-full rounded-xl border bg-white px-3 text-sm text-[#1A1220] outline-none focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10 ${fieldErrors.rentalEndDate ? "border-[#F2C4C4]" : "border-[#E6DDF0]"}`} />
                                                    {fieldErrors.rentalEndDate && <p className="mt-1 text-xs text-red-600">{fieldErrors.rentalEndDate}</p>}
                                                </div>
                                            )}
                                            <div>
                                                <label htmlFor="event-start-time" className="mb-2 block text-xs font-semibold text-[#2B174C]">Event time</label>
                                                <input id="event-start-time" type="time" value={eventTime}
                                                       onChange={e => { setEventTime(e.target.value); clearError("eventTime"); }}
                                                       className={`h-12 w-full rounded-xl border bg-white px-3 text-sm text-[#1A1220] outline-none focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10 ${fieldErrors.eventTime ? "border-[#F2C4C4]" : "border-[#E6DDF0]"}`} />
                                                {fieldErrors.eventTime && <p className="mt-1 text-xs text-red-600">{fieldErrors.eventTime}</p>}
                                            </div>
                                        </div>
                                        <p aria-live="polite" className="mt-3 text-xs font-medium text-[#5F4E75]">
                                            {!date ? "Choose your event date to calculate the rental duration." : eventDurationType === "multiple" && !rentalEndDate
                                                ? "Choose the end date for your multi-day event."
                                                : requestedEventDays > 30 ? "The maximum event period is 30 days."
                                                    : rentalDuration > 0 ? `${rentalDuration} ${rentalDuration === 1 ? "day" : "days"} selected for the event and rental estimate.`
                                                        : "Choose valid event dates."}
                                        </p>
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

                                {/* Rental equipment comes after event scheduling for both booking types. */}
                                <div className="mt-6 rounded-2xl border border-[#E6DDF0] bg-[#FFFDF8] p-4">
                                    <h3 className="text-sm font-bold text-[#2B174C]">{bookingType === "package" ? "Additional rental equipment (optional)" : "Rental equipment (optional)"}</h3>
                                    <p className="mt-1 text-xs leading-5 text-[#7A6A84]">
                                        {bookingType === "package"
                                            ? "Add equipment beyond what your package includes. Package inclusions stay in the package price."
                                            : "Choose tables, chairs, tents, or other equipment for your event."}
                                        {" "}Rates are per item, per day. Equipment is reserved after booking confirmation.
                                    </p>
                                    <p className="mt-2 text-xs font-medium text-[#4E2C66]" aria-live="polite">
                                        {!date ? "Select your event date in Event Schedule above to see the rental estimate."
                                            : eventDurationType === "multiple" && !rentalEndDate ? "Select the event end date above to calculate multi-day rentals."
                                                : rentalDuration > 0 ? `Rental duration: ${rentalDuration} ${rentalDuration === 1 ? "day" : "days"}.`
                                                    : "Choose valid event dates above."}
                                    </p>
                                    <input type="search" value={rentalSearch} onChange={e => setRentalSearch(e.target.value)}
                                           placeholder="Search rental equipment..." aria-label="Search rental equipment"
                                           className="mt-3 h-11 w-full rounded-xl border border-[#E6DDF0] bg-white px-3 text-sm outline-none focus:border-[#2B174C]" />
                                    {rentalCatalogError && <p className="mt-2 text-xs text-red-600">{rentalCatalogError}</p>}
                                    <div className="mt-2 max-h-52 space-y-2 overflow-y-auto" aria-busy={rentalCatalogLoading}>
                                        {rentalCatalogLoading && <div role="status" aria-label="Loading rental equipment" className="space-y-2">
                                            {[0, 1, 2].map(index => <div key={index} className="h-14 animate-pulse rounded-lg bg-[#EEE8F3]" />)}
                                        </div>}
                                        {!rentalCatalogLoading && rentalCatalog.filter(item => item.name.toLowerCase().includes(rentalSearch.toLowerCase())).map(item => {
                                            const chosen = selectedRentalItems.find(x => x.id === item.id);
                                            return <div key={item.id} className="flex items-center justify-between gap-2 rounded-lg border border-[#E6DDF0] bg-white p-2">
                                                <div className="min-w-0 text-xs">
                                                    <p className="font-semibold text-[#2B174C]">{item.name}</p>
                                                    <p className="text-[#806A8C]">{peso(item.dailyRate)} / item / day · {item.physicallyAvailable} physically ready</p>
                                                </div>
                                                <div className="flex shrink-0 items-center gap-2">
                                                    <input type="number" aria-label={`Quantity of ${item.name}`} min={1} max={item.physicallyAvailable}
                                                           value={chosen?.quantity || 1}
                                                           onChange={e => {
                                                               const quantity = Math.max(1, Math.min(item.physicallyAvailable, Number(e.target.value) || 1));
                                                               setSelectedRentalItems(prev => prev.some(x => x.id === item.id) ? prev.map(x => x.id === item.id ? {...x, quantity} : x) : [...prev, {...item, quantity}]);
                                                           }} className="w-16 rounded-lg border border-[#E6DDF0] p-1.5 text-sm" />
                                                    <button type="button" onClick={() => {
                                                        setSelectedRentalItems(prev => chosen ? prev.filter(x => x.id !== item.id) : [...prev, {...item, quantity:1}]);
                                                        clearError("selection");
                                                    }} className="rounded-lg border border-[#E6DDF0] px-2 py-1.5 text-xs font-semibold text-[#2B174C]">
                                                        {chosen ? "Remove" : "Add"}
                                                    </button>
                                                </div>
                                            </div>;
                                        })}
                                        {!rentalCatalogLoading && !rentalCatalog.length && !rentalCatalogError && <p className="py-2 text-xs text-[#806A8C]">{!customBranchId ? "Choose a package or booking branch to view rental equipment." : "No priced rental equipment in this branch yet."}</p>}
                                    </div>
                                    {selectedRentalItems.length > 0 && <div className="mt-3 border-t border-[#E6DDF0] pt-3 text-sm text-[#2B174C]">
                                        <p className="font-semibold">Rental subtotal: {peso(selectedRentalTotal)}</p>
                                        <p className="mt-1 text-xs text-[#7A6A84]">The final price and availability are confirmed by the business before approval.</p>
                                    </div>}
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
                                                    value={selectedPackageData?.name || ""}
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
                                                    label={eventDurationType === "multiple" ? "Event dates" : "Date"}
                                                    value={eventDurationType === "multiple" && eventEndDate && eventEndDate >= date
                                                        ? `${date} to ${eventEndDate} (${rentalDuration} days)` : date}
                                                />
                                            )}
                                            {eventTime && (
                                                <SummaryItem
                                                    label="Event time"
                                                    value={eventTime}
                                                />
                                            )}
                                        </div>

                                        <div className="mt-5 rounded-xl border border-[#E6DDF0] bg-[#FFFDF8] p-4 text-xs text-[#2B174C]">
                                            <h4 className="mb-2 text-sm font-bold">Itemized booking quotation · Estimate</h4>
                                            {bookingType==='package' && <div className="flex justify-between py-1"><span>Package (included items)</span><strong>{peso(Number(estimatedBase))}</strong></div>}
                                            {bookingType==='custom' && <div className="flex justify-between py-1"><span>Requested sales items (estimate)</span><strong>{peso(selectedCustomTotal)}</strong></div>}
                                            {selectedRentalItems.length > 0 && rentalDuration === 0 && <p className="py-2 text-xs text-[#806A8C]">Choose your event dates above to calculate the rental charges.</p>}
                                            {selectedRentalItems.map(item=><div key={item.id} className="flex justify-between gap-3 py-1"><span>{item.name} · {item.quantity} × {rentalDuration} day(s)</span><strong>{peso(item.dailyRate*item.quantity*rentalDuration)}</strong></div>)}
                                            <div className="mt-2 border-t border-[#E6DDF0] pt-2 space-y-2">
                                                <label className="flex justify-between gap-2"><span><input type="checkbox" checked={serviceDelivery} onChange={e=>setServiceDelivery(e.target.checked)}/> Delivery & pickup</span><strong>{bookingType==='package'&&feePolicy.deliveryIncludedPackage?'Included':peso(feePolicy.deliveryFee)}</strong></label>
                                                <label className="flex justify-between gap-2"><span><input type="checkbox" checked={serviceSetup} onChange={e=>setServiceSetup(e.target.checked)}/> Setup assistance</span><strong>{bookingType==='package'&&feePolicy.setupIncludedPackage?'Included':peso(feePolicy.setupFee)}</strong></label>
                                            </div>
                                            <div className="mt-2 flex justify-between border-t border-[#E6DDF0] pt-2 font-bold"><span>Estimated booking charge</span><span>{peso(estimatedBase+(bookingType==='custom'?selectedCustomTotal:0)+selectedRentalTotal+estimatedDelivery+estimatedSetup)}</span></div>
                                            <div className="mt-2 flex justify-between"><span>Refundable security deposit (held separately)</span><strong>{peso(feePolicy.refundableDeposit)}</strong></div>
                                            <p className="mt-2 text-[#806A8C]">Booking charges, required down payment and refundable deposit are distinct. Final custom prices and availability require business confirmation. This quotation is not a tax invoice.</p>
                                            <button type="button" onClick={()=>window.print()} className="mt-3 rounded-lg border border-[#D8CBE7] px-3 py-2 font-semibold">Print quotation</button>
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
                <div
                    className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/45 px-3 py-3 backdrop-blur-sm sm:px-4 sm:py-6"
                    role="dialog"
                    aria-modal="true"
                    aria-label={`${detailsPackage.name} package details`}
                    onClick={() => {
                        setDetailsPackage(null);
                        setShowExpandedPackageImage(false);
                    }}
                >
                    <div
                        className="flex max-h-[92vh] w-full max-w-[980px] flex-col overflow-hidden rounded-[22px] border border-[#E6DDF0] bg-white shadow-[0_24px_80px_rgba(20,10,35,0.28)]"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="relative shrink-0 overflow-hidden bg-[#2D1B4E]">
                            <button
                                type="button"
                                onClick={() => setShowExpandedPackageImage(true)}
                                className="group/image block h-[280px] w-full cursor-zoom-in overflow-hidden text-left"
                                aria-label="Expand package cover image"
                                title="Click to enlarge image"
                            >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    src={detailsCoverImage}
                                    alt={`${detailsPackage.name} package cover`}
                                    className="h-full w-full object-cover transition duration-300 group-hover/image:scale-[1.02]"
                                />
                                <div className="absolute inset-0 bg-gradient-to-t from-[#160C27]/85 via-[#160C27]/15 to-transparent" />

                                <span className="absolute right-5 top-5 rounded-full bg-black/45 px-3 py-1.5 text-[11px] font-semibold text-white backdrop-blur-sm transition group-hover/image:bg-black/60">
                                    Click image to expand
                                </span>
                            </button>

                            <button
                                type="button"
                                onClick={() => {
                                    setDetailsPackage(null);
                                    setShowExpandedPackageImage(false);
                                }}
                                className="absolute left-5 top-5 flex h-10 w-10 items-center justify-center rounded-full bg-white/95 text-[#2B174C] shadow-md transition hover:scale-105 hover:bg-white"
                                aria-label="Close package details"
                            >
                                <X size={18} />
                            </button>

                            <div className="pointer-events-none absolute bottom-0 left-0 right-0 p-6">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/75">
                                    Package details
                                </p>
                                <h2 className="mt-1 max-w-[820px] text-[28px] font-bold leading-tight text-white">
                                    {detailsPackage.name}
                                </h2>
                            </div>
                        </div>

                        <div className="min-h-0 flex-1 overflow-y-auto">
                            <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
                                <div className="min-w-0 space-y-5">
                                    <section>
                                        <h3 className="text-sm font-bold text-[#1A1220]">
                                            Package Information
                                        </h3>

                                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                            <CustomerPackageDetailBox
                                                label="Package Price"
                                                value={peso(detailsPackage.package_price)}
                                                strong
                                            />
                                            <CustomerPackageDetailBox
                                                label="Down Payment"
                                                value={peso(detailsPackage.down_payment_amount || 0)}
                                            />
                                            <CustomerPackageDetailBox
                                                label="Original Value"
                                                value={peso(detailsPackage.original_value || 0)}
                                            />
                                            <CustomerPackageDetailBox
                                                label="Discount"
                                                value={detailsDiscountLabel}
                                            />
                                            <CustomerPackageDetailBox
                                                label="Category"
                                                value={detailsPackage.category || "Other"}
                                            />
                                            <CustomerPackageDetailBox
                                                label="Duration"
                                                value={detailsPackage.duration || "Not set"}
                                            />
                                        </div>
                                    </section>

                                    <section className="rounded-[16px] border border-[#EAE1EF] bg-[#FFFCF8] p-4">
                                        <h3 className="text-sm font-bold text-[#1A1220]">
                                            Description
                                        </h3>
                                        <p className="mt-2 text-sm leading-6 text-[#74657D]">
                                            {detailsPackage.description || "No description provided."}
                                        </p>
                                    </section>

                                    <section className="rounded-[16px] border border-[#EAE1EF] bg-white p-4">
                                        <div className="flex items-center justify-between gap-4">
                                            <div>
                                                <h3 className="text-sm font-bold text-[#1A1220]">
                                                    Inclusion Summary
                                                </h3>
                                                <p className="mt-1 text-xs text-[#84738D]">
                                                    Quick summary of everything included in this package.
                                                </p>
                                            </div>

                                            <span className="rounded-full bg-[#EFE8F8] px-3 py-1 text-xs font-bold text-[#4E2C66]">
                                                {detailsInclusionCount} {detailsInclusionCount === 1 ? "item" : "items"}
                                            </span>
                                        </div>

                                        <div className="mt-4 grid grid-cols-2 gap-3">
                                            <CustomerPackageDetailBox
                                                label="Included Units"
                                                value={`${detailsTotalIncludedUnits} units`}
                                            />
                                            <CustomerPackageDetailBox
                                                label="Inclusion Value"
                                                value={peso(detailsTotalInclusionValue)}
                                                strong
                                            />
                                        </div>
                                    </section>

                                    <section className="rounded-[16px] border border-[#D8CBE7] bg-[#F7F1FF] p-4">
                                        <p className="text-sm leading-6 text-[#5F4E75]">
                                            Themes and color motifs are customizable. Add your preferred design direction in the booking form.
                                        </p>
                                    </section>
                                </div>

                                <div className="min-w-0">
                                    <section className="rounded-[18px] border border-[#E6DDF0] bg-[#FBF8FD] p-4">
                                        <div className="flex items-center justify-between gap-4">
                                            <div>
                                                <h3 className="text-sm font-bold text-[#1A1220]">
                                                    Package Inclusions
                                                </h3>
                                                <p className="mt-1 text-xs text-[#84738D]">
                                                    Items included in this package.
                                                </p>
                                            </div>

                                            <span className="shrink-0 rounded-full bg-[#EEE5F8] px-3 py-1 text-xs font-bold text-[#4E2C66]">
                                                {detailsInclusionCount} {detailsInclusionCount === 1 ? "item" : "items"}
                                            </span>
                                        </div>

                                        <div className="mt-4 max-h-[420px] space-y-2 overflow-y-auto pr-1">
                                            {detailsInclusionCount === 0 ? (
                                                <p className="rounded-xl border border-dashed border-[#DCCFE6] bg-white px-4 py-8 text-center text-sm text-[#7A6A84]">
                                                    No inclusions listed.
                                                </p>
                                            ) : (
                                                (detailsPackage.inclusions || []).map((item, index) => (
                                                    <div
                                                        key={item.inventoryKey || `${item.productId}-${item.variantId || 0}-${index}`}
                                                        className="rounded-[14px] border border-[#E6DDF0] bg-white px-4 py-3 shadow-[0_1px_2px_rgba(43,23,76,0.03)]"
                                                    >
                                                        <div className="flex items-start justify-between gap-4">
                                                            <div className="min-w-0">
                                                                <p className="break-words text-sm font-semibold leading-5 text-[#1A1220]">
                                                                    {item.productName}
                                                                </p>

                                                                {item.variantName ? (
                                                                    <p className="mt-1 break-words text-xs text-[#806F89]">
                                                                        {item.variantName}
                                                                    </p>
                                                                ) : null}

                                                                <p className="mt-1.5 text-xs text-[#7A6A84]">
                                                                    {peso(item.unitSalesPrice)} each
                                                                </p>
                                                            </div>

                                                            <div className="shrink-0 text-right">
                                                                <p className="text-sm font-bold text-[#2B174C]">
                                                                    × {item.quantity}
                                                                </p>
                                                                <p className="mt-1 text-xs font-semibold text-[#7A6A84]">
                                                                    {peso(item.lineValue)}
                                                                </p>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    </section>
                                </div>
                            </div>
                        </div>

                        <div className="flex shrink-0 flex-col gap-3 border-t border-[#E8DFED] bg-white px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
                            <p className="text-xs text-[#8A7A91]">
                                Review the package details, then select it to continue your booking.
                            </p>

                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => setDetailsPackage(null)}
                                    className="rounded-xl border border-[#DCCFE6] bg-white px-5 py-2.5 text-sm font-semibold text-[#2B174C] shadow-sm transition hover:bg-[#F7F1FF]"
                                >
                                    Close
                                </button>

                                <button
                                    type="button"
                                    onClick={() => {
                                        handleSelectPackage(detailsPackage);
                                        setDetailsPackage(null);
                                        setShowExpandedPackageImage(false);
                                    }}
                                    className="rounded-xl bg-[#2B174C] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31]"
                                >
                                    Select this package
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {detailsPackage && showExpandedPackageImage && (
                <div
                    className="fixed inset-0 z-[120] flex items-center justify-center overflow-y-auto bg-black/85 p-2 backdrop-blur-sm sm:p-4"
                    role="dialog"
                    aria-modal="true"
                    aria-label={`${detailsPackage.name} enlarged cover image`}
                    onClick={() => setShowExpandedPackageImage(false)}
                >
                    <div
                        className="relative flex max-h-[94vh] max-w-[94vw] items-center justify-center"
                        onClick={(event) => event.stopPropagation()}
                    >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={detailsCoverImage}
                            alt={`${detailsPackage.name} enlarged package cover`}
                            className="max-h-[90vh] max-w-[90vw] rounded-[18px] object-contain shadow-2xl"
                        />

                        <button
                            type="button"
                            onClick={() => setShowExpandedPackageImage(false)}
                            className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full bg-white/95 text-[#2B174C] shadow-md transition hover:scale-105 hover:bg-white"
                            aria-label="Close enlarged image"
                        >
                            <X size={18} />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function CustomerPackageDetailBox({
                                      label,
                                      value,
                                      strong = false,
                                  }: {
    label: string;
    value: string;
    strong?: boolean;
}) {
    return (
        <div className="rounded-[14px] border border-[#E6DDF0] bg-white px-4 py-3 shadow-[0_1px_2px_rgba(43,23,76,0.03)]">
            <p className="text-xs font-semibold text-[#806A8C]">{label}</p>
            <p
                className={`mt-1 text-sm ${
                    strong
                        ? "font-bold text-[#2B174C]"
                        : "font-semibold text-[#1A1220]"
                }`}
            >
                {value}
            </p>
        </div>
    );
}

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