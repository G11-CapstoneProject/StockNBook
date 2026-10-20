"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    CreditCard,
    MapPin,
    Package,
    Palette,
    PhilippinePeso,
    StickyNote,
} from "lucide-react";
import BookingFinancialPanel from "./BookingFinancialPanel";

export type BookingAccess = "none" | "view" | "standard" | "full";

export type FilterType =
    | "All"
    | "Pending Review"
    | "Confirmed"
    | "Preparing"
    | "Completed"
    | "Cancelled";

export const TABS: FilterType[] = [
    "All",
    "Pending Review",
    "Confirmed",
    "Preparing",
    "Completed",
    "Cancelled",
];

export type Booking = {
    id: number;

    branchId?: number | null;
    branch_id?: number | null;
    branchName?: string;
    branch_name?: string;

    bookingReference?: string;
    booking_reference?: string;

    bookingType?: string;
    booking_type?: string;

    name: string;
    facebookName?: string;
    facebook_name?: string;
    phone?: string;
    email?: string;

    date: string;
    eventTime?: string;
    event_time?: string;
    eventType?: string;
    event_type?: string;

    package?: string;
    packageName?: string;
    package_name?: string;

    customOrder?: string;
    custom_order?: string;

    theme?: string;
    venue?: string;
    notes?: string;

    status: string;
    approvalStatus?: "pending" | "approved" | "rejected" | null;
    approvalReason?: string | null;

    agreed_price?: number | string | null;
    agreedPrice?: number | string | null;

    package_price?: number | string | null;
    packagePrice?: number | string | null;

    required_down_payment?: number | string | null;
    requiredDownPayment?: number | string | null;

    down_payment_amount?: number | string | null;
    downPaymentAmount?: number | string | null;

    amount_paid?: number | string | null;
    amountPaid?: number | string | null;

    balance?: number | string | null;

    payment_status?: string | null;
    paymentStatus?: string | null;

    createdAt?: string;
    created_at?: string;
};

type BookingRentalItem = {
    id: number;
    equipment_id: number;
    equipment_name: string;
    quantity: number | string;
    start_date: string;
    end_date: string;
    billable_days: number | string;
    allocation_status: string;
};

type BookingInventoryItem = {
    id: number;
    booking_id?: number;
    source_type?: string;
    product_id?: number;
    variant_id?: number | null;
    product_name: string;
    variant_name?: string | null;
    booked_quantity: number | string;
    reserved_quantity?: number | string;
    used_quantity?: number | string;
    restored_quantity?: number | string;
    inventory_status?: string;
};

type CalendarDropdownProps = {
    month: Date;
    bookingDateCounts: Record<string, number>;
    selectedDate: string;
    onChangeMonth: (date: Date) => void;
    onSelectDate: (dateKey: string) => void;
};

const STATUS_STYLE: Record<string, string> = {
    "Pending Review": "border-[#F4D79A] bg-[#FFF8E8] text-[#A56607]",
    "Awaiting Down Payment": "border-[#F4D79A] bg-[#FFF8E8] text-[#A56607]",
    Confirmed: "border-[#C9D9FB] bg-[#EEF4FF] text-[#1D4ED8]",
    Preparing: "border-[#D8CBE7] bg-[#F7F1FF] text-[#4E2C66]",
    Completed: "border-[#B7E9C8] bg-[#EDFBF1] text-[#138342]",
    Cancelled: "border-[#F2C4C4] bg-[#FFF0F0] text-[#C32F2F]",
};

const PAYMENT_STYLE: Record<string, string> = {
    Unpaid: "border-[#F2C4C4] bg-[#FFF0F0] text-[#C32F2F]",
    "Down Payment Required": "border-[#F4D79A] bg-[#FFF8E8] text-[#A56607]",
    "Down Payment Paid": "border-[#C9D9FB] bg-[#EEF4FF] text-[#1D4ED8]",
    Partial: "border-[#D8CBE7] bg-[#F7F1FF] text-[#4E2C66]",
    "Fully Paid": "border-[#B7E9C8] bg-[#EDFBF1] text-[#138342]",
};

function rawValue(raw: Record<string, unknown>, key: string) {
    return raw[key];
}

function rawString(raw: Record<string, unknown>, key: string, fallback = "") {
    const value = rawValue(raw, key);

    if (value === undefined || value === null) return fallback;

    return String(value);
}

function rawNumber(raw: Record<string, unknown>, key: string, fallback = 0) {
    const value = rawValue(raw, key);
    const num = Number(value ?? fallback);

    return Number.isFinite(num) ? num : fallback;
}

