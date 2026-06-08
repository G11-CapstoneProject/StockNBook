"use client";

import RoleSidebar from "@/components/sidebar/RoleSidebar";
import RequirePermission from "@/components/permissions/RequirePermission";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useEffect, useMemo, useState } from "react";
import {
  Check,
  X,
  Clock,
  MessageCircle,
  Package,
  Sparkles,
  PhilippinePeso,
  Search,
  RefreshCw,
  MoreVertical,
  ChevronDown,
} from "lucide-react";

type Booking = {
  id: number;
  branchId?: number | null;
  branchName?: string | null;
  branch_id?: number | null;
  branch_name?: string | null;
  bookingReference?: string;
  booking_reference?: string;
  bookingType?: string;
  booking_type?: string;
  name: string;
  facebookName?: string;
  facebook_name?: string;
  phone?: string;
  date: string;
  eventTime?: string;
  event_time?: string;
  eventType?: string;
  event_type?: string;
  package?: string;
  package_name?: string;
  customOrder?: string;
  custom_order?: string;
  theme?: string;
  venue?: string;
  notes?: string;
  status: string;
  agreed_price?: number | null;
  agreedPrice?: number | null;
  payment_status?: string;
  paymentStatus?: string;
  createdAt?: string;
  created_at?: string;
};

type BookingAccess = "none" | "view" | "full";

const TABS = [
  "All",
  "Pending Review",
  "Confirmed",
  "Preparing",
  "Completed",
  "Cancelled",
] as const;

type FilterType = (typeof TABS)[number];

const STATUS_STYLE: Record<string, string> = {
  "Pending Review": "bg-[#FFF4D8] text-[#8A5A00]",
  Confirmed: "bg-[#EAF4DC] text-[#3F6B15]",
  Preparing: "bg-[#EFE7FF] text-[#4E2C85]",
  Completed: "bg-[#E6F6EA] text-[#226B36]",
  Cancelled: "bg-[#FFE5E5] text-[#9A2424]",
};

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeBooking(raw: any, fallbackBranchName = ""): Booking {
  const branchId = raw.branchId ?? raw.branch_id ?? raw.branchID ?? null;

  const branchName =
      raw.branchName ??
      raw.branch_name ??
      raw.branch ??
      raw.branchTitle ??
      raw.branch_title ??
      raw.assignedBranchName ??
      raw.assigned_branch_name ??
      fallbackBranchName ??
      "";

  const customOrder =
      raw.customOrder ??
      raw.custom_order ??
      raw.customRequest ??
      raw.custom_request ??
      raw.custom_order_details ??
      "";

  const bookingType =
      raw.bookingType ??
      raw.booking_type ??
      (customOrder ? "custom" : "package");

  return {
    ...raw,
    id: Number(raw.id ?? raw.booking_id),
    branchId: branchId !== null && branchId !== undefined ? Number(branchId) : null,
    branchName: cleanText(branchName),
    bookingReference: raw.bookingReference ?? raw.booking_reference ?? "",
    bookingType,
    name: raw.name ?? raw.customer_name ?? "",
    facebookName: raw.facebookName ?? raw.facebook_name ?? "",
    phone: raw.phone ?? raw.contact_number ?? "",
    date: raw.date ?? raw.event_date ?? "",
    eventTime: raw.eventTime ?? raw.event_time ?? "",
    eventType: raw.eventType ?? raw.event_type ?? "",
    package: raw.package ?? raw.package_name ?? raw.packageName ?? "",
    customOrder,
    theme: raw.theme ?? "",
    venue: raw.venue ?? "",
    notes: raw.notes ?? "",
    status: raw.status ?? "Pending Review",
    agreed_price:
        raw.agreed_price !== undefined && raw.agreed_price !== null
            ? Number(raw.agreed_price)
            : raw.agreedPrice !== undefined && raw.agreedPrice !== null
                ? Number(raw.agreedPrice)
                : null,
    payment_status: raw.payment_status ?? raw.paymentStatus ?? "",
    createdAt: raw.createdAt ?? raw.created_at ?? "",
  };
}

