"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
    type Branch,
    type BranchesApiResponse,
    type CartItem,
    type CartMap,
    type Category,
    type CategoryApiResponse,
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

export function usePOS() {
    const [orders, setOrders] = useState<Order[]>(() =>
        readRole() === "owner" ? [] : readOrders()
    );
    const [cart, setCart] = useState<CartMap>({});
    const [products, setProducts] = useState<Product[]>(() => readProducts());
    const [manualCategories, setManualCategories] = useState<Category[]>(() =>
        readCategories()
    );

    const [role, setRole] = useState<string>(() => readRole());
    const [assignedBranchId, setAssignedBranchId] = useState<string>(() =>
        readBranchId()
    );
    const [assignedBranchName, setAssignedBranchName] = useState<string>(() =>
        readBranchName()
    );

    const [branches, setBranches] = useState<Branch[]>([]);
    const [selectedSalesBranchId, setSelectedSalesBranchId] =
        useState<string>("");

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

    const setOwnerOrderDateRange = useCallback(
        (startDate: string, endDate: string) => {
            setOwnerOrderStartDate(startDate);
            setOwnerOrderEndDate(endDate);
        },
        []
    );

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

        try {
            const [productsRes, categoriesRes, ordersRes] = await Promise.all([
                fetch("/api/products", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify(
                        buildProductsPayload(currentRole, currentBranchId)
                    ),
                }),

                fetch("/api/categories", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({ action: "get_categories" }),
                }),

                fetch("/api/pos", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                        action: "get_orders",
                        ...(
                            currentRole === "owner" &&
                            selectedSalesBranchId
                                ? {
                                    branch_id: Number(
                                        selectedSalesBranchId
                                    ),
                                }
                                : {}
                        ),
                        ...(
                            currentRole === "owner" && ownerOrderStartDate
                                ? { date_from: ownerOrderStartDate }
                                : {}
                        ),
                        ...(
                            currentRole === "owner" && ownerOrderEndDate
                                ? { date_to: ownerOrderEndDate }
                                : {}
                        ),
                    }),
                }),
            ]);

            const productsData = await safeJson<ProductsApiResponse>(productsRes);
            const categoriesData = await safeJson<CategoryApiResponse>(categoriesRes);
            const ordersData = await safeJson<PosOrdersApiResponse>(ordersRes);

            if (ordersRes.ok) {
                const backendTaxType = String(ordersData.taxType || "").toUpperCase();
                setTaxType(backendTaxType === "NON_VAT" ? "NON_VAT" : "VAT");
            }

            if (productsRes.ok && Array.isArray(productsData.products)) {
                const mapped = productsData.products.map(mapProduct);

                setProducts(mapped);
                safeSetSessionJson(
                    "stocknbook_inventory_products",
                    mapped
                );
            }

            if (categoriesRes.ok && Array.isArray(categoriesData.categories)) {
                setManualCategories(categoriesData.categories);
                safeSetSessionJson(
                    "stocknbook_categories",
                    categoriesData.categories
                );
            }

            if (ordersRes.ok && Array.isArray(ordersData.orders)) {
                const mapped = ordersData.orders.map((o) => {
                    const safeDate =
                        o.orderDate && o.orderDate !== "0000-00-00"
                            ? new Date(o.orderDate)
                            : o.createdAt
                                ? new Date(o.createdAt)
                                : new Date();

                    const rawBranchId =
                        o.branchId ??
                        o.branch_id ??
                        null;

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
                                Number(o.total || 0) - Number(o.totalPaid ?? o.customerPayment ?? 0)
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
                        date: safeDate.toLocaleDateString("en-US", {
                            month: "long",
                            day: "numeric",
                            year: "numeric",
                        }),

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
                });

                setOrders(mapped);

                /*
                 * Manager/Staff only load one branch, so their small cache can
                 * still be kept for compatibility. Owner may load the entire
                 * store history; keeping that in sessionStorage is what caused
                 * QuotaExceededError and later reset the Owner view to 0.
                 */
                if (currentRole === "owner") {
                    try {
                        sessionStorage.removeItem("stocknbook_orders");
                    } catch {
                        // The live React state above is still valid.
                    }
                } else {
                    safeSetSessionJson("stocknbook_orders", mapped);
                }
            }
        } catch (err) {
            console.warn("POS loadData failed:", err);
        }
    }, [
        buildProductsPayload,
        selectedSalesBranchId,
        ownerOrderStartDate,
        ownerOrderEndDate,
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

    const refreshAll = useCallback(async () => {
        await Promise.all([loadData(), loadBranches()]);
    }, [loadData, loadBranches]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            void refreshAll();
        }, 0);

        return () => window.clearTimeout(timer);
    }, [refreshAll]);

    useEffect(() => {
        const sync = () => {
            const currentRole = readRole();

            setProducts(readProducts());
            setManualCategories(readCategories());
            setRole(currentRole);
            setAssignedBranchId(readBranchId());
            setAssignedBranchName(readBranchName());

            if (currentRole === "owner") {
                /*
                 * Owner orders come from the API, not sessionStorage.
                 * The full store history may exceed the storage quota.
                 */
                void loadData();
            } else {
                setOrders(readOrders());
            }
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

    function resetOrderDraft(_nextCustomerName = "Walk-in") {
        setCart({});
        setCategoryFilter("All");
        setSearch("");
        setPayment("");
        setCustomerName("Walk-in");
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
        const due = new Date();
        due.setHours(0, 0, 0, 0);
        due.setDate(due.getDate() + days);
        return due.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
        });
    }, [paymentMode, creditTerm]);

    const canPlaceOrder = useMemo(() => {
        if (cartItems.length === 0) return false;
        if (!customerName.trim()) return false;
        if (!Number.isFinite(paymentNumber)) return false;

        if (paymentMode === "CASH") {
            return paymentNumber >= total;
        }

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
    ]);

    async function handlePlaceOrder(): Promise<Order | null> {
        if (!validateStockOrAlert()) return null;

        if (cartItems.length === 0) {
            alert("Please add at least 1 item to the order.");
            return null;
        }

        const existingOrders = orders;

        const normalizedCustomerName = customerName.trim();
        const normalizedCustomerAddress = "N/A";

        if (!normalizedCustomerName) {
            alert("Customer name is required.");
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

        const todayKey = now.toLocaleDateString("en-US", {
            month: "long",
            day: "numeric",
            year: "numeric",
        });

        const todaysCount = existingOrders.filter((o) => o.date === todayKey).length;

        const finalCustomerName = "Walk-in";
        const orderId = createPosTransactionId(existingOrders, now);
        const dbDate = `${year}-${month}-${day}`;

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

    async function getCollectionHistory(orderId: string): Promise<CreditCollection[]> {
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
    }

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

    const todayKey = new Date().toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
    });

    const todayOrders = orders.filter((o) => o.date === todayKey);

    const todayOrdersForSales = todayOrders.filter(
        (o) => Number(o.total || 0) > 0
    );

    const totalRevenue = orders.reduce(
        (sum, o) => sum + Number(o.total || 0),
        0
    );

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
        [allBuyableItems]
    );

    const totalProfit = orders.reduce(
        (sum, order) => sum + calculateOrderProfit(order),
        0
    );

    const todayProfit = todayOrdersForSales.reduce(
        (sum, order) => sum + calculateOrderProfit(order),
        0
    );

    const currentMonth = new Date().toLocaleDateString("en-PH", {
        month: "long",
        year: "numeric",
    });

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
        cart,
        products,
        allBuyableItems,

        role,

        branches,
        selectedSalesBranchId,
        setSelectedSalesBranchId,

        ownerOrderStartDate,
        ownerOrderEndDate,
        setOwnerOrderDateRange,

        categoryFilter,
        setCategoryFilter,

        search,
        setSearch,

        payment,
        setPayment,
        customerName,
        setCustomerName,
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
        recordCreditPayment,
        getCollectionHistory,
        updateTaxRegistration,

        todayOrders,

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