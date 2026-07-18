"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { CalendarDays, Download, TriangleAlert, Gift, RefreshCw, Star } from "lucide-react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { useInventoryController } from "@/hooks/useInventory";
import {
    InventoryDialogs,
    type Product as InventoryProduct,
} from "@/components/inventory/_shared";


type DashboardPdfCell =
    | string
    | number
    | null
    | undefined;

type DashboardPdfColumn = {
    header: string;
    align?: "left" | "center" | "right";
    width?: number;
};

type DashboardPdfOptions = {
    filename: string;
    reportTitle: string;
    storeName: string;
    branchName: string;
    generatedAt?: Date;
    columns: DashboardPdfColumn[];
    rows: DashboardPdfCell[][];
};

const PDF_PURPLE: [number, number, number] = [43, 23, 76];
const PDF_TEXT: [number, number, number] = [28, 24, 34];
const PDF_MUTED: [number, number, number] = [92, 80, 103];
const PDF_GRID: [number, number, number] = [224, 217, 231];
const PDF_ALT_ROW: [number, number, number] = [250, 248, 252];

function safeDashboardPdfText(value: DashboardPdfCell) {
    if (value === null || value === undefined || value === "") {
        return "-";
    }

    return String(value);
}

function cleanDashboardPdfFilename(filename: string) {
    const cleaned = filename
        .trim()
        .replace(/\.pdf$/i, "")
        .replace(/[^a-zA-Z0-9-_]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");

    return `${cleaned || "stocknbook-dashboard-report"}.pdf`;
}

function formatDashboardPdfShortDate(value: Date) {
    return value.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
    });
}

function getDashboardPdfDateRange(generatedAt: Date) {
    const startDate = new Date(
        generatedAt.getFullYear(),
        generatedAt.getMonth(),
        1,
    );

    return `${formatDashboardPdfShortDate(startDate)} - ${formatDashboardPdfShortDate(
        generatedAt,
    )}`;
}

function formatDashboardPdfDate(value?: string) {
    if (!value) return "-";

    const parsed = new Date(value);

    if (Number.isNaN(parsed.getTime())) {
        return value;
    }

    return parsed.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
    });
}

function formatDashboardPdfCurrency(value: number) {
    return `PHP ${Number(value || 0).toLocaleString("en-PH", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    })}`;
}

function downloadDashboardPdf({
                                  filename,
                                  reportTitle,
                                  storeName,
                                  branchName,
                                  generatedAt = new Date(),
                                  columns,
                                  rows,
                              }: DashboardPdfOptions) {
    const doc = new jsPDF({
        orientation: "landscape",
        unit: "pt",
        format: "a4",
        compress: true,
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const leftMargin = 32;
    const rightMargin = 32;
    const tableStartY = 82;
    const footerY = pageHeight - 16;

    doc.setProperties({
        title: `StockNBook - ${reportTitle}`,
        subject: `${reportTitle} generated from the StockNBook dashboard`,
        author: "StockNBook",
        creator: "StockNBook",
    });

    const tableRows =
        rows.length > 0
            ? rows.map((row) =>
                columns.map((_, index) =>
                    safeDashboardPdfText(row[index]),
                ),
            )
            : [
                columns.map((_, index) =>
                    index === 0 ? "No records available." : "",
                ),
            ];

    const columnStyles = Object.fromEntries(
        columns.map((column, index) => [
            index,
            {
                halign: column.align || "left",
                ...(column.width
                    ? { cellWidth: column.width }
                    : {}),
            },
        ]),
    );

    const drawHeader = (pageNumber: number) => {
        const title =
            pageNumber === 1
                ? `StockNBook - ${reportTitle}`
                : `StockNBook - ${reportTitle} (continued)`;

        doc.setTextColor(...PDF_TEXT);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(16);
        doc.text(title, leftMargin, 28);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
        doc.setTextColor(...PDF_MUTED);
        doc.text(
            `Store: ${storeName || "StockNBook"}`,
            leftMargin,
            46,
        );
        doc.text(
            `Branch: ${branchName || "All Branches"}`,
            leftMargin,
            59,
        );
        doc.text(
            `Date range: ${getDashboardPdfDateRange(generatedAt)}`,
            leftMargin,
            72,
        );
    };

    autoTable(doc, {
        head: [columns.map((column) => column.header)],
        body: tableRows,
        startY: tableStartY,
        margin: {
            top: tableStartY,
            right: rightMargin,
            bottom: 30,
            left: leftMargin,
        },
        theme: "grid",
        showHead: "everyPage",
        rowPageBreak: "avoid",
        styles: {
            font: "helvetica",
            fontSize: 7.2,
            textColor: PDF_TEXT,
            lineColor: PDF_GRID,
            lineWidth: 0.35,
            cellPadding: {
                top: 4,
                right: 5,
                bottom: 4,
                left: 5,
            },
            valign: "middle",
            overflow: "linebreak",
        },
        headStyles: {
            fillColor: PDF_PURPLE,
            textColor: [255, 255, 255],
            fontStyle: "bold",
            lineColor: [255, 255, 255],
            lineWidth: 0.25,
            minCellHeight: 20,
        },
        alternateRowStyles: {
            fillColor: PDF_ALT_ROW,
        },
        columnStyles,
        didDrawPage: (data) => {
            drawHeader(data.pageNumber);
        },
    });

    const pageCount = doc.getNumberOfPages();

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        doc.setPage(pageNumber);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.5);
        doc.setTextColor(...PDF_MUTED);
        doc.text(
            `Page ${pageNumber} of ${pageCount}`,
            pageWidth - rightMargin,
            footerY,
            { align: "right" },
        );
    }

    doc.save(cleanDashboardPdfFilename(filename));
}

type Product = {
    id: number;
    branchId?: number | null;
    branch_id?: number | null;
    name: string;
    category: string;
    stock: number;
    alertLevel: number;
    alert_level?: number;
    originalPrice: number;
    original_price?: number;
    salesPrice: number;
    sales_price?: number;
    hasVariants?: boolean;
    variant?: string;
    variantName?: string;
    variant_name?: string;
};

type ProductApiRaw = {
    id: number | string;
    branchId?: number | string | null;
    branch_id?: number | string | null;
    name: string;
    category?: string;
    stock?: number | string;
    alertLevel?: number | string;
    alert_level?: number | string;
    originalPrice?: number | string;
    original_price?: number | string;
    salesPrice?: number | string;
    sales_price?: number | string;
    hasVariants?: boolean;
    has_variants?: boolean;
    variant?: string;
    variantName?: string;
    variant_name?: string;
};

type Order = {
    id?: string;
    orderId?: string;
    branchId?: number | null;
    branch_id?: number | null;
    total?: number;
    date?: string;
    orderDate?: string;
    createdAt?: string;
    item?: string;
    items?: {
        name?: string;
        quantity?: number;
    }[];
};