function isCustomBooking(b: Booking) {
  return (
      b.bookingType === "custom" ||
      b.booking_type === "custom" ||
      Boolean(b.customOrder) ||
      Boolean(b.custom_order)
  );
}

function peso(n?: number | null) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";

  return `₱${Number(n).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(date?: string) {
  if (!date) return "—";

  return new Date(date).toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function shortDate(date?: string) {
  if (!date) return "—";

  return new Date(date).toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
  });
}

function getBookingItemLabel(b: Booking) {
  if (isCustomBooking(b)) return b.eventType || "Custom Booking";
  return b.package || "Package";
}

function getBookingItemSubtext(b: Booking) {
  if (isCustomBooking(b)) return b.customOrder || b.custom_order || "Custom request";
  return b.eventType || "Package booking";
}

function getBranchGroupName(b: Booking) {
  const name = cleanText(b.branchName ?? b.branch_name);

  if (name) return name;

  if (b.branchId || b.branch_id) {
    return `Branch #${b.branchId ?? b.branch_id}`;
  }

  return "Unassigned Branch";
}

function getSavedPermissions() {
  if (typeof window === "undefined") return {};

  try {
    return JSON.parse(sessionStorage.getItem("permissions") || "{}") as Record<
        string,
        boolean | string
    >;
  } catch {
    return {};
  }
}

function getSavedBookingAccess(
    role: string,
    latestPermissions?: Record<string, boolean | string>
): BookingAccess {
  if (role === "owner") return "full";

  const permissions = latestPermissions || getSavedPermissions();

  const directAccess = permissions.bookings;

  const levelAccess =
      permissions.bookings_access ||
      permissions.booking_access;

  if (directAccess !== true) return "none";

  if (levelAccess === "full") return "full";
  if (levelAccess === "view") return "view";
  if (levelAccess === "none") return "none";

  return "full";
}

function PriceModal({
                      booking,
                      onConfirm,
                      onClose,
                    }: {
  booking: Booking;
  onConfirm: (price: number) => void;
  onClose: () => void;
}) {
  const [price, setPrice] = useState(booking.agreed_price?.toString() || "");
  const [error, setError] = useState("");

  function handleConfirm() {
    const parsed = parseFloat(price);

    if (!price || Number.isNaN(parsed) || parsed <= 0) {
      setError("Please enter a valid amount.");
      return;
    }

    onConfirm(parsed);
  }

  const isCustom = isCustomBooking(booking);

  return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 px-4">
        <div className="w-full max-w-md rounded-[22px] border border-[#E6DDF0] bg-[#FFFDF8] p-5 shadow-2xl">
          <h3 className="font-serif text-lg font-semibold text-[#1A1220]">
            Set Agreed Amount
          </h3>

          <p className="mt-1 text-xs leading-relaxed text-[#7A6A84]">
            Enter the amount agreed with{" "}
            <span className="font-semibold text-[#1A1220]">{booking.name}</span>.
          </p>

          <div className="mt-4">
            <label className="mb-2 block text-xs font-semibold text-[#5A476A]">
              Agreed Amount (₱)
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
                  className="w-full rounded-xl border border-[#E6DDF0] bg-white py-3 pl-10 pr-4 text-sm outline-none focus:border-[#2B174C]"
              />
            </div>

            {error && <p className="mt-1.5 text-xs font-medium text-red-500">{error}</p>}
          </div>

          <div className="mt-4 rounded-xl bg-[#F8F2EA] p-3 text-xs text-[#6A5D6F]">
            <p className="font-semibold text-[#1A1220]">
              {isCustom ? "Custom Request:" : "Booking:"}
            </p>
            <p className="mt-1">{getBookingItemSubtext(booking)}</p>
          </div>

          <div className="mt-5 flex gap-3">
            <button
                onClick={onClose}
                className="flex-1 rounded-xl border border-[#E6DDF0] bg-white py-3 text-xs font-semibold text-[#5A476A] hover:bg-[#FAF7F2]"
            >
              Cancel
            </button>

            <button
                onClick={handleConfirm}
                className="flex-1 rounded-xl bg-[#2B174C] py-3 text-xs font-semibold text-white hover:bg-[#1B0D31]"
            >
              Save Amount
            </button>
          </div>
        </div>
      </div>
  );
}

