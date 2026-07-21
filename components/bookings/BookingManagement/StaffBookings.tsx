"use client";

import { useEffect, useMemo, useState } from "react";
import {
    BadgeCheck,
    CalendarDays,
    CircleDollarSign,
    RefreshCw,
    Search,
    Wallet,
} from "lucide-react";
import {
    Booking,
    BookingAccess,
    CalendarDropdown,
    FilterType,
    TABS,
    BookingRow,
    PriceModal,
    dateKey,
    formatDate,
    getAmountPaid,
    getBalance,
    getBranchGroupName,
    getRequiredDownPayment,
    getSavedBookingAccess,
    getTotalPrice,
    normalizeBooking,
    peso,
} from "./_shared";

type BookingInventoryItem = {
    id: number;
    booking_id?: number;
    source_type?: string;
    product_id?: number;
    variant_id?: number | null;
    product_name: string;
    variant_name?: string | null;
    booked_quantity: number | string;
    reserved_quantity: number | string;
    used_quantity?: number | string;
    restored_quantity?: number | string;
    unit_price?: number | string;
    inventory_status?: string;
};

type CancelUsedItem = {
    booking_item_id: number;
    used_quantity: number;
};

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


export default function StaffBookings() {
    const [bookings, setBookings] = useState<Booking[]>([]);
    const [branchName, setBranchName] = useState("Assigned Branch");
    const [loading, setLoading] = useState(true);
    const [access, setAccess] = useState<BookingAccess>("none");

    const [filter, setFilter] = useState<FilterType>("All");
    const [search, setSearch] = useState("");
    const [selectedDate, setSelectedDate] = useState("");
    const [calendarOpen, setCalendarOpen] = useState(false);
    const [priceModal, setPriceModal] = useState<Booking | null>(null);
    const [calendarMonth, setCalendarMonth] = useState(() => new Date());
    const [currentDateTime, setCurrentDateTime] = useState<Date | null>(null);
    const [cancelModal, setCancelModal] = useState<Booking | null>(null);
    const [cancelItems, setCancelItems] = useState<BookingInventoryItem[]>([]);
    const [cancelUsedQty, setCancelUsedQty] = useState<Record<number, number>>({});
    const [cancelLoading, setCancelLoading] = useState(false);
    const [cancelSubmitting, setCancelSubmitting] = useState(false);
    const [cancelError, setCancelError] = useState("");

    const canView = access === "view" || access === "full";
    const canManage = access === "full";

    function getToken() {
        return sessionStorage.getItem("token");
    }

    function getBranchId() {
        return (
            sessionStorage.getItem("branch_id") ||
            sessionStorage.getItem("stocknbook_branch_id") ||
            sessionStorage.getItem("staff_branch_id") ||
            sessionStorage.getItem("manager_branch_id")
        );
    }

    function getStoreId() {
        return (
            sessionStorage.getItem("store_id") ||
            sessionStorage.getItem("stocknbook_store_id")
        );
    }

    function getSavedBranchName() {
        return (
            sessionStorage.getItem("branch_name") ||
            sessionStorage.getItem("stocknbook_branch_name") ||
            sessionStorage.getItem("staff_branch_name") ||
            "Assigned Branch"
        );
    }

    async function loadBookings() {
        setLoading(true);

        const savedAccess = getSavedBookingAccess("staff");
        setAccess(savedAccess);

        const token = getToken();
        const storeId = getStoreId();
        const branchId = getBranchId();
        const savedBranchName = getSavedBranchName();

        setBranchName(savedBranchName);

        if (savedAccess === "none") {
            setBookings([]);
            setLoading(false);
            return;
        }

        if (!token || !storeId || !branchId) {
            setBookings([]);
            setLoading(false);
            return;
        }

        try {
            const res = await fetch("/api/bookings", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    action: "get_booking_page_bookings",
                    store_id: Number(storeId),
                    branch_id: Number(branchId),
                    role: "staff",
                }),
                cache: "no-store",
            });

            const data = await res.json();

            if (!res.ok || data.success === false) {
                console.error("Bookings load failed:", data);
                setBookings([]);
                return;
            }

            const normalizedBookings = (data.bookings || []).map(
                (b: Record<string, unknown>) => normalizeBooking(b, savedBranchName)
            );

            setBookings(normalizedBookings);

            const firstBookingDate = normalizedBookings.find((b: Booking) =>
                dateKey(b.date)
            );

            if (firstBookingDate) {
                const key = dateKey(firstBookingDate.date);
                setCalendarMonth(new Date(`${key}T00:00:00`));
            }
        } catch (err) {
            console.error("Bookings load failed:", err);
            setBookings([]);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        void loadBookings();
    }, []);


    useEffect(() => {
        const updateDateTime = () => setCurrentDateTime(new Date());

        updateDateTime();
        const timer = window.setInterval(updateDateTime, 30_000);

        return () => {
            window.clearInterval(timer);
        };
    }, []);

    async function updateStatus(
        id: number,
        newStatus: string,
        price?: number,
        usedItems?: CancelUsedItem[]
    ) {

        if (!canManage) return;

        const token = getToken();
        const branchId = getBranchId();

        try {
            const body: Record<string, unknown> = {
                action: "update_status",
                booking_id: id,
                status: newStatus,
            };

            if (branchId) body.branch_id = Number(branchId);
            if (price !== undefined) body.agreed_price = price;
            if (usedItems) body.used_items = usedItems;

            const res = await fetch("/api/bookings", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify(body),
            });

            const data = await res.json();

            if (!res.ok || data.success === false) {
                throw new Error(data.message || "Failed to update booking status.");
            }

            setBookings((prev) =>
                prev.map((b) =>
                    b.id === id
                        ? {
                            ...b,
                            status: newStatus,
                            ...(price !== undefined
                                ? {
                                    agreed_price: price,
                                    agreedPrice: price,
                                }
                                : {}),
                        }
                        : b
                )
            );
        } catch (err) {
            console.error("Failed to update booking status:", err);
            throw err;
        }
    }

    async function openCancelModal(booking: Booking) {
        if (!canManage) return;

        const token = getToken();
        const branchId = getBranchId();

        setCancelModal(booking);
        setCancelItems([]);
        setCancelUsedQty({});
        setCancelError("");
        setCancelLoading(true);

        try {
            const body: Record<string, unknown> = {
                action: "get_booking_items",
                booking_id: booking.id,
            };

            if (branchId) body.branch_id = Number(branchId);

            const res = await fetch("/api/bookings", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify(body),
            });

            const data = await res.json();

            if (!res.ok || data.success === false) {
                throw new Error(data.message || data.error || "Failed to load booking items.");
            }

            const items = Array.isArray(data.items) ? data.items : [];

            setCancelItems(items);

            const initialUsed: Record<number, number> = {};
            items.forEach((item: BookingInventoryItem) => {
                initialUsed[Number(item.id)] = 0;
            });

            setCancelUsedQty(initialUsed);
        } catch (err) {
            console.error("Failed to load booking items:", err);
            setCancelError("Failed to load booking items. Please try again.");
        } finally {
            setCancelLoading(false);
        }
    }

    async function confirmCancelBooking() {
        if (!cancelModal || !canManage) return;

        setCancelSubmitting(true);
        setCancelError("");

        try {
            const usedItems: CancelUsedItem[] = cancelItems.map((item) => {
                const itemId = Number(item.id);
                const reservedQty = Number(item.reserved_quantity || 0);
                const usedQty = Math.max(
                    0,
                    Math.min(Number(cancelUsedQty[itemId] || 0), reservedQty)
                );

                return {
                    booking_item_id: itemId,
                    used_quantity: usedQty,
                };
            });

            await updateStatus(cancelModal.id, "Cancelled", undefined, usedItems);

            setCancelModal(null);
            setCancelItems([]);
            setCancelUsedQty({});
        } catch (err) {
            console.error("Failed to cancel booking:", err);
            setCancelError("Failed to cancel booking. Please check the used quantities and try again.");
        } finally {
            setCancelSubmitting(false);
        }
    }

    async function updateCustomPaymentTerms(
        booking: Booking,
        agreedPrice: number,
        requiredDownPayment: number
    ) {
        if (!canManage) return;

        const token = getToken();
        const branchId = getBranchId();

        try {
            const body: Record<string, unknown> = {
                action: "update_price",
                booking_id: booking.id,
                agreed_price: agreedPrice,
                required_down_payment: requiredDownPayment,
            };

            if (branchId) body.branch_id = Number(branchId);

            const res = await fetch("/api/bookings", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify(body),
            });

            const data = await res.json();

            if (!res.ok || data.success === false) {
                throw new Error(data.message || "Failed to update custom payment terms.");
            }

            const currentPaid = getAmountPaid(booking);
            const newBalance = Math.max(agreedPrice - currentPaid, 0);

            setBookings((prev) =>
                prev.map((b) =>
                    b.id === booking.id
                        ? {
                            ...b,
                            agreed_price: agreedPrice,
                            agreedPrice: agreedPrice,
                            required_down_payment: requiredDownPayment,
                            requiredDownPayment: requiredDownPayment,
                            balance: newBalance,
                            payment_status:
                                currentPaid >= agreedPrice
                                    ? "Fully Paid"
                                    : currentPaid >= requiredDownPayment
                                        ? "Down Payment Paid"
                                        : currentPaid > 0
                                            ? "Partial"
                                            : "Down Payment Required",
                        }
                        : b
                )
            );
        } catch (err) {
            console.error("Failed to update custom payment terms:", err);
        }
    }

    async function handlePriceConfirm(
        agreedPrice: number,
        requiredDownPayment: number
    ) {
        if (!priceModal) return;

        await updateCustomPaymentTerms(
            priceModal,
            agreedPrice,
            requiredDownPayment
        );

        setPriceModal(null);
    }

    async function recordDownPayment(booking: Booking) {
        if (!canManage) return;

        const token = getToken();
        const branchId = getBranchId();

        const total = getTotalPrice(booking);
        const requiredDp = getRequiredDownPayment(booking);

        if (total <= 0 || requiredDp <= 0) {
            console.error(
                "Cannot record down payment. Missing total price or required down payment."
            );
            return;
        }

        const currentPaid = getAmountPaid(booking);
        const newAmountPaid = Math.max(currentPaid, requiredDp);
        const newBalance = Math.max(total - newAmountPaid, 0);

        try {
            const body: Record<string, unknown> = {
                action: "update_payment",
                booking_id: booking.id,
                amount_paid: newAmountPaid,
                balance: newBalance,
                payment_status: "Down Payment Paid",
            };

            if (branchId) body.branch_id = Number(branchId);

            const res = await fetch("/api/bookings", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify(body),
            });

            const data = await res.json();

            if (!res.ok || data.success === false) {
                throw new Error(data.message || "Failed to record down payment.");
            }

            setBookings((prev) =>
                prev.map((b) =>
                    b.id === booking.id
                        ? {
                            ...b,
                            amount_paid: newAmountPaid,
                            amountPaid: newAmountPaid,
                            balance: newBalance,
                            payment_status: "Down Payment Paid",
                            paymentStatus: "Down Payment Paid",
                            status:
                                b.status === "Pending Review" ||
                                b.status === "Awaiting Down Payment"
                                    ? "Confirmed"
                                    : b.status,
                        }
                        : b
                )
            );
        } catch (err) {
            console.error("Failed to record down payment:", err);
        }
    }

    async function markFullyPaid(booking: Booking) {
        if (!canManage) return;

        const token = getToken();
        const branchId = getBranchId();

        const total = getTotalPrice(booking);

        if (total <= 0) {
            console.error("Cannot mark fully paid. Missing total price.");
            return;
        }

        try {
            const body: Record<string, unknown> = {
                action: "update_payment",
                booking_id: booking.id,
                amount_paid: total,
                balance: 0,
                payment_status: "Fully Paid",
            };

            if (branchId) body.branch_id = Number(branchId);

            const res = await fetch("/api/bookings", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify(body),
            });

            const data = await res.json();

            if (!res.ok || data.success === false) {
                throw new Error(data.message || "Failed to mark booking as fully paid.");
            }

            setBookings((prev) =>
                prev.map((b) =>
                    b.id === booking.id
                        ? {
                            ...b,
                            amount_paid: total,
                            amountPaid: total,
                            balance: 0,
                            payment_status: "Fully Paid",
                            paymentStatus: "Fully Paid",
                        }
                        : b
                )
            );
        } catch (err) {
            console.error("Failed to mark fully paid:", err);
        }
    }

    const bookingDateCounts = useMemo(() => {
        const map: Record<string, number> = {};

        bookings.forEach((booking) => {
            const key = dateKey(booking.date);
            if (!key) return;

            map[key] = (map[key] || 0) + 1;
        });

        return map;
    }, [bookings]);

    const filtered = useMemo(() => {
        return bookings
            .filter((b) => filter === "All" || b.status === filter)
            .filter((b) => !selectedDate || dateKey(b.date) === selectedDate)
            .filter((b) => {
                if (!search) return true;

                const q = search.toLowerCase();

                return (
                    b.name.toLowerCase().includes(q) ||
                    b.bookingReference?.toLowerCase().includes(q) ||
                    b.phone?.includes(q) ||
                    b.facebookName?.toLowerCase().includes(q) ||
                    getBranchGroupName(b).toLowerCase().includes(q) ||
                    b.customOrder?.toLowerCase().includes(q) ||
                    b.custom_order?.toLowerCase().includes(q) ||
                    b.package?.toLowerCase().includes(q) ||
                    b.packageName?.toLowerCase().includes(q) ||
                    b.package_name?.toLowerCase().includes(q) ||
                    b.eventType?.toLowerCase().includes(q) ||
                    b.event_type?.toLowerCase().includes(q) ||
                    b.theme?.toLowerCase().includes(q) ||
                    b.venue?.toLowerCase().includes(q)
                );
            });
    }, [bookings, filter, selectedDate, search]);

    const counts = TABS.reduce((acc, tab) => {
        acc[tab] =
            tab === "All"
                ? bookings.length
                : bookings.filter((b) => b.status === tab).length;

        return acc;
    }, {} as Record<string, number>);

    const bookingSales = bookings
        .filter((b) => b.status !== "Cancelled")
        .reduce((sum, b) => sum + getTotalPrice(b), 0);

    const bookingRevenue = bookings
        .filter((b) => b.status !== "Cancelled")
        .reduce((sum, b) => sum + getAmountPaid(b), 0);

    const outstandingBalance = bookings
        .filter((b) => b.status !== "Cancelled")
        .reduce((sum, b) => sum + getBalance(b), 0);

    const completedBookings = bookings.filter(
        (b) => b.status === "Completed"
    ).length;

    const selectedDateCount = selectedDate
        ? bookingDateCounts[selectedDate] || 0
        : 0;

    return (
        <>
            <header className="sticky top-0 z-20 border-b border-[#E9E0EF] bg-[#FFFDF8]/95 font-sans backdrop-blur">
                <div className="flex min-h-[72px] flex-wrap items-center justify-between gap-4 px-6 py-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-3">
                        <h1 className="text-[25px] font-bold text-[#1A1220]">
                            Bookings
                        </h1>

                        <span
                            title={branchName}
                            className="max-w-[220px] truncate rounded-lg bg-[#EFE8F8] px-3.5 py-1.5 text-sm font-medium text-[#4E2C66]"
                        >
                            {branchName}
                        </span>

                        {access === "view" && (
                            <span className="rounded-lg border border-[#E6DDF0] bg-white px-3.5 py-1.5 text-xs font-semibold text-[#5F4E75]">
                                View only
                            </span>
                        )}
                    </div>

                    <div className="flex items-center gap-2.5">
                        <span className="inline-flex h-[42px] items-center rounded-xl border border-[#E6DDF0] bg-white px-3.5 text-sm font-semibold text-[#2B174C] shadow-sm">
                            {currentDateTime
                                ? formatCurrentDateTime(currentDateTime)
                                : "Loading date..."}
                        </span>

                        <button
                            onClick={() => void loadBookings()}
                            disabled={loading}
                            aria-label="Refresh bookings"
                            title="Refresh bookings"
                            className="inline-flex h-[42px] items-center gap-2 rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31] disabled:cursor-not-allowed disabled:opacity-60"
                            type="button"
                        >
                            <RefreshCw
                                size={16}
                                className={loading ? "animate-spin" : ""}
                            />
                            Refresh
                        </button>
                    </div>
                </div>
            </header>

            <section className="px-6 py-4">
                {loading ? (
                    <div className="rounded-[14px] border border-[#E6DDF0] bg-white px-4 py-10 text-center text-sm text-[#9B8AAA] shadow-sm">
                        Loading bookings...
                    </div>
                ) : !canView ? (
                    <div className="rounded-[14px] border border-[#E6DDF0] bg-white px-4 py-10 text-center shadow-sm">
                        <p className="text-sm font-bold text-[#1A1220]">
                            No booking access
                        </p>
                        <p className="mt-1 text-sm text-[#7A6A84]">
                            Your staff account does not have permission to view bookings.
                        </p>
                    </div>
                ) : (
                    <>
                        <div className="mb-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                            <CompactMetricCard
                                title="Booking Sales"
                                value={peso(bookingSales)}
                                subLabel="Revenue"
                                subValue={peso(bookingRevenue)}
                                icon={<CircleDollarSign size={18} strokeWidth={1.9} />}
                                iconClassName="bg-[#F0E9FF] text-[#5A35A5]"
                            />

                            <CompactMetricCard
                                title="Outstanding Balance"
                                value={peso(outstandingBalance)}
                                icon={<Wallet size={18} strokeWidth={1.9} />}
                                iconClassName="bg-[#FFF3D8] text-[#9A6200]"
                                valueClassName="text-[#A56607]"
                            />

                            <CompactMetricCard
                                title="Completed Bookings"
                                value={String(completedBookings)}
                                icon={<BadgeCheck size={18} strokeWidth={1.9} />}
                                iconClassName="bg-[#EAF8EF] text-[#168A48]"
                                valueClassName="text-[#168A48]"
                            />
                        </div>

                        <div className="mb-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
                            <div className="relative">
                                <Search
                                    size={15}
                                    className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9B8AAA]"
                                />

                                <input
                                    value={search}
                                    onChange={(event) => setSearch(event.target.value)}
                                    placeholder="Search bookings, package, client..."
                                    className="h-[42px] w-full rounded-xl border border-[#E3D8EA] bg-white px-4 pl-10 text-sm text-[#1A1220] outline-none shadow-sm placeholder:text-[#9B8AAA] transition focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10"
                                />
                            </div>

                            <div className="relative">
                                <button
                                    onClick={() => setCalendarOpen((value) => !value)}
                                    disabled={!canView}
                                    className="inline-flex h-[42px] w-full items-center justify-center gap-2 rounded-xl border border-[#E6DDF0] bg-white px-3.5 text-sm font-semibold text-[#2B174C] shadow-sm transition hover:bg-[#F7F1FF] disabled:cursor-not-allowed disabled:opacity-60 lg:w-auto"
                                    type="button"
                                >
                                    <CalendarDays size={15} />
                                    {selectedDate
                                        ? formatDate(selectedDate)
                                        : "Filter by date"}
                                </button>

                                {calendarOpen && canView && (
                                    <CalendarDropdown
                                        month={calendarMonth}
                                        bookingDateCounts={bookingDateCounts}
                                        selectedDate={selectedDate}
                                        onChangeMonth={setCalendarMonth}
                                        onSelectDate={(key) => {
                                            setSelectedDate(key);
                                            setCalendarOpen(false);
                                        }}
                                    />
                                )}
                            </div>
                        </div>

                        <div className="mb-3 flex flex-wrap gap-2.5">
                            {TABS.map((tab) => (
                                <button
                                    key={tab}
                                    onClick={() => setFilter(tab)}
                                    className={`rounded-xl px-3.5 py-2.5 text-[11px] font-semibold transition ${
                                        filter === tab
                                            ? "bg-[#2B174C] text-white shadow-sm"
                                            : "border border-[#E6DDF0] bg-white text-[#2B174C] hover:bg-[#F7F1FF]"
                                    }`}
                                    type="button"
                                >
                                    {tab}

                                    {counts[tab] > 0 && (
                                        <span
                                            className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[9px] ${
                                                filter === tab
                                                    ? "bg-white/20 text-white"
                                                    : "bg-[#EFE8F8] text-[#5F4E75]"
                                            }`}
                                        >
                                            {counts[tab]}
                                        </span>
                                    )}
                                </button>
                            ))}
                        </div>

                        {selectedDate && (
                            <div className="mb-3 flex flex-wrap items-center gap-2.5">
                                <div className="inline-flex items-center gap-2 rounded-xl bg-[#EFE8F8] px-3.5 py-2 text-xs font-semibold text-[#2B174C]">
                                    <CalendarDays size={14} />
                                    {formatDate(selectedDate)} — {selectedDateCount}{" "}
                                    {selectedDateCount === 1 ? "booking" : "bookings"}
                                </div>

                                <button
                                    onClick={() => setSelectedDate("")}
                                    className="rounded-xl border border-[#E6DDF0] bg-white px-3.5 py-2 text-xs font-semibold text-[#2B174C] hover:bg-[#F7F1FF]"
                                    type="button"
                                >
                                    Clear filter
                                </button>
                            </div>
                        )}

                        {filtered.length === 0 ? (
                            <div className="rounded-[14px] border border-[#E6DDF0] bg-white px-4 py-10 text-center text-sm text-[#9B8AAA] shadow-sm">
                                No bookings found.
                            </div>
                        ) : (
                            <div className="overflow-hidden rounded-[14px] border border-[#E6DDF0] bg-white shadow-sm">
                                <div className="max-h-[600px] overflow-y-auto overflow-x-auto">
                                    <table className="w-full min-w-[930px] border-collapse">
                                        <thead className="sticky top-0 z-10">
                                        <tr className="border-b border-[#E6DDF0] bg-white">
                                            <th className="px-3 py-3 text-left text-xs font-semibold text-[#806A8C]">
                                                Client
                                            </th>
                                            <th className="px-3 py-3 text-left text-xs font-semibold text-[#806A8C]">
                                                Schedule
                                            </th>
                                            <th className="px-3 py-3 text-left text-xs font-semibold text-[#806A8C]">
                                                Booking Selection
                                            </th>
                                            <th className="px-3 py-3 text-left text-xs font-semibold text-[#806A8C]">
                                                Payment
                                            </th>
                                            <th className="px-3 py-3 text-left text-xs font-semibold text-[#806A8C]">
                                                Status
                                            </th>
                                            <th className="px-3 py-3 text-right text-xs font-semibold text-[#806A8C]">
                                                Details
                                            </th>
                                        </tr>
                                        </thead>

                                        <tbody>
                                        {filtered.map((b) => (
                                            <BookingRow
                                                key={b.id}
                                                b={b}
                                                canManage={canManage}
                                                onUpdateStatus={canManage ? updateStatus : undefined}
                                                onSetPrice={canManage ? setPriceModal : undefined}
                                                onRecordDownPayment={
                                                    canManage ? recordDownPayment : undefined
                                                }
                                                onMarkFullyPaid={
                                                    canManage ? markFullyPaid : undefined
                                                }
                                                onCancelBooking={canManage ? openCancelModal : undefined}
                                            />
                                        ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </section>

            {priceModal && canManage && (
                <PriceModal
                    booking={priceModal}
                    onConfirm={handlePriceConfirm}
                    onClose={() => setPriceModal(null)}
                />
            )}

            {cancelModal && canManage && (
                <CancelInventoryModal
                    booking={cancelModal}
                    items={cancelItems}
                    usedQty={cancelUsedQty}
                    loading={cancelLoading}
                    submitting={cancelSubmitting}
                    error={cancelError}
                    onChangeUsedQty={(itemId: number, value: number) =>
                        setCancelUsedQty((prev) => ({
                            ...prev,
                            [itemId]: value,
                        }))
                    }
                    onClose={() => {
                        if (cancelSubmitting) return;
                        setCancelModal(null);
                        setCancelItems([]);
                        setCancelUsedQty({});
                        setCancelError("");
                    }}
                    onConfirm={confirmCancelBooking}
                />
            )}
        </>
    );
}

function CancelInventoryModal({
                                  booking,
                                  items,
                                  usedQty,
                                  loading,
                                  submitting,
                                  error,
                                  onChangeUsedQty,
                                  onClose,
                                  onConfirm,
                              }: {
    booking: Booking;
    items: BookingInventoryItem[];
    usedQty: Record<number, number>;
    loading: boolean;
    submitting: boolean;
    error: string;
    onChangeUsedQty: (itemId: number, value: number) => void;
    onClose: () => void;
    onConfirm: () => void;
}) {
    const reservedItems = items.filter(
        (item) => Number(item.reserved_quantity || 0) > 0
    );

    const hasReservedItems = reservedItems.length > 0;

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/35 px-4 font-sans">
            <div className="max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-[22px] border border-[#E6DDF0] bg-white shadow-2xl">
                <div className="border-b border-[#EFE7F4] px-5 py-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#806A8C]">
                        Cancel Booking
                    </p>

                    <h2 className="mt-1 text-xl font-bold text-[#1A1220]">
                        Record used items before cancelling
                    </h2>

                    <p className="mt-1 text-sm text-[#7A6A84]">
                        Booking #{booking.id} · {booking.name}
                    </p>
                </div>

                <div className="max-h-[58vh] overflow-y-auto px-5 py-4">
                    {loading ? (
                        <div className="rounded-xl border border-[#E6DDF0] bg-[#FFFDF8] px-4 py-8 text-center text-sm text-[#806A8C]">
                            Loading booking items...
                        </div>
                    ) : !hasReservedItems ? (
                        <div className="rounded-xl border border-[#F4D79A] bg-[#FFF8E8] px-4 py-4 text-sm text-[#8A5A00]">
                            No reserved inventory was found for this booking. Cancelling will only update the booking status.
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <div className="rounded-xl border border-[#E6DDF0] bg-[#F7F1FF] px-4 py-3 text-sm text-[#4E2C66]">
                                Enter the quantity that was already used. Anything not used will be returned to inventory.
                            </div>

                            {reservedItems.map((item) => {
                                const itemId = Number(item.id);
                                const reserved = Number(item.reserved_quantity || 0);
                                const used = Math.max(
                                    0,
                                    Math.min(Number(usedQty[itemId] || 0), reserved)
                                );
                                const restored = Math.max(reserved - used, 0);
                                const label = item.variant_name
                                    ? `${item.product_name} — ${item.variant_name}`
                                    : item.product_name;

                                return (
                                    <div
                                        key={item.id}
                                        className="rounded-2xl border border-[#E6DDF0] bg-white p-4 shadow-sm"
                                    >
                                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                            <div className="min-w-0">
                                                <p className="text-sm font-bold text-[#1A1220]">
                                                    {label}
                                                </p>

                                                <p className="mt-1 text-xs text-[#7A6A84]">
                                                    Reserved: {reserved}
                                                </p>

                                                <p className="mt-1 text-xs font-semibold text-[#138342]">
                                                    Will return to inventory: {restored}
                                                </p>
                                            </div>

                                            <div className="w-full md:w-[180px]">
                                                <label className="text-xs font-semibold text-[#5F4E75]">
                                                    Used quantity
                                                </label>

                                                <input
                                                    type="number"
                                                    min={0}
                                                    max={reserved}
                                                    value={used}
                                                    disabled={submitting}
                                                    onChange={(event) => {
                                                        const nextValue = Math.max(
                                                            0,
                                                            Math.min(Number(event.target.value || 0), reserved)
                                                        );

                                                        onChangeUsedQty(itemId, nextValue);
                                                    }}
                                                    className="mt-1 h-11 w-full rounded-xl border border-[#D8CBE7] bg-white px-3 text-sm font-semibold text-[#1A1220] outline-none transition focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10 disabled:opacity-60"
                                                />

                                                <p className="mt-1 text-[11px] text-[#806A8C]">
                                                    Max: {reserved}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {error && (
                        <div className="mt-4 rounded-xl border border-[#F2C4C4] bg-[#FFF0F0] px-4 py-3 text-sm font-semibold text-[#C32F2F]">
                            {error}
                        </div>
                    )}
                </div>

                <div className="flex flex-col-reverse gap-2 border-t border-[#EFE7F4] bg-[#FFFDF8] px-5 py-4 sm:flex-row sm:justify-end">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={submitting}
                        className="inline-flex h-11 items-center justify-center rounded-xl border border-[#D8CBE7] bg-white px-4 text-sm font-semibold text-[#2B174C] transition hover:bg-[#F7F1FF] disabled:opacity-60"
                    >
                        Back
                    </button>

                    <button
                        type="button"
                        onClick={onConfirm}
                        disabled={loading || submitting}
                        className="inline-flex h-11 items-center justify-center rounded-xl bg-[#A33E20] px-4 text-sm font-semibold text-white transition hover:bg-[#883117] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {submitting ? "Cancelling..." : "Confirm Cancellation"}
                    </button>
                </div>
            </div>
        </div>
    );
}

function CompactMetricCard({
                               title,
                               value,
                               subLabel,
                               subValue,
                               icon,
                               iconClassName = "bg-[#F0E9FF] text-[#5A35A5]",
                               valueClassName = "text-[#1A1220]",
                               compactValue = false,
                           }: {
    title: string;
    value: string;
    subLabel?: string;
    subValue?: string;
    icon: React.ReactNode;
    iconClassName?: string;
    valueClassName?: string;
    compactValue?: boolean;
}) {
    const helperText =
        subLabel && subValue
            ? `${subLabel}: ${subValue}`
            : "";

    return (
        <div className="flex h-[132px] flex-col rounded-[18px] border border-[#E6DDF0] bg-white p-3 shadow-sm">
            <div className="flex items-start justify-between gap-3">
                <p className="pt-1 text-sm font-semibold text-[#1A1220]">
                    {title}
                </p>

                <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${iconClassName}`}
                >
                    {icon}
                </span>
            </div>

            <p
                className={[
                    "mt-3 break-words font-bold leading-tight tracking-[-0.025em]",
                    compactValue ? "line-clamp-2 text-[19px]" : "text-[23px]",
                    valueClassName,
                ].join(" ")}
                title={value}
            >
                {value}
            </p>

            {helperText && (
                <p className="mt-1 text-[11px] leading-4 text-[#8A7D90]">
                    {helperText}
                </p>
            )}
        </div>
    );
}