type OrderApiRaw = {
    id?: string;
    orderId?: string;
    order_id?: string;
    branchId?: number | string | null;
    branch_id?: number | string | null;
    total?: number | string;
    date?: string;
    orderDate?: string;
    order_date?: string;
    createdAt?: string;
    created_at?: string;
    item?: string;
    items?: {
        name?: string;
        quantity?: number;
    }[];
};

type Booking = {
    id: number;
    branchId?: number | null;
    branch_id?: number | null;
    date: string;
    name: string;
    status?: string;
    packageName?: string;
    eventName?: string;
};

type BookingApiRaw = {
    id?: number | string;
    booking_id?: number | string;
    branchId?: number | string | null;
    branch_id?: number | string | null;
    date?: string;
    event_date?: string;
    name?: string;
    customer_name?: string;
    status?: string;
    packageName?: string;
    package_name?: string;
    package?: string;
    package_title?: string;
    service_name?: string;
    eventName?: string;
    event_name?: string;
    event?: string;
    event_type?: string;
};

const STORAGE_KEY = "stocknbook_inventory_products";
const ORDERS_KEY = "stocknbook_orders";

function getSavedItem(key: string) {
    if (typeof window === "undefined") return "";
    return sessionStorage.getItem(key) || localStorage.getItem(key) || "";
}


function getSavedJson<T>(key: string, fallback: T): T {
    try {
        if (typeof window === "undefined") return fallback;

        const raw = sessionStorage.getItem(key) || localStorage.getItem(key) || "";

        return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
        return fallback;
    }
}

function getSavedPermissions() {
    try {
        return JSON.parse(
            sessionStorage.getItem("permissions") ||
            localStorage.getItem("permissions") ||
            "{}",
        );
    } catch {
        return {};
    }
}

function getUserValue(user: unknown, key: string) {
    if (!user || typeof user !== "object") return "";
    return String((user as Record<string, unknown>)[key] ?? "");
}

function mapProduct(product: ProductApiRaw): Product {
    const rawBranchId = product.branchId ?? product.branch_id ?? null;

    return {
        id: Number(product.id),
        branchId: rawBranchId ? Number(rawBranchId) : null,
        branch_id: rawBranchId ? Number(rawBranchId) : null,
        name: String(product.name ?? ""),
        category: String(product.category ?? ""),
        stock: Number(product.stock ?? 0),
        alertLevel: Number(product.alertLevel ?? product.alert_level ?? 0),
        alert_level: Number(product.alertLevel ?? product.alert_level ?? 0),
        originalPrice: Number(product.originalPrice ?? product.original_price ?? 0),
        original_price: Number(
            product.originalPrice ?? product.original_price ?? 0,
        ),
        salesPrice: Number(product.salesPrice ?? product.sales_price ?? 0),
        sales_price: Number(product.salesPrice ?? product.sales_price ?? 0),
        hasVariants: Boolean(product.hasVariants ?? product.has_variants),
        variant: String(
            product.variant ??
            product.variantName ??
            product.variant_name ??
            "",
        ),
        variantName: String(
            product.variantName ??
            product.variant_name ??
            product.variant ??
            "",
        ),
        variant_name: String(
            product.variant_name ??
            product.variantName ??
            product.variant ??
            "",
        ),
    };
}

function toInventoryProduct(
    product: Product,
    branchName: string,
): InventoryProduct {
    return {
        id: Number(product.id),
        branchId: product.branchId ?? product.branch_id ?? null,
        branchName,
        name: product.name,
        category: product.category,
        stock: Number(product.stock || 0),
        alertLevel: Number(product.alertLevel || 0),
        originalPrice: Number(product.originalPrice ?? product.original_price ?? 0),
        salesPrice: Number(product.salesPrice ?? product.sales_price ?? 0),
        hasVariants: Boolean(product.hasVariants),
        variants: [],
    };
}

function toDashboardProduct(product: InventoryProduct): Product {
    return {
        id: Number(product.id),
        branchId: product.branchId ?? null,
        branch_id: product.branchId ?? null,
        name: product.name,
        category: product.category,
        stock: Number(product.stock || 0),
        alertLevel: Number(product.alertLevel || 0),
        alert_level: Number(product.alertLevel || 0),
        originalPrice: Number(product.originalPrice || 0),
        original_price: Number(product.originalPrice || 0),
        salesPrice: Number(product.salesPrice || 0),
        sales_price: Number(product.salesPrice || 0),
        hasVariants: Boolean(product.hasVariants),
    };
}

function normalizeBooking(raw: BookingApiRaw): Booking {
    const rawBranchId = raw.branchId ?? raw.branch_id ?? null;

    return {
        id: Number(raw.id ?? raw.booking_id),
        branchId: rawBranchId ? Number(rawBranchId) : null,
        branch_id: rawBranchId ? Number(rawBranchId) : null,
        date: raw.date ?? raw.event_date ?? "",
        name: raw.name ?? raw.customer_name ?? "",
        status: raw.status ?? "Pending Review",
        packageName: String(
            raw.packageName ??
            raw.package_name ??
            raw.package ??
            raw.package_title ??
            raw.service_name ??
            "",
        ),
        eventName: String(
            raw.eventName ?? raw.event_name ?? raw.event ?? raw.event_type ?? "",
        ),
    };
}

function parseOrderItems(itemText?: string) {
    if (!itemText) return [];

    return itemText
        .split(",")
        .map((item) => {
            const [name, quantity] = item.split(" x");

            return {
                name: name?.trim() || "Unnamed item",
                quantity: Number(quantity || 0),
            };
        })
        .filter((item) => item.name);
}

function normalizeOrder(raw: OrderApiRaw): Order {
    const rawBranchId = raw.branchId ?? raw.branch_id ?? null;

    return {
        id: raw.id ?? raw.orderId ?? raw.order_id,
        orderId: raw.orderId ?? raw.order_id ?? raw.id,
        branchId: rawBranchId ? Number(rawBranchId) : null,
        branch_id: rawBranchId ? Number(rawBranchId) : null,
        total: Number(raw.total ?? 0),
        date:
            raw.date ??
            raw.orderDate ??
            raw.order_date ??
            raw.createdAt ??
            raw.created_at ??
            "",
        orderDate: raw.orderDate ?? raw.order_date ?? raw.date ?? "",
        createdAt: raw.createdAt ?? raw.created_at ?? "",
        item: raw.item ?? "",
        items: Array.isArray(raw.items) ? raw.items : parseOrderItems(raw.item),
    };
}

function filterByBranch<
    T extends { branchId?: number | null; branch_id?: number | null },
>(items: T[], branchId: string) {
    if (!branchId) return items;

    const hasBranchIds = items.some((item) => item.branchId || item.branch_id);

    if (!hasBranchIds) return items;

    return items.filter((item) => {
        const itemBranchId = item.branchId ?? item.branch_id;
        return String(itemBranchId) === String(branchId);
    });
}