function BookingRow({
                      b,
                      ownerView = false,
                      canManage = true,
                      onUpdateStatus,
                      onSetPrice,
                    }: {
  b: Booking;
  ownerView?: boolean;
  canManage?: boolean;
  onUpdateStatus?: (id: number, status: string, price?: number) => void;
  onSetPrice?: (b: Booking) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isCustom = isCustomBooking(b);

  const messengerLink = b.facebookName
      ? `https://www.facebook.com/search/top?q=${encodeURIComponent(b.facebookName)}`
      : null;

  const typeLabel = isCustom ? "Custom" : "Package";
  const itemLabel = getBookingItemLabel(b);
  const itemSubtext = getBookingItemSubtext(b);
  const needsAmount = isCustom && !b.agreed_price && !ownerView && canManage;

  return (
      <>
        <tr className="border-b border-[#EFE7F4] bg-white transition hover:bg-[#FFFCF7]">
          <td className="px-4 py-3 align-top">
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
              <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold ${
                      isCustom
                          ? "bg-[#FFE8F4] text-[#9A2F67]"
                          : "bg-[#EEE8FF] text-[#4B2B83]"
                  }`}
              >
                {isCustom ? <Sparkles size={9} /> : <Package size={9} />}
                {typeLabel}
              </span>

                {b.bookingReference && (
                    <span className="font-mono text-[10px] font-semibold text-[#6D4A91]">
                  {b.bookingReference}
                </span>
                )}
              </div>

              <p className="font-serif text-sm font-semibold text-[#1A1220]">{b.name}</p>

              {b.facebookName && (
                  <p className="text-[11px] text-[#9B8AAA]">FB: {b.facebookName}</p>
              )}
            </div>
          </td>

          <td className="px-4 py-3 align-top">
            <p className="font-serif text-sm text-[#1A1220]">{shortDate(b.date)}</p>
            {b.eventTime && <p className="mt-1 text-[11px] text-[#9B8AAA]">{b.eventTime}</p>}
          </td>

          <td className="px-4 py-3 align-top">
            <p className="max-w-[210px] truncate font-serif text-sm text-[#1A1220]">
              {itemLabel}
            </p>
            <p className="mt-1 max-w-[210px] truncate text-[11px] text-[#9B8AAA]">
              {itemSubtext}
            </p>
          </td>

          <td className="px-4 py-3 align-top">
            {needsAmount ? (
                <button
                    onClick={() => onSetPrice?.(b)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#D9D0E5] bg-[#F7F1FF] px-2.5 py-1.5 text-[11px] font-semibold text-[#2B174C] hover:bg-[#EFE8F8]"
                >
                  <PhilippinePeso size={12} />
                  Set Amount
                </button>
            ) : (
                <>
                  <p className="font-serif text-sm text-[#1A1220]">{peso(b.agreed_price)}</p>
                  {b.payment_status && (
                      <p className="mt-1 text-[11px] text-[#9B8AAA]">{b.payment_status}</p>
                  )}
                </>
            )}
          </td>

          <td className="px-4 py-3 align-top">
          <span
              className={`inline-flex rounded-md px-2.5 py-1 text-[11px] font-semibold ${
                  STATUS_STYLE[b.status] || "bg-gray-100 text-gray-600"
              }`}
          >
            {b.status}
          </span>
          </td>

          <td className="px-4 py-3 align-top">
            <div className="flex flex-wrap items-center justify-end gap-2">
              {messengerLink && (
                  <a
                      href={messengerLink}
                      target="_blank"
                      rel="noreferrer"
                      title="Open Messenger"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[#D9D0E5] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#2B174C] hover:bg-[#F7F1FF]"
                  >
                    <MessageCircle size={12} />
                    Messenger
                  </a>
              )}

              <button
                  onClick={() => setExpanded((v) => !v)}
                  className="rounded-lg border border-[#D9D0E5] bg-white p-1.5 text-[#5F4E75] hover:bg-[#F7F1FF]"
                  title="View details"
              >
                <MoreVertical size={14} />
              </button>
            </div>
          </td>
        </tr>

        {expanded && (
            <tr className="border-b border-[#EFE7F4] bg-[#FFFCF7]">
              <td colSpan={6} className="px-4 py-4">
                <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
                  <div className="grid gap-3 text-sm md:grid-cols-3">
                    <Detail label="Branch" value={getBranchGroupName(b)} />
                    <Detail label="Full Date" value={formatDate(b.date)} />
                    {b.eventTime && <Detail label="Time" value={b.eventTime} />}
                    {b.phone && <Detail label="Phone" value={b.phone} />}
                    {b.venue && <Detail label="Venue" value={b.venue} />}
                    {b.theme && <Detail label="Theme" value={b.theme} />}
                    {!isCustom && b.package && <Detail label="Package" value={b.package} />}
                    {isCustom && b.eventType && <Detail label="Event Type" value={b.eventType} />}
                    {isCustom && <Detail label="Agreed Amount" value={peso(b.agreed_price)} />}
                  </div>

                  <div className="rounded-xl border border-[#E6DDF0] bg-white p-3">
                    <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#9B8AAA]">
                      {ownerView ? "Owner View" : canManage ? "Actions" : "View Only"}
                    </p>

                    {ownerView ? (
                        <p className="text-xs leading-relaxed text-[#6A5D6F]">
                          This is a branch monitoring view. Booking status updates are managed from the assigned branch account.
                        </p>
                    ) : !canManage ? (
                        <p className="text-xs leading-relaxed text-[#6A5D6F]">
                          View only access. You can review booking details, but status updates and amount changes are disabled.
                        </p>
                    ) : (
                        <div className="flex flex-wrap gap-2">
                          {b.status === "Pending Review" && (
                              <>
                                {isCustom ? (
                                    <>
                                      <button
                                          onClick={() => onSetPrice?.(b)}
                                          className="inline-flex items-center gap-1.5 rounded-lg border border-[#D9D0E5] bg-white px-3 py-2 text-[11px] font-semibold text-[#5F4E75] hover:bg-[#F7F1FF]"
                                      >
                                        <PhilippinePeso size={12} />
                                        {b.agreed_price ? "Edit Amount" : "Set Amount"}
                                      </button>

                                      {b.agreed_price && (
                                          <button
                                              onClick={() => onUpdateStatus?.(b.id, "Confirmed")}
                                              className="inline-flex items-center gap-1.5 rounded-lg bg-[#2B174C] px-3 py-2 text-[11px] font-semibold text-white hover:bg-[#1B0D31]"
                                          >
                                            <Check size={12} />
                                            Confirm
                                          </button>
                                      )}
                                    </>
                                ) : (
                                    <button
                                        onClick={() => onUpdateStatus?.(b.id, "Confirmed")}
                                        className="inline-flex items-center gap-1.5 rounded-lg bg-[#2B174C] px-3 py-2 text-[11px] font-semibold text-white hover:bg-[#1B0D31]"
                                    >
                                      <Check size={12} />
                                      Confirm
                                    </button>
                                )}

                                <button
                                    onClick={() => onUpdateStatus?.(b.id, "Cancelled")}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-600 hover:bg-red-100"
                                >
                                  <X size={12} />
                                  Cancel
                                </button>
                              </>
                          )}

                          {b.status === "Confirmed" && (
                              <button
                                  onClick={() => onUpdateStatus?.(b.id, "Preparing")}
                                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#2B174C] px-3 py-2 text-[11px] font-semibold text-white hover:bg-[#1B0D31]"
                              >
                                <Clock size={12} />
                                Mark as Preparing
                              </button>
                          )}

                          {b.status === "Preparing" && (
                              <button
                                  onClick={() => onUpdateStatus?.(b.id, "Completed")}
                                  className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-2 text-[11px] font-semibold text-white hover:bg-green-700"
                              >
                                <Check size={12} />
                                Mark as Completed
                              </button>
                          )}

                          {(b.status === "Confirmed" || b.status === "Preparing") && (
                              <button
                                  onClick={() => onUpdateStatus?.(b.id, "Cancelled")}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-600 hover:bg-red-100"
                              >
                                <X size={12} />
                                Cancel
                              </button>
                          )}

                          {isCustom && b.status !== "Cancelled" && (
                              <button
                                  onClick={() => onSetPrice?.(b)}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#D9D0E5] bg-white px-3 py-2 text-[11px] font-semibold text-[#5F4E75] hover:bg-[#F7F1FF]"
                              >
                                <PhilippinePeso size={12} />
                                {b.agreed_price ? "Edit Amount" : "Set Amount"}
                              </button>
                          )}
                        </div>
                    )}
                  </div>
                </div>

                {isCustom && (b.customOrder || b.custom_order) && (
                    <div className="mt-3 rounded-xl bg-[#FFEAF5] px-3 py-2 text-xs text-[#6A5D6F]">
                      <span className="font-semibold text-[#9A2F67]">Custom Request: </span>
                      {b.customOrder || b.custom_order}
                    </div>
                )}

                {b.notes && (
                    <div className="mt-3 rounded-xl bg-[#F8F2EA] px-3 py-2 text-xs text-[#6A5D6F]">
                      <span className="font-semibold text-[#5A476A]">Notes: </span>
                      {b.notes}
                    </div>
                )}
              </td>
            </tr>
        )}
      </>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
      <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9B8AAA]">
        {label}
      </span>
        <span className="font-serif text-xs font-semibold text-[#1A1220]">
        {value}
      </span>
      </div>
  );
}

function BranchSummaryCard({
                             name,
                             bookings,
                             isOpen,
                             onToggle,
                           }: {
  name: string;
  bookings: Booking[];
  isOpen: boolean;
  onToggle: () => void;
}) {
  const total = bookings.length;
  const pending = bookings.filter((b) => b.status === "Pending Review").length;
  const active = bookings.filter(
      (b) => b.status === "Confirmed" || b.status === "Preparing"
  ).length;
  const completed = bookings.filter((b) => b.status === "Completed").length;
  const cancelled = bookings.filter((b) => b.status === "Cancelled").length;

  return (
      <button
          onClick={onToggle}
          className={`rounded-[18px] border p-4 text-left shadow-sm transition ${
              isOpen
                  ? "border-[#2B174C] bg-[#F7F1FF]"
                  : "border-[#E6DDF0] bg-white hover:bg-[#FFFCF7]"
          }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-serif text-base font-semibold text-[#1A1220]">{name}</p>
            <p className="mt-1 text-xs text-[#8A7A91]">{total} total bookings</p>
          </div>

          <ChevronDown
              size={16}
              className={`text-[#5F4E75] transition ${isOpen ? "rotate-180" : ""}`}
          />
        </div>

        <div className="mt-4 grid grid-cols-4 gap-2">
          <MiniStat label="Pending" value={pending} />
          <MiniStat label="Active" value={active} />
          <MiniStat label="Done" value={completed} />
          <MiniStat label="Cancel" value={cancelled} />
        </div>
      </button>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
      <div className="rounded-xl bg-[#FFFDF8] px-2 py-2 text-center">
        <p className="font-serif text-base font-semibold text-[#1A1220]">{value}</p>
        <p className="text-[9px] uppercase tracking-[0.12em] text-[#9B8AAA]">
          {label}
        </p>
      </div>
  );
}

export default function BookingManagementPage() {
  const { user } = useCurrentUser();

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [filter, setFilter] = useState<FilterType>("All");
  const [branchName, setBranchName] = useState("");
  const [role, setRole] = useState("");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [priceModal, setPriceModal] = useState<Booking | null>(null);
  const [openBranch, setOpenBranch] = useState<string>("");

  const currentRole = user?.role || role;
  const currentPermissions = user?.permissions;

  const bookingAccess: BookingAccess = getSavedBookingAccess(
      currentRole,
      currentPermissions
  );

  const canManageBookings: boolean = bookingAccess === "full";

  async function loadBookings() {
    setLoading(true);

    const token = sessionStorage.getItem("token");
    const currentRole = (sessionStorage.getItem("role") || "").toLowerCase();

    const storeId =
        sessionStorage.getItem("store_id") ||
        sessionStorage.getItem("stocknbook_store_id");

    const branchId =
        sessionStorage.getItem("branch_id") ||
        sessionStorage.getItem("stocknbook_branch_id");

    const savedBranchName =
        sessionStorage.getItem("branch_name") ||
        sessionStorage.getItem("stocknbook_branch_name") ||
        "";

    setBranchName(savedBranchName);
    setRole(currentRole);

    if (!token || !storeId) {
      setBookings([]);
      setLoading(false);
      return;
    }

    try {
      const body: Record<string, unknown> = {
        action: "get_bookings",
        store_id: Number(storeId),
        role: currentRole,
      };

      if (currentRole === "manager" || currentRole === "staff") {
        if (!branchId) {
          console.error("Missing branch_id for", currentRole);
          setBookings([]);
          setLoading(false);
          return;
        }

        body.branch_id = Number(branchId);
      }

      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        setBookings([]);
        return;
      }

      const normalizedBookings = (data.bookings || []).map((b: any) =>
          normalizeBooking(
              b,
              currentRole === "manager" || currentRole === "staff" ? savedBranchName : ""
          )
      );

      setBookings(normalizedBookings);
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

  async function updateStatus(id: number, newStatus: string, price?: number) {
    if (!canManageBookings) return;

    const token = sessionStorage.getItem("token");

    const currentRole = (sessionStorage.getItem("role") || "").toLowerCase();
    const branchId =
        sessionStorage.getItem("branch_id") ||
        sessionStorage.getItem("stocknbook_branch_id");

    try {
      const body: Record<string, unknown> = {
        action: "update_status",
        booking_id: id,
        status: newStatus,
      };

      if ((currentRole === "manager" || currentRole === "staff") && branchId) {
        body.branch_id = Number(branchId);
      }

      if (price !== undefined) body.agreed_price = price;

      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error("Failed");

      setBookings((prev) =>
          prev.map((b) =>
              b.id === id
                  ? {
                    ...b,
                    status: newStatus,
                    ...(price !== undefined ? { agreed_price: price } : {}),
                  }
                  : b
          )
      );
    } catch (err) {
      console.error("Failed to update:", err);
    }
  }

  async function updatePriceOnly(booking: Booking, price: number) {
    if (!canManageBookings) return;

    const token = sessionStorage.getItem("token");

    const currentRole = (sessionStorage.getItem("role") || "").toLowerCase();
    const branchId =
        sessionStorage.getItem("branch_id") ||
        sessionStorage.getItem("stocknbook_branch_id");

    try {
      const body: Record<string, unknown> = {
        action: "update_price",
        booking_id: booking.id,
        agreed_price: price,
      };

      if ((currentRole === "manager" || currentRole === "staff") && branchId) {
        body.branch_id = Number(branchId);
      }

      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error("Failed");

      setBookings((prev) =>
          prev.map((b) => (b.id === booking.id ? { ...b, agreed_price: price } : b))
      );
    } catch (err) {
      console.error("Failed to update price:", err);
    }
  }

  async function handlePriceConfirm(price: number) {
    if (!priceModal) return;
    await updatePriceOnly(priceModal, price);
    setPriceModal(null);
  }

  const filtered = bookings
      .filter((b) => filter === "All" || b.status === filter)
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
            b.eventType?.toLowerCase().includes(q)
        );
      });

  const counts = TABS.reduce((acc, tab) => {
    acc[tab] =
        tab === "All" ? bookings.length : bookings.filter((b) => b.status === tab).length;
    return acc;
  }, {} as Record<string, number>);

  const branchGroups = useMemo(() => {
    const groups: Record<string, Booking[]> = {};

    filtered.forEach((booking) => {
      const key = getBranchGroupName(booking);
      if (!groups[key]) groups[key] = [];
      groups[key].push(booking);
    });

    return groups;
  }, [filtered]);

  const branchNames = Object.keys(branchGroups);
  const displayScope = role === "owner" ? "Grouped by Branch" : branchName || "Assigned Branch";

  const currentMonth = new Date().toLocaleDateString("en-PH", {
    month: "long",
    year: "numeric",
  });

  const isOwner = role === "owner";

  return (
      <RequirePermission permission="bookings">
        <div
            className="flex min-h-screen text-[#1A1220]"
            style={{
              backgroundColor: "#FDFAF4",
              fontFamily: "Georgia, 'Times New Roman', serif",
            }}
        >
          <RoleSidebar />

          <main className="flex-1 overflow-y-auto">
            <div className="sticky top-0 z-20 border-b border-[#E9E0EF] bg-[#FFFDF8]/95 backdrop-blur">
              <div className="flex items-center justify-between px-5 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="font-serif text-[22px] font-semibold text-[#1A1220]">
                    Bookings
                  </h1>

                  <span className="rounded-md bg-[#EFE8F8] px-3 py-1 text-xs font-medium text-[#4E2C66]">
                  {displayScope}
                </span>

                  {!isOwner && bookingAccess === "view" && (
                      <span className="rounded-md bg-[#F8F2EA] px-3 py-1 text-xs font-medium text-[#7A6A84]">
                    View only
                  </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <div className="rounded-lg border border-[#E6DDF0] bg-white px-4 py-2 text-xs text-[#6A5D6F] shadow-sm">
                    {currentMonth}
                  </div>

                  <button
                      onClick={() => void loadBookings()}
                      className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#E6DDF0] bg-white text-[#5F4E75] shadow-sm hover:bg-[#F7F1FF]"
                      title="Refresh"
                  >
                    <RefreshCw size={15} />
                  </button>

                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#2B174C] text-xs font-semibold text-white shadow-sm">
                    {role === "owner" ? "OW" : role === "staff" ? "ST" : "MG"}
                  </div>
                </div>
              </div>
            </div>

            <div className="px-5 py-5">
              <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
                <div className="relative flex-1">
                  <Search
                      size={15}
                      className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9B8AAA]"
                  />
                  <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder={
                        isOwner
                            ? "Search branch, client, reference, custom request..."
                            : "Search bookings, package, custom request..."
                      }
                      className="w-full rounded-xl border border-[#E3D8EA] bg-white px-4 py-3 pl-10 text-sm text-[#1A1220] outline-none shadow-sm placeholder:text-[#9B8AAA] focus:border-[#2B174C]"
                      style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
                  />
                </div>

                <button
                    onClick={() => void loadBookings()}
                    className="rounded-xl bg-[#2B174C] px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-[#1B0D31]"
                >
                  Refresh bookings
                </button>
              </div>

              <div className="mb-4 flex flex-wrap gap-2">
                {TABS.map((tab) => (
                    <button
                        key={tab}
                        onClick={() => setFilter(tab)}
                        className={`rounded-full px-3 py-1.5 text-[11px] font-semibold transition ${
                            filter === tab
                                ? "bg-[#2B174C] text-white shadow-sm"
                                : "border border-[#E6DDF0] bg-white text-[#6A5D6F] hover:bg-[#F7F1FF]"
                        }`}
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

              {loading ? (
                  <div className="rounded-[16px] border border-[#E6DDF0] bg-white px-4 py-12 text-center text-sm text-[#9B8AAA] shadow-sm">
                    Loading bookings...
                  </div>
              ) : filtered.length === 0 ? (
                  <div className="rounded-[16px] border border-[#E6DDF0] bg-white px-4 py-12 text-center text-sm text-[#9B8AAA] shadow-sm">
                    No bookings found.
                  </div>
              ) : isOwner ? (
                  <div className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {branchNames.map((branch) => (
                          <BranchSummaryCard
                              key={branch}
                              name={branch}
                              bookings={branchGroups[branch]}
                              isOpen={openBranch === branch}
                              onToggle={() => setOpenBranch(openBranch === branch ? "" : branch)}
                          />
                      ))}
                    </div>

                    {openBranch && branchGroups[openBranch] && (
                        <div className="overflow-hidden rounded-[16px] border border-[#E6DDF0] bg-white shadow-sm">
                          <div className="border-b border-[#E6DDF0] bg-[#FFFCF7] px-4 py-3">
                            <p className="font-serif text-base font-semibold text-[#1A1220]">
                              {openBranch}
                            </p>
                            <p className="text-xs text-[#8A7A91]">
                              {branchGroups[openBranch].length} bookings shown for this branch.
                            </p>
                          </div>

                          <div className="overflow-x-auto">
                            <table className="w-full min-w-[840px] border-collapse">
                              <thead>
                              <tr className="border-b border-[#E6DDF0] bg-white">
                                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-[#806A8C]">
                                  Client
                                </th>
                                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-[#806A8C]">
                                  Date
                                </th>
                                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-[#806A8C]">
                                  Booking
                                </th>
                                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-[#806A8C]">
                                  Amount
                                </th>
                                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-[#806A8C]">
                                  Status
                                </th>
                                <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.12em] text-[#806A8C]">
                                  View
                                </th>
                              </tr>
                              </thead>

                              <tbody>
                              {branchGroups[openBranch].map((b) => (
                                  <BookingRow key={b.id} b={b} ownerView />
                              ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                    )}
                  </div>
              ) : (
                  <div className="overflow-hidden rounded-[16px] border border-[#E6DDF0] bg-white shadow-sm">
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[840px] border-collapse">
                        <thead>
                        <tr className="border-b border-[#E6DDF0] bg-white">
                          <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-[#806A8C]">
                            Client
                          </th>
                          <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-[#806A8C]">
                            Date
                          </th>
                          <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-[#806A8C]">
                            Booking
                          </th>
                          <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-[#806A8C]">
                            Amount
                          </th>
                          <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-[#806A8C]">
                            Status
                          </th>
                          <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.12em] text-[#806A8C]">
                            {canManageBookings ? "Actions" : "View"}
                          </th>
                        </tr>
                        </thead>

                        <tbody>
                        {filtered.map((b) => (
                            <BookingRow
                                key={b.id}
                                b={b}
                                canManage={canManageBookings}
                                onUpdateStatus={updateStatus}
                                onSetPrice={canManageBookings ? setPriceModal : undefined}
                            />
                        ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
              )}
            </div>
          </main>

          {priceModal && canManageBookings && (
              <PriceModal
                  booking={priceModal}
                  onConfirm={handlePriceConfirm}
                  onClose={() => setPriceModal(null)}
              />
          )}
        </div>
      </RequirePermission>
  );
}