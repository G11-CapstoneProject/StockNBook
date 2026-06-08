"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import {
    CalendarDays,
    Clock3,
    Package2,
    ChevronDown,
    MoreVertical,
    Check,
    Sparkles,
    X,
    Copy,
    Search,
    Clock,
    MapPin,
    Palette,
    RefreshCw,
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

const categories = ["All", "Birthday", "Debut", "Anniversary", "Wedding", "Corporate", "Kids Party"];

const STATUS_MAP: Record<string, { color: string; icon: React.ReactNode }> = {
    "Pending Review": { color: "bg-yellow-100 text-yellow-700", icon: <Clock size={13} /> },
    "Confirmed":      { color: "bg-blue-100 text-blue-700",     icon: <Check size={13} /> },
    "Preparing":      { color: "bg-purple-100 text-purple-700", icon: <Clock size={13} /> },
    "Completed":      { color: "bg-green-100 text-green-700",   icon: <Check size={13} /> },
    "Cancelled":      { color: "bg-red-100 text-red-700",       icon: <X size={13} /> },
};

const TIMELINE_STEPS = ["Pending Review", "Confirmed", "Preparing", "Completed"];

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
    const s = STATUS_MAP[status] || { color: "bg-gray-100 text-gray-700", icon: <Clock size={13} /> };
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

    const displayBooking = booking ?? selectedBooking;

    return (
        <div className="border-b border-purple-100 bg-purple-50/60 px-6 py-5">
            <div className="mx-auto max-w-7xl">

                {/* Mode tabs */}
                <div className="mb-4 flex items-center gap-2">
                    <button
                        onClick={() => switchMode("ref")}
                        className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                            mode === "ref" ? "bg-purple-600 text-white" : "bg-white border border-gray-200 text-gray-500 hover:border-purple-300"
                        }`}
                    >
                        Search by reference no.
                    </button>
                    <button
                        onClick={() => switchMode("phone")}
                        className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                            mode === "phone" ? "bg-purple-600 text-white" : "bg-white border border-gray-200 text-gray-500 hover:border-purple-300"
                        }`}
                    >
                        I forgot my reference no.
                    </button>
                    <button onClick={() => { onClose(); clearUrl(); }} className="ml-auto rounded-xl border border-gray-200 bg-white p-2 text-gray-400 hover:text-gray-600">
                        <X size={15} />
                    </button>
                </div>

                {mode === "ref" && (
                    <div className="flex items-center gap-3">
                        <Search size={16} className="shrink-0 text-purple-500" />
                        <input
                            value={refInput}
                            onChange={(e) => { setRefInput(e.target.value.toUpperCase()); setError(""); setBooking(null); }}
                            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                            placeholder="e.g. YUKA-2026-532001"
                            className="flex-1 rounded-xl border border-purple-200 bg-white px-4 py-2.5 text-sm font-mono tracking-widest outline-none focus:border-purple-400 focus:ring-1 focus:ring-purple-200"
                        />
                        <button
                            onClick={handleSearch}
                            disabled={loading}
                            className="rounded-xl bg-purple-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-60"
                        >
                            {loading ? "Searching…" : "Search"}
                        </button>
                    </div>
                )}

                {mode === "phone" && (
                    <div className="space-y-3">
                        <div className="flex items-center gap-3">
                            <Search size={16} className="shrink-0 text-purple-500" />
                            <input
                                value={phoneInput}
                                onChange={(e) => { setPhoneInput(e.target.value); setError(""); setPhoneBookings([]); setSelectedBooking(null); }}
                                placeholder="Phone number used when booking (09XXXXXXXXX)"
                                className="flex-1 rounded-xl border border-purple-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-purple-400 focus:ring-1 focus:ring-purple-200"
                            />
                        </div>
                        <div className="flex items-center gap-3">
                            <CalendarDays size={16} className="shrink-0 text-purple-500" />
                            <input
                                type="date"
                                value={dateInput}
                                onChange={(e) => { setDateInput(e.target.value); setError(""); setPhoneBookings([]); setSelectedBooking(null); }}
                                className="flex-1 rounded-xl border border-purple-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-purple-400 focus:ring-1 focus:ring-purple-200"
                            />
                            <button
                                onClick={handleSearch}
                                disabled={loading}
                                className="rounded-xl bg-purple-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-60"
                            >
                                {loading ? "Searching…" : "Search"}
                            </button>
                        </div>
                        <p className="pl-7 text-xs text-gray-400">
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

                        <p className="mt-3 text-xs text-gray-400">
                            For follow-ups, contact the store with your booking reference number.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}

function DetailItem({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
    return (
        <div className="flex flex-col gap-0.5">
            <span className="flex items-center gap-1 text-xs text-gray-400">{icon}{label}</span>
            <span className="text-sm font-semibold text-[#1f2a44]">{value}</span>
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

    function clearError(key: string) {
        setFieldErrors((prev) => ({ ...prev, [key]: "" }));
    }

    function validateForm(): Record<string, string> {
        const errors: Record<string, string> = {};
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const maxDate = new Date(); maxDate.setFullYear(maxDate.getFullYear() + 2);

        const hasSelection = bookingType === "package" ? !!selectedPackage : !!customOrder.trim();
        if (!hasSelection) errors.selection = bookingType === "package" ? "Please select a package." : "Please describe your custom request.";
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
        setSelectedPackage(""); setCustomOrder(""); setName(""); setFacebookName("");
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

        const selectedBranchId =
            selectedPackageData?.branch_id ||
            selectedPackageData?.branchId ||
            null;

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
            customOrder: bookingType === "custom" ? customOrder.trim() : "",
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
            <div className="flex min-h-screen items-center justify-center bg-[#f5f7fb]">
                <div className="text-lg font-medium text-gray-500">Loading store...</div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-[#f5f7fb]">
                <div className="rounded-2xl bg-white p-8 text-red-500 shadow">{error}</div>
            </div>
        );
    }

    if (!store) {
        return <div className="flex min-h-screen items-center justify-center bg-[#f5f7fb]">Store not found</div>;
    }

    return (
        <div className="min-h-screen bg-[#f5f7fb]">

            {/* ── Topbar ── */}
            <div className="sticky top-0 z-50 border-b border-gray-200 bg-white/90 backdrop-blur">
                <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
                    <div>
                        <h1 className="text-2xl font-bold text-[#1f2a44]">{store.store_name}</h1>
                        <p className="text-sm text-gray-500">Event Packages & Booking</p>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setShowStatusDrawer((v) => !v)}
                            className={`flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition ${
                                showStatusDrawer
                                    ? "border-purple-400 bg-purple-600 text-white"
                                    : "border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100"
                            }`}
                        >
                            <Search size={15} />
                            Check booking status
                        </button>
                        <button
                            onClick={() => window.history.back()}
                            className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                        >
                            Back
                        </button>
                    </div>
                </div>
            </div>

            {/* ── Inline Status Drawer ── */}
            {showStatusDrawer && <StatusDrawer storeId={store.id} onClose={() => setShowStatusDrawer(false)} />}

            {/* ── Packages ── */}
            <section ref={packageRef} className="mx-auto max-w-7xl px-6 py-8">
                <div className="mb-8 flex flex-wrap gap-3">
                    {categories.map((category) => {
                        const active = activeCategory === category;
                        return (
                            <button
                                key={category}
                                onClick={() => setActiveCategory(category)}
                                className={`rounded-full px-5 py-2 text-sm font-medium transition ${
                                    active
                                        ? "bg-purple-600 text-white shadow-lg shadow-purple-200"
                                        : "border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                                }`}
                            >
                                {category}
                            </button>
                        );
                    })}
                    <button className="flex items-center gap-2 rounded-full border border-gray-200 bg-white px-5 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">
                        More <ChevronDown size={16} />
                    </button>
                </div>

                <div className="mb-8">
                    <div className="flex items-center gap-3">
                        <h2 className="text-3xl font-bold text-[#1f2a44]">Packages</h2>
                        <span className="rounded-full bg-purple-100 px-3 py-1 text-sm font-semibold text-purple-700">
                            {filteredPackages.length}
                        </span>
                    </div>
                    <p className="mt-3 text-sm text-gray-500">
                        All packages may be customized based on your preferred theme, color motif, or design inspiration.
                        Final design details can be discussed with the store.
                    </p>
                </div>

                {filteredPackages.length === 0 ? (
                    <div className="rounded-3xl border border-dashed border-gray-300 bg-white p-14 text-center shadow-sm">
                        <div className="mb-4 flex justify-center"><Sparkles className="text-purple-500" size={42} /></div>
                        <h3 className="text-xl font-bold text-[#1f2a44]">No packages found</h3>
                        <p className="mt-2 text-gray-500">Try another category or create a custom request below.</p>
                    </div>
                ) : (
                    <div className="grid gap-7 md:grid-cols-2 xl:grid-cols-4">
                        {filteredPackages.map((pkg, index) => (
                            <div key={pkg.id} className="group overflow-hidden rounded-[28px] border border-gray-200 bg-white shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-xl">
                                <div className="relative h-52 overflow-hidden">
                                    <img
                                        src={`https://picsum.photos/600/400?random=${index}`}
                                        alt={pkg.name}
                                        className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                                    />
                                    <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
                                    <div className="absolute left-4 top-4">
                                        <span className="rounded-full bg-green-500 px-3 py-1 text-xs font-semibold text-white shadow">Active</span>
                                    </div>
                                    <button className="absolute right-4 top-4 rounded-xl bg-white/90 p-2 shadow transition hover:bg-white">
                                        <MoreVertical size={18} className="text-gray-700" />
                                    </button>
                                </div>
                                <div className="p-5">
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <h3 className="text-xl font-bold text-[#1f2a44]">{pkg.name}</h3>
                                            <p className="mt-2 text-3xl font-bold text-purple-600">{peso(pkg.package_price)}</p>
                                        </div>
                                        <span className="rounded-full bg-purple-100 px-3 py-1 text-xs font-semibold text-purple-700">
                                            {pkg.category || "Event"}
                                        </span>
                                    </div>
                                    <p className="mt-4 line-clamp-2 text-sm leading-relaxed text-gray-500">
                                        {pkg.description || "Elegant event package setup for memorable celebrations."}
                                    </p>
                                    <div className="mt-5 flex items-center gap-5 border-t border-gray-100 pt-5 text-sm text-gray-500">
                                        <div className="flex items-center gap-2"><Package2 size={16} /><span>{pkg.inclusions.length} Items</span></div>
                                        <div className="flex items-center gap-2"><Clock3 size={16} /><span>{pkg.duration}</span></div>
                                    </div>
                                    <div className="mt-6 grid grid-cols-2 gap-3">
                                        <button onClick={() => setDetailsPackage(pkg)} className="rounded-xl bg-purple-600 py-3 text-sm font-semibold text-white transition hover:bg-purple-700">
                                            View Details
                                        </button>
                                        <button onClick={() => handleSelectPackage(pkg)} className="rounded-xl border border-purple-500 py-3 text-sm font-semibold text-purple-600 transition hover:bg-purple-50">
                                            Select
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            {/* ── Booking Form ── */}
            <section className="px-6 pb-16">
                <div ref={formRef} className="mx-auto max-w-5xl overflow-hidden rounded-[32px] border border-gray-200 bg-white shadow-sm">
                    <div className="border-b border-gray-100 px-8 py-7">
                        <h2 className="text-3xl font-bold text-[#1f2a44]">Book Your Event</h2>
                        <p className="mt-2 text-gray-500">
                            This form is for sure booking requests. After submission, you will receive a booking
                            reference number that you can use for follow-ups and status checking.
                        </p>
                    </div>

                    {showSuccess ? (
                        <div className="px-8 py-20 text-center">
                            <div className="mb-5 flex justify-center">
                                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-green-100">
                                    <Check size={40} className="text-green-600" />
                                </div>
                            </div>
                            <h3 className="text-3xl font-bold text-[#1f2a44]">Booking Request Submitted!</h3>
                            <p className="mt-3 text-gray-500">
                                Save your booking reference number below. You can check your status anytime using the
                                <strong className="text-purple-700"> Check booking status</strong> button at the top.
                            </p>

                            <div className="mx-auto mt-8 max-w-md rounded-3xl border border-purple-100 bg-purple-50 p-6">
                                <p className="text-sm font-semibold text-gray-500">Booking Reference No.</p>
                                <div className="mt-3 flex items-center justify-center gap-3">
                                    <p className="text-2xl font-black tracking-wide text-purple-700">{bookingReference}</p>
                                    <button
                                        onClick={copyReference}
                                        className="rounded-xl bg-white p-2 text-purple-600 shadow-sm hover:bg-purple-100"
                                        title="Copy reference number"
                                    >
                                        <Copy size={18} />
                                    </button>
                                </div>
                            </div>

                            <div className="mx-auto mt-6 max-w-lg rounded-2xl bg-gray-50 p-5 text-sm text-gray-600">
                                Your booking is now in the store&apos;s admin system for review. The store can confirm,
                                prepare, complete, or cancel the booking from their admin dashboard.
                            </div>

                            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
                                <button
                                    onClick={() => { setShowStatusDrawer(true); setShowSuccess(false); setBookingReference(""); }}
                                    className="rounded-xl border border-purple-300 bg-white px-6 py-3 font-medium text-purple-700 hover:bg-purple-50"
                                >
                                    Check Booking Status
                                </button>
                                <a
                                    href={`https://m.me/${STORE_MESSENGER}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="rounded-xl bg-purple-600 px-6 py-3 font-medium text-white hover:bg-purple-700"
                                >
                                    Continue on Messenger
                                </a>
                            </div>

                            <button
                                onClick={() => { setShowSuccess(false); setBookingReference(""); }}
                                className="mt-8 text-sm font-medium text-gray-400 underline hover:text-gray-600"
                            >
                                Submit another booking
                            </button>
                        </div>
                    ) : (
                        <div className="grid gap-10 p-8 lg:grid-cols-[1fr_380px]">

                            {/* ── Top error banner ── */}
                            {Object.keys(fieldErrors).some((k) => fieldErrors[k]) && (
                                <div className="col-span-full rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm font-medium text-red-600">
                                    Please fix the highlighted fields before submitting.
                                </div>
                            )}

                            <div>
                                {/* Booking Type */}
                                <div>
                                    <label className="mb-3 block text-sm font-semibold text-gray-700">Booking Type</label>
                                    <div className="grid grid-cols-2 gap-3">
                                        <button
                                            type="button"
                                            onClick={() => { setBookingType("package"); clearError("selection"); }}
                                            className={`rounded-2xl border p-4 text-left transition ${bookingType === "package" ? "border-purple-500 bg-purple-50" : "border-gray-200 bg-white"}`}
                                        >
                                            <div className="font-semibold text-[#1f2a44]">Package Booking</div>
                                            <div className="mt-1 text-sm text-gray-500">Select from available packages</div>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => { setBookingType("custom"); clearError("selection"); }}
                                            className={`rounded-2xl border p-4 text-left transition ${bookingType === "custom" ? "border-purple-500 bg-purple-50" : "border-gray-200 bg-white"}`}
                                        >
                                            <div className="font-semibold text-[#1f2a44]">Custom Request</div>
                                            <div className="mt-1 text-sm text-gray-500">Personalized event setup</div>
                                        </button>
                                    </div>
                                </div>

                                {/* Package / Custom */}
                                <div className="mt-6">
                                    {bookingType === "package" ? (
                                        <>
                                            <label className="mb-3 block text-sm font-semibold text-gray-700">Select Package</label>
                                            <select
                                                value={selectedPackage}
                                                onChange={(e) => { setSelectedPackage(e.target.value); clearError("selection"); }}
                                                className={`w-full rounded-2xl border bg-white p-4 text-gray-700 outline-none transition focus:border-purple-400 ${
                                                    fieldErrors.selection ? "border-red-400 bg-red-50" : "border-gray-200"
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
                                            <label className="mb-3 block text-sm font-semibold text-gray-700">Custom Request</label>
                                            <textarea
                                                value={customOrder}
                                                onChange={(e) => { setCustomOrder(e.target.value); clearError("selection"); }}
                                                placeholder="Describe your custom event setup request..."
                                                className={`min-h-[140px] w-full resize-none rounded-2xl border p-4 outline-none transition focus:border-purple-400 ${
                                                    fieldErrors.selection ? "border-red-400 bg-red-50" : "border-gray-200"
                                                }`}
                                            />
                                            {fieldErrors.selection && (
                                                <p className="mt-1.5 text-xs font-medium text-red-500">{fieldErrors.selection}</p>
                                            )}
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
                                        <label className="mb-3 block text-sm font-semibold text-gray-700">Event Date</label>
                                        <div className="relative">
                                            <CalendarDays size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                                            <input
                                                type="date"
                                                value={date}
                                                onChange={(e) => { setDate(e.target.value); clearError("date"); }}
                                                className={`w-full rounded-2xl border py-4 pl-12 pr-4 outline-none transition focus:border-purple-400 ${
                                                    fieldErrors.date ? "border-red-400 bg-red-50" : "border-gray-200"
                                                }`}
                                            />
                                        </div>
                                        {fieldErrors.date && (
                                            <p className="mt-1.5 text-xs font-medium text-red-500">{fieldErrors.date}</p>
                                        )}
                                    </div>

                                    {/* Event Time */}
                                    <div>
                                        <label className="mb-3 block text-sm font-semibold text-gray-700">Event Time</label>
                                        <input
                                            type="time"
                                            value={eventTime}
                                            onChange={(e) => { setEventTime(e.target.value); clearError("eventTime"); }}
                                            className={`w-full rounded-2xl border p-4 outline-none transition focus:border-purple-400 ${
                                                fieldErrors.eventTime ? "border-red-400 bg-red-50" : "border-gray-200"
                                            }`}
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
                                    <label className="mb-3 block text-sm font-semibold text-gray-700">Theme / Motif Request</label>
                                    <textarea
                                        value={theme}
                                        onChange={(e) => { setTheme(e.target.value); clearError("theme"); }}
                                        placeholder="Example: pastel pink, safari, princess, floral, minimalist, blue and gold..."
                                        className={`min-h-[120px] w-full resize-none rounded-2xl border p-4 outline-none transition focus:border-purple-400 ${
                                            fieldErrors.theme ? "border-red-400 bg-red-50" : "border-gray-200"
                                        }`}
                                    />
                                    {fieldErrors.theme && (
                                        <p className="mt-1.5 text-xs font-medium text-red-500">{fieldErrors.theme}</p>
                                    )}
                                    <p className="mt-2 text-xs text-gray-500">
                                        You may request any theme, color motif, or design inspiration. Final design can be confirmed with the store.
                                    </p>
                                </div>

                                {/* Notes */}
                                <div className="mt-6">
                                    <label className="mb-3 block text-sm font-semibold text-gray-700">Additional Notes</label>
                                    <textarea
                                        value={notes}
                                        onChange={(e) => setNotes(e.target.value)}
                                        placeholder="Additional requests, backdrop text, celebrant name, age, delivery notes..."
                                        className="min-h-[120px] w-full resize-none rounded-2xl border border-gray-200 p-4 outline-none transition focus:border-purple-400"
                                    />
                                </div>
                            </div>

                            {/* Booking Summary Sidebar */}
                            <div>
                                <div className="sticky top-24 rounded-[28px] border border-purple-100 bg-gradient-to-br from-purple-50 to-pink-50 p-6">
                                    <h3 className="text-2xl font-bold text-[#1f2a44]">Booking Summary</h3>
                                    <div className="mt-6 space-y-5">
                                        <SummaryItem label="Booking Type" value={bookingType === "package" ? "Package Booking" : "Custom Request"} />
                                        {selectedPackage && <SummaryItem label="Package" value={selectedPackage} />}
                                        {customOrder && bookingType === "custom" && <SummaryItem label="Custom Request" value={customOrder} />}
                                        {name && <SummaryItem label="Customer" value={name} />}
                                        {facebookName && <SummaryItem label="Messenger Name" value={facebookName} />}
                                        {bookingType === "custom" && eventType && <SummaryItem label="Event Type" value={eventType} />}
                                        {theme && <SummaryItem label="Theme / Motif" value={theme} />}
                                        {venue && <SummaryItem label="Venue" value={venue} />}
                                        {date && <SummaryItem label="Date" value={date} />}
                                        {eventTime && <SummaryItem label="Event Time" value={eventTime} />}
                                        <div className="border-t border-purple-100 pt-5">
                                            <p className="text-sm font-semibold text-[#1f2a44]">After submission</p>
                                            <p className="mt-2 text-xs leading-relaxed text-gray-500">
                                                You will receive a booking reference number. Use the{" "}
                                                <span className="font-semibold text-purple-700">Check booking status</span>{" "}
                                                button at the top to track your booking anytime.
                                            </p>
                                        </div>
                                    </div>

                                    <a
                                        href={`https://m.me/${STORE_MESSENGER}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="mt-8 block w-full rounded-2xl border border-purple-200 bg-white py-3 text-center font-semibold text-purple-700 transition hover:bg-purple-100"
                                    >
                                        Continue on Messenger
                                    </a>
                                    <button
                                        onClick={handleSubmit}
                                        disabled={submitting}
                                        className="mt-4 w-full rounded-2xl bg-gradient-to-r from-purple-600 to-pink-500 py-4 text-sm font-semibold text-white shadow-lg shadow-purple-200 transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        {submitting ? "Submitting..." : "Submit Booking Request"}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </section>

            {/* ── Package Details Modal ── */}
            {detailsPackage && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-4">
                    <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-[28px] bg-white p-6 shadow-2xl">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <h2 className="text-2xl font-bold text-[#1f2a44]">{detailsPackage.name}</h2>
                                <p className="mt-2 text-3xl font-bold text-purple-600">{peso(detailsPackage.package_price)}</p>
                            </div>
                            <button onClick={() => setDetailsPackage(null)} className="rounded-full bg-gray-100 p-2 text-gray-600 hover:bg-gray-200">
                                <X size={20} />
                            </button>
                        </div>
                        <p className="mt-5 text-sm leading-relaxed text-gray-600">{detailsPackage.description || "No description provided."}</p>
                        <div className="mt-6 rounded-2xl bg-gray-50 p-4 text-sm text-gray-600">
                            <span className="font-semibold text-[#1f2a44]">Duration:</span> {detailsPackage.duration || "Not set"}
                        </div>
                        <div className="mt-7">
                            <h3 className="mb-4 text-lg font-bold text-[#1f2a44]">Package Inclusions</h3>
                            {detailsPackage.inclusions.length === 0 ? (
                                <p className="rounded-2xl bg-gray-50 p-4 text-sm text-gray-500">No inclusions listed.</p>
                            ) : (
                                <div className="space-y-3">
                                    {detailsPackage.inclusions.map((item) => (
                                        <div key={item.productId} className="rounded-2xl border border-gray-200 p-4">
                                            <p className="font-semibold text-[#1f2a44]">{item.productName}</p>
                                            <p className="mt-1 text-sm text-gray-500">Included quantity: {item.quantity}</p>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                        <p className="mt-6 rounded-2xl bg-purple-50 p-4 text-sm text-gray-600">
                            Theme and color motif are customizable per booking. Please include your preferred theme in the booking form.
                        </p>
                        <button
                            onClick={() => { handleSelectPackage(detailsPackage); setDetailsPackage(null); }}
                            className="mt-8 w-full rounded-2xl bg-purple-600 py-4 font-semibold text-white hover:bg-purple-700"
                        >
                            Select This Package
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function Input({ label, value, onChange, placeholder, error }: {
    label: string; value: string; onChange: (v: string) => void; placeholder?: string; error?: string;
}) {
    return (
        <div>
            <label className="mb-3 block text-sm font-semibold text-gray-700">{label}</label>
            <input
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                className={`w-full rounded-2xl border p-4 outline-none transition focus:border-purple-400 ${
                    error ? "border-red-400 bg-red-50" : "border-gray-200"
                }`}
            />
            {error && <p className="mt-1.5 text-xs font-medium text-red-500">{error}</p>}
        </div>
    );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-start justify-between gap-5">
            <span className="text-sm font-medium text-gray-500">{label}</span>
            <span className="text-right text-sm font-semibold text-[#1f2a44]">{value}</span>
        </div>
    );
}