async function loadBranchStaffCount(
    token: string,
    branchId: string,
    storeId: string,
) {
    const possibleActions = [
        "get_staff",
        "get_staff_members",
        "get_branch_staff",
        "get_staff_by_branch",
        "get_users",
    ];

    for (const action of possibleActions) {
        try {
            const response = await fetch("/api/staff-management", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    action,
                    store_id: Number(storeId),
                    branch_id: Number(branchId),
                    branchId: Number(branchId),
                }),
            });

            const text = await response.text();
            const data = text ? JSON.parse(text) : {};

            if (!response.ok) continue;

            if (Array.isArray(data.staff)) return data.staff.length;
            if (Array.isArray(data.staffMembers)) return data.staffMembers.length;
            if (Array.isArray(data.users)) return data.users.length;
            if (Array.isArray(data.members)) return data.members.length;
            if (Array.isArray(data.data)) return data.data.length;
        } catch {
            // Try the next compatible action.
        }
    }

    return 0;
}

function formatBookingDate(date: string) {
    if (!date) {
        return { dateLabel: "—", timeLabel: "" };
    }

    const parsed = new Date(date);

    if (Number.isNaN(parsed.getTime())) {
        return {
            dateLabel: date.slice(0, 10),
            timeLabel: date.length > 10 ? date.slice(11, 16) : "",
        };
    }

    return {
        dateLabel: parsed.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
        }),
        timeLabel: parsed.toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
        }),
    };
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

export default function StaffDashboard() {
    const { user } = useCurrentUser();
    const inventoryController = useInventoryController();

    const [orders, setOrders] = useState<Order[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [bookings, setBookings] = useState<Booking[]>([]);
    const [branchName, setBranchName] = useState("Branch");
    const [permissions, setPermissions] = useState<Record<string, boolean>>({});
    const [activeStaffCount, setActiveStaffCount] = useState(0);

    const [showAlertsModal, setShowAlertsModal] = useState(false);
    const [alertFilter, setAlertFilter] = useState<"all" | "low" | "out">("all");
    const inventoryEditWasOpenRef = useRef(false);
    const [currentDateTime, setCurrentDateTime] = useState<Date | null>(null);
    const [refreshKey, setRefreshKey] = useState(0);

    useEffect(() => {
        const loadData = async () => {
            const currentBranchName =
                getUserValue(user, "branch_name") ||
                getSavedItem("branch_name") ||
                getSavedItem("stocknbook_branch_name") ||
                "Branch";

            const branchId =
                getUserValue(user, "branch_id") ||
                getSavedItem("branch_id") ||
                getSavedItem("stocknbook_branch_id");

            const storeId =
                getUserValue(user, "store_id") ||
                getSavedItem("store_id") ||
                getSavedItem("stocknbook_store_id");

            const token = getSavedItem("token");

            setBranchName(currentBranchName);

            setPermissions(
                user && typeof user === "object" && "permissions" in user
                    ? (
                    user as {
                        permissions?: Record<string, boolean>;
                    }
                ).permissions || {}
                    : getSavedPermissions(),
            );

            const savedProducts = getSavedJson<Product[]>(STORAGE_KEY, []);
            setProducts(filterByBranch(savedProducts, branchId));

            const savedOrders = getSavedJson<Order[]>(ORDERS_KEY, []);
            setOrders(filterByBranch(savedOrders, branchId));

            if (!token || !branchId) {
                setBookings([]);
                setActiveStaffCount(0);
                return;
            }

            try {
                const productsResponse = await fetch("/api/products", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                        action: "get_products",
                        branch_id: Number(branchId),
                    }),
                });

                const productsText = await productsResponse.text();
                const productsData = productsText ? JSON.parse(productsText) : {};

                if (productsResponse.ok && Array.isArray(productsData.products)) {
                    const scopedProducts = productsData.products.map(mapProduct);
                    setProducts(scopedProducts);
                    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(scopedProducts));
                }
            } catch (error) {
                console.warn("Manager dashboard products fetch failed:", error);
            }

            try {
                const ordersResponse = await fetch("/api/pos", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                        action: "get_orders",
                        branch_id: Number(branchId),
                    }),
                });

                const ordersText = await ordersResponse.text();
                const ordersData: { orders?: OrderApiRaw[] } = ordersText
                    ? JSON.parse(ordersText)
                    : {};

                if (ordersResponse.ok && Array.isArray(ordersData.orders)) {
                    const normalizedOrders: Order[] =
                        ordersData.orders.map(normalizeOrder);

                    const currentBranchProducts: Product[] = products.length
                        ? products
                        : getSavedJson<Product[]>(STORAGE_KEY, []);

                    const branchProductNames = new Set(
                        currentBranchProducts
                            .filter((product) => {
                                const productBranchId = product.branchId ?? product.branch_id;

                                return (
                                    !productBranchId ||
                                    String(productBranchId) === String(branchId)
                                );
                            })
                            .map((product) => product.name.trim().toLowerCase()),
                    );

                    const hasOrderBranchIds = normalizedOrders.some((order) =>
                        Boolean(order.branchId ?? order.branch_id),
                    );

                    const scopedOrders = hasOrderBranchIds
                        ? normalizedOrders.filter((order) => {
                            const orderBranchId = order.branchId ?? order.branch_id;

                            return String(orderBranchId) === String(branchId);
                        })
                        : normalizedOrders.filter((order) =>
                            (order.items || []).some((item) =>
                                branchProductNames.has(
                                    (item.name || "").trim().toLowerCase(),
                                ),
                            ),
                        );

                    setOrders(scopedOrders);
                    sessionStorage.setItem(ORDERS_KEY, JSON.stringify(scopedOrders));
                }
            } catch (error) {
                console.warn("Manager dashboard orders fetch failed:", error);
            }

            try {
                const bookingsResponse = await fetch("/api/bookings", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                        action: "get_bookings",
                        role: "staff",
                        store_id: storeId ? Number(storeId) : undefined,
                        branch_id: Number(branchId),
                    }),
                });

                const bookingsText = await bookingsResponse.text();
                const bookingsData = bookingsText ? JSON.parse(bookingsText) : {};

                if (bookingsResponse.ok && Array.isArray(bookingsData.bookings)) {
                    setBookings(bookingsData.bookings.map(normalizeBooking));
                } else {
                    setBookings([]);
                }
            } catch (error) {
                console.warn("Manager dashboard bookings fetch failed:", error);
                setBookings([]);
            }

            if (storeId) {
                const staffCount = await loadBranchStaffCount(
                    token,
                    String(branchId),
                    String(storeId),
                );

                setActiveStaffCount(staffCount);
            } else {
                setActiveStaffCount(0);
            }
        };

        void loadData();
        window.addEventListener("focus", loadData);

        return () => {
            window.removeEventListener("focus", loadData);
        };
    }, [user, refreshKey]);

    useEffect(() => {
        const updateDateTime = () => setCurrentDateTime(new Date());

        updateDateTime();
        const timer = window.setInterval(updateDateTime, 30_000);

        return () => window.clearInterval(timer);
    }, []);

    const canAccess = (permission: string) => permissions[permission] === true;

    const totalSales = orders.reduce(
        (sum, order) => sum + Number(order.total || 0),
        0,
    );


    const totalBookings = bookings.length;
    const totalProducts = products.length;

    const allAlertItems = products.filter(
        (product) => product.stock <= product.alertLevel,
    );
    const lowStockAlertItems = allAlertItems.filter(
        (product) => product.stock > 0,
    );
    const outOfStockAlertItems = allAlertItems.filter(
        (product) => product.stock <= 0,
    );

    const modalAlertItems =
        alertFilter === "low"
            ? lowStockAlertItems
            : alertFilter === "out"
                ? outOfStockAlertItems
                : allAlertItems;

    const lowStockItems = allAlertItems.slice(0, 3);
    const upcomingBookings = [...bookings]
        .filter((booking) => {
            const status = String(booking.status || "").toLowerCase();
            const schedule = new Date(booking.date || "");

            return (
                !["completed", "cancelled", "canceled"].includes(status) &&
                !Number.isNaN(schedule.getTime())
            );
        })
        .sort(
            (first, second) =>
                new Date(first.date || 0).getTime() -
                new Date(second.date || 0).getTime(),
        )
        .slice(0, 3);

    const popularItems = Object.values(
        orders.reduce<Record<string, { name: string; quantity: number }>>(
            (accumulator, order) => {
                (order.items || []).forEach((item) => {
                    const name = item.name || "Unnamed item";
                    const quantity = item.quantity || 0;

                    if (!accumulator[name]) {
                        accumulator[name] = { name, quantity: 0 };
                    }

                    accumulator[name].quantity += quantity;
                });

                return accumulator;
            },
            {},
        ),
    )
        .sort((first, second) => second.quantity - first.quantity)
        .slice(0, 3);

    const mostBookedPackages = Object.values(
        bookings.reduce<Record<string, { name: string; quantity: number }>>(
            (accumulator, booking) => {
                const packageName = booking.packageName?.trim() || "Package booking";

                if (!accumulator[packageName]) {
                    accumulator[packageName] = {
                        name: packageName,
                        quantity: 0,
                    };
                }

                accumulator[packageName].quantity += 1;
                return accumulator;
            },
            {},
        ),
    )
        .sort((first, second) => second.quantity - first.quantity)
        .slice(0, 3);

    const popularMax = Math.max(...popularItems.map((item) => item.quantity), 1);
    const packageMax = Math.max(
        ...mostBookedPackages.map((item) => item.quantity),
        1,
    );

    const openInventoryEditProduct = (product: Product) => {
        const matchingInventoryProduct = inventoryController.products.find(
            (inventoryProduct) => Number(inventoryProduct.id) === Number(product.id),
        );

        inventoryController.handleEditProduct(
            matchingInventoryProduct ?? toInventoryProduct(product, branchName),
        );
    };

    const inventoryEditOpen =
        inventoryController.showForm && inventoryController.editingId !== null;

    useEffect(() => {
        if (inventoryEditOpen) {
            inventoryEditWasOpenRef.current = true;
            return;
        }

        if (!inventoryEditWasOpenRef.current) return;

        const activeBranchId =
            getUserValue(user, "branch_id") ||
            getSavedItem("branch_id") ||
            getSavedItem("stocknbook_branch_id");

        const refreshedProducts = filterByBranch(
            inventoryController.products.map(toDashboardProduct),
            activeBranchId,
        );

        inventoryEditWasOpenRef.current = false;

        if (refreshedProducts.length === 0) return;

        setProducts(refreshedProducts);
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(refreshedProducts));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(refreshedProducts));
    }, [inventoryEditOpen, inventoryController.products, user]);

    // Kept to preserve the existing active-staff data flow.
    void activeStaffCount;

    const firstName =
        getUserValue(user, "first_name") || getUserValue(user, "firstName");
    const lastName =
        getUserValue(user, "last_name") || getUserValue(user, "lastName");
    const dashboardUserName =
        getUserValue(user, "full_name") ||
        getUserValue(user, "fullName") ||
        getUserValue(user, "name") ||
        [firstName, lastName].filter(Boolean).join(" ") ||
        getUserValue(user, "username") ||
        getSavedItem("full_name") ||
        getSavedItem("name") ||
        getSavedItem("username") ||
        "User";
    const dashboardStoreName =
        getUserValue(user, "store_name") ||
        getUserValue(user, "storeName") ||
        getUserValue(user, "business_name") ||
        getUserValue(user, "businessName") ||
        getSavedItem("store_name") ||
        getSavedItem("storeName") ||
        getSavedItem("stocknbook_store_name") ||
        getSavedItem("business_name") ||
        branchName ||
        "your store";
    const currentMonthLabel = currentDateTime
        ? currentDateTime.toLocaleDateString("en-US", {
            month: "long",
            year: "numeric",
        })
        : "the current month";

    return (
        <>
            <main className="min-w-0 flex-1 overflow-x-hidden bg-[#FDFAF4] font-sans text-[#1A1220]">
                <header className="sticky top-0 z-20 border-b border-[#E9E0EF] bg-[#FFFDF8]/95 backdrop-blur">
                    <div className="flex min-h-[88px] flex-wrap items-center justify-between gap-4 px-6 py-3">
                        <div className="min-w-0">
                            <h1 className="truncate text-[25px] font-bold text-[#1A1220]">
                                Welcome to Dashboard, {dashboardUserName}
                            </h1>
                            <p className="mt-1 truncate text-[12px] text-[#7A6A84]">
                                Here&apos;s an overview of {dashboardStoreName} business performance for {currentMonthLabel}.
                            </p>
                        </div>

                        <div className="flex shrink-0 items-center gap-2.5">
              <span className="inline-flex h-[42px] items-center rounded-xl border border-[#E6DDF0] bg-white px-3.5 text-sm font-semibold text-[#2B174C] shadow-sm">
                {currentDateTime
                    ? formatCurrentDateTime(currentDateTime)
                    : "Loading date..."}
              </span>

                            <button
                                type="button"
                                onClick={() => setRefreshKey((current) => current + 1)}
                                aria-label="Refresh dashboard"
                                title="Refresh dashboard"
                                className="inline-flex h-[42px] items-center gap-2 rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31]"
                            >
                                <RefreshCw size={16} />
                                Refresh
                            </button>
                        </div>
                    </div>
                </header>

                <section className="space-y-3.5 px-6 py-4">
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                        <MetricCard
                            title="Total Sales"
                            value={
                                canAccess("pos")
                                    ? `₱${totalSales.toLocaleString("en-PH")}`
                                    : "—"
                            }
                        />
                        <MetricCard
                            title="Total Bookings"
                            value={canAccess("bookings") ? String(totalBookings) : "—"}
                        />
                        <MetricCard
                            title="Total Products"
                            value={canAccess("inventory") ? String(totalProducts) : "—"}
                        />
                    </div>

                    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                        <DashboardPanel className="flex flex-col">
                            <PanelHeading
                                title="Popular Items"
                                icon={<Star size={16} strokeWidth={1.9} fill="currentColor" />}
                                action="View all"
                                href="/analytics"
                                onDownload={() =>
                                    downloadDashboardPdf({
                                        filename: "stocknbook-popular-items",
                                        reportTitle: "Popular Items Report",
                                        storeName: dashboardStoreName,
                                        branchName,
                                        generatedAt: currentDateTime || new Date(),
                                        columns: [
                                            {
                                                header: "Rank",
                                                align: "center",
                                                width: 70,
                                            },
                                            { header: "Product Name", width: 500 },
                                            {
                                                header: "Units Sold",
                                                align: "right",
                                                width: 120,
                                            },
                                        ],
                                        rows: popularItems.map(
                                            (item, index) => [
                                                index + 1,
                                                item.name,
                                                item.quantity,
                                            ],
                                        ),
                                    })
                                }
                            />

                            {canAccess("pos") ? (
                                popularItems.length > 0 ? (
                                    <div className="flex-1">
                                        {popularItems.map((item) => (
                                            <RankedProgressRow
                                                key={item.name}
                                                label={item.name}
                                                value={`${item.quantity} sold`}
                                                percent={(item.quantity / popularMax) * 100}
                                            />
                                        ))}
                                    </div>
                                ) : (
                                    <DashboardEmptyText text="No popular items yet." />
                                )
                            ) : (
                                <DashboardEmptyText text="Popular items are hidden because POS access is not enabled." />
                            )}
                        </DashboardPanel>

                        <DashboardPanel className="flex flex-col">
                            <PanelHeading
                                title="Most Booked Packages"
                                icon={<Gift size={16} strokeWidth={1.9} />}
                                action="View all"
                                href="/analytics"
                                onDownload={() =>
                                    downloadDashboardPdf({
                                        filename: "stocknbook-most-booked-packages",
                                        reportTitle: "Most Booked Packages Report",
                                        storeName: dashboardStoreName,
                                        branchName,
                                        generatedAt: currentDateTime || new Date(),
                                        columns: [
                                            {
                                                header: "Rank",
                                                align: "center",
                                                width: 70,
                                            },
                                            { header: "Package Name", width: 500 },
                                            {
                                                header: "Total Bookings",
                                                align: "right",
                                                width: 120,
                                            },
                                        ],
                                        rows: mostBookedPackages.map(
                                            (item, index) => [
                                                index + 1,
                                                item.name,
                                                item.quantity,
                                            ],
                                        ),
                                    })
                                }
                            />

                            {canAccess("bookings") ? (
                                mostBookedPackages.length > 0 ? (
                                    <div className="flex-1">
                                        {mostBookedPackages.map((item) => (
                                            <RankedProgressRow
                                                key={item.name}
                                                label={item.name}
                                                value={`${item.quantity} booking${
                                                    item.quantity === 1 ? "" : "s"
                                                }`}
                                                percent={(item.quantity / packageMax) * 100}
                                            />
                                        ))}
                                    </div>
                                ) : (
                                    <DashboardEmptyText text="No package bookings yet." />
                                )
                            ) : (
                                <DashboardEmptyText text="Package bookings are hidden because booking access is not enabled." />
                            )}
                        </DashboardPanel>
                    </div>

                    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                        <DashboardPanel className="overflow-hidden !rounded-[12px] !p-0 font-sans shadow-[0_6px_18px_rgba(45,27,78,0.06)]">
                            <div className="border-b border-[#F0ECF5]">
                                <ManagerTableHeader
                                    title="Upcoming Bookings"
                                    subtitle="Upcoming reservations for this branch"
                                    action="View all"
                                    onAction={() => window.location.assign("/bookings")}
                                    onDownload={() =>
                                        downloadDashboardPdf({
                                            filename: "stocknbook-upcoming-bookings",
                                            reportTitle: "Upcoming Bookings Report",
                                            storeName: dashboardStoreName,
                                            branchName,
                                            generatedAt: currentDateTime || new Date(),
                                            columns: [
                                                { header: "Customer", width: 120 },
                                                { header: "Event", width: 135 },
                                                { header: "Branch", width: 115 },
                                                { header: "Schedule", width: 125 },
                                                { header: "Package", width: 145 },
                                                { header: "Status", width: 80 },
                                            ],
                                            rows: upcomingBookings.map((booking) => [
                                                booking.name,
                                                booking.eventName ||
                                                "Booking reservation",
                                                branchName,
                                                formatDashboardPdfDate(
                                                    booking.date,
                                                ),
                                                booking.packageName ||
                                                "Package booking",
                                                booking.status ||
                                                "Pending Review",
                                            ]),
                                        })
                                    }
                                    tone="violet"
                                />
                            </div>

                            {!canAccess("bookings") ? (
                                <div className="px-4 py-4">
                                    <DashboardEmptyText text="Booking access is not enabled for this account." />
                                </div>
                            ) : upcomingBookings.length === 0 ? (
                                <div className="px-4 py-4">
                                    <DashboardEmptyText text="No upcoming bookings yet." />
                                </div>
                            ) : (
                                <>
                                    <div className="overflow-hidden">
                                        <table className="w-full table-fixed border-collapse">
                                            <thead className="bg-[#FCFBFE]">
                                            <tr className="border-b border-[#F0ECF5]">
                                                <CompactTableHeader>
                                                    Customer / Event
                                                </CompactTableHeader>
                                                <CompactTableHeader>Branch</CompactTableHeader>
                                                <CompactTableHeader>Schedule</CompactTableHeader>
                                                <CompactTableHeader>Package</CompactTableHeader>
                                                <CompactTableHeader>Status</CompactTableHeader>
                                            </tr>
                                            </thead>
                                            <tbody>
                                            {upcomingBookings.map((booking) => (
                                                <UpcomingBookingRow
                                                    key={booking.id}
                                                    booking={booking}
                                                    branchName={branchName}
                                                />
                                            ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </>
                            )}
                        </DashboardPanel>

                        <DashboardPanel className="overflow-hidden !rounded-[12px] !p-0 font-sans shadow-[0_6px_18px_rgba(45,27,78,0.06)]">
                            <div className="border-b border-[#F0ECF5]">
                                <ManagerTableHeader
                                    title="Inventory Alerts"
                                    subtitle="Products that need attention or restocking"
                                    action="View all"
                                    onAction={() => {
                                        setAlertFilter("all");
                                        setShowAlertsModal(true);
                                    }}
                                    onDownload={() =>
                                        downloadDashboardPdf({
                                            filename: "stocknbook-inventory-alerts",
                                            reportTitle: "Inventory Alerts Report",
                                            storeName: dashboardStoreName,
                                            branchName,
                                            generatedAt: currentDateTime || new Date(),
                                            columns: [
                                                { header: "Product Name", width: 235 },
                                                { header: "Branch", width: 115 },
                                                { header: "Category", width: 130 },
                                                {
                                                    header: "Current Stock",
                                                    align: "right",
                                                    width: 90,
                                                },
                                                {
                                                    header: "Reorder Level",
                                                    align: "right",
                                                    width: 90,
                                                },
                                                { header: "Status", width: 90 },
                                            ],
                                            rows: lowStockItems.map((product) => [
                                                product.name,
                                                branchName,
                                                product.category ||
                                                "Uncategorized",
                                                Number(product.stock || 0),
                                                Number(product.alertLevel || 0),
                                                Number(product.stock || 0) <= 0
                                                    ? "Out of Stock"
                                                    : "Low Stock",
                                            ]),
                                        })
                                    }
                                    tone="red"
                                />
                            </div>

                            {!canAccess("inventory") ? (
                                <div className="px-4 py-4">
                                    <DashboardEmptyText text="Inventory access is not enabled for this account." />
                                </div>
                            ) : lowStockItems.length === 0 ? (
                                <div className="px-4 py-4">
                                    <DashboardEmptyText text="All items are well stocked." />
                                </div>
                            ) : (
                                <>
                                    <div className="overflow-hidden">
                                        <table className="w-full table-fixed border-collapse">
                                            <thead className="bg-[#FCFBFE]">
                                            <tr className="border-b border-[#F0ECF5]">
                                                <CompactTableHeader>Item</CompactTableHeader>
                                                <CompactTableHeader>Branch</CompactTableHeader>
                                                <CompactTableHeader>Category</CompactTableHeader>
                                                <CompactTableHeader>Stock Level</CompactTableHeader>
                                                <CompactTableHeader align="right">
                                                    Action
                                                </CompactTableHeader>
                                            </tr>
                                            </thead>
                                            <tbody>
                                            {lowStockItems.map((product) => (
                                                <InventoryAlertTableRow
                                                    key={product.id}
                                                    product={product}
                                                    branchName={branchName}
                                                    onRestock={() => openInventoryEditProduct(product)}
                                                />
                                            ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </>
                            )}
                        </DashboardPanel>
                    </div>
                </section>

                {showAlertsModal && (
                    <RestockAlertsModal
                        items={modalAlertItems}
                        activeFilter={alertFilter}
                        lowStockCount={lowStockAlertItems.length}
                        outOfStockCount={outOfStockAlertItems.length}
                        onChangeFilter={setAlertFilter}
                        onClose={() => setShowAlertsModal(false)}
                        onRestock={(product) => {
                            setShowAlertsModal(false);
                            openInventoryEditProduct(product);
                        }}
                    />
                )}

                <div className="font-sans text-[#1A1220] [&_*]:font-sans">
                    <InventoryDialogs inv={inventoryController} />
                </div>
            </main>
        </>
    );
}

function DashboardPanel({
                            children,
                            className = "",
                        }: {
    children: ReactNode;
    className?: string;
}) {
    return (
        <section
            className={`rounded-[14px] border border-[#E6DDF0] bg-white p-4 shadow-sm ${className}`}
        >
            {children}
        </section>
    );
}

function MetricCard({
                        title,
                        value,
                    }: {
    title: string;
    value: string;
}) {
    return (
        <div className="flex min-h-[90px] flex-col justify-center rounded-[14px] border border-[#E6DDF0] bg-white px-4 py-3 shadow-sm">
            <p className="text-sm font-semibold text-[#2B174C]">{title}</p>
            <p className="mt-1 text-[24px] font-bold leading-tight text-[#1A1220]">
                {value}
            </p>
        </div>
    );
}

function PanelHeading({
                          title,
                          icon,
                          action,
                          href,
                          onDownload,
                      }: {
    title: string;
    icon?: ReactNode;
    action: string;
    href: string;
    onDownload?: () => void;
}) {
    return (
        <div className="mb-3 flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-2 text-[#6D35D4]">
                {icon && (
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center">
            {icon}
          </span>
                )}
                <h2 className="min-w-0 truncate text-[14px] font-bold text-[#24152F]">
                    {title}
                </h2>
            </div>

            <div className="flex shrink-0 items-center gap-2">
                {onDownload && (
                    <button
                        type="button"
                        onClick={onDownload}
                        aria-label={`Download ${title}`}
                        title={`Download ${title}`}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[#E6DDF0] bg-[#FAF8FF] text-[#6D35D4] shadow-sm transition hover:border-[#D7C7EC] hover:bg-[#F3EEFF] hover:text-[#4B21BD]"
                    >
                        <Download size={14} strokeWidth={2} />
                    </button>
                )}

                <Link
                    href={href}
                    className="inline-flex h-7 items-center justify-center rounded-lg border border-[#E6DDF0] bg-[#FAF8FF] px-3 text-[11px] font-semibold text-[#6D35D4] shadow-sm transition hover:border-[#D7C7EC] hover:bg-[#F3EEFF] hover:text-[#4B21BD]"
                >
                    {action}
                </Link>
            </div>
        </div>
    );
}

function ManagerTableHeader({
                                title,
                                subtitle,
                                action,
                                onAction,
                                onDownload,
                                tone,
                            }: {
    title: string;
    subtitle: string;
    action: string;
    onAction: () => void;
    onDownload?: () => void;
    tone: "violet" | "red";
}) {
    const isAlert = tone === "red";

    return (
        <div className="flex min-h-[64px] items-center justify-between gap-4 px-4 py-3">
            <div className="flex min-w-0 items-start gap-2">
        <span
            className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center ${
                isAlert ? "text-[#EF4444]" : "text-[#6D35D4]"
            }`}
        >
          {isAlert ? (
              <TriangleAlert size={16} strokeWidth={2} />
          ) : (
              <CalendarDays size={16} strokeWidth={2} />
          )}
        </span>

                <div className="min-w-0">
                    <h2 className="truncate text-[14px] font-bold text-[#24152F]">
                        {title}
                    </h2>
                    <p className="truncate text-[10px] leading-4 text-[#8A7D92]">
                        {subtitle}
                    </p>
                </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
                {onDownload && (
                    <button
                        type="button"
                        onClick={onDownload}
                        aria-label={`Download ${title}`}
                        title={`Download ${title}`}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[#E6DDF0] bg-[#FAF8FF] text-[#6D35D4] shadow-sm transition hover:border-[#D7C7EC] hover:bg-[#F3EEFF] hover:text-[#4B21BD]"
                    >
                        <Download size={14} strokeWidth={2} />
                    </button>
                )}

                <button
                    type="button"
                    onClick={onAction}
                    className="inline-flex h-7 items-center justify-center whitespace-nowrap rounded-lg border border-[#E6DDF0] bg-[#FAF8FF] px-3 text-[11px] font-semibold text-[#6D35D4] shadow-sm transition hover:border-[#D7C7EC] hover:bg-[#F3EEFF] hover:text-[#4B21BD]"
                >
                    {action}
                </button>
            </div>
        </div>
    );
}
function RankedProgressRow({
                               label,
                               value,
                               percent,
                           }: {
    label: string;
    value: string;
    percent: number;
}) {
    return (
        <div className="border-b border-[#F0EBF5] py-3 first:pt-1 last:border-b-0 last:pb-1">
            <div className="mb-2 flex items-center justify-between gap-3">
                <p
                    title={label}
                    className="min-w-0 flex-1 truncate text-[12px] font-medium text-[#30243A]"
                >
                    {label}
                </p>

                <p className="shrink-0 text-[11px] font-semibold text-[#7C3AED]">
                    {value}
                </p>
            </div>

            <div className="h-1.5 overflow-hidden rounded-full bg-[#ECE8F2]">
                <div
                    className="h-full rounded-full bg-[#7C3AED] transition-[width] duration-300"
                    style={{
                        width: `${Math.max(Math.min(percent, 100), 7)}%`,
                    }}
                />
            </div>
        </div>
    );
}

function CompactTableHeader({
                                children,
                                align = "left",
                            }: {
    children: ReactNode;
    align?: "left" | "right";
}) {
    return (
        <th
            className={`px-2.5 py-2 text-[10px] font-semibold uppercase tracking-[0.06em] text-[#806A8C] ${
                align === "right" ? "text-right" : "text-left"
            }`}
        >
            {children}
        </th>
    );
}

function TableHeader({
                         children,
                         align = "left",
                     }: {
    children: ReactNode;
    align?: "left" | "right";
}) {
    return (
        <th
            className={`px-4 py-3 !text-[11px] !font-semibold uppercase tracking-[0.08em] text-[#806A8C] ${
                align === "right" ? "text-right" : "text-left"
            }`}
        >
            {children}
        </th>
    );
}

function UpcomingBookingRow({
                                booking,
                                branchName,
                            }: {
    booking: Booking;
    branchName: string;
}) {
    const parsedDate = new Date(booking.date || "");
    const hasValidDate = !Number.isNaN(parsedDate.getTime());
    const monthLabel = hasValidDate
        ? parsedDate.toLocaleDateString("en-US", { month: "short" }).toUpperCase()
        : "—";
    const dayLabel = hasValidDate ? String(parsedDate.getDate()) : "—";
    const dateLabel = hasValidDate
        ? parsedDate.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
        })
        : "—";
    const timeLabel = hasValidDate
        ? parsedDate.toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
        })
        : "";

    const status = booking.status || "Pending Review";
    const normalized = status.trim().toLowerCase();

    const statusClass =
        normalized === "completed"
            ? "text-[#16A34A]"
            : normalized === "confirmed"
                ? "text-[#2563EB]"
                : normalized === "preparing"
                    ? "text-[#7C3AED]"
                    : normalized === "cancelled" || normalized === "canceled"
                        ? "text-[#DC2626]"
                        : "text-[#B7791F]";

    const displayStatus =
        normalized === "pending review"
            ? "Pending"
            : status.charAt(0).toUpperCase() + status.slice(1);

    return (
        <tr className="h-[58px] border-b border-[#F3EFF6] transition hover:bg-[#FCFAFF] last:border-b-0">
            <td className="px-2.5 py-2">
                <div className="flex min-w-0 items-center gap-2">
                    <div className="flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-md border border-[#E8E0F0] bg-[#FBF9FE] leading-none">
            <span className="text-[8px] font-bold text-[#7C3AED]">
              {monthLabel}
            </span>
                        <span className="mt-0.5 text-[12px] font-bold text-[#342047]">
              {dayLabel}
            </span>
                    </div>

                    <p
                        title={booking.name || "Customer"}
                        className="min-w-0 truncate text-[12px] font-medium text-[#30243A]"
                    >
                        {booking.name || "Customer"}
                    </p>
                </div>
            </td>

            <td className="px-2 py-2">
                <p
                    title={branchName}
                    className="truncate text-[11px] font-semibold text-[#7C3AED]"
                >
                    {branchName}
                </p>
            </td>

            <td className="px-2 py-2">
                <p className="truncate text-[12px] font-medium text-[#30243A]">
                    {dateLabel}
                </p>
                {timeLabel && (
                    <p className="mt-0.5 text-[10px] text-[#7A6A84]">{timeLabel}</p>
                )}
            </td>

            <td className="px-2 py-2">
                <p
                    title={booking.packageName || "Package booking"}
                    className="truncate text-[12px] font-medium text-[#30243A]"
                >
                    {booking.packageName || "Package booking"}
                </p>
            </td>

            <td className="px-2.5 py-2">
        <span
            className={`block max-w-full truncate text-[11px] font-semibold capitalize ${statusClass}`}
        >
          {displayStatus}
        </span>
            </td>
        </tr>
    );
}

function InventoryAlertTableRow({
                                    product,
                                    branchName,
                                    onRestock,
                                }: {
    product: Product;
    branchName: string;
    onRestock: () => void;
}) {
    const unitsLeft = Number(product.stock || 0);
    const isOutOfStock = unitsLeft <= 0;

    return (
        <tr className="h-[58px] border-b border-[#F3EFF6] transition hover:bg-[#FFFCFC] last:border-b-0">
            <td className="px-2.5 py-2">
                <p
                    title={product.name}
                    className="truncate text-[12px] font-medium text-[#30243A]"
                >
                    {product.name}
                </p>
                <p
                    className={`mt-0.5 text-[10px] font-semibold ${
                        isOutOfStock ? "text-[#DC2626]" : "text-[#B45309]"
                    }`}
                >
                    {isOutOfStock ? "Out of stock" : "Low stock"}
                </p>
            </td>

            <td className="px-2 py-2">
                <p
                    title={branchName}
                    className="truncate text-[11px] font-semibold text-[#7C3AED]"
                >
                    {branchName}
                </p>
            </td>

            <td className="px-2 py-2">
                <p
                    title={product.category || "Uncategorized"}
                    className="truncate text-[11px] font-medium text-[#5F4E75]"
                >
                    {product.category || "Uncategorized"}
                </p>
            </td>

            <td className="px-2 py-2">
        <span
            className={`whitespace-nowrap text-[11px] font-semibold ${
                isOutOfStock ? "text-[#DC2626]" : "text-[#B7791F]"
            }`}
        >
          {unitsLeft} left
        </span>
            </td>

            <td className="px-2.5 py-2 text-right">
                <button
                    type="button"
                    onClick={onRestock}
                    className="whitespace-nowrap rounded-md bg-[#F2EDFF] px-3 py-1.5 text-[10px] font-semibold text-[#5B2FC6] transition hover:bg-[#E6DDFF]"
                >
                    Restock
                </button>
            </td>
        </tr>
    );
}

function DashboardEmptyText({ text }: { text: string }) {
    return (
        <div className="flex min-h-[154px] items-center justify-center rounded-xl border border-dashed border-[#E6DDF0] bg-[#FFFCF7] px-5 text-center">
            <p className="text-sm leading-6 text-[#7A6A84]">{text}</p>
        </div>
    );
}

function RestockAlertsModal({
                                items,
                                activeFilter,
                                lowStockCount,
                                outOfStockCount,
                                onChangeFilter,
                                onClose,
                                onRestock,
                            }: {
    items: Product[];
    activeFilter: "all" | "low" | "out";
    lowStockCount: number;
    outOfStockCount: number;
    onChangeFilter: (filter: "all" | "low" | "out") => void;
    onClose: () => void;
    onRestock: (product: Product) => void;
}) {
    const filterButtonClass = (
        isActive: boolean,
        tone: "all" | "low" | "out",
    ) => {
        if (tone === "all") {
            return isActive
                ? "border-[#2B174C] bg-[#2B174C] text-white"
                : "border-[#E6DDF0] bg-white text-[#5F4E75] hover:bg-[#F7F1FF]";
        }

        if (tone === "low") {
            return isActive
                ? "border-[#F4D79A] bg-[#FFF8E8] text-[#A56607]"
                : "border-[#E6DDF0] bg-white text-[#A56607] hover:bg-[#FFF8E8]";
        }

        return isActive
            ? "border-[#F2C4C4] bg-[#FFF0F0] text-[#C32F2F]"
            : "border-[#E6DDF0] bg-white text-[#C32F2F] hover:bg-[#FFF0F0]";
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4 py-6 font-sans text-[#1A1220] backdrop-blur-sm [&_*]:font-sans">
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="dashboard-restock-alerts-title"
                className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-[18px] border border-[#E6DDF0] bg-white shadow-2xl"
            >
                <div className="flex items-start justify-between gap-4 border-b border-[#E6DDF0] px-6 py-5">
                    <div className="flex min-w-0 items-start gap-3">
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#FFF4D8] text-[#B7791F]">
                            <TriangleAlert size={21} strokeWidth={2} />
                        </span>

                        <div className="min-w-0">
                            <h3
                                id="dashboard-restock-alerts-title"
                                className="!text-[20px] !font-bold !leading-6 text-[#1A1220]"
                            >
                                Restock Alerts
                            </h3>
                            <p className="mt-1 !text-sm !font-normal !leading-5 text-[#7A6A84]">
                                Low-stock and out-of-stock items that need restocking.
                            </p>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close restock alerts"
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl !text-[22px] !font-normal !leading-none text-[#806A8C] transition hover:bg-[#F7F1FF] hover:text-[#2B174C]"
                    >
                        ×
                    </button>
                </div>

                <div className="flex flex-wrap items-center gap-2 border-b border-[#E6DDF0] px-6 py-4">
                    <button
                        type="button"
                        onClick={() => onChangeFilter("all")}
                        className={`h-9 rounded-xl border px-4 !text-xs !font-semibold transition ${filterButtonClass(
                            activeFilter === "all",
                            "all",
                        )}`}
                    >
                        All ({lowStockCount + outOfStockCount})
                    </button>

                    <button
                        type="button"
                        onClick={() => onChangeFilter("low")}
                        className={`h-9 rounded-xl border px-4 !text-xs !font-semibold transition ${filterButtonClass(
                            activeFilter === "low",
                            "low",
                        )}`}
                    >
                        Low Stock ({lowStockCount})
                    </button>

                    <button
                        type="button"
                        onClick={() => onChangeFilter("out")}
                        className={`h-9 rounded-xl border px-4 !text-xs !font-semibold transition ${filterButtonClass(
                            activeFilter === "out",
                            "out",
                        )}`}
                    >
                        Out of Stock ({outOfStockCount})
                    </button>
                </div>

                <div className="min-h-0 flex-1 overflow-auto px-6 pb-6 pt-4">
                    <div className="overflow-hidden rounded-xl border border-[#E6DDF0]">
                        <table className="w-full min-w-[780px] table-fixed border-collapse">
                            <colgroup>
                                <col className="w-[39%]" />
                                <col className="w-[18%]" />
                                <col className="w-[15%]" />
                                <col className="w-[15%]" />
                                <col className="w-[13%]" />
                            </colgroup>

                            <thead className="sticky top-0 z-10 bg-[#FFFCF7]">
                            <tr className="border-b border-[#E6DDF0]">
                                <th className="px-4 py-3 text-left !text-[11px] !font-semibold uppercase tracking-[0.08em] text-[#806A8C]">
                                    Product
                                </th>
                                <th className="px-4 py-3 text-left !text-[11px] !font-semibold uppercase tracking-[0.08em] text-[#806A8C]">
                                    Variant
                                </th>
                                <th className="px-4 py-3 text-left !text-[11px] !font-semibold uppercase tracking-[0.08em] text-[#806A8C]">
                                    Current Stock
                                </th>
                                <th className="px-4 py-3 text-left !text-[11px] !font-semibold uppercase tracking-[0.08em] text-[#806A8C]">
                                    Alert Level
                                </th>
                                <th className="px-4 py-3 text-left !text-[11px] !font-semibold uppercase tracking-[0.08em] text-[#806A8C]">
                                    Action
                                </th>
                            </tr>
                            </thead>

                            <tbody>
                            {items.length === 0 ? (
                                <tr>
                                    <td
                                        colSpan={5}
                                        className="px-4 py-10 text-center text-sm text-[#7A6A84]"
                                    >
                                        No restock alerts found.
                                    </td>
                                </tr>
                            ) : (
                                items.map((product) => {
                                    const currentStock = Number(product.stock || 0);
                                    const alertLevel = Number(product.alertLevel || 0);
                                    const isOutOfStock = currentStock <= 0;
                                    const variantLabel =
                                        product.variantName?.trim() ||
                                        product.variant_name?.trim() ||
                                        product.variant?.trim() ||
                                        "—";

                                    return (
                                        <tr
                                            key={product.id}
                                            className="border-b border-[#EEE7F2] transition hover:bg-[#FFFCF7] last:border-b-0"
                                        >
                                            <td className="px-4 py-3.5 text-left">
                                                <p className="truncate !text-sm !font-semibold !leading-5 text-[#1A1220]">
                                                    {product.name}
                                                </p>
                                                <p
                                                    className={`mt-0.5 !text-xs !font-medium !leading-4 ${
                                                        isOutOfStock
                                                            ? "text-[#C32F2F]"
                                                            : "text-[#A56607]"
                                                    }`}
                                                >
                                                    {isOutOfStock
                                                        ? "Out of Stock"
                                                        : "Low Stock"}
                                                </p>
                                            </td>

                                            <td className="px-4 py-3.5 text-left !text-sm !font-normal !leading-5 text-[#7A6A84]">
                                                {variantLabel}
                                            </td>

                                            <td
                                                className={`px-4 py-3.5 text-left !text-sm !font-semibold !leading-5 ${
                                                    isOutOfStock
                                                        ? "text-[#C32F2F]"
                                                        : "text-[#A56607]"
                                                }`}
                                            >
                                                {currentStock}
                                            </td>

                                            <td className="px-4 py-3.5 text-left !text-sm !font-semibold !leading-5 text-[#5F4E75]">
                                                {alertLevel}
                                            </td>

                                            <td className="px-4 py-3.5 text-left">
                                                <button
                                                    type="button"
                                                    onClick={() => onRestock(product)}
                                                    className="inline-flex h-9 min-w-[74px] items-center justify-center rounded-xl border border-[#2B174C] bg-white px-3 !text-xs !font-semibold text-[#2B174C] transition hover:bg-[#F7F1FF]"
                                                >
                                                    Restock
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
}