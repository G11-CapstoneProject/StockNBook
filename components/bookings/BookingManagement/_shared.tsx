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
    UserRound,
    CalendarDays,
    Clock3,
    ShieldCheck,
    Download,
} from "lucide-react";
import BookingFinancialPanel from "./BookingFinancialPanel";

export type BookingAccess = "none" | "view" | "standard" | "full";

export type FilterType =
    | "All"
    | "Pending Review"
    | "Awaiting Down Payment"
    | "Confirmed"
    | "Preparing"
    | "Released"
    | "Completed"
    | "Cancelled";

export const TABS: FilterType[] = [
    "All",
    "Pending Review",
    "Awaiting Down Payment",
    "Confirmed",
    "Preparing",
    "Released",
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
    additional_custom_request?: string;
    additionalCustomRequest?: string;
    theme_motif_request?: string;
    themeMotifRequest?: string;
    additional_notes?: string;
    additionalNotes?: string;
    refundable_deposit?: number | string | null;
    refundableDeposit?: number | string | null;

    status: string;
    approvalStatus?: "pending" | "approved" | "rejected" | null;
    approvalReason?: string | null;

    agreed_price?: number | string | null;
    agreedPrice?: number | string | null;

    package_price?: number | string | null;
    packagePrice?: number | string | null;

    required_down_payment?: number | string | null;
    requiredDownPayment?: number | string | null;
    downPaymentDeadline?: string | null;
    down_payment_deadline?: string | null;
    booking_dp_deadline?: string | null;

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
    daily_rate?: number | string | null;
    rental_rate?: number | string | null;
    amount?: number | string | null;
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
    unit_price?: number | string | null;
    total_price?: number | string | null;
};

type BookingItemizedStatement = {
    salesItems: { name: string; variantName?: string; quantity: number; unitPrice: number; amount: number }[];
    rentalItems: { name: string; quantity: number; days: number; dailyRate: number; amount: number }[];
    salesSubtotal?: number;
    rentalSubtotal?: number;
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
    Approved: "border-[#D8CBE7] bg-[#F5EEFF] text-[#5930A4]",
    Confirmed: "border-[#C9D9FB] bg-[#EEF4FF] text-[#1D4ED8]",
    Preparing: "border-[#D8CBE7] bg-[#F7F1FF] text-[#4E2C66]",
    Released: "border-[#C9D9FB] bg-[#EEF4FF] text-[#1D4ED8]",
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
        raw === "approved" ||
        raw === "awaiting down payment" ||
        raw === "waiting down payment" ||
        raw === "awaiting payment" ||
        raw === "down payment required"
    ) {
        return "Awaiting Down Payment";
    }

    if (raw === "confirmed") return "Confirmed";
    if (raw === "preparing") return "Preparing";
    if (raw === "released") return "Released";
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

// Display-only classification for the Manager booking screen. Never replace
// the actual bookingType value: API requests and pricing need the original data.
export function getManagerBookingTypeLabel(booking: Booking): "Custom" | "Package" {
    const rawType = String(booking.bookingType || booking.booking_type || "").trim().toLowerCase();
    // Honor the booking choice saved by the public customer portal first.
    if (rawType.includes("custom")) return "Custom";
    if (rawType.includes("package")) return "Package";
    return isCustomBooking(booking) ? "Custom" : "Package";
}

// The persisted status remains "Awaiting Down Payment" to keep the existing API
// and inventory reservation workflow compatible. Only the manager UI says Approved.
export function getManagerBookingStatusLabel(status?: string | null) {
    const normalized = normalizeBookingStatus(status);
    return normalized === "Awaiting Down Payment" ? "Approved" : normalized;
}

// Manager-facing payment label only: retain all backend payment states,
// amounts, thresholds, and booking-transition rules unchanged.
export function getManagerPaymentLabel(booking: Booking): "Unpaid" | "Down Payment Paid" | "Fully Paid" {
    const current = getPaymentStatus(booking);
    if (current === "Fully Paid") return "Fully Paid";
    if (current === "Down Payment Paid") return "Down Payment Paid";
    // Includes the former "Down Payment Required" and "Partial" labels.
    // The amounts remain visible so any partial receipt is never hidden.
    return "Unpaid";
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
        refundable_deposit: rawValue(raw, "refundable_deposit") ?? rawValue(raw, "refundableDeposit") ?? null,
        package_price: rawValue(raw, "package_price") ?? rawValue(raw, "packagePrice") ?? null,
        required_down_payment:
            rawValue(raw, "required_down_payment") ??
            rawValue(raw, "requiredDownPayment") ??
            rawValue(raw, "down_payment_amount") ??
            rawValue(raw, "downPaymentAmount") ??
            0,
        downPaymentDeadline: rawString(raw,"downPaymentDeadline") || rawString(raw,"booking_dp_deadline") || rawString(raw,"down_payment_deadline") || null,
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
    onConfirm: (agreedPrice: number, requiredDownPayment: number, refundableDeposit: number) => void | Promise<void>;
    onClose: () => void;
}) {
    const [price, setPrice] = useState(String(booking.agreed_price ?? booking.agreedPrice ?? ""));
    const [downPayment, setDownPayment] = useState(String(
        booking.required_down_payment ?? booking.requiredDownPayment ?? booking.down_payment_amount ?? booking.downPaymentAmount ?? ""
    ));
    const [refundableDeposit, setRefundableDeposit] = useState(String(
        booking.refundable_deposit ?? booking.refundableDeposit ?? ""
    ));
    const [hasRental, setHasRental] = useState<boolean | null>(null);
    const [termsLoading, setTermsLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const isCustom = isCustomBooking(booking);

    // Identify rental equipment from the actual booking rather than guessing from booking type.
    // The financial statement also holds the existing refundable-deposit amount.
    useEffect(() => {
        let cancelled = false;
        const token = sessionStorage.getItem("token");
        if (!token) { setError("Login required to review booking items."); setTermsLoading(false); return; }
        const branchId = booking.branchId ?? booking.branch_id;
        const body = (action: string) => JSON.stringify({ action, booking_id: booking.id,
            ...(branchId ? { branch_id: Number(branchId) } : {}) });
        void (async () => {
            try {
                const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
                const [itemsResponse, statementResponse] = await Promise.all([
                    fetch("/api/bookings", { method: "POST", headers, body: body("get_booking_items") }),
                    fetch("/api/bookings", { method: "POST", headers, body: body("get_booking_financial_statement") }),
                ]);
                const [itemsData, financeData] = await Promise.all([itemsResponse.json(), statementResponse.json()]);
                if (!itemsResponse.ok || itemsData.error || itemsData.success === false ||
                    !statementResponse.ok || financeData.error || financeData.success === false || !financeData.statement) {
                    throw new Error(itemsData.error || financeData.error || "Could not verify booking rental items and security deposit.");
                }
                if (!Array.isArray(itemsData.rentalItems) || !Array.isArray(financeData.statement.rentalItems)) {
                    throw new Error("The booking API did not provide the rental-item information required to set the security deposit.");
                }
                const rental = itemsData.rentalItems.length > 0 || financeData.statement.rentalItems.length > 0;
                const saved = financeData.statement.depositRequired;
                if (saved == null || !Number.isFinite(Number(saved)) || Number(saved) < 0) {
                    throw new Error("The booking API did not provide a valid current refundable security deposit.");
                }
                if (!cancelled) {
                    setHasRental(rental);
                    setRefundableDeposit(String(saved));
                }
            } catch (err) {
                if (!cancelled) setError(err instanceof Error ? err.message : "Could not check rental items.");
            } finally {
                if (!cancelled) setTermsLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [booking.id, booking.branchId, booking.branch_id]);

    async function handleConfirm() {
        if (saving || termsLoading || hasRental === null) return;
        const parsedPrice = Number(price);
        const parsedDownPayment = Number(downPayment);
        const parsedDeposit = Number(refundableDeposit);
        const isMoney = (value: string, n: number) => value.trim() !== "" &&
            Number.isFinite(n) && Math.abs(n * 100 - Math.round(n * 100)) < 0.001;
        if (!isCustom) { setError("Agreed price is only used for custom bookings."); return; }
        if (!isMoney(price, parsedPrice) || parsedPrice <= 0) { setError("Enter a valid agreed price."); return; }
        if (!isMoney(downPayment, parsedDownPayment) || parsedDownPayment < 0 || parsedDownPayment > parsedPrice) {
            setError("Down payment must be between ₱0.00 and the agreed booking price."); return;
        }
        if (!isMoney(refundableDeposit, parsedDeposit) || parsedDeposit < 0) {
            setError("Enter a valid refundable security deposit amount."); return;
        }
        if (hasRental && parsedDeposit <= 0) {
            setError("A security deposit greater than ₱0.00 is required because this booking includes rental equipment."); return;
        }
        setSaving(true); setError("");
        try { await onConfirm(parsedPrice, parsedDownPayment, parsedDeposit); }
        catch (err) { setError(err instanceof Error ? err.message : "Could not save payment terms."); }
        finally { setSaving(false); }
    }

    const inputStyle = "h-[42px] w-full rounded-xl border border-[#E6DDF0] bg-[#FFFDF8] px-3 pl-10 text-sm text-[#1A1220] outline-none transition focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10";
    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm">
            <div role="dialog" aria-modal="true" aria-label="Set Custom Payment Terms" className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-[18px] border border-[#E6DDF0] bg-white p-5 font-sans shadow-2xl">
                <h3 className="text-[20px] font-bold text-[#1A1220]">Set Custom Payment Terms</h3>
                <p className="mt-1 text-sm leading-6 text-[#7A6A84]">Enter the agreed price, required down payment, and refundable security deposit for <strong className="text-[#1A1220]">{booking.name}</strong>.</p>
                <div className="mt-4 space-y-3">
                    {([
                        { label: "Agreed Price (₱)", value: price, set: setPrice },
                        { label: "Required Down Payment (₱)", value: downPayment, set: setDownPayment },
                        { label: "Refundable Security Deposit (₱)", value: refundableDeposit, set: setRefundableDeposit },
                    ] as const).map(field => <label key={field.label} className="block text-sm font-medium text-[#1A1220]">
                        {field.label}
                        <div className="relative mt-2">
                            <PhilippinePeso size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9B8AAA]" />
                            <input aria-label={field.label} type="number" min="0" step="0.01" required
                                   disabled={termsLoading || saving} value={field.value}
                                   onChange={e => { field.set(e.target.value); setError(""); }} placeholder="0.00" className={inputStyle} />
                        </div>
                    </label>)}
                    <p className="text-xs leading-5 text-[#806A8C]">
                        {termsLoading ? "Checking rental equipment and existing deposit..." : hasRental === null
                            ? "Rental equipment could not be verified. Saving is disabled."
                            : hasRental ? "Required: this booking contains rental items. The Manager must enter a security deposit greater than ₱0.00."
                                : "Optional: no rental items were found. Enter ₱0.00 if no security deposit is needed."}
                        {" "}The security deposit is refundable and is not included in the agreed booking price.
                    </p>
                    {price !== "" && downPayment !== "" && refundableDeposit !== "" &&
                        Number.isFinite(Number(price)) && Number.isFinite(Number(downPayment)) && Number.isFinite(Number(refundableDeposit)) &&
                        <div className="rounded-xl border border-[#E6DDF0] bg-[#FBF8FF] p-3 text-xs text-[#2B174C]">
                            <div className="flex justify-between"><span>Remaining booking balance after DP</span><strong>{peso(Math.max(0, Number(price) - Number(downPayment)))}</strong></div>
                            <div className="mt-1 flex justify-between"><span>Before-release amount (if deposit not yet collected)</span><strong>{peso(Math.max(0, Number(price) - Number(downPayment)) + Number(refundableDeposit))}</strong></div>
                        </div>}
                    {error && <p role="alert" className="rounded-xl border border-[#F2C4C4] bg-[#FFF0F0] px-3 py-2 text-xs font-medium text-[#C32F2F]">{error}</p>}
                </div>
                <div className="mt-5 flex gap-3">
                    <button type="button" disabled={saving} onClick={onClose} className="flex-1 rounded-xl border border-[#E6DDF0] bg-white px-4 py-2.5 text-sm font-semibold text-[#2B174C] transition hover:bg-[#F7F1FF] disabled:opacity-50">Cancel</button>
                    <button type="button" disabled={saving || termsLoading || hasRental === null} onClick={() => void handleConfirm()} className="flex-1 rounded-xl bg-[#2B174C] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31] disabled:opacity-50">{saving ? "Saving..." : "Save Terms"}</button>
                </div>
            </div>
        </div>
    );
}

export function getNextStatusConfig(displayStatus: string, downPaymentPaid: boolean) {
    switch (displayStatus) {
        case "Pending Review":
            return {
                nextStatus: "Awaiting Down Payment",
                nextStatusLabel: "Approve & Request DP",
                statusActionDisabled: false,
                statusHelper: "Review availability before requesting payment. No stock is allocated yet."
            };
        case "Awaiting Down Payment":
            return {
                nextStatus: "Confirmed",
                nextStatusLabel: "Confirm & Reserve",
                statusActionDisabled: !downPaymentPaid,
                statusHelper: downPaymentPaid ? "Recheck availability and reserve the items." : "Manager must verify the required DP first."
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
                nextStatus: "Released",
                nextStatusLabel: "Release Items",
                statusActionDisabled: false,
                statusHelper: "Staff can release prepared items only after full booking payment and the refundable security deposit have been collected."
            };
        case "Released":
            return {
                nextStatus: "Completed",
                nextStatusLabel: "Complete Booking",
                statusActionDisabled: false,
                statusHelper: "After rental returns, inspection, claim settlement, and deposit refund, staff can complete the booking."
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

// Customer-only details; the public portal currently may append its free-text request
// after generated inventory lines inside customOrder. Never display those product lines as notes.
function getCustomerCustomRequest(booking: Booking): string {
    const explicit = String(booking.additional_custom_request || booking.additionalCustomRequest || "").trim();
    if (explicit) return explicit;
    const saved = String(booking.customOrder || booking.custom_order || "").trim();
    if (!saved) return "";
    if (!/selected inventory items:|^additional request:/im.test(saved)) return saved;
    const marker = /(?:^|\n)\s*Additional request:\s*/ig;
    let found: RegExpExecArray | null, after = "";
    while ((found = marker.exec(saved)) !== null) after = saved.slice(marker.lastIndex).trim();
    if (!after) return "";
    // The legacy portal writes rental item lines first, followed by a blank line and
    // the customer's typed request. Do not confuse a rental line with customer text.
    const blocks = after.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
    if (blocks.length > 1) return blocks[blocks.length - 1];
    if (/\b(?:\d+\s*[x×]\s*\d+|₱\s*[\d,.]+|rental equipment)\b/i.test(after)) return "";
    return after;
}

function itemNameKey(name: string) { return String(name || "").trim().replace(/\s+/g, " ").toLowerCase(); }

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
    onOperateBooking?: (id: number, status: "Preparing" | "Released" | "Completed") => void;
    operationsBusy?: boolean;
    // Only used by the non-paginated selectable booking workspace.
    hideSummaryRow?: boolean;
    expandedByDefault?: boolean;
    detailTab?: BookingDetailTab;
    managerView?: boolean;
};

export function BookingRow({
                               b,
                               hideSummaryRow = false,
                               expandedByDefault = false,
                               detailTab = "Overview",
                               managerView = false,
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
    const [itemizedPrices, setItemizedPrices] = useState<BookingItemizedStatement | null>(null);
    const [itemsLoading, setItemsLoading] = useState(false);
    const [itemsLoaded, setItemsLoaded] = useState(false);
    const [itemsError, setItemsError] = useState("");
    const [estimatedBookingPrice, setEstimatedBookingPrice] = useState<number | null>(null);
    // Existing financial-statement API supplies the booking-specific, refundable deposit.
    const [securityDeposit, setSecurityDeposit] = useState<{ required: number; collected: number } | null>(null);
    const [estimateLoading, setEstimateLoading] = useState(false);
    const [estimateError, setEstimateError] = useState(false);
    const [open, setOpen] = useState(expandedByDefault);

    // Status transitions change rental allocations; reload the displayed
    // inventory lines when a booking moves to its next operational step.
    useEffect(() => { setItemsLoaded(false); }, [b.status]);

    const isCustom = isCustomBooking(b);
    // Read the saved estimate without treating it as the manager's final agreed price.
    // This endpoint totals catalog-verified custom consumables and rental lines,
    // plus the branch's saved optional charges, when applicable.
    useEffect(() => {
        if (!hideSummaryRow || !managerView || detailTab !== "Overview" || !open) return;
        const token = sessionStorage.getItem("token");
        if (!token) { setEstimateError(true); return; }
        let cancelled = false;
        setEstimatedBookingPrice(null);
        setSecurityDeposit(null);
        setEstimateError(false);
        setEstimateLoading(true);
        const branchId = b.branchId || b.branch_id;
        void (async () => {
            try {
                const res = await fetch("/api/bookings", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                    body: JSON.stringify({ action: "get_booking_financial_statement", booking_id: b.id,
                        ...(branchId ? { branch_id: Number(branchId) } : {}) }),
                });
                const result = await res.json();
                if (res.ok && !result.error && result.statement && !cancelled) {
                    const required = Number(result.statement.depositRequired);
                    const collected = Number(result.statement.depositCollected);
                    if (Number.isFinite(required) && Number.isFinite(collected)) {
                        setSecurityDeposit({ required: Math.max(0, required), collected: Math.max(0, collected) });
                    }
                }
                const estimate = Number(result.statement?.agreedCharges);
                if (!res.ok || result.error || !Number.isFinite(estimate) || estimate < 0 ||
                    result.statement?.agreedCharges == null) throw new Error("Quote unavailable");
                if (!cancelled) setEstimatedBookingPrice(estimate);
            } catch {
                if (!cancelled) setEstimateError(true);
            } finally {
                if (!cancelled) setEstimateLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [b.id, b.status, b.branchId, b.branch_id, b.refundable_deposit, b.refundableDeposit, b.agreed_price, hideSummaryRow, managerView, detailTab, open]);
    const total = getTotalPrice(b);
    const requiredDp = getRequiredDownPayment(b);
    const paid = getAmountPaid(b);
    const balance = getBalance(b);
    const paymentStatus = getPaymentStatus(b);
    const displayStatus = normalizeBookingStatus(b.status);

    const customNeedsTerms = isCustom && total <= 0;
    // Custom quotations are locked immediately after manager approval.
    const canEditPaymentTerms = displayStatus === "Pending Review" && b.approvalStatus !== "approved";
    // For a no-DP booking, the whole booking price must be paid before confirmation.
    const downPaymentPaid = total > 0 && paid + 0.005 >= (requiredDp > 0 ? requiredDp : total);

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
    const actionNextStatus = nextStatus;
    const actionLabel = managerView && displayStatus === "Pending Review" ? "Approve Booking" : nextStatusLabel;
    const managerCanAdvance = displayStatus === "Pending Review" || displayStatus === "Awaiting Down Payment";

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
            setItemizedPrices(null);

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

                // Itemized prices come from the same financial statement used by Billing.
                // Do not invent unit prices when a product is missing from the statement.
                try {
                    const financialResponse = await fetch("/api/bookings", {
                        method: "POST",
                        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                        body: JSON.stringify({ action: "get_booking_financial_statement", booking_id: b.id,
                            ...(branchId ? { branch_id: Number(branchId) } : {}) }),
                    });
                    const financialData = await financialResponse.json();
                    const statement = financialData.statement;
                    if (financialResponse.ok && !financialData.error && statement && !cancelled) {
                        setItemizedPrices({
                            salesItems: Array.isArray(statement.salesItems) ? statement.salesItems : [],
                            rentalItems: Array.isArray(statement.rentalItems) ? statement.rentalItems : [],
                            salesSubtotal: Number.isFinite(Number(statement.salesSubtotal)) && statement.salesSubtotal != null ? Number(statement.salesSubtotal) : undefined,
                            rentalSubtotal: Number.isFinite(Number(statement.rentalSubtotal)) && statement.rentalSubtotal != null ? Number(statement.rentalSubtotal) : undefined,
                        });
                    }
                } catch {
                    // The inventory remains visible; prices are marked unavailable instead of guessed.
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

    // Only the Manager uses the redesigned overview. Keep the existing
    // BookingRow actions, Billing, Items and Notes for the other views.
    if (hideSummaryRow && managerView && detailTab === "Overview") {
        const infoLabel = "text-xs font-medium text-[#887B99]";
        const infoValue = "text-right text-xs font-semibold text-[#261940] break-words";
        const card = "min-w-0 rounded-xl border border-[#E8E1F1] bg-white p-3.5 sm:p-4";
        const action = "inline-flex min-h-10 items-center justify-center rounded-lg px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";
        return (
            <tr><td colSpan={6} className="p-0">
                <div className="space-y-3 text-[#25153D]">
                    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                        <section className={card}>
                            <h3 className="mb-4 flex items-center gap-2 text-sm font-bold"><UserRound size={17} className="text-[#6536D4]"/>Customer Information</h3>
                            <div className="space-y-3">
                                <div className="flex justify-between gap-3"><span className={infoLabel}>Name</span><span className={infoValue}>{b.name}</span></div>
                                <div className="flex justify-between gap-3"><span className={infoLabel}>Contact Number</span><span className={infoValue}>{b.phone || "—"}</span></div>
                                <div className="flex justify-between gap-3"><span className={infoLabel}>Email</span><span className={infoValue}>{b.email || "—"}</span></div>
                            </div>
                        </section>
                        <section className={card}>
                            <h3 className="mb-4 flex items-center gap-2 text-sm font-bold"><CalendarDays size={17} className="text-[#6536D4]"/>Event Details</h3>
                            <div className="space-y-3">
                                <div className="flex justify-between gap-3"><span className={infoLabel}>Event Date</span><span className={infoValue}>{formatDate(b.date)}</span></div>
                                <div className="flex justify-between gap-3"><span className={infoLabel}>Event Time</span><span className={infoValue}>{b.eventTime || b.event_time || "—"}</span></div>
                                <div className="flex justify-between gap-3"><span className={infoLabel}>Booking Type</span><span className={infoValue}>{getManagerBookingTypeLabel(b)}</span></div>
                                <div className="flex justify-between gap-3"><span className={infoLabel}>Event Type</span><span className={infoValue}>{b.eventType || b.event_type || "—"}</span></div>
                            </div>
                        </section>
                        <section className={card}>
                            <h3 className="mb-4 flex items-center gap-2 text-sm font-bold"><CreditCard size={17} className="text-[#6536D4]"/>Payment Summary</h3>
                            <div className="space-y-3">
                                <div className="flex justify-between gap-3"><span className={infoLabel}>Estimated Price</span>
                                    <span className={infoValue}>{estimateLoading ? "Loading..." : estimateError || estimatedBookingPrice === null ? "Unavailable" : peso(estimatedBookingPrice)}</span></div>
                                <p className="text-[11px] leading-4 text-[#887B99]">Original itemized estimate; subject to manager review.</p>
                                <div className="flex justify-between gap-3"><span className={infoLabel}>Agreed Price</span><span className={infoValue}>{total > 0 ? peso(total) : "Not set"}</span></div>
                                <div className="flex justify-between gap-3"><span className={infoLabel}>Required Down Payment</span><span className={infoValue}>{requiredDp > 0 ? peso(requiredDp) : isCustom && total <= 0 ? "Not set" : "No down payment required"}</span></div>
                                <div className="flex justify-between gap-3"><span className={infoLabel}>Refundable Security Deposit</span><span className={infoValue}>{securityDeposit ? peso(securityDeposit.required) : "Unavailable"}</span></div>
                                <div className="flex justify-between gap-3"><span className={infoLabel}>Security Deposit Collected</span><span className={infoValue}>{securityDeposit ? peso(securityDeposit.collected) : "Unavailable"}</span></div>
                                {securityDeposit && <div className="flex justify-between gap-3"><span className={infoLabel}>Total Due Before Release</span><span className={infoValue}>{peso(balance + Math.max(0, securityDeposit.required - securityDeposit.collected))}</span></div>}
                                <div className="flex justify-between gap-3"><span className={infoLabel}>Amount Paid</span><span className={infoValue}>{peso(paid)}</span></div>
                                <div className="flex justify-between gap-3 border-t border-[#EAE4F0] pt-3"><span className="text-xs font-bold">Remaining Balance</span><strong className="text-sm text-[#351263]">{isCustom && total <= 0 ? "Not set" : peso(balance)}</strong></div>
                            </div>
                        </section>
                        <section className={card}>
                            <h3 className="mb-4 flex items-center gap-2 text-sm font-bold"><Clock3 size={17} className="text-[#6536D4]"/>Status &amp; Schedule</h3>
                            <div className="space-y-3">
                                <div className="flex items-center justify-between gap-3"><span className={infoLabel}>Current Status</span><span className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${statusClass}`}>{managerView ? getManagerBookingStatusLabel(displayStatus) : displayStatus}</span></div>
                                <div className="flex justify-between gap-3"><span className={infoLabel}>Next Step</span><span className={infoValue}>{managerCanAdvance ? (statusActionDisabled ? "Verify booking payment first" : actionLabel) : "Staff: " + nextStatusLabel}</span></div>
                                <div className="flex justify-between gap-3"><span className={infoLabel}>Payment Status</span><span className={infoValue}>{getManagerPaymentLabel(b)}</span></div>
                                <div className="flex justify-between gap-3"><span className={infoLabel}>Event Schedule</span><span className={infoValue}>{formatDate(b.date)}</span></div>
                            </div>
                        </section>
                    </div>
                    <section className={`${card} !bg-[#FCFAFF]`}>
                        <h3 className="mb-3 flex items-center gap-2 text-sm font-bold"><ShieldCheck size={17} className="text-[#6536D4]"/>Quick Actions</h3>
                        {!canManage || ownerView ? (
                            <div className="rounded-lg border border-[#E8E1F1] bg-white p-3 text-xs text-[#847492]">You have view-only access to booking actions.</div>
                        ) : (
                            <div className="grid gap-2 sm:grid-cols-2">
                                {isCustom && customNeedsTerms && canEditPaymentTerms ? (
                                    <button type="button" className={`${action} bg-[#4D2A96] text-white hover:bg-[#371C72]`} onClick={() => onSetPrice?.(b)}>Set Price, DP &amp; Deposit</button>
                                ) : displayStatus === "Pending Review" ? (
                                    <span className="flex items-center justify-center rounded-lg border border-[#E8DCF4] bg-white px-3 py-2 text-center text-xs font-semibold text-[#806D92]">Approve booking before recording payment</span>
                                ) : displayStatus === "Cancelled" ? (
                                    <span className="flex items-center justify-center rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-center text-xs font-semibold text-red-700">Cancelled booking — payments disabled</span>
                                ) : total > 0 && balance > 0 ? (
                                    <button type="button" className={`${action} border border-[#D6C4F8] bg-[#F3EEFF] text-[#4D2A96] hover:bg-[#ECE2FF]`}
                                            onClick={() => requiredDp > 0 && paid < requiredDp ? onRecordDownPayment?.(b) : onMarkFullyPaid?.(b)}>
                                        {requiredDp > 0 && paid < requiredDp ? "Verify & Record Down Payment" : "Record Remaining Payment"}
                                    </button>
                                ) : <span className="flex items-center justify-center rounded-lg border border-[#D6EDDC] bg-[#EFF9F1] px-3 py-2 text-xs font-semibold text-[#18854C]">{total <= 0 ? "Payment terms missing" : "Payment completed"}</span>}
                                {isCustom && !customNeedsTerms && canEditPaymentTerms &&
                                    <button type="button" className={`${action} border border-[#D6C4F8] bg-white text-[#4D2A96] hover:bg-[#F3EEFF]`} onClick={() => onSetPrice?.(b)}>Edit Price, DP &amp; Deposit</button>}
                                {managerCanAdvance ? (
                                    <button type="button" disabled={statusActionDisabled || total <= 0} onClick={() => { if (!statusActionDisabled && total > 0) onUpdateStatus?.(b.id, actionNextStatus); }}
                                            className={`${action} border border-[#D6C4F8] bg-[#F3EEFF] text-[#4D2A96] hover:bg-[#ECE2FF]`}>
                                        {actionLabel}
                                    </button>
                                ) : <span className="flex items-center justify-center rounded-lg border border-[#E8DCF4] bg-white px-3 py-2 text-center text-xs font-semibold text-[#806D92]">Preparation, release and completion are handled by Staff.</span>}
                                {!(["Released", "Completed", "Cancelled"].includes(displayStatus)) && onUpdateStatus &&
                                    <button type="button" onClick={() => onCancelBooking ? onCancelBooking(b) : onUpdateStatus?.(b.id, "Cancelled")}
                                            className={`${action} border border-red-200 bg-red-50 text-red-700 hover:bg-red-100`}>Cancel Booking</button>}
                            </div>
                        )}
                        {!canEditPaymentTerms && isCustom && <p className="mt-3 rounded-lg border border-[#E7DDF5] bg-[#F8F4FF] p-3 text-xs text-[#674A8E]">Custom price, required down payment and refundable security deposit are locked after approval.</p>}
                        {b.approvalStatus === "pending" && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-900"><strong>Manager approval requested:</strong> {b.approvalReason || "Awaiting review."}</p>}
                        <p className="mt-3 text-xs leading-5 text-[#847492]">{statusHelper} Recording money does not automatically confirm a booking.</p>
                    </section>
                    {customNeedsTerms && <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">Agree on custom pricing and the down payment before collecting payment.</p>}
                </div>
            </td></tr>
        );
    }

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

                                        {!hideSummaryRow && <BookingFinancialPanel bookingId={b.id} branchId={Number(b.branchId||b.branch_id||0)} ownerView={ownerView} editable={canManage || canOperateBookings}/>}

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
                                    <BookingFinancialPanel bookingId={b.id} branchId={Number(b.branchId||b.branch_id||0)} ownerView={ownerView} editable={canManage || canOperateBookings}/>
                                )}

                                {(!hideSummaryRow || detailTab === "Items") && (
                                    <div className="min-w-0 space-y-3">
                                        {itemsLoading ? (
                                            <div role="status" className="rounded-[14px] border border-[#E6DDF0] bg-[#FFFDF8] p-5 text-center text-sm text-[#7A6A84]">
                                                Loading booking items...
                                            </div>
                                        ) : itemsError ? (
                                            <p role="alert" className="rounded-xl border border-[#F2C4C4] bg-[#FFF0F0] px-3 py-2 text-xs font-semibold text-[#C32F2F]">
                                                {itemsError}
                                            </p>
                                        ) : (
                                            <>
                                                <section aria-label="Inclusions" className="min-w-0 rounded-[14px] border border-[#E6DDF0] bg-[#FFFDF8] p-4">
                                                    <div className="mb-3 flex items-center justify-between gap-2">
                                                        <div className="flex items-center gap-2">
                                                            <Package size={14} className="shrink-0 text-[#6C3AD6]" />
                                                            <h3 className="text-[16px] font-bold text-[#1A1220]">Consumable Items</h3>
                                                        </div>
                                                        <span className="shrink-0 rounded-full bg-[#F0E9FF] px-2.5 py-1 text-[11px] font-bold text-[#5A35A5]">
                                                            {bookingItems.length} {bookingItems.length === 1 ? "item" : "items"}
                                                        </span>
                                                    </div>
                                                    {bookingItems.length === 0 ? (
                                                        <div className="rounded-xl border border-dashed border-[#E6DDF0] bg-white px-3 py-4 text-center text-xs text-[#7A6A84]">
                                                            No consumable items for this booking.
                                                        </div>
                                                    ) : (
                                                        <div className="max-h-[245px] space-y-2 overflow-y-auto overscroll-contain pr-1">
                                                            {bookingItems.map((item) => {
                                                                const itemLabel = item.variant_name
                                                                    ? `${item.product_name} — ${item.variant_name}`
                                                                    : item.product_name;
                                                                const quantity = Number(item.booked_quantity || item.reserved_quantity || 0);
                                                                const priced = itemizedPrices?.salesItems.find(line =>
                                                                    itemNameKey(line.name) === itemNameKey(item.product_name) &&
                                                                    itemNameKey(line.variantName || "") === itemNameKey(item.variant_name || "") &&
                                                                    Number(line.quantity) === quantity);
                                                                const fallbackUnit = item.unit_price == null ? null : Number(item.unit_price);
                                                                const unitPrice = priced && Number.isFinite(Number(priced.unitPrice)) ? Number(priced.unitPrice)
                                                                    : fallbackUnit !== null && Number.isFinite(fallbackUnit) ? fallbackUnit : null;
                                                                const lineTotal = priced && Number.isFinite(Number(priced.amount)) ? Number(priced.amount)
                                                                    : item.total_price != null && Number.isFinite(Number(item.total_price)) ? Number(item.total_price)
                                                                        : unitPrice == null ? null : unitPrice * quantity;
                                                                return (
                                                                    <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#EFE7F4] bg-white px-3 py-2">
                                                                        <div className="min-w-0">
                                                                            <p className="truncate text-sm font-semibold text-[#1A1220]" title={itemLabel}>
                                                                                {itemLabel}
                                                                            </p>
                                                                            <p className="mt-0.5 text-[11px] text-[#806A8C]">
                                                                                {item.source_type === "package" ? "Package inclusion · Sales inventory" : "Sales inventory"}
                                                                                {item.inventory_status ? ` · ${item.inventory_status}` : ""}
                                                                            </p>
                                                                        </div>
                                                                        <div className="flex shrink-0 flex-wrap items-center gap-3 text-right text-xs text-[#4E2C66]">
                                                                            <div><p className="text-[10px] text-[#806A8C]">Quantity</p><strong>{quantity}</strong></div>
                                                                            <div><p className="text-[10px] text-[#806A8C]">Unit Price</p><strong>{unitPrice !== null ? peso(unitPrice) : "Unavailable"}</strong></div>
                                                                            <div><p className="text-[10px] text-[#806A8C]">Total Price</p><strong>{lineTotal !== null ? peso(lineTotal) : "Unavailable"}</strong></div>
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    )}
                                                    {itemizedPrices?.salesSubtotal != null && (
                                                        <div className="mt-3 flex justify-between border-t border-[#E6DDF0] pt-2 text-xs font-bold text-[#2B174C]">
                                                            <span>Consumable Items Subtotal</span><strong>{peso(itemizedPrices.salesSubtotal)}</strong>
                                                        </div>
                                                    )}
                                                </section>
                                                <section aria-label="Additional Rental Equipment" className="min-w-0 rounded-[14px] border border-[#E6DDF0] bg-[#FFFDF8] p-4">
                                                    <div className="mb-3 flex items-center justify-between gap-2">
                                                        <div className="flex min-w-0 items-center gap-2">
                                                            <Package size={14} className="shrink-0 text-[#6C3AD6]" />
                                                            <h3 className="text-[16px] font-bold text-[#1A1220]">Rental Items</h3>
                                                        </div>
                                                        <span className="shrink-0 rounded-full bg-[#F0E9FF] px-2.5 py-1 text-[11px] font-bold text-[#5A35A5]">
                                                            {bookingRentalItems.length} {bookingRentalItems.length === 1 ? "item" : "items"}
                                                        </span>
                                                    </div>
                                                    {bookingRentalItems.length === 0 ? (
                                                        <div className="rounded-xl border border-dashed border-[#E6DDF0] bg-white px-3 py-4 text-center text-xs text-[#7A6A84]">
                                                            No rental items for this booking.
                                                        </div>
                                                    ) : (
                                                        <div className="max-h-[245px] space-y-2 overflow-y-auto overscroll-contain pr-1">
                                                            {bookingRentalItems.map((item) => {
                                                                const quantity = Number(item.quantity || 0);
                                                                const priced = itemizedPrices?.rentalItems.find(line =>
                                                                    itemNameKey(line.name) === itemNameKey(item.equipment_name) &&
                                                                    Number(line.quantity) === quantity);
                                                                const days = priced ? Number(priced.days) : Number(item.billable_days || 1);
                                                                const rawRate = priced?.dailyRate ?? item.daily_rate ?? item.rental_rate;
                                                                const rate = rawRate == null || !Number.isFinite(Number(rawRate)) ? null : Number(rawRate);
                                                                const totalPrice = priced && Number.isFinite(Number(priced.amount)) ? Number(priced.amount)
                                                                    : item.amount != null && Number.isFinite(Number(item.amount)) ? Number(item.amount)
                                                                        : rate == null ? null : rate * quantity * days;
                                                                return <div key={`rental-${item.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#EFE7F4] bg-white px-3 py-2">
                                                                    <div className="min-w-0">
                                                                        <p className="truncate text-sm font-semibold text-[#1A1220]" title={item.equipment_name}>
                                                                            {item.equipment_name}
                                                                        </p>
                                                                        <p className="mt-0.5 text-[11px] text-[#806A8C]">
                                                                            Rental equipment · {item.allocation_status.replace(/_/g, " ")}
                                                                            {" · "}{item.start_date === item.end_date ? item.start_date : `${item.start_date} – ${item.end_date}`}
                                                                        </p>
                                                                    </div>
                                                                    <div className="flex shrink-0 flex-wrap items-center gap-3 text-right text-xs text-[#4E2C66]">
                                                                        <div><p className="text-[10px] text-[#806A8C]">Quantity</p><strong>{quantity}</strong></div>
                                                                        <div><p className="text-[10px] text-[#806A8C]">Days</p><strong>{Number.isFinite(days) ? days : "Unavailable"}</strong></div>
                                                                        <div><p className="text-[10px] text-[#806A8C]">Rate/Day</p><strong>{rate !== null ? peso(rate) : "Unavailable"}</strong></div>
                                                                        <div><p className="text-[10px] text-[#806A8C]">Total Price</p><strong>{totalPrice !== null ? peso(totalPrice) : "Unavailable"}</strong></div>
                                                                    </div>
                                                                </div>;
                                                            })}
                                                        </div>
                                                    )}
                                                    {itemizedPrices?.rentalSubtotal != null && (
                                                        <div className="mt-3 flex justify-between border-t border-[#E6DDF0] pt-2 text-xs font-bold text-[#2B174C]">
                                                            <span>Rental Items Subtotal</span><strong>{peso(itemizedPrices.rentalSubtotal)}</strong>
                                                        </div>
                                                    )}
                                                </section>
                                            </>
                                        )}
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

                                        <p className="mb-3 text-xs text-[#806A8C]">Customization &amp; Special Requests submitted by the customer</p>
                                        <div className="space-y-3">
                                            {([
                                                ["Additional Custom Request", getCustomerCustomRequest(b)],
                                                ["Theme / Motif Request", b.theme_motif_request || b.themeMotifRequest || b.theme || ""],
                                                ["Additional Notes", b.additional_notes || b.additionalNotes || b.notes || ""],
                                            ] as Array<[string, string]>).map(([label, value]) => (
                                                <div key={label} className="border-t border-[#E6DDF0] pt-2">
                                                    <p className="mb-1 text-xs font-bold text-[#2B174C]">{label}</p>
                                                    <p className="whitespace-pre-wrap text-sm leading-6 text-[#7A6A84]">{String(value).trim() || "None provided."}</p>
                                                </div>
                                            ))}
                                        </div>
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
                                        ) : managerView && displayStatus === "Pending Review" && !customNeedsTerms ? (
                                            <div className="rounded-xl border border-[#E6DDF0] bg-[#F7F1FF] px-3 py-3 text-center text-xs font-semibold text-[#6E5B83]">Approve booking before recording payment.</div>
                                        ) : managerView && displayStatus === "Cancelled" ? (
                                            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-3 text-center text-xs font-semibold text-red-700">Cancelled booking — payments disabled.</div>
                                        ) : isCustom && customNeedsTerms && canEditPaymentTerms ? (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onSetPrice?.(b);
                                                }}
                                                type="button"
                                                className="inline-flex h-[42px] w-full items-center justify-center rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31]"
                                            >
                                                Set Price, DP & Security Deposit
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
                                                Verify & Record Down Payment
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

                                        {isCustom && !customNeedsTerms && canManage && !ownerView && canEditPaymentTerms && (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onSetPrice?.(b);
                                                }}
                                                type="button"
                                                className="mt-3 inline-flex h-[42px] w-full items-center justify-center rounded-xl border border-[#E6DDF0] bg-white px-4 text-sm font-semibold text-[#2B174C] transition hover:bg-[#F7F1FF]"
                                            >
                                                Edit Price, DP & Security Deposit
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
                                                value={actionLabel}
                                            />
                                        </div>

                                        {ownerView || (!canManage && !(canOperateBookings && (displayStatus === "Confirmed" || displayStatus === "Preparing" || displayStatus === "Released"))) ? (
                                            <div className="rounded-xl border border-[#E6DDF0] bg-white px-3 py-3 text-center text-xs font-semibold text-[#7A6A84]">
                                                {canConfirmStandard && ["Pending Review","Awaiting Down Payment"].includes(displayStatus)
                                                    ? "Manager approval and payment confirmation are required before Staff can prepare items."
                                                    : "View-only booking status."}
                                            </div>
                                        ) : !canManage ? (
                                            <button
                                                type="button"
                                                disabled={operationsBusy || !onOperateBooking}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (displayStatus === "Confirmed" || displayStatus === "Preparing" || displayStatus === "Released") {
                                                        onOperateBooking?.(b.id, displayStatus === "Confirmed" ? "Preparing" : displayStatus === "Preparing" ? "Released" : "Completed");
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
                                                    onClick={(e) => { e.stopPropagation(); if (managerCanAdvance && !statusActionDisabled && total > 0) onUpdateStatus?.(b.id, actionNextStatus); }}
                                                    disabled={!managerCanAdvance || statusActionDisabled || total <= 0}
                                                    className="mb-2 inline-flex h-[42px] w-full items-center justify-center rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31] disabled:cursor-not-allowed disabled:bg-[#D8CBE7] disabled:text-[#806A8C]"
                                                >
                                                    {actionLabel}
                                                </button>

                                                {/* Cancel Button */}
                                                {!["Released", "Completed", "Cancelled"].includes(displayStatus) && onUpdateStatus && (
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
                                        {canConfirmStandard && ["Pending Review","Awaiting Down Payment"].includes(displayStatus) && (
                                            <div className="mt-3 flex flex-col gap-2">
                                                {b.approvalStatus !== "pending" && requiredDp > 0 ? (
                                                    <button type="button" onClick={(e)=>{e.stopPropagation(); onConfirmStandard?.(b)}}
                                                            className="min-h-[42px] rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white hover:bg-[#1B0D31]">
                                                        {displayStatus==="Pending Review"?"Approve Standard Booking":"Confirm Paid Standard Booking"}
                                                    </button>
                                                ) : null}
                                                {displayStatus==="Pending Review" && requiredDp===0 && <p className="rounded-lg bg-[#FFF8E8] px-3 py-2 text-xs text-[#A56607]">A no-DP reservation needs Manager authorization. Use Request Manager Approval below.</p>}
                                                <button type="button" onClick={(e)=>{e.stopPropagation(); onRequestApproval?.(b)}}
                                                        className="min-h-[42px] rounded-xl border border-[#D8CBE7] bg-white px-4 text-sm font-semibold text-[#2B174C] hover:bg-[#F7F1FF]">
                                                    {b.approvalStatus === "pending" ? "Update Approval Request" : "Request Manager Approval"}
                                                </button>
                                            </div>
                                        )}
                                        {canManage && !ownerView && displayStatus === "Pending Review" && b.approvalStatus === "pending" && (
                                            <p className="mt-2 text-center text-xs font-semibold text-amber-900">
                                                Manager approval starts payment collection; allocation happens only after confirmation.
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


// Select one booking from the scrollable list; reuse BookingRow for status and API actions.
export function BookingWorkspace({
                                     bookings, ownerView = false, managerView = false, listToolbar,
                                     onExportSelected, ...bookingActions
                                 }: Omit<BookingRowProps, "b" | "hideSummaryRow" | "expandedByDefault" | "detailTab" | "managerView"> & {
    bookings: Booking[];
    managerView?: boolean;
    listToolbar?: ReactNode;
    onExportSelected?: (booking: Booking, format: "pdf" | "excel") => void;
}) {
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [detailTab, setDetailTab] = useState<BookingDetailTab>("Overview");
    const [exportOpen, setExportOpen] = useState(false);
    const selectedBooking = bookings.find(booking => booking.id === selectedId) ?? bookings[0];
    const tabs: BookingDetailTab[] = ["Overview", "Billing", "Items", "Notes"];

    return (
        <div className={`grid min-w-0 gap-3 ${managerView ? "xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" : "2xl:grid-cols-[minmax(0,1.12fr)_minmax(0,0.88fr)]"}`}>
            <section aria-label="Booking list" className={`flex min-w-0 flex-col overflow-hidden rounded-[16px] border border-[#E6DDF0] bg-white shadow-sm ${managerView ? "h-[700px] xl:h-[760px]" : ""}`}>
                {managerView && <div className="px-3 pt-3 sm:px-4">
                    {listToolbar}
                </div>}
                <div className={`${managerView ? "min-h-0 flex-1" : "max-h-[640px]"} overflow-auto overscroll-contain`}>
                    <table role="grid" aria-label="Bookings" className="w-full min-w-[590px] border-collapse">
                        <thead className="sticky top-0 z-10 bg-[#FFFDF8]">
                        <tr className="border-b border-[#E6DDF0] text-left text-[11px] font-semibold text-[#806A8C]">
                            <th className="px-3 py-3">Customer / Booking Ref</th>
                            <th className="px-3 py-3">Schedule</th>
                            <th className="px-3 py-3">Type</th>
                            <th className="px-3 py-3">Payment</th>
                            <th className="px-3 py-3">Status</th>
                        </tr>
                        </thead>
                        <tbody>
                        {bookings.map(booking => {
                            const selected = booking.id === selectedBooking?.id;
                            const total = getTotalPrice(booking);
                            const paid = getAmountPaid(booking);
                            const payment = managerView ? getManagerPaymentLabel(booking) : getPaymentStatus(booking);
                            const bookingTypeLabel = managerView ? getManagerBookingTypeLabel(booking) : getBookingItemLabel(booking);
                            const status = normalizeBookingStatus(booking.status);
                            return (
                                <tr key={booking.id}
                                    onClick={() => { setSelectedId(booking.id); setDetailTab("Overview"); setExportOpen(false); }}
                                    onKeyDown={event => {
                                        if (event.key === "Enter" || event.key === " ") {
                                            event.preventDefault(); setSelectedId(booking.id); setDetailTab("Overview"); setExportOpen(false);
                                        }
                                    }}
                                    tabIndex={0} aria-selected={selected}
                                    className={`cursor-pointer border-b border-[#EFE7F4] text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#6C3AD6] ${selected ? "bg-[#F1E9FF] shadow-[inset_4px_0_0_#6C3AD6]" : "bg-white hover:bg-[#FAF6FF]"}`}>
                                    <td className="max-w-[165px] px-3 py-3 align-top">
                                        <p className="truncate text-xs font-bold text-[#1A1220]" title={booking.name}>{booking.name}</p>
                                        <p className="mt-1 truncate text-[11px] text-[#806A8C]">{booking.bookingReference || `#${booking.id}`}</p>
                                        {ownerView && <p className="mt-1 truncate text-[11px] text-[#806A8C]">{getBranchGroupName(booking)}</p>}
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-3 align-top text-xs text-[#1A1220]">
                                        <p className="font-semibold">{formatDate(booking.date)}</p>
                                        {booking.eventTime && <p className="mt-1 text-[#806A8C]">{booking.eventTime}</p>}
                                    </td>
                                    <td className="max-w-[110px] px-3 py-3 align-top">
                                        <p className="line-clamp-2 text-[11px] font-semibold text-[#1A1220]" title={bookingTypeLabel}>{bookingTypeLabel}</p>
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-3 align-top">
                                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${PAYMENT_STYLE[payment] || "border-[#E6DDF0] bg-[#F7F1FF] text-[#2B174C]"}`}>{payment}</span>
                                        <p className="mt-1 text-[11px] text-[#806A8C]">{peso(paid)} / {total > 0 ? peso(total) : "Not set"}</p>
                                    </td>
                                    <td className="px-3 py-3 align-top"><span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-1 text-[11px] font-semibold ${STATUS_STYLE[status] || "border-[#E6DDF0] bg-[#F7F1FF] text-[#2B174C]"}`}>{managerView ? getManagerBookingStatusLabel(status) : status}</span></td>
                                </tr>
                            );
                        })}
                        </tbody>
                    </table>
                    {bookings.length === 0 && <p className="p-8 text-center text-sm text-[#806A8C]">No bookings match the selected filters.</p>}
                </div>
                {managerView && <div className="border-t border-[#EFE7F4] px-4 py-2 text-xs text-[#806A8C]">Showing {bookings.length} booking{bookings.length === 1 ? "" : "s"}</div>}
            </section>
            <section aria-label="Selected booking details" className={`flex min-w-0 flex-col overflow-hidden rounded-[16px] border border-[#E6DDF0] bg-white shadow-sm ${managerView ? "h-[700px] xl:h-[760px]" : "max-h-[760px]"}`}>
                {selectedBooking ? <>
                    <div className="shrink-0 border-b border-[#EFE7F4] px-4 py-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                                <h2 className="truncate text-[18px] font-bold text-[#1A1220]">{selectedBooking.name}</h2>
                                <p className="mt-0.5 text-xs font-semibold text-[#806A8C]">{selectedBooking.bookingReference || `Booking #${selectedBooking.id}`}</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className={`inline-flex shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${STATUS_STYLE[normalizeBookingStatus(selectedBooking.status)] || "border-[#E6DDF0] bg-[#F7F1FF] text-[#2B174C]"}`}>{managerView ? getManagerBookingStatusLabel(selectedBooking.status) : normalizeBookingStatus(selectedBooking.status)}</span>
                                {managerView && onExportSelected && <div className="relative">
                                    <button type="button" aria-label="Export selected booking" title="Export selected booking" onClick={() => setExportOpen(v => !v)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#D9C9EB] text-[#43217A] hover:bg-[#F3EEFF]"><Download size={16}/></button>
                                    {exportOpen && <div className="absolute right-0 top-10 z-30 w-40 rounded-xl border border-[#E6DDF0] bg-white p-1.5 shadow-xl">
                                        <button type="button" onClick={() => {onExportSelected(selectedBooking, "pdf");setExportOpen(false);}} className="block w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-[#F7F1FF]">Download PDF</button>
                                        <button type="button" onClick={() => {onExportSelected(selectedBooking, "excel");setExportOpen(false);}} className="block w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-[#F7F1FF]">Download Excel (.xlsx)</button>
                                    </div>}
                                </div>}
                            </div>
                        </div>
                        {!managerView && <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#5F4E75]">
                            <span>{formatDate(selectedBooking.date)}{selectedBooking.eventTime ? ` · ${selectedBooking.eventTime}` : ""}</span>
                            <span className="max-w-full truncate">{getBranchGroupName(selectedBooking)}</span>
                            <span className="max-w-full truncate" title={getBookingItemLabel(selectedBooking)}>{getBookingItemLabel(selectedBooking)}</span>
                        </div>}
                        <div className="mt-3 grid grid-cols-4 gap-1 rounded-xl bg-[#F7F1FF] p-1" role="tablist" aria-label="Booking detail sections">
                            {tabs.map(tab => <button key={tab} type="button" role="tab" aria-selected={tab === detailTab} onClick={() => setDetailTab(tab)} className={`min-w-0 rounded-lg px-1.5 py-2 text-[11px] font-semibold transition ${tab === detailTab ? "bg-white text-[#2B174C] shadow-sm" : "text-[#806A8C] hover:bg-white/60"}`}>{tab}</button>)}
                        </div>
                    </div>
                    <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
                        <table className="w-full table-fixed border-collapse"><tbody>
                        <BookingRow key={selectedBooking.id} b={selectedBooking} ownerView={ownerView} managerView={managerView} {...bookingActions} hideSummaryRow expandedByDefault detailTab={detailTab}/>
                        </tbody></table>
                    </div>
                </> : <div className="p-8 text-center text-sm text-[#806A8C]">No booking selected.</div>}
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