export function peso(n: number | string | null | undefined) {
    const value = Number(n || 0);

    return `₱${value.toLocaleString("en-PH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;
}

export function dateKey(value?: string | null) {
    if (!value) return "";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return String(value).slice(0, 10);
    }

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

export function formatDate(value?: string | null) {
    const key = dateKey(value);

    if (!key) return "—";

    const date = new Date(`${key}T00:00:00`);

    return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
    });
}

export function formatMonth(date: Date) {
    return date.toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
    });
}

function toNumber(value: unknown) {
    const n = Number(value || 0);
    return Number.isFinite(n) ? n : 0;
}

export function normalizeBookingStatus(value?: string | null) {
    const raw = String(value || "")
        .trim()
        .toLowerCase();

    if (!raw) return "Pending Review";
    if (raw === "pending" || raw === "pending review") return "Pending Review";

    if (
        raw === "awaiting down payment" ||
        raw === "waiting down payment" ||
        raw === "awaiting payment" ||
        raw === "down payment required"
    ) {
        return "Awaiting Down Payment";
    }

    if (raw === "confirmed") return "Confirmed";
    if (raw === "preparing") return "Preparing";
    if (raw === "completed") return "Completed";
    if (raw === "cancelled" || raw === "canceled") return "Cancelled";

    return value || "Pending Review";
}

function normalizePaymentStatus(value?: string | null) {
    const raw = String(value || "")
        .trim()
        .toLowerCase();

    if (!raw) return "";

    if (raw === "unpaid") return "Unpaid";
    if (raw === "down payment required") return "Down Payment Required";
    if (raw === "down payment paid") return "Down Payment Paid";
    if (raw === "partial") return "Partial";
    if (raw === "fully paid" || raw === "paid") return "Fully Paid";

    return value || "";
}

export function isCustomBooking(booking: Booking) {
    const type = String(booking.bookingType || booking.booking_type || "")
        .toLowerCase()
        .trim();

    const packageLabel = String(
        booking.package || booking.packageName || booking.package_name || ""
    )
        .toLowerCase()
        .trim();

    const customText = String(booking.customOrder || booking.custom_order || "")
        .toLowerCase()
        .trim();

    return (
        type.includes("custom") ||
        packageLabel.includes("custom") ||
        Boolean(customText)
    );
}

export function getBookingItemLabel(booking: Booking) {
    if (isCustomBooking(booking)) {
        return "Custom Inventory Booking";
    }

    return (
        booking.package ||
        booking.packageName ||
        booking.package_name ||
        "Package Booking"
    );
}

export function getBookingItemSubtext(booking: Booking) {
    const parts = [
        booking.eventType || booking.event_type,
        booking.theme,
        booking.venue,
    ].filter(Boolean);

    return parts.length > 0 ? parts.join(" · ") : "No extra details";
}

export function getBranchGroupName(booking: Booking) {
    return booking.branchName || booking.branch_name || "Unassigned Branch";
}

export function getTotalPrice(booking: Booking) {
    if (isCustomBooking(booking)) {
        return toNumber(booking.agreed_price ?? booking.agreedPrice);
    }

    const agreed=toNumber(booking.agreed_price ?? booking.agreedPrice);
    return agreed>0 ? agreed : toNumber(booking.package_price ?? booking.packagePrice);
}

export function getRequiredDownPayment(booking: Booking) {
    return toNumber(
        booking.required_down_payment ??
        booking.requiredDownPayment ??
        booking.down_payment_amount ??
        booking.downPaymentAmount
    );
}

export function getAmountPaid(booking: Booking) {
    return toNumber(booking.amount_paid ?? booking.amountPaid);
}

export function getBalance(booking: Booking) {
    const explicitBalance = booking.balance;

    if (explicitBalance !== undefined && explicitBalance !== null) {
        return toNumber(explicitBalance);
    }

    return Math.max(getTotalPrice(booking) - getAmountPaid(booking), 0);
}

export function getPaymentStatus(booking: Booking) {
    const savedStatus = normalizePaymentStatus(
        booking.payment_status || booking.paymentStatus
    );

    const total = getTotalPrice(booking);
    const requiredDp = getRequiredDownPayment(booking);
    const paid = getAmountPaid(booking);

    if (total <= 0) return savedStatus || "Unpaid";
    if (paid >= total || savedStatus === "Fully Paid") return "Fully Paid";
    if (requiredDp > 0 && paid >= requiredDp) return "Down Payment Paid";
    if (paid > 0) return "Partial";
    if (requiredDp > 0) return "Down Payment Required";

    return savedStatus || "Unpaid";
}

export function normalizeBooking(
    raw: Record<string, unknown>,
    fallbackBranchName = "Assigned Branch"
): Booking {
    const branchId = rawValue(raw, "branchId") ?? rawValue(raw, "branch_id") ?? null;
    const branchName =
        rawValue(raw, "branchName") ?? rawValue(raw, "branch_name") ?? fallbackBranchName;

    return {
        ...raw,
        id: rawNumber(raw, "id"),
        branchId: branchId === null ? null : Number(branchId),
        branchName: String(branchName || fallbackBranchName),
        bookingReference:
            rawString(raw, "bookingReference") || rawString(raw, "booking_reference"),
        bookingType: rawString(raw, "bookingType") || rawString(raw, "booking_type"),
        facebookName: rawString(raw, "facebookName") || rawString(raw, "facebook_name"),
        eventTime: rawString(raw, "eventTime") || rawString(raw, "event_time"),
        eventType: rawString(raw, "eventType") || rawString(raw, "event_type"),
        package:
            rawString(raw, "package") ||
            rawString(raw, "packageName") ||
            rawString(raw, "package_name"),
        customOrder:
            rawString(raw, "customOrder") || rawString(raw, "custom_order"),
        status: normalizeBookingStatus(rawString(raw, "status")),
        approvalStatus: (rawValue(raw, "approvalStatus") || null) as Booking["approvalStatus"],
        approvalReason: String(rawValue(raw,"approvalReason") || "") || null,
        agreed_price: rawValue(raw, "agreed_price") ?? rawValue(raw, "agreedPrice") ?? null,
        package_price: rawValue(raw, "package_price") ?? rawValue(raw, "packagePrice") ?? null,
        required_down_payment:
            rawValue(raw, "required_down_payment") ??
            rawValue(raw, "requiredDownPayment") ??
            rawValue(raw, "down_payment_amount") ??
            rawValue(raw, "downPaymentAmount") ??
            0,
        amount_paid: rawValue(raw, "amount_paid") ?? rawValue(raw, "amountPaid") ?? 0,
        balance: rawValue(raw, "balance") ?? null,
        payment_status: normalizePaymentStatus(
            String(rawValue(raw, "payment_status") ?? rawValue(raw, "paymentStatus") ?? "Unpaid")
        ),
        createdAt: rawString(raw, "createdAt") || rawString(raw, "created_at"),
    } as Booking;
}

export function getSavedBookingAccess(role: "staff" | "manager" = "staff"): BookingAccess {
    try {
        const permissions = JSON.parse(
            sessionStorage.getItem("permissions") ||
            localStorage.getItem("permissions") ||
            "{}"
        ) as Record<string, unknown>;

        // The manager's editor saves both a legacy `bookings` boolean and
        // `bookings_access`. Read the granular access value first so `true`
        // cannot incorrectly override `"full"` or `"standard"`.
        const access = permissions.bookings_access ??
            permissions.booking_access ??
            permissions.bookings;

        if (access === undefined || access === null) {
            return role === "manager" ? "full" : "none";
        }
        if (role === "staff") {
            // Staff "full" in the access editor means standard-confirm only;
            // Manager-only pricing and cancellation actions stay unavailable.
            if (access === "full" || access === "standard" || access === "confirm_standard") return "standard";
            // Preserve legacy boolean grants as read-only, not write access.
            if (access === true || access === "true" || access === "view" ||
                access === "view_only" || access === "viewOnly") return "view";
            return "none";
        }
        if (access === "full" || access === true) return "full";
        if (access === "view" || access === "view_only" || access === "viewOnly") return "view";
        return "none";
    } catch {
        return role === "manager" ? "full" : "none";
    }
}

export function MetricCard({
                               title,
                               value,
                               subLabel,
                               subValue,
                           }: {
    title: string;
    value: string;
    subLabel?: string;
    subValue?: string;
}) {
    return (
        <div className="min-h-[102px] rounded-[14px] border border-[#E6DDF0] bg-white px-4 py-3 shadow-sm">
            <p className="text-sm font-semibold text-[#2B174C]">{title}</p>

            <p className="mt-1 truncate text-[24px] font-bold leading-tight text-[#1A1220]">
                {value}
            </p>

            {subLabel && subValue && (
                <div className="mt-2 flex items-center justify-between gap-3 border-t border-[#EFE7F4] pt-2 text-xs">
                    <span className="text-[#7A6A84]">{subLabel}</span>
                    <span className="font-semibold text-[#1A1220]">
                        {subValue}
                    </span>
                </div>
            )}
        </div>
    );
}

export function BookingOverviewCard({
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
    icon: ReactNode;
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

export function CalendarDropdown({
                                     month,
                                     bookingDateCounts,
                                     selectedDate,
                                     onChangeMonth,
                                     onSelectDate,
                                 }: CalendarDropdownProps) {
    const cells = useMemo(() => {
        const year = month.getFullYear();
        const monthIndex = month.getMonth();

        const firstDay = new Date(year, monthIndex, 1);
        const start = new Date(firstDay);
        start.setDate(firstDay.getDate() - firstDay.getDay());

        return Array.from({ length: 42 }).map((_, index) => {
            const date = new Date(start);
            date.setDate(start.getDate() + index);

            return {
                date,
                inMonth: date.getMonth() === monthIndex,
            };
        });
    }, [month]);

    return (
        <div className="absolute right-0 top-[calc(100%+10px)] z-50 w-[320px] rounded-[18px] border border-[#E6DDF0] bg-white p-4 font-sans shadow-xl">
            <div className="mb-3 flex items-center justify-between">
                <button
                    onClick={() =>
                        onChangeMonth(
                            new Date(month.getFullYear(), month.getMonth() - 1, 1)
                        )
                    }
                    className="flex h-9 w-9 items-center justify-center rounded-xl text-[#2B174C] transition hover:bg-[#F7F1FF]"
                    type="button"
                >
                    <ChevronLeft size={16} />
                </button>

                <p className="text-sm font-bold text-[#1A1220]">
                    {formatMonth(month)}
                </p>

                <button
                    onClick={() =>
                        onChangeMonth(
                            new Date(month.getFullYear(), month.getMonth() + 1, 1)
                        )
                    }
                    className="flex h-9 w-9 items-center justify-center rounded-xl text-[#2B174C] transition hover:bg-[#F7F1FF]"
                    type="button"
                >
                    <ChevronRight size={16} />
                </button>
            </div>

            <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-[#806A8C]">
                {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day) => (
                    <div key={day} className="py-1">
                        {day}
                    </div>
                ))}
            </div>

            <div className="mt-1 grid grid-cols-7 gap-1">
                {cells.map(({ date, inMonth }) => {
                    const key = dateKey(date.toISOString());
                    const hasBooking = bookingDateCounts[key] > 0;
                    const isSelected = selectedDate === key;

                    return (
                        <button
                            key={key}
                            onClick={() => onSelectDate(key)}
                            type="button"
                            className={`relative flex h-9 items-center justify-center rounded-full text-sm transition ${
                                isSelected
                                    ? "bg-[#2B174C] text-white shadow-sm"
                                    : inMonth
                                        ? "text-[#1A1220] hover:bg-[#F7F1FF]"
                                        : "text-[#B8AFC0] hover:bg-[#F7F1FF]"
                            }`}
                        >
                            {date.getDate()}

                            {hasBooking && (
                                <span
                                    className={`absolute bottom-1 h-1.5 w-1.5 rounded-full ${
                                        isSelected ? "bg-white" : "bg-[#2B174C]"
                                    }`}
                                />
                            )}
                        </button>
                    );
                })}
            </div>

            <div className="mt-4 flex items-center gap-2 border-t border-[#EFE7F4] pt-3 text-xs text-[#6A5D6F]">
                <span className="h-2 w-2 rounded-full bg-[#2B174C]" />
                Has booking
            </div>
        </div>
    );
}

export function PriceModal({
                               booking,
                               onConfirm,
                               onClose,
                           }: {
    booking: Booking;
    onConfirm: (agreedPrice: number, requiredDownPayment: number) => void;
    onClose: () => void;
}) {
    const [price, setPrice] = useState(
        String(booking.agreed_price ?? booking.agreedPrice ?? "")
    );

    const [downPayment, setDownPayment] = useState(
        String(
            booking.required_down_payment ??
            booking.requiredDownPayment ??
            booking.down_payment_amount ??
            booking.downPaymentAmount ??
            ""
        )
    );

    const [error, setError] = useState("");
    const isCustom = isCustomBooking(booking);

    function handleConfirm() {
        const parsedPrice = parseFloat(price);
        const parsedDownPayment = parseFloat(downPayment);

        if (!isCustom) {
            setError("Agreed price is only used for custom bookings.");
            return;
        }

        if (!price || Number.isNaN(parsedPrice) || parsedPrice <= 0) {
            setError("Please enter a valid agreed price.");
            return;
        }

        if (
            !downPayment ||
            Number.isNaN(parsedDownPayment) ||
            parsedDownPayment < 0
        ) {
            setError("Please enter a valid required down payment.");
            return;
        }

        if (parsedDownPayment > parsedPrice) {
            setError("Required down payment cannot exceed agreed price.");
            return;
        }

        onConfirm(parsedPrice, parsedDownPayment);
    }

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm">
            <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-[18px] border border-[#E6DDF0] bg-white p-5 font-sans shadow-2xl">
                <h3 className="text-[20px] font-bold text-[#1A1220]">
                    Set Custom Payment Terms
                </h3>

                <p className="mt-1 text-sm leading-6 text-[#7A6A84]">
                    Enter the agreed price and required down payment for{" "}
                    <span className="font-semibold text-[#1A1220]">
                        {booking.name}
                    </span>
                    .
                </p>

                <div className="mt-4 space-y-3">
                    <div>
                        <label className="mb-2 block text-sm font-medium text-[#1A1220]">
                            Agreed Price (₱)
                        </label>

                        <div className="relative">
                            <PhilippinePeso
                                size={15}
                                className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9B8AAA]"
                            />

                            <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={price}
                                onChange={(e) => {
                                    setPrice(e.target.value);
                                    setError("");
                                }}
                                placeholder="0.00"
                                className="h-[42px] w-full rounded-xl border border-[#E6DDF0] bg-[#FFFDF8] px-3 pl-10 text-sm text-[#1A1220] outline-none transition focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="mb-2 block text-sm font-medium text-[#1A1220]">
                            Required Down Payment (₱)
                        </label>

                        <div className="relative">
                            <PhilippinePeso
                                size={15}
                                className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9B8AAA]"
                            />

                            <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={downPayment}
                                onChange={(e) => {
                                    setDownPayment(e.target.value);
                                    setError("");
                                }}
                                placeholder="0.00"
                                className="h-[42px] w-full rounded-xl border border-[#E6DDF0] bg-[#FFFDF8] px-3 pl-10 text-sm text-[#1A1220] outline-none transition focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10"
                            />
                        </div>
                    </div>

                    {error && (
                        <p className="rounded-xl border border-[#F2C4C4] bg-[#FFF0F0] px-3 py-2 text-xs font-medium text-[#C32F2F]">{error}</p>
                    )}
                </div>

                <div className="mt-4 rounded-xl border border-[#E6DDF0] bg-[#FFFDF8] p-3 text-sm text-[#7A6A84]">
                    <p className="font-semibold text-[#1A1220]">
                        Custom Request:
                    </p>
                    <p className="mt-1">{getBookingItemSubtext(booking)}</p>
                </div>

                <div className="mt-5 flex gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        className="flex-1 rounded-xl border border-[#E6DDF0] bg-white px-4 py-2.5 text-sm font-semibold text-[#2B174C] transition hover:bg-[#F7F1FF]"
                    >
                        Cancel
                    </button>

                    <button
                        type="button"
                        onClick={handleConfirm}
                        className="flex-1 rounded-xl bg-[#2B174C] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31]"
                    >
                        Save Terms
                    </button>
                </div>
            </div>
        </div>
    );
}

export function getNextStatusConfig(displayStatus: string, downPaymentPaid: boolean) {
    switch (displayStatus) {
        case "Pending Review":
            return {
                nextStatus: "Confirmed",
                nextStatusLabel: "Confirm Booking", // ← first button
                statusActionDisabled: false,
                statusHelper: "Booking must be confirmed before preparation."
            };
        case "Confirmed":
            return {
                nextStatus: "Preparing",
                nextStatusLabel: "Start Preparing", // ← second button
                statusActionDisabled: false,
                statusHelper: "Move this booking to preparation stage."
            };
        case "Preparing":
            return {
                nextStatus: "Completed",
                nextStatusLabel: "Complete Booking", // ← third button
                statusActionDisabled: false,
                statusHelper: "Mark this booking completed when service is done."
            };
        case "Completed":
            return {
                nextStatus: "Completed",
                nextStatusLabel: "Completed",
                statusActionDisabled: true,
                statusHelper: "This booking is already completed."
            };
        case "Cancelled":
            return {
                nextStatus: "Cancelled",
                nextStatusLabel: "Cancelled",
                statusActionDisabled: true,
                statusHelper: "This booking has been cancelled."
            };
        default:
            return {
                nextStatus: "Pending Review",
                nextStatusLabel: "Confirm Booking",
                statusActionDisabled: false,
                statusHelper: "Move this booking to the next step."
            };
    }
}

export type BookingDetailTab = "Overview" | "Billing" | "Items" | "Notes";

type BookingRowProps = {
    b: Booking;
    ownerView?: boolean;
    canManage?: boolean;
    onUpdateStatus?: (id: number, status: string, price?: number) => void;
    onSetPrice?: (b: Booking) => void;
    onRecordDownPayment?: (b: Booking) => void;
    onMarkFullyPaid?: (b: Booking) => void;
    onCancelBooking?: (b: Booking) => void;
    canConfirmStandard?: boolean;
    onConfirmStandard?: (b: Booking) => void;
    onRequestApproval?: (b: Booking) => void;
    canOperateBookings?: boolean;
    onOperateBooking?: (id: number, status: "Preparing" | "Completed") => void;
    operationsBusy?: boolean;
    // Only used by the non-paginated selectable booking workspace.
    hideSummaryRow?: boolean;
    expandedByDefault?: boolean;
    detailTab?: BookingDetailTab;
};

export function BookingRow({
                               b,
                               hideSummaryRow = false,
                               expandedByDefault = false,
                               detailTab = "Overview",
                               ownerView = false,
                               canManage = true,
                               onUpdateStatus,
                               onSetPrice,
                               onRecordDownPayment,
                               onMarkFullyPaid,
                               onCancelBooking,
                               canConfirmStandard = false,
                               onConfirmStandard,
                               onRequestApproval,
                               canOperateBookings = false,
                               onOperateBooking,
                               operationsBusy = false,
                           }: BookingRowProps) {
    const [bookingItems, setBookingItems] = useState<BookingInventoryItem[]>([]);
    const [bookingRentalItems, setBookingRentalItems] = useState<BookingRentalItem[]>([]);
    const [itemsLoading, setItemsLoading] = useState(false);
    const [itemsLoaded, setItemsLoaded] = useState(false);
    const [itemsError, setItemsError] = useState("");
    const [open, setOpen] = useState(expandedByDefault);

    // Status transitions change rental allocations; reload the displayed
    // inventory lines when a booking moves to its next operational step.
    useEffect(() => { setItemsLoaded(false); }, [b.status]);

    const isCustom = isCustomBooking(b);
    const total = getTotalPrice(b);
    const requiredDp = getRequiredDownPayment(b);
    const paid = getAmountPaid(b);
    const balance = getBalance(b);
    const paymentStatus = getPaymentStatus(b);
    const displayStatus = normalizeBookingStatus(b.status);

    const customNeedsTerms = isCustom && total <= 0;
    const canRecordPayment = total > 0 && requiredDp > 0;
    const downPaymentPaid = requiredDp > 0 && paid >= requiredDp;
    const fullyPaid = total > 0 && balance <= 0;

    const statusClass =
        STATUS_STYLE[displayStatus] ||
        "bg-[#F7F1FF] text-[#2B174C] border-[#E6DDF0]";

    const paymentClass =
        PAYMENT_STYLE[paymentStatus] ||
        "bg-[#F7F1FF] text-[#2B174C] border-[#E6DDF0]";

    const {
        nextStatus,
        nextStatusLabel,
        statusActionDisabled,
        statusHelper,
    } = getNextStatusConfig(displayStatus, downPaymentPaid);

    useEffect(() => {
        if (!open || itemsLoaded || (hideSummaryRow && detailTab !== "Items")) return;

        const token = sessionStorage.getItem("token");
        const branchId =
            b.branchId ||
            b.branch_id ||
            sessionStorage.getItem("branch_id") ||
            sessionStorage.getItem("stocknbook_branch_id") ||
            sessionStorage.getItem("manager_branch_id") ||
            sessionStorage.getItem("staff_branch_id");

        if (!token) return;

        let cancelled = false;

        async function loadBookingItems() {
            setItemsLoading(true);
            setItemsError("");

            try {
                const body: Record<string, unknown> = {
                    action: "get_booking_items",
                    booking_id: b.id,
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

                if (!cancelled) {
                    setBookingItems(
                        Array.isArray(data.items)
                            ? (data.items as BookingInventoryItem[])
                            : []
                    );
                    setBookingRentalItems(Array.isArray(data.rentalItems)
                        ? (data.rentalItems as BookingRentalItem[]) : []);
                    setItemsLoaded(true);
                }
            } catch (err) {
                console.error("Failed to load booking items:", err);

                if (!cancelled) {
                    setItemsError(
                        err instanceof Error
                            ? err.message
                            : "Unable to load selected items."
                    );
                    setItemsLoaded(true);
                }
            } finally {
                if (!cancelled) {
                    setItemsLoading(false);
                }
            }
        }

        void loadBookingItems();

        return () => {
            cancelled = true;
        };
    }, [
        open,
        itemsLoaded,
        hideSummaryRow,
        detailTab,
        b.id,
        b.branchId,
        b.branch_id,
    ]);

    return (
        <>
            {!hideSummaryRow && (<tr
                onClick={() => setOpen((v) => !v)}
                className={`cursor-pointer border-b border-[#EFE7F4] transition hover:bg-[#FFFCF7] ${
                    open ? "bg-[#F9F4FF]" : "bg-white"
                }`}
            >
                <td className="px-4 py-3">
                    <div className="flex items-start gap-2.5">
                        <ChevronDown
                            size={14}
                            className={`mt-1 shrink-0 text-[#2B174C] transition ${
                                open ? "rotate-180" : "-rotate-90"
                            }`}
                        />

                        <div className="min-w-0">
                            <p className="text-sm font-bold text-[#1A1220]">
                                {b.name}
                            </p>

                            {b.phone && (
                                <p className="mt-0.5 text-xs text-[#5F4E75]">
                                    {b.phone}
                                </p>
                            )}

                            {b.bookingReference && (
                                <p className="mt-0.5 text-xs font-semibold text-[#806A8C]">
                                    {b.bookingReference}
                                </p>
                            )}

                            {ownerView && (
                                <p className="mt-0.5 text-xs text-[#806A8C]">
                                    {getBranchGroupName(b)}
                                </p>
                            )}
                        </div>
                    </div>
                </td>

                <td className="px-4 py-3">
                    <p className="text-sm font-semibold text-[#1A1220]">
                        {formatDate(b.date)}
                    </p>

                    {b.eventTime && (
                        <p className="mt-0.5 text-xs text-[#7A6A84]">
                            {b.eventTime}
                        </p>
                    )}
                </td>

                <td className="px-4 py-3">
                    <div className="flex max-w-[210px] items-start gap-2">
                        <Package size={14} className="mt-0.5 shrink-0 text-[#6C3AD6]" />

                        <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-[#1A1220]">
                                {getBookingItemLabel(b)}
                            </p>

                            <p className="mt-0.5 text-xs text-[#7A6A84]">
                                {total > 0
                                    ? peso(total)
                                    : isCustom
                                        ? "No agreed price yet"
                                        : "No package price"}
                            </p>

                            {b.theme && (
                                <p className="mt-0.5 truncate text-xs text-[#806A8C]">
                                    {b.theme}
                                </p>
                            )}
                        </div>
                    </div>
                </td>

                <td className="px-4 py-3">
                    <span
                        className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${paymentClass}`}
                    >
                        {paymentStatus}
                    </span>

                    <p className="mt-1 text-xs text-[#7A6A84]">
                        Paid {peso(paid)}
                    </p>
                </td>

                <td className="px-4 py-3">
                    <span
                        className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClass}`}
                    >
                        {displayStatus}
                    </span>
                </td>

                <td className="px-4 py-3 text-right">
                    {b.venue ? (
                        <div className="inline-flex max-w-[180px] items-center justify-end gap-1.5 text-xs font-medium text-[#5F4E75]">
                            <MapPin size={13} />
                            <span className="truncate">{b.venue}</span>
                        </div>
                    ) : b.theme ? (
                        <div className="inline-flex max-w-[180px] items-center justify-end gap-1.5 text-xs font-medium text-[#5F4E75]">
                            <Palette size={13} />
                            <span className="truncate">{b.theme}</span>
                        </div>
                    ) : (
                        <span className="text-xs text-[#9B8AAA]">Open row</span>
                    )}
                </td>
            </tr>)}

            {open && (
                <tr className="border-b border-[#EFE7F4] bg-[#F9F4FF]">
                    <td colSpan={6} className={hideSummaryRow ? "p-0" : "px-4 pb-4"}>
                        <div className={hideSummaryRow
                            ? "flex w-full min-w-0 flex-col gap-3 bg-white"
                            : "flex w-full flex-col gap-4 rounded-[14px] border border-[#E6DDF0] bg-white p-4 xl:flex-row"}>
                            {/* LEFT SIDE */}
                            <div className="min-w-0 flex-1 space-y-4">
                                {(!hideSummaryRow || detailTab === "Overview") && (
                                    <div className="rounded-[14px] border border-[#E6DDF0] bg-[#FFFDF8] p-4">
                                        <div className="mb-4 flex items-center gap-2">
                                            <CreditCard
                                                size={15}
                                                className="text-[#6C3AD6]"
                                            />

                                            <p className="text-[16px] font-bold text-[#1A1220]">
                                                Payment Summary
                                            </p>
                                        </div>

                                        <div className="space-y-3 text-sm">
                                            <SummaryLine
                                                label={isCustom ? "Agreed Price" : "Package Price"}
                                                value={total > 0 ? peso(total) : "Not set"}
                                            />

                                            <SummaryLine
                                                label="Required Down Payment"
                                                value={requiredDp > 0 ? peso(requiredDp) : "No down payment required"}
                                            />

                                            <SummaryLine
                                                label="Amount Paid"
                                                value={peso(paid)}
                                            />

                                            <div className="border-t border-[#EFE7F4] pt-4">
                                                <SummaryLine
                                                    label="Balance"
                                                    value={peso(balance)}
                                                    strong
                                                />
                                            </div>
                                        </div>

                                        {!hideSummaryRow && <BookingFinancialPanel bookingId={b.id} branchId={Number(b.branchId||b.branch_id||0)} ownerView={ownerView} editable={canManage}/>}

                                        {customNeedsTerms && (
                                            <p className="mt-3 rounded-xl bg-orange-50 px-3 py-2 text-xs font-medium text-orange-700">
                                                This custom booking needs an agreed price and required down payment before payment can be recorded.
                                            </p>
                                        )}

                                        {!isCustom && total <= 0 && (
                                            <p className="mt-3 rounded-xl bg-orange-50 px-3 py-2 text-xs font-medium text-orange-700">
                                                Package price is missing. Check if the booking API includes package price.
                                            </p>
                                        )}
                                    </div>
                                )}

                                {hideSummaryRow && detailTab === "Billing" && (
                                    <BookingFinancialPanel bookingId={b.id} branchId={Number(b.branchId||b.branch_id||0)} ownerView={ownerView} editable={canManage}/>
                                )}

                                {(!hideSummaryRow || detailTab === "Items") && (
                                    <div className="flex h-[290px] flex-col rounded-[14px] border border-[#E6DDF0] bg-[#FFFDF8] p-4">
                                        <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
                                            <div className="flex items-center gap-2">
                                                <Package
                                                    size={14}
                                                    className="text-[#6C3AD6]"
                                                />

                                                <p className="text-[16px] font-bold text-[#1A1220]">
                                                    Booking Inventory Items
                                                </p>
                                            </div>

                                            {(bookingItems.length + bookingRentalItems.length) > 0 && (
                                                <span className="shrink-0 rounded-full bg-[#F0E9FF] px-2.5 py-1 text-[11px] font-bold text-[#5A35A5]">
                                                    {bookingItems.length + bookingRentalItems.length} lines
                                                </span>
                                            )}
                                        </div>

                                        <div className="min-h-0 flex-1">
                                            {itemsLoading ? (
                                                <div className="flex h-full items-center justify-center">
                                                    <p className="text-sm text-[#7A6A84]">
                                                        Loading items...
                                                    </p>
                                                </div>
                                            ) : itemsError ? (
                                                <p className="rounded-xl border border-[#F2C4C4] bg-[#FFF0F0] px-3 py-2 text-xs font-semibold text-[#C32F2F]">
                                                    {itemsError}
                                                </p>
                                            ) : (bookingItems.length + bookingRentalItems.length) === 0 ? (
                                                <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-[#E6DDF0] bg-white px-4 text-center">
                                                    <p className="text-sm text-[#7A6A84]">
                                                        No saved items found for this booking.
                                                    </p>
                                                </div>
                                            ) : (
                                                <div className="h-full space-y-2 overflow-y-auto overscroll-contain pr-1">
                                                    {bookingItems.map((item) => {
                                                        const itemLabel = item.variant_name
                                                            ? `${item.product_name} — ${item.variant_name}`
                                                            : item.product_name;

                                                        const quantity = Number(
                                                            item.booked_quantity ||
                                                            item.reserved_quantity ||
                                                            0
                                                        );

                                                        return (
                                                            <div
                                                                key={item.id}
                                                                className="flex items-center justify-between gap-3 rounded-xl border border-[#EFE7F4] bg-white px-3 py-2"
                                                            >
                                                                <div className="min-w-0">
                                                                    <p className="truncate text-sm font-semibold text-[#1A1220]">
                                                                        {itemLabel}
                                                                    </p>

                                                                    <p className="mt-0.5 text-[11px] text-[#806A8C]">
                                                                        {item.source_type === 'package' ? 'Package inclusion · Sales inventory' : 'Sales inventory'}
                                                                        {item.inventory_status ? ` · ${item.inventory_status}` : ''}
                                                                    </p>
                                                                </div>

                                                                <span className="shrink-0 rounded-full bg-[#F7F1FF] px-2.5 py-1 text-xs font-bold text-[#4E2C66]">
                                                                    x{quantity}
                                                                </span>
                                                            </div>
                                                        );
                                                    })}
                                                    {bookingRentalItems.map(item => (
                                                        <div key={`rental-${item.id}`}
                                                             className="flex items-center justify-between gap-3 rounded-xl border border-[#EFE7F4] bg-white px-3 py-2">
                                                            <div className="min-w-0">
                                                                <p className="truncate text-sm font-semibold text-[#1A1220]">{item.equipment_name}</p>
                                                                <p className="mt-0.5 text-[11px] text-[#806A8C]">
                                                                    Rental equipment · {item.allocation_status.replace(/_/g, ' ')}
                                                                    {' · '}{item.start_date === item.end_date ? item.start_date : `${item.start_date} – ${item.end_date}`}
                                                                </p>
                                                            </div>
                                                            <span className="shrink-0 rounded-full bg-[#F7F1FF] px-2.5 py-1 text-xs font-bold text-[#4E2C66]">
                                                                x{Number(item.quantity)}
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {(!hideSummaryRow || detailTab === "Notes") && (
                                    <div className="min-h-[96px] rounded-[14px] border border-[#E6DDF0] bg-[#FFFDF8] p-4">
                                        <div className="mb-2 flex items-center gap-2">
                                            <StickyNote
                                                size={14}
                                                className="text-[#806A8C]"
                                            />

                                            <p className="text-[16px] font-bold text-[#1A1220]">
                                                Notes
                                            </p>
                                        </div>

                                        <p className="text-sm leading-6 text-[#7A6A84]">
                                            {b.notes || "No notes provided."}
                                        </p>
                                    </div>
                                )}
                            </div>

                            {/* RIGHT SIDE */}
                            {(!hideSummaryRow || detailTab === "Overview") && (
                                <div className="min-w-0 flex-1 space-y-4">
                                    <div className="rounded-[14px] border border-[#E6DDF0] bg-[#FFFDF8] p-4">
                                        <p className="mb-3 text-[16px] font-bold text-[#1A1220]">
                                            Payment Action
                                        </p>

                                        {ownerView || !canManage ? (
                                            <div className="rounded-xl border border-[#E6DDF0] bg-white px-3 py-3 text-center text-xs font-semibold text-[#7A6A84]">
                                                View-only booking record.
                                            </div>
                                        ) : isCustom && customNeedsTerms ? (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onSetPrice?.(b);
                                                }}
                                                type="button"
                                                className="inline-flex h-[42px] w-full items-center justify-center rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31]"
                                            >
                                                Set Price & Down Payment
                                            </button>
                                        ) : total <= 0 ? (
                                            <div
                                                className="flex min-h-[42px] w-full items-center justify-center rounded-xl border border-[#F4D79A] bg-[#FFF8E8] px-4 text-center text-sm font-semibold text-[#A56607]"
                                            >
                                                Payment terms missing
                                            </div>
                                        ) : balance <= 0 ? (
                                            <div
                                                className="flex min-h-[42px] w-full items-center justify-center rounded-xl border border-[#B7E9C8] bg-[#EDFBF1] px-4 text-center text-sm font-semibold text-[#138342]"
                                            >
                                                Payment completed
                                            </div>
                                        ) : requiredDp === 0 ? (
                                            <button type="button" onClick={(e) => {e.stopPropagation();onMarkFullyPaid?.(b)}}
                                                    className="inline-flex h-[42px] w-full items-center justify-center rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white hover:bg-[#1B0D31]">
                                                Mark as Fully Paid
                                            </button>
                                        ) : paid <= 0 || paid < requiredDp ? (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onRecordDownPayment?.(b);
                                                }}
                                                type="button"
                                                className="inline-flex h-[42px] w-full items-center justify-center rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31]"
                                            >
                                                Mark Down Payment Paid
                                            </button>
                                        ) : (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onMarkFullyPaid?.(b);
                                                }}
                                                type="button"
                                                className="inline-flex h-[42px] w-full items-center justify-center rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31]"
                                            >
                                                Mark as Fully Paid
                                            </button>
                                        )}

                                        {isCustom && !customNeedsTerms && canManage && !ownerView && (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onSetPrice?.(b);
                                                }}
                                                type="button"
                                                className="mt-3 inline-flex h-[42px] w-full items-center justify-center rounded-xl border border-[#E6DDF0] bg-white px-4 text-sm font-semibold text-[#2B174C] transition hover:bg-[#F7F1FF]"
                                            >
                                                Edit Custom Price & DP
                                            </button>
                                        )}
                                    </div>

                                    <div className="rounded-[14px] border border-[#E6DDF0] bg-[#FFFDF8] p-4">
                                        <p className="mb-4 text-[16px] font-bold text-[#1A1220]">
                                            Booking Status
                                        </p>

                                        <div className="space-y-3 text-sm">
                                            <SummaryLine
                                                label="Current Status"
                                                value={displayStatus}
                                                badgeClass={statusClass}
                                            />

                                            <SummaryLine
                                                label="Next Step"
                                                value={nextStatusLabel}
                                            />
                                        </div>

                                        {ownerView || (!canManage && !(canOperateBookings && (displayStatus === "Confirmed" || displayStatus === "Preparing"))) ? (
                                            <div className="rounded-xl border border-[#E6DDF0] bg-white px-3 py-3 text-center text-xs font-semibold text-[#7A6A84]">
                                                {canConfirmStandard && displayStatus === "Pending Review"
                                                    ? "Staff may confirm a catalog-priced booking below or request Manager review."
                                                    : "View-only booking status."}
                                            </div>
                                        ) : !canManage ? (
                                            <button
                                                type="button"
                                                disabled={operationsBusy || !onOperateBooking}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (displayStatus === "Confirmed" || displayStatus === "Preparing") {
                                                        onOperateBooking?.(b.id, displayStatus === "Confirmed" ? "Preparing" : "Completed");
                                                    }
                                                }}
                                                className="inline-flex min-h-[42px] w-full items-center justify-center rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white hover:bg-[#1B0D31] disabled:cursor-not-allowed disabled:opacity-50"
                                            >
                                                {operationsBusy ? "Processing..." : nextStatusLabel}
                                            </button>
                                        ) : (
                                            <>
                                                {/* Next Step Button */}
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); if (!statusActionDisabled) onUpdateStatus?.(b.id, nextStatus); }}
                                                    disabled={statusActionDisabled}
                                                    className="mb-2 inline-flex h-[42px] w-full items-center justify-center rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31] disabled:cursor-not-allowed disabled:bg-[#D8CBE7] disabled:text-[#806A8C]"
                                                >
                                                    {b.approvalStatus === "pending" && nextStatus === "Confirmed" ? "Approve & Confirm Booking" : nextStatusLabel}
                                                </button>

                                                {/* Cancel Button */}
                                                {!["Completed", "Cancelled"].includes(displayStatus) && onUpdateStatus && (
                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.stopPropagation();

                                                            if (onCancelBooking) {
                                                                onCancelBooking(b);
                                                                return;
                                                            }

                                                            onUpdateStatus?.(b.id, "Cancelled");
                                                        }}
                                                        className="mt-3 inline-flex h-[42px] w-full items-center justify-center rounded-xl bg-[#A33E20] px-4 text-sm font-semibold text-white transition hover:bg-[#883117]"
                                                    >
                                                        Cancel Booking
                                                    </button>
                                                )}
                                            </>
                                        )}

                                        {b.approvalStatus === "pending" && (
                                            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-900">
                                                <strong>Manager approval requested</strong>
                                                <p className="mt-1">{b.approvalReason || "Awaiting review of this booking exception."}</p>
                                            </div>
                                        )}
                                        {canConfirmStandard && displayStatus === "Pending Review" && (
                                            <div className="mt-3 flex flex-col gap-2">
                                                {b.approvalStatus !== "pending" ? (
                                                    <button type="button" onClick={(e)=>{e.stopPropagation(); onConfirmStandard?.(b)}}
                                                            className="min-h-[42px] rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white hover:bg-[#1B0D31]">
                                                        Confirm Standard Booking
                                                    </button>
                                                ) : null}
                                                <button type="button" onClick={(e)=>{e.stopPropagation(); onRequestApproval?.(b)}}
                                                        className="min-h-[42px] rounded-xl border border-[#D8CBE7] bg-white px-4 text-sm font-semibold text-[#2B174C] hover:bg-[#F7F1FF]">
                                                    {b.approvalStatus === "pending" ? "Update Approval Request" : "Request Manager Approval"}
                                                </button>
                                            </div>
                                        )}
                                        {canManage && !ownerView && displayStatus === "Pending Review" && b.approvalStatus === "pending" && (
                                            <p className="mt-2 text-center text-xs font-semibold text-amber-900">
                                                Confirm Booking will record Manager approval and reserve the equipment.
                                            </p>
                                        )}
                                        <p className="mt-3 text-center text-xs text-[#7A6A84]">
                                            {statusHelper}
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </td>
                </tr>
            )}
        </>
    );
}


// One selected booking at a time: no row checkboxes or pagination.
// BookingRow remains the single source of truth for all existing booking actions.
export function BookingWorkspace({ bookings, ownerView = false, ...bookingActions }: Omit<BookingRowProps,
    "b" | "hideSummaryRow" | "expandedByDefault" | "detailTab"> & { bookings: Booking[] }) {
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [detailTab, setDetailTab] = useState<BookingDetailTab>("Overview");
    const selectedBooking = bookings.find(booking => booking.id === selectedId) ?? bookings[0];

    if (!selectedBooking) {
        return <div className="rounded-2xl border border-[#E6DDF0] bg-white p-8 text-center text-sm text-[#806A8C]">No bookings found.</div>;
    }

    const tabs: BookingDetailTab[] = ["Overview", "Billing", "Items", "Notes"];
    return (
        <div className="grid min-w-0 gap-3 2xl:grid-cols-[minmax(0,1.12fr)_minmax(0,0.88fr)]">
            <section aria-label="Booking list" className="min-w-0 overflow-hidden rounded-[16px] border border-[#E6DDF0] bg-white shadow-sm">
                <div className="max-h-[640px] overflow-auto overscroll-contain">
                    <table role="grid" aria-label="Bookings" className="w-full min-w-[650px] border-collapse">
                        <thead className="sticky top-0 z-10 bg-[#FFFDF8]">
                        <tr className="border-b border-[#E6DDF0] text-left text-[11px] font-semibold text-[#806A8C]">
                            <th className="px-3 py-3">Client / Booking Ref</th>
                            <th className="px-3 py-3">Schedule</th>
                            <th className="px-3 py-3">Booking Type</th>
                            <th className="px-3 py-3">Payment</th>
                            <th className="px-3 py-3">Status</th>
                        </tr>
                        </thead>
                        <tbody>
                        {bookings.map(booking => {
                            const selected = booking.id === selectedBooking.id;
                            const total = getTotalPrice(booking);
                            const paid = getAmountPaid(booking);
                            const payment = getPaymentStatus(booking);
                            const status = normalizeBookingStatus(booking.status);
                            return (
                                <tr key={booking.id}
                                    onClick={() => {setSelectedId(booking.id); setDetailTab("Overview");}}
                                    onKeyDown={event => {
                                        if (event.key === "Enter" || event.key === " ") {
                                            event.preventDefault(); setSelectedId(booking.id); setDetailTab("Overview");
                                        }
                                    }}
                                    tabIndex={0} aria-selected={selected}
                                    className={`cursor-pointer border-b border-[#EFE7F4] text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#6C3AD6] ${
                                        selected ? "bg-[#F1E9FF] shadow-[inset_4px_0_0_#6C3AD6]" : "bg-white hover:bg-[#FAF6FF]"
                                    }`}>
                                    <td className="max-w-[190px] px-3 py-3 align-top">
                                        <p className="truncate font-bold text-[#1A1220]" title={booking.name}>{booking.name}</p>
                                        <p className="mt-1 truncate text-[11px] text-[#806A8C]">{booking.bookingReference || `#${booking.id}`}</p>
                                        {ownerView && <p className="mt-1 truncate text-[11px] text-[#806A8C]">{getBranchGroupName(booking)}</p>}
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-3 align-top text-xs text-[#1A1220]">
                                        <p className="font-semibold">{formatDate(booking.date)}</p>
                                        {booking.eventTime && <p className="mt-1 text-[#806A8C]">{booking.eventTime}</p>}
                                    </td>
                                    <td className="max-w-[145px] px-3 py-3 align-top">
                                        <p className="line-clamp-2 text-xs font-semibold text-[#1A1220]" title={getBookingItemLabel(booking)}>{getBookingItemLabel(booking)}</p>
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-3 align-top">
                                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${PAYMENT_STYLE[payment] || "border-[#E6DDF0] bg-[#F7F1FF] text-[#2B174C]"}`}>{payment}</span>
                                        <p className="mt-1 text-[11px] text-[#806A8C]">{peso(paid)} / {total > 0 ? peso(total) : "Not set"}</p>
                                    </td>
                                    <td className="px-3 py-3 align-top">
                                        <span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-1 text-[11px] font-semibold ${STATUS_STYLE[status] || "border-[#E6DDF0] bg-[#F7F1FF] text-[#2B174C]"}`}>{status}</span>
                                    </td>
                                </tr>
                            );
                        })}
                        </tbody>
                    </table>
                </div>
            </section>

            <section aria-label="Selected booking details" className="flex min-w-0 max-h-[640px] flex-col overflow-hidden rounded-[16px] border border-[#E6DDF0] bg-white shadow-sm">
                <div className="shrink-0 border-b border-[#EFE7F4] px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                            <h2 className="truncate text-[18px] font-bold text-[#1A1220]">{selectedBooking.name}</h2>
                            <p className="mt-0.5 text-xs font-semibold text-[#806A8C]">{selectedBooking.bookingReference || `Booking #${selectedBooking.id}`}</p>
                        </div>
                        <span className={`inline-flex shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${STATUS_STYLE[normalizeBookingStatus(selectedBooking.status)] || "border-[#E6DDF0] bg-[#F7F1FF] text-[#2B174C]"}`}>{normalizeBookingStatus(selectedBooking.status)}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#5F4E75]">
                        <span>{formatDate(selectedBooking.date)}{selectedBooking.eventTime ? ` · ${selectedBooking.eventTime}` : ""}</span>
                        <span className="max-w-full truncate">{getBranchGroupName(selectedBooking)}</span>
                        <span className="max-w-full truncate" title={getBookingItemLabel(selectedBooking)}>{getBookingItemLabel(selectedBooking)}</span>
                    </div>
                    <div className="mt-3 grid grid-cols-4 gap-1 rounded-xl bg-[#F7F1FF] p-1" role="tablist" aria-label="Booking detail sections">
                        {tabs.map(tab => (
                            <button key={tab} type="button" role="tab" aria-selected={tab === detailTab}
                                    onClick={() => setDetailTab(tab)}
                                    className={`min-w-0 rounded-lg px-1.5 py-2 text-[11px] font-semibold transition ${tab === detailTab ? "bg-white text-[#2B174C] shadow-sm" : "text-[#806A8C] hover:bg-white/60"}`}>
                                {tab}
                            </button>
                        ))}
                    </div>
                </div>
                <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
                    <table className="w-full table-fixed border-collapse"><tbody>
                    <BookingRow key={selectedBooking.id} b={selectedBooking} ownerView={ownerView}
                                {...bookingActions} hideSummaryRow expandedByDefault detailTab={detailTab}/>
                    </tbody></table>
                </div>
            </section>
        </div>
    );
}

function SummaryLine({
                         label,
                         value,
                         strong = false,
                         badgeClass,
                     }: {
    label: string;
    value: string;
    strong?: boolean;
    badgeClass?: string;
}) {
    return (
        <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-[#7A6A84]">{label}</span>

            {badgeClass ? (
                <span
                    className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${badgeClass}`}
                >
                    {value}
                </span>
            ) : (
                <span
                    className={`text-right ${
                        strong
                            ? "text-[18px] font-bold text-[#2B174C]"
                            : "text-sm font-semibold text-[#1A1220]"
                    }`}
                >
                    {value}
                </span>
            )}
        </div>
    );
}