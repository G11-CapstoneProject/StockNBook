"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    type ApiOrder,
    type Branch,
    type BranchesApiResponse,
    type CartItem,
    type CartMap,
    type Category,
    type CategoryApiResponse,
    type CreditCheckResult,
    type CreditCollection,
    type Order,
    type OrderItem,
    type PosOrdersApiResponse,
    type Product,
    type ProductsApiResponse,
    mapProduct,
    productToBuyableItems,
    readBranchId,
    readBranchName,
    readCategories,
    readOrders,
    readProducts,
    readRole,
} from "@/components/pos/_shared";

async function safeJson<T>(res: Response): Promise<T> {
    const text = await res.text();

    try {
        return JSON.parse(text) as T;
    } catch {
        return { error: text || "Non-JSON response" } as T;
    }
}

function safeSetSessionJson(key: string, value: unknown): boolean {
    if (typeof window === "undefined") return false;

    try {
        sessionStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch (error) {
        console.warn(`POS cache skipped for "${key}":`, error);

        /*
         * The API/database is the source of truth.
         * A full Owner order history can be much larger than the browser's
         * sessionStorage quota. Never allow a cache write failure to break
         * the POS data load.
         */
        if (key === "stocknbook_orders") {
            try {
                sessionStorage.removeItem(key);
            } catch {
                // Ignore cache cleanup failures.
            }
        }

        return false;
    }
}

function getManilaDateParts(value: Date) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Manila",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(value);

    const readPart = (type: Intl.DateTimeFormatPartTypes) =>
        parts.find((part) => part.type === type)?.value || "";

    return {
        year: readPart("year"),
        month: readPart("month"),
        day: readPart("day"),
    };
}

function getManilaDateInputValue(value = new Date()) {
    const { year, month, day } = getManilaDateParts(value);
    return `${year}-${month}-${day}`;
}

function formatISODateLong(value: string) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return value;

    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return date.toLocaleDateString("en-US", {
        timeZone: "UTC",
        month: "long",
        day: "numeric",
        year: "numeric",
    });
}

function addDaysToISODate(value: string, days: number) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return "";

    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

function isRealizedPOSOrder(order: Order) {
    const status = String(order.status || "COMPLETED").trim().toUpperCase();
    return ![
        "PENDING",
        "PENDING PAYMENT",
        "UNPAID",
        "CANCELLED",
        "CANCELED",
        "REFUNDED",
        "VOID",
        "VOIDED",
        "DRAFT",
        "FAILED",
    ].includes(status);
}

function isExpiredPosDate(value?: string | null) {
    const raw = String(value || "").trim();
    if (!raw) return false;

    const isoDate = raw.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
    if (isoDate) {
        return isoDate < getManilaDateInputValue();
    }

    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return false;

    return getManilaDateInputValue(parsed) < getManilaDateInputValue();
}

function getTransactionStoreCode() {
    if (typeof window === "undefined") {
        return "STORE";
    }

    const savedStoreCode =
        sessionStorage.getItem("store_code") ||
        sessionStorage.getItem("stocknbook_store_code") ||
        "";

    if (savedStoreCode.trim()) {
        const normalizedCode = savedStoreCode
            .trim()
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, "");

        return normalizedCode || "STORE";
    }

    const savedStoreName =
        sessionStorage.getItem("store_name") ||
        sessionStorage.getItem("stocknbook_store_name") ||
        sessionStorage.getItem("business_name") ||
        "STORE";

    // Uses the first word of the business name as the short store code.
    // Example: "Stellise Part Shop" becomes "STELLISE".
    const shortStoreName = savedStoreName.trim().split(/\s+/)[0] || "STORE";

    const normalizedName = shortStoreName
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "");

    return normalizedName || "STORE";
}

function createPosTransactionId(existingOrders: Order[], now: Date) {
    const { year, month, day } = getManilaDateParts(now);
    const datePart = `${year}${month}${day}`;
    const baseId = `${getTransactionStoreCode()}-POS-${datePart}`;

    const matchingIds = existingOrders.filter((order) => {
        const currentId = String(order.id || "").toUpperCase();

        return (
            currentId === baseId ||
            new RegExp(`^${baseId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-\\d+$`).test(
                currentId
            )
        );
    });

    // Every POS transaction always includes its daily sequence number.
    // Examples:
    // STELLISE-POS-20260629-01
    // STELLISE-POS-20260629-02
    return `${baseId}-${String(matchingIds.length + 1).padStart(2, "0")}`;
}


function mapApiOrderToOrder(o: ApiOrder): Order {
    const rawBranchId =
        o.branchId ??
        o.branch_id ??
        null;

    const orderDateISO =
        o.orderDate && o.orderDate !== "0000-00-00"
            ? String(o.orderDate).slice(0, 10)
            : o.createdAt
                ? getManilaDateInputValue(new Date(o.createdAt))
                : getManilaDateInputValue();

    return {
        id: o.orderId,
        controlNumber: o.controlNumber ?? null,
        customer: o.customerName,
        customerAddress: o.customerAddress ?? null,
        customerContactNumber: o.customerContactNumber ?? null,
        paymentMode: o.paymentMode ?? null,
        creditTerm: o.creditTerm ?? null,
        creditDueDate: o.creditDueDate ?? null,
        taxType: o.taxType ?? null,
        vatableSales: Number(o.vatableSales ?? 0),
        vatAmount: Number(o.vatAmount ?? 0),
        customerPayment: Number(o.customerPayment ?? 0),
        totalPaid: Number(o.totalPaid ?? o.customerPayment ?? 0),
        balance: Number(
            o.balance ??
            Math.max(
                0,
                Number(o.total || 0) -
                Number(o.totalPaid ?? o.customerPayment ?? 0)
            )
        ),
        collectionStatus: o.collectionStatus ?? null,
        changeDue: Number(o.changeDue ?? 0),
        cashierId:
            o.cashierId == null || o.cashierId === ""
                ? null
                : Number(o.cashierId),
        cashierName: o.cashierName ?? null,
        cashierRole: o.cashierRole ?? null,
        status: o.status ?? null,
        items: o.item
            ? o.item.split(",").map((s: string) => {
                const [name, qty] = s.split(" x");
                return {
                    name: name.trim(),
                    quantity: Number(qty || 0),
                };
            })
            : [],
        total: Number(o.total || 0),
        cost: Number(
            o.totalCost ??
            o.total_cost ??
            o.total ??
            0
        ),
        profit: Number(
            o.profit ??
            (
                Number(o.total || 0) -
                Number(
                    o.totalCost ??
                    o.total_cost ??
                    o.total ??
                    0
                )
            )
        ),
        date: formatISODateLong(orderDateISO),

        branchId:
            rawBranchId === null ||
            rawBranchId === undefined ||
            rawBranchId === ""
                ? null
                : Number(rawBranchId),

        branchName: String(
            o.branchName ??
            o.branch_name ??
            o.branch ??
            ""
        ).trim() || null,
    };
}

export function usePOS() {
    const [orders, setOrders] = useState<Order[]>(() =>
        readRole() === "owner" ? [] : readOrders()
    );
    const [pendingCreditOrders, setPendingCreditOrders] = useState<Order[]>([]);
    const [cart, setCart] = useState<CartMap>({});
    const [products, setProducts] = useState<Product[]>(() =>
        readRole() === "owner" ? [] : readProducts()
    );
    const [manualCategories, setManualCategories] = useState<Category[]>(() =>
        readRole() === "owner" ? [] : readCategories()
    );

    const [role, setRole] = useState<string>(() => readRole());
    const [assignedBranchId, setAssignedBranchId] = useState<string>(() =>
        readBranchId()
    );
    const [assignedBranchName, setAssignedBranchName] = useState<string>(() =>
        readBranchName()
    );

    const [branches, setBranches] = useState<Branch[]>([]);
    const [selectedSalesBranchId, setSelectedSalesBranchIdState] =
        useState<string>("");
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const hasLoadedRef = useRef(false);

    /*
     * Owner POS starts on today's Manila date instead of loading the entire
     * order history. This keeps the first Owner render fast and makes the
     * date inputs immediately show an actual date instead of dd/mm/yyyy.
     */
    const [ownerOrderStartDate, setOwnerOrderStartDate] = useState<string>(() =>
        getManilaDateInputValue()
    );
    const [ownerOrderEndDate, setOwnerOrderEndDate] = useState<string>(() =>
        getManilaDateInputValue()
    );
    const [ownerOrderSearch, setOwnerOrderSearchState] = useState("");
    const [ownerOrderPage, setOwnerOrderPage] = useState(1);
    const ownerOrderPageSize = 50;
    const [ownerOrderTotal, setOwnerOrderTotal] = useState(0);
    const [ownerOrderTotalPages, setOwnerOrderTotalPages] = useState(1);
    const [ownerOrderSummary, setOwnerOrderSummary] = useState({
        transactions: 0,
        sales: 0,
        cost: 0,
        profit: 0,
    });

    const setOwnerOrderDateRange = useCallback(
        (startDate: string, endDate: string) => {
            setOwnerOrderStartDate(startDate);
            setOwnerOrderEndDate(endDate);
            setOwnerOrderPage(1);
        },
        []
    );

    const setOwnerOrderSearch = useCallback((value: string) => {
        setOwnerOrderSearchState(value);
        setOwnerOrderPage(1);
    }, []);

    const setSelectedSalesBranchId = useCallback((value: string) => {
        setSelectedSalesBranchIdState(value);
        setOwnerOrderPage(1);
    }, []);

    const [categoryFilter, setCategoryFilter] = useState<string>("All");
    const [search, setSearch] = useState("");
    const [payment, setPayment] = useState<string>("");
    const [customerName, setCustomerName] = useState<string>("Walk-in");
    const [customerAddress, setCustomerAddress] = useState<string>("N/A");
    const [customerContactNumber, setCustomerContactNumber] = useState<string>("");
    const [paymentMode, setPaymentMode] = useState<"CASH" | "CREDIT">("CASH");
    const [creditTerm, setCreditTerm] = useState<string>("N/A");
    const [taxType, setTaxType] = useState<"VAT" | "NON_VAT">("VAT");

    const isOwner = role === "owner";
    const isBranchUser = role === "manager" || role === "staff";
    const canUseCreditSales = role === "manager";
    const activeBranchId = assignedBranchId;
    const activeBranchName = assignedBranchName;

    const buildProductsPayload = useCallback(
        (currentRole = role, currentBranchId = assignedBranchId) => {
            const payload: Record<string, unknown> = { action: "get_products" };

            if (
                (currentRole === "manager" || currentRole === "staff") &&
                currentBranchId
            ) {
                payload.branch_id = Number(currentBranchId);
            }

            return payload;
        },
        [role, assignedBranchId]
    );

    const loadData = useCallback(async () => {
        if (typeof window === "undefined") return;

        const token = sessionStorage.getItem("token");
        if (!token) return;

        const currentRole = readRole();
        const currentBranchId = readBranchId();
        const currentBranchName = readBranchName();

        setRole(currentRole);
        setAssignedBranchId(currentBranchId);
        setAssignedBranchName(currentBranchName);

        const isCurrentOwner = currentRole === "owner";
        const isCurrentManager = currentRole === "manager";
        const isCurrentBranchUser =
            currentRole === "manager" || currentRole === "staff";
        const todayISO = getManilaDateInputValue();

        try {
            /*
             * Owner is monitoring-only in POS. Do not download the full product
             * catalog/categories just to render sales history. Manager/Staff still
             * need those datasets to operate the register.
             */
            const productsRequest = isCurrentOwner
                ? Promise.resolve<Response | null>(null)
                : fetch("/api/products", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify(
                        buildProductsPayload(currentRole, currentBranchId)
                    ),
                });

            const categoriesRequest = isCurrentOwner
                ? Promise.resolve<Response | null>(null)
                : fetch("/api/categories", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({ action: "get_categories" }),
                });

            /*
             * Branch POS only needs today's orders for cards/table. Historical
             * unpaid credit is loaded separately for Managers below.
             */
            const ordersRequest = fetch("/api/pos", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    action: "get_orders",
                    ...(
                        isCurrentOwner && selectedSalesBranchId
                            ? {
                                branch_id: Number(
                                    selectedSalesBranchId
                                ),
                            }
                            : {}
                    ),
                    ...(
                        isCurrentOwner && ownerOrderStartDate
                            ? { date_from: ownerOrderStartDate }
                            : {}
                    ),
                    ...(
                        isCurrentOwner && ownerOrderEndDate
                            ? { date_to: ownerOrderEndDate }
                            : {}
                    ),
                    ...(
                        isCurrentOwner
                            ? {
                                paginate: true,
                                page: ownerOrderPage,
                                page_size: ownerOrderPageSize,
                                ...(ownerOrderSearch.trim()
                                    ? { search: ownerOrderSearch.trim() }
                                    : {}),
                            }
                            : {}
                    ),
                    ...(
                        isCurrentBranchUser
                            ? {
                                date_from: todayISO,
                                date_to: todayISO,
                            }
                            : {}
                    ),
                }),
            });

            /*
             * Pending Collections must not depend on loading the branch's entire
             * POS history. Managers receive only open credit transactions.
             */
            const pendingCollectionsRequest = isCurrentManager
                ? fetch("/api/pos", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                        action: "get_orders",
                        credit_open_only: true,
                    }),
                })
                : Promise.resolve<Response | null>(null);

            const [
                productsRes,
                categoriesRes,
                ordersRes,
                pendingCollectionsRes,
            ] = await Promise.all([
                productsRequest,
                categoriesRequest,
                ordersRequest,
                pendingCollectionsRequest,
            ]);

            const productsData = productsRes
                ? await safeJson<ProductsApiResponse>(productsRes)
                : null;
            const categoriesData = categoriesRes
                ? await safeJson<CategoryApiResponse>(categoriesRes)
                : null;
            const ordersData = await safeJson<PosOrdersApiResponse>(ordersRes);
            const pendingCollectionsData = pendingCollectionsRes
                ? await safeJson<PosOrdersApiResponse>(pendingCollectionsRes)
                : null;

            if (ordersRes.ok) {
                const backendTaxType = String(ordersData.taxType || "").toUpperCase();
                setTaxType(backendTaxType === "NON_VAT" ? "NON_VAT" : "VAT");
            }

            if (isCurrentOwner) {
                // Owner POS does not need inventory/catalog state.
                setProducts([]);
                setManualCategories([]);
            } else {
                if (
                    productsRes?.ok &&
                    productsData &&
                    Array.isArray(productsData.products)
                ) {
                    const mapped = productsData.products.map(mapProduct);

                    setProducts(mapped);
                    safeSetSessionJson(
                        "stocknbook_inventory_products",
                        mapped
                    );
                }

                if (
                    categoriesRes?.ok &&
                    categoriesData &&
                    Array.isArray(categoriesData.categories)
                ) {
                    setManualCategories(categoriesData.categories);
                    safeSetSessionJson(
                        "stocknbook_categories",
                        categoriesData.categories
                    );
                }
            }

            if (ordersRes.ok && Array.isArray(ordersData.orders)) {
                const mapped = ordersData.orders.map(mapApiOrderToOrder);
                setOrders(mapped);

                if (isCurrentOwner) {
                    const pagination = ordersData.pagination;
                    setOwnerOrderTotal(Number(pagination?.total ?? mapped.length));
                    setOwnerOrderTotalPages(
                        Math.max(1, Number(pagination?.totalPages ?? 1))
                    );

                    if (ordersData.summary) {
                        setOwnerOrderSummary({
                            transactions: Number(ordersData.summary.transactions || 0),
                            sales: Number(ordersData.summary.sales || 0),
                            cost: Number(ordersData.summary.cost || 0),
                            profit: Number(ordersData.summary.profit || 0),
                        });
                    }
                }

                /*
                 * Manager/Staff now cache only today's branch transactions.
                 * Owner remains API-only to avoid sessionStorage growth.
                 */
                if (isCurrentOwner) {
                    try {
                        sessionStorage.removeItem("stocknbook_orders");
                    } catch {
                        // The live React state above is still valid.
                    }
                } else {
                    safeSetSessionJson("stocknbook_orders", mapped);
                }
            }

            if (
                isCurrentManager &&
                pendingCollectionsRes?.ok &&
                pendingCollectionsData &&
                Array.isArray(pendingCollectionsData.orders)
            ) {
                setPendingCreditOrders(
                    pendingCollectionsData.orders.map(mapApiOrderToOrder)
                );
            } else {
                setPendingCreditOrders([]);
            }
        } catch (err) {
            console.warn("POS loadData failed:", err);
        }
    }, [
        buildProductsPayload,
        selectedSalesBranchId,
        ownerOrderStartDate,
        ownerOrderEndDate,
        ownerOrderSearch,
        ownerOrderPage,
    ]);

    const loadBranches = useCallback(async () => {
        if (typeof window === "undefined") return;

        const token = sessionStorage.getItem("token");
        if (!token) return;

        try {
            const res = await fetch("/api/branches", {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });

            const data = await safeJson<BranchesApiResponse>(res);

            if (!res.ok || !Array.isArray(data.branches)) {
                setBranches([]);
                return;
            }

            const mapped = data.branches
                .map((b) => ({
                    id: Number(b.id ?? b.branch_id ?? b.branchId),
                    branchName:
                        b.branchName ?? b.branch_name ?? b.name ?? "Unnamed Branch",
                }))
                .filter((b) => b.id);

            setBranches(mapped);
        } catch (err) {
            console.warn("Branches fetch failed:", err);
            setBranches([]);
        }
    }, []);

    const refreshAll = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
        // Keep the current POS screen visible on later refreshes. Skeletons are
        // reserved for the first data load; manual/background refreshes are non-blocking.
        if (!hasLoadedRef.current) setLoading(true);
        else if (!silent) setRefreshing(true);

        try {
            await Promise.all([loadData(), loadBranches()]);
        } finally {
            hasLoadedRef.current = true;
            setLoading(false);
            setRefreshing(false);
        }
    }, [loadData, loadBranches]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            void refreshAll();
        }, 0);

        return () => window.clearTimeout(timer);
    }, [refreshAll]);
    // Other employees may restock, reserve, or sell stock in a different session.
    // Read the backend periodically; the server still enforces stock at checkout.
    useEffect(() => {
        const refreshVisible = () => {
            if (document.visibilityState === "visible" && readRole() !== "owner") {
                void loadData();
            }
        };
        const timer = window.setInterval(refreshVisible, 15000);
        window.addEventListener("focus", refreshVisible);
        return () => { window.clearInterval(timer); window.removeEventListener("focus", refreshVisible); };
    }, [loadData]);

    useEffect(() => {
        const sync = () => {
            const currentRole = readRole();

            setRole(currentRole);
            setAssignedBranchId(readBranchId());
            setAssignedBranchName(readBranchName());

            if (currentRole === "owner") {
                // Owner is monitoring-only and does not need catalog caches.
                setProducts([]);
                setManualCategories([]);
                void loadData();
                return;
            }

            setProducts(readProducts());
            setManualCategories(readCategories());

            if (currentRole === "manager") {
                // Refresh today's orders plus the dedicated Pending Collections feed.
                void loadData();
                return;
            }

            // Staff only needs the small cached set of today's branch orders on focus.
            setOrders(readOrders());
        };

        window.addEventListener("focus", sync);
        window.addEventListener("storage", sync);

        return () => {
            window.removeEventListener("focus", sync);
            window.removeEventListener("storage", sync);
        };
    }, [loadData]);

    const branchRawProducts = useMemo(() => {
        if (isBranchUser) return products;
        return [];
    }, [isBranchUser, products]);

    const branchProducts = useMemo(() => {
        if (isBranchUser) {
            return products.flatMap(productToBuyableItems);
        }

        return [];
    }, [isBranchUser, products]);

    const allBuyableItems = useMemo(() => {
        return products.flatMap(productToBuyableItems);
    }, [products]);

    const displayProducts = useMemo(() => {
        const q = search.trim().toLowerCase();

        return branchRawProducts.filter((product) => {
            const category = product.category || "Uncategorized";
            const variants = Array.isArray(product.variants) ? product.variants : [];

            const matchesCategory =
                categoryFilter === "All" || category === categoryFilter;

            const matchesSearch =
                q.length === 0 ||
                product.name.toLowerCase().includes(q) ||
                category.toLowerCase().includes(q) ||
                variants.some((variant) => {
                    const variantName = variant.name || "";
                    const fullName = `${product.name}/${variantName}`;

                    return (
                        variantName.toLowerCase().includes(q) ||
                        fullName.toLowerCase().includes(q)
                    );
                });

            return matchesCategory && matchesSearch;
        });
    }, [branchRawProducts, categoryFilter, search]);

    function resetOrderDraft(nextCustomerName = "Walk-in") {
        setCart({});
        setCategoryFilter("All");
        setSearch("");
        setPayment("");
        setCustomerName(nextCustomerName || "Walk-in");
        setCustomerAddress("N/A");
        setCustomerContactNumber("");
        setPaymentMode("CASH");
        setCreditTerm("N/A");
    }

    function handleQty(key: string, change: number) {
        setCart((prev) => {
            const item = branchProducts.find((p) => p.key === key);
            const current = prev[key] || 0;
            const next = Math.max(0, current + change);

            if (item && next > item.stock) return prev;

            return { ...prev, [key]: next };
        });
    }

    function setQty(key: string, qty: number) {
        const item = branchProducts.find((p) => p.key === key);
        const safe = Math.max(0, Math.floor(qty));

        if (item && safe > item.stock) {
            setCart((prev) => ({ ...prev, [key]: item.stock }));
            return;
        }

        setCart((prev) => ({ ...prev, [key]: safe }));
    }

    function removeItemFromCart(key: string) {
        setCart((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
        });
    }

    const total = useMemo(() => {
        return Object.entries(cart).reduce((sum, [key, qty]) => {
            const item = branchProducts.find((x) => x.key === key);
            return sum + (item ? Number(item.salesPrice || 0) * qty : 0);
        }, 0);
    }, [cart, branchProducts]);

    const categories = useMemo(() => {
        const fromManual = manualCategories
            .map((c) => c.categoryName?.trim() || "")
            .filter(Boolean);

        const fromProducts = branchRawProducts
            .map((p) => (p.category || "").trim())
            .filter(Boolean);

        const unique = Array.from(new Set([...fromManual, ...fromProducts])).sort(
            (a, b) => a.localeCompare(b)
        );

        return ["All", ...unique];
    }, [manualCategories, branchRawProducts]);

    const filteredProducts = useMemo(() => {
        const q = search.trim().toLowerCase();

        return branchProducts.filter((p) => {
            const category = p.category || "Uncategorized";

            const matchesCategory =
                categoryFilter === "All" || category === categoryFilter;

            const matchesSearch =
                q.length === 0 ||
                p.name.toLowerCase().includes(q) ||
                p.productName.toLowerCase().includes(q) ||
                String(p.variantName || "").toLowerCase().includes(q) ||
                category.toLowerCase().includes(q);

            return matchesCategory && matchesSearch;
        });
    }, [branchProducts, categoryFilter, search]);

    const cartItems = useMemo(() => {
        return Object.entries(cart)
            .map(([key, qty]) => {
                const item = branchProducts.find((x) => x.key === key);
                if (!item || qty <= 0) return null;

                return {
                    key: item.key,
                    productId: item.productId,
                    variantId: item.variantId,
                    branchId: item.branchId,
                    productName: item.productName,
                    variantName: item.variantName,
                    name: item.name,
                    qty,
                    price: Number(item.salesPrice || 0),
                    lineTotal: Number(item.salesPrice || 0) * qty,
                    stock: item.stock,
                    category: item.category,
                    originalPrice: item.originalPrice,
                    salesPrice: item.salesPrice,
                    alertLevel: item.alertLevel,
                    expirationDate: item.expirationDate ?? null,
                    isVariant: item.isVariant,
                };
            })
            .filter(Boolean) as CartItem[];
    }, [cart, branchProducts]);

    function validateStockOrAlert(): boolean {
        if (isOwner) {
            alert("Owner account is for sales monitoring only.");
            return false;
        }

        for (const [key, qty] of Object.entries(cart)) {
            const item = branchProducts.find((x) => x.key === key);

            if (item && isExpiredPosDate(item.expirationDate)) {
                alert(`Expired item "${item.name}" cannot be sold.`);
                return false;
            }

            if (item && qty > item.stock) {
                alert(`Not enough stock for ${item.name}`);
                return false;
            }
        }

        return true;
    }

    const paymentNumber = useMemo(() => {
        if (paymentMode === "CREDIT" && payment.trim() === "") return 0;
        const val = Number(payment);
        return Number.isFinite(val) ? val : NaN;
    }, [payment, paymentMode]);

    const change = useMemo(() => {
        if (!Number.isFinite(paymentNumber)) return 0;
        return Math.max(0, paymentNumber - total);
    }, [paymentNumber, total]);

    const vatableSales = useMemo(() => {
        if (taxType !== "VAT") return 0;
        return Math.round((total / 1.12) * 100) / 100;
    }, [taxType, total]);

    const vatAmount = useMemo(() => {
        if (taxType !== "VAT") return 0;
        return Math.round((vatableSales * 0.12) * 100) / 100;
    }, [taxType, vatableSales]);

    const creditDueDate = useMemo(() => {
        if (paymentMode !== "CREDIT") return "";
        const days = String(creditTerm || "").startsWith("30") ? 30 : 15;
        const dueISO = addDaysToISODate(getManilaDateInputValue(), days);
        return dueISO ? formatISODateLong(dueISO) : "";
    }, [paymentMode, creditTerm]);

    const canPlaceOrder = useMemo(() => {
        if (cartItems.length === 0) return false;
        if (!customerName.trim()) return false;
        if (!Number.isFinite(paymentNumber)) return false;

        if (paymentMode === "CASH") {
            return paymentNumber >= total;
        }

        if (!canUseCreditSales) return false;
        if (!customerContactNumber.trim()) return false;
        if (!creditTerm || creditTerm === "N/A") return false;
        return paymentNumber >= 0 && paymentNumber <= total;
    }, [
        cartItems.length,
        customerName,
        customerContactNumber,
        paymentNumber,
        paymentMode,
        creditTerm,
        total,
        canUseCreditSales,
    ]);

    async function handlePlaceOrder(): Promise<Order | null> {
        if (!validateStockOrAlert()) return null;

        if (cartItems.length === 0) {
            alert("Please add at least 1 item to the order.");
            return null;
        }

        const existingOrders = orders;

        const normalizedCustomerName = customerName.trim();
        const normalizedCustomerAddress =
            paymentMode === "CREDIT" && customerAddress.trim()
                ? customerAddress.trim()
                : "N/A";

        if (!normalizedCustomerName) {
            alert("Customer name is required.");
            return null;
        }

        if (paymentMode === "CREDIT" && !canUseCreditSales) {
            alert("Only an assigned Manager can create credit sales.");
            return null;
        }

        if (paymentMode === "CREDIT" && !customerContactNumber.trim()) {
            alert("Customer contact number is required for credit sales.");
            return null;
        }

        if (paymentMode === "CREDIT" && (!creditTerm || creditTerm === "N/A")) {
            alert("Please select a credit term for credit sales.");
            return null;
        }

        if (!Number.isFinite(paymentNumber)) {
            alert("Please enter a valid payment amount.");
            return null;
        }

        if (paymentMode === "CASH" && paymentNumber < total) {
            alert("Payment must be equal or greater than the total for a cash sale.");
            return null;
        }

        if (paymentMode === "CREDIT" && paymentNumber > total) {
            alert("Customer payment cannot exceed the order total for a credit sale.");
            return null;
        }

        const items: OrderItem[] = cartItems.map((i) => ({
            name: i.name,
            quantity: i.qty,
            unitPrice: i.price,
            lineTotal: i.lineTotal,
        }));

        const now = new Date();
        const { year, month, day } = getManilaDateParts(now);

        const dbDate = `${year}-${month}-${day}`;
        const todayKey = formatISODateLong(dbDate);

        const finalCustomerName =
            paymentMode === "CREDIT" ? normalizedCustomerName : "Walk-in";
        const orderId = createPosTransactionId(existingOrders, now);

        const newOrder: Order = {
            id: orderId,
            customer: finalCustomerName,
            customerAddress: normalizedCustomerAddress,
            customerContactNumber:
                paymentMode === "CREDIT" ? customerContactNumber.trim() : null,
            items,
            total,
            date: todayKey,
            paymentMode,
            creditTerm: paymentMode === "CREDIT" ? creditTerm : "N/A",
            taxType,
            vatableSales,
            vatAmount,
            customerPayment: paymentNumber,
            changeDue: paymentMode === "CASH" ? change : 0,
            creditDueDate: paymentMode === "CREDIT" ? creditDueDate : null,
            totalPaid: paymentNumber,
            balance: paymentMode === "CREDIT" ? Math.max(0, total - paymentNumber) : 0,
            collectionStatus:
                paymentMode === "CREDIT"
                    ? paymentNumber >= total
                        ? "PAID"
                        : paymentNumber > 0
                            ? "PARTIAL"
                            : "PENDING"
                    : "PAID",
            branchId: activeBranchId
                ? Number(activeBranchId)
                : null,
            branchName:
                activeBranchName || null,
        };

        const token = sessionStorage.getItem("token");

        if (!token) {
            alert("No token found. Please log in again.");
            return null;
        }

        const itemText =
            newOrder.items.length > 0
                ? newOrder.items.map((i) => `${i.name} x${i.quantity}`).join(", ")
                : "";

        try {
            const orderRes = await fetch("/api/pos", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    action: "create_order",
                    order_id: newOrder.id,
                    customer_name: newOrder.customer,
                    customer_address: newOrder.customerAddress,
                    customer_contact_number:
                        paymentMode === "CREDIT" ? customerContactNumber.trim() : "",
                    payment_mode: paymentMode,
                    credit_term: paymentMode === "CREDIT" ? creditTerm : "N/A",
                    tax_type: taxType,
                    customer_payment: Number(paymentNumber.toFixed(2)),
                    change_due: Number(change.toFixed(2)),
                    item: itemText,
                    total: newOrder.total,
                    order_date: dbDate,
                    ...(activeBranchId ? { branch_id: Number(activeBranchId) } : {}),
                    order_items: cartItems.map((ci) => ({
                        product_id: ci.productId,
                        variant_id: ci.variantId || null,
                        quantity: ci.qty,
                        unit_price: ci.price,
                        item_name: ci.name,
                    })),
                }),
            });

            const orderData = await safeJson<{
                success?: boolean;
                error?: string;
                order?: {
                    orderId?: string;
                    controlNumber?: string | null;
                    branchId?: number | string | null;
                    branchName?: string | null;
                    customerName?: string;
                    customerAddress?: string | null;
                    total?: number | string | null;
                    customerContactNumber?: string | null;
                    paymentMode?: string | null;
                    creditTerm?: string | null;
                    creditDueDate?: string | null;
                    taxType?: string | null;
                    vatableSales?: number | string | null;
                    vatAmount?: number | string | null;
                    customerPayment?: number | string | null;
                    totalPaid?: number | string | null;
                    balance?: number | string | null;
                    collectionStatus?: string | null;
                    changeDue?: number | string | null;
                    cashierId?: number | string | null;
                    cashierName?: string | null;
                    cashierRole?: string | null;
                    totalCost?: number;
                    profit?: number;
                    orderItems?: Array<{
                        name: string;
                        quantity: number;
                        unitPrice?: number;
                        lineTotal?: number;
                        costPrice?: number;
                    }>;
                };
            }>(orderRes);

            if (!orderRes.ok) {
                alert(
                    orderData?.error ||
                    "Failed to save order to database."
                );
                return null;
            }

            /*
             * The backend owns the final order ID because order_id is a
             * table-wide PRIMARY KEY. Another branch may already have used
             * the sequence generated from this branch's locally loaded list.
             */
            const persistedOrder: Order = {
                ...newOrder,
                id:
                    String(
                        orderData?.order?.orderId ||
                        newOrder.id
                    ),
                controlNumber: orderData?.order?.controlNumber ?? null,
                customer: orderData?.order?.customerName || newOrder.customer,
                customerAddress:
                    orderData?.order?.customerAddress ?? newOrder.customerAddress,
                total: Number(orderData?.order?.total ?? newOrder.total),
                customerContactNumber:
                    orderData?.order?.customerContactNumber ??
                    newOrder.customerContactNumber ??
                    null,
                paymentMode: orderData?.order?.paymentMode || newOrder.paymentMode,
                creditTerm: orderData?.order?.creditTerm || newOrder.creditTerm,
                creditDueDate:
                    orderData?.order?.creditDueDate ?? newOrder.creditDueDate ?? null,
                taxType: orderData?.order?.taxType || newOrder.taxType,
                vatableSales: Number(
                    orderData?.order?.vatableSales ?? newOrder.vatableSales ?? 0
                ),
                vatAmount: Number(
                    orderData?.order?.vatAmount ?? newOrder.vatAmount ?? 0
                ),
                customerPayment: Number(
                    orderData?.order?.customerPayment ?? newOrder.customerPayment ?? 0
                ),
                totalPaid: Number(
                    orderData?.order?.totalPaid ?? newOrder.totalPaid ?? 0
                ),
                balance: Number(
                    orderData?.order?.balance ?? newOrder.balance ?? 0
                ),
                collectionStatus:
                    orderData?.order?.collectionStatus ??
                    newOrder.collectionStatus ??
                    null,
                changeDue: Number(
                    orderData?.order?.changeDue ?? newOrder.changeDue ?? 0
                ),
                cashierId:
                    orderData?.order?.cashierId == null
                        ? null
                        : Number(orderData.order.cashierId),
                cashierName: orderData?.order?.cashierName ?? null,
                cashierRole: orderData?.order?.cashierRole ?? null,
                items:
                    Array.isArray(orderData?.order?.orderItems) &&
                    orderData!.order!.orderItems!.length > 0
                        ? orderData!.order!.orderItems!.map((item) => ({
                            name: item.name,
                            quantity: Number(item.quantity || 0),
                            unitPrice: Number(item.unitPrice || 0),
                            lineTotal: Number(item.lineTotal || 0),
                            costPrice: Number(item.costPrice || 0),
                        }))
                        : newOrder.items,
                branchId:
                    orderData?.order?.branchId == null
                        ? newOrder.branchId
                        : Number(
                            orderData.order.branchId
                        ),
                branchName:
                    String(
                        orderData?.order?.branchName ||
                        newOrder.branchName ||
                        ""
                    ) || null,
                cost:
                    Number.isFinite(
                        Number(orderData?.order?.totalCost)
                    )
                        ? Number(
                            orderData?.order?.totalCost
                        )
                        : undefined,
                profit:
                    Number.isFinite(
                        Number(orderData?.order?.profit)
                    )
                        ? Number(
                            orderData?.order?.profit
                        )
                        : undefined,
            };

            const refreshRes = await fetch("/api/products", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify(buildProductsPayload()),
            });

            const refreshData = await safeJson<ProductsApiResponse>(refreshRes);

            if (refreshRes.ok && Array.isArray(refreshData.products)) {
                const mapped = refreshData.products.map(mapProduct);

                setProducts(mapped);
                safeSetSessionJson(
                    "stocknbook_inventory_products",
                    mapped
                );
            }

            const updatedOrders = [
                persistedOrder,
                ...existingOrders,
            ];

            safeSetSessionJson(
                "stocknbook_orders",
                updatedOrders
            );
            setOrders(updatedOrders);

            resetOrderDraft("Walk-in");
            return persistedOrder;
        } catch (err) {
            console.error(err);
            alert("Failed to place order.");
            return null;
        }
    }

    const checkCustomerCredit = useCallback(async (
        contactNumber: string
    ): Promise<CreditCheckResult> => {
        const unverified: CreditCheckResult = {
            status: "UNVERIFIED",
            restricted: false,
            matchedOrders: 0,
            openOrders: 0,
            outstandingBalance: 0,
            overdueBalance: 0,
            oldestDueDate: null,
        };

        const token = sessionStorage.getItem("token");
        if (!token || role !== "manager") return unverified;

        try {
            const res = await fetch("/api/pos", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    action: "check_customer_credit",
                    customer_contact_number: contactNumber,
                }),
            });

            const data = await safeJson<CreditCheckResult & { error?: string }>(res);

            if (!res.ok) {
                console.warn("Credit check failed:", data.error || res.statusText);
                return unverified;
            }

            return {
                status: data.status || "UNVERIFIED",
                restricted: Boolean(data.restricted),
                matchedOrders: Number(data.matchedOrders || 0),
                openOrders: Number(data.openOrders || 0),
                outstandingBalance: Number(data.outstandingBalance || 0),
                overdueBalance: Number(data.overdueBalance || 0),
                oldestDueDate: data.oldestDueDate || null,
            };
        } catch (error) {
            console.warn("Customer credit check failed:", error);
            return unverified;
        }
    }, [role]);

    async function recordCreditPayment(
        orderId: string,
        amount: number,
        paymentMethod: string,
        referenceNumber = ""
    ): Promise<boolean> {
        const token = sessionStorage.getItem("token");
        if (!token) {
            alert("No token found. Please log in again.");
            return false;
        }

        try {
            const res = await fetch("/api/pos", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    action: "record_collection",
                    order_id: orderId,
                    amount,
                    payment_method: paymentMethod,
                    reference_number: referenceNumber,
                }),
            });

            const data = await safeJson<{ success?: boolean; error?: string }>(res);

            if (!res.ok || !data.success) {
                alert(data.error || "Failed to record credit payment.");
                return false;
            }

            await loadData();
            return true;
        } catch (error) {
            console.error(error);
            alert("Failed to record credit payment.");
            return false;
        }
    }

    const getCollectionHistory = useCallback(async (orderId: string): Promise<CreditCollection[]> => {
        const token = sessionStorage.getItem("token");
        if (!token) return [];

        try {
            const res = await fetch("/api/pos", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    action: "get_collection_history",
                    order_id: orderId,
                }),
            });

            const data = await safeJson<{
                collections?: CreditCollection[];
                error?: string;
            }>(res);

            if (!res.ok || !Array.isArray(data.collections)) {
                return [];
            }

            return data.collections.map((entry) => ({
                ...entry,
                id: Number(entry.id),
                amount: Number(entry.amount || 0),
            }));
        } catch (error) {
            console.warn("Collection history fetch failed:", error);
            return [];
        }
    }, []);

    const voidPosOrder = useCallback(async (
        orderId: string,
        reason: string
    ): Promise<boolean> => {
        const token = sessionStorage.getItem("token");
        if (!token) {
            alert("No token found. Please log in again.");
            return false;
        }

        if (role !== "manager") {
            alert("Only an assigned Manager can void POS transactions.");
            return false;
        }

        try {
            const res = await fetch("/api/pos", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    action: "void_order",
                    order_id: orderId,
                    reason,
                }),
            });

            const data = await safeJson<{ success?: boolean; error?: string }>(res);
            if (!res.ok || !data.success) {
                alert(data.error || "Failed to void POS transaction.");
                return false;
            }

            await refreshAll({ silent: true });
            return true;
        } catch (error) {
            console.error(error);
            alert("Failed to void POS transaction.");
            return false;
        }
    }, [role, refreshAll]);

    async function updateTaxRegistration(
        registration: "VAT_REGISTERED" | "NON_VAT"
    ): Promise<boolean> {
        const token = sessionStorage.getItem("token");
        if (!token) {
            alert("No token found. Please log in again.");
            return false;
        }

        try {
            const res = await fetch("/api/pos", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    action: "update_tax_registration",
                    tax_registration: registration,
                }),
            });

            const data = await safeJson<{
                success?: boolean;
                taxType?: string;
                error?: string;
            }>(res);

            if (!res.ok || !data.success) {
                alert(data.error || "Failed to update tax registration.");
                return false;
            }

            setTaxType(String(data.taxType).toUpperCase() === "NON_VAT" ? "NON_VAT" : "VAT");
            await loadData();
            return true;
        } catch (error) {
            console.error(error);
            alert("Failed to update tax registration.");
            return false;
        }
    }

    const todayKey = formatISODateLong(getManilaDateInputValue());

    const todayOrders = orders.filter((o) => o.date === todayKey);

    const todayOrdersForSales = todayOrders.filter(
        (o) => Number(o.total || 0) > 0 && isRealizedPOSOrder(o)
    );

    const totalRevenue = orders
        .filter(isRealizedPOSOrder)
        .reduce((sum, o) => sum + Number(o.total || 0), 0);

    const todayRevenue = todayOrdersForSales.reduce(
        (sum, o) => sum + Number(o.total || 0),
        0
    );

    const calculateOrderProfit = useCallback(
        (order: Order) => {
            const backendProfit = Number(order.profit);

            if (Number.isFinite(backendProfit)) {
                return backendProfit;
            }

            // Branch users must never derive or receive product-cost/profit
            // information client-side. Owner-only compatibility fallback for
            // older cached orders is retained below.
            if (!isOwner) return 0;

            return order.items.reduce((itemSum, item) => {
                const buyableItem = allBuyableItems.find(
                    (p) => p.name === item.name
                );

                if (!buyableItem) return itemSum;

                const unitProfit =
                    Number(buyableItem.salesPrice || 0) -
                    Number(buyableItem.originalPrice || 0);

                return (
                    itemSum +
                    unitProfit * Number(item.quantity || 0)
                );
            }, 0);
        },
        [allBuyableItems, isOwner]
    );

    const totalProfit = orders.reduce(
        (sum, order) => sum + calculateOrderProfit(order),
        0
    );

    const todayProfit = todayOrdersForSales.reduce(
        (sum, order) => sum + calculateOrderProfit(order),
        0
    );

    const currentMonth = (() => {
        const { year, month } = getManilaDateParts(new Date());
        const date = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
        return date.toLocaleDateString("en-PH", {
            timeZone: "UTC",
            month: "long",
            year: "numeric",
        });
    })();

    function getBranchSales(branch: Branch) {
        const branchId = String(branch.id || "").trim();
        const branchName = String(branch.branchName || "")
            .trim()
            .toLowerCase();

        const branchOrders = orders.filter((order) => {
            const orderBranchId = String(order.branchId || "").trim();
            const orderBranchName = String(order.branchName || "")
                .trim()
                .toLowerCase();

            // Primary match: branch ID.
            if (orderBranchId && orderBranchId === branchId) {
                return true;
            }

            // Fallback for older/cached orders that have the correct
            // branch name but no branch ID.
            if (
                !orderBranchId &&
                orderBranchName &&
                branchName &&
                orderBranchName === branchName
            ) {
                return true;
            }

            return false;
        });

        const sales = branchOrders.reduce(
            (sum, order) => sum + Number(order.total || 0),
            0
        );

        const profit = branchOrders.reduce(
            (sum, order) =>
                sum + calculateOrderProfit(order),
            0
        );

        return {
            orders: branchOrders,
            sales,
            profit,
        };
    }

    const selectedBranch = branches.find(
        (branch) => String(branch.id) === selectedSalesBranchId
    );

    const selectedBranchData = selectedBranch
        ? getBranchSales(selectedBranch)
        : null;

    return {
        orders,
        pendingCreditOrders,
        cart,
        products,
        allBuyableItems,

        role,

        branches,
        selectedSalesBranchId,
        setSelectedSalesBranchId,
        loading,
        refreshing,

        ownerOrderStartDate,
        ownerOrderEndDate,
        setOwnerOrderDateRange,
        ownerOrderSearch,
        setOwnerOrderSearch,
        ownerOrderPage,
        setOwnerOrderPage,
        ownerOrderPageSize,
        ownerOrderTotal,
        ownerOrderTotalPages,
        ownerOrderSummary,

        categoryFilter,
        setCategoryFilter,

        search,
        setSearch,

        payment,
        setPayment,
        customerName,
        setCustomerName,
        customerAddress,
        setCustomerAddress,
        customerContactNumber,
        setCustomerContactNumber,
        paymentMode,
        setPaymentMode,
        creditTerm,
        setCreditTerm,
        taxType,
        setTaxType,

        isOwner,
        canUseCreditSales,
        activeBranchName,

        refreshAll,

        resetOrderDraft,
        handleQty,
        setQty,
        removeItemFromCart,

        total,
        categories,
        displayProducts,
        filteredProducts,
        cartItems,

        change,
        vatableSales,
        vatAmount,
        creditDueDate,
        canPlaceOrder,
        handlePlaceOrder,
        checkCustomerCredit,
        recordCreditPayment,
        getCollectionHistory,
        voidPosOrder,
        updateTaxRegistration,

        todayOrders,
        todayCompletedOrders: todayOrdersForSales,

        totalRevenue,
        todayRevenue,
        totalProfit,
        todayProfit,

        currentMonth,

        getBranchSales,
        selectedBranch,
        selectedBranchData,
    };
}

export type UsePOSReturn = ReturnType<typeof usePOS>;