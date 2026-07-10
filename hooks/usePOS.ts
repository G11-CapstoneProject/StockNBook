"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
    type Branch,
    type BranchesApiResponse,
    type CartItem,
    type CartMap,
    type Category,
    type CategoryApiResponse,
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
    const [orders, setOrders] = useState<Order[]>(() => readOrders());
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

    const [categoryFilter, setCategoryFilter] = useState<string>("All");
    const [search, setSearch] = useState("");
    const [payment, setPayment] = useState<string>("");

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
                    body: JSON.stringify({ action: "get_orders" }),
                }),
            ]);

            const productsData = await safeJson<ProductsApiResponse>(productsRes);
            const categoriesData = await safeJson<CategoryApiResponse>(categoriesRes);
            const ordersData = await safeJson<PosOrdersApiResponse>(ordersRes);

            if (productsRes.ok && Array.isArray(productsData.products)) {
                const mapped = productsData.products.map(mapProduct);

                setProducts(mapped);
                sessionStorage.setItem(
                    "stocknbook_inventory_products",
                    JSON.stringify(mapped)
                );
            }

            if (categoriesRes.ok && Array.isArray(categoriesData.categories)) {
                setManualCategories(categoriesData.categories);
                sessionStorage.setItem(
                    "stocknbook_categories",
                    JSON.stringify(categoriesData.categories)
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
                        customer: o.customerName,
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
                sessionStorage.setItem("stocknbook_orders", JSON.stringify(mapped));
            }
        } catch (err) {
            console.warn("POS loadData failed:", err);
        }
    }, [buildProductsPayload]);

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
            setProducts(readProducts());
            setOrders(readOrders());
            setManualCategories(readCategories());
            setRole(readRole());
            setAssignedBranchId(readBranchId());
            setAssignedBranchName(readBranchName());
        };

        window.addEventListener("focus", sync);
        window.addEventListener("storage", sync);

        return () => {
            window.removeEventListener("focus", sync);
            window.removeEventListener("storage", sync);
        };
    }, []);

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

    function resetOrderDraft() {
        setCart({});
        setCategoryFilter("All");
        setSearch("");
        setPayment("");
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
        const val = Number(payment);
        return Number.isFinite(val) ? val : NaN;
    }, [payment]);

    const change = useMemo(() => {
        if (!Number.isFinite(paymentNumber)) return 0;
        return Math.max(0, paymentNumber - total);
    }, [paymentNumber, total]);

    async function handlePlaceOrder() {
        if (!validateStockOrAlert()) return;

        if (cartItems.length === 0) {
            alert("Please add at least 1 item to the order.");
            return;
        }

        const existingOrders = readOrders();

        if (!Number.isFinite(paymentNumber)) {
            alert("Please enter a valid payment amount.");
            return;
        }

        if (paymentNumber < total) {
            alert("Payment must be equal or greater than the total.");
            return;
        }

        const items: OrderItem[] = cartItems.map((i) => ({
            name: i.name,
            quantity: i.qty,
        }));

        const now = new Date();
        const { year, month, day } = getManilaDateParts(now);

        const todayKey = now.toLocaleDateString("en-US", {
            month: "long",
            day: "numeric",
            year: "numeric",
        });

        const todaysCount = existingOrders.filter((o) => o.date === todayKey).length;

        const customerName = `Customer ${todaysCount + 1}`;
        const orderId = createPosTransactionId(existingOrders, now);
        const dbDate = `${year}-${month}-${day}`;

        const newOrder: Order = {
            id: orderId,
            customer: customerName,
            items,
            total,
            date: todayKey,
        };

        const token = sessionStorage.getItem("token");

        if (!token) {
            alert("No token found. Please log in again.");
            return;
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

            if (!orderRes.ok) {
                const data = await orderRes
                    .json()
                    .catch(() => ({} as { error?: string }));

                alert(data?.error || "Failed to save order to database.");
                return;
            }

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
                sessionStorage.setItem(
                    "stocknbook_inventory_products",
                    JSON.stringify(mapped)
                );
            }

            const updatedOrders = [newOrder, ...existingOrders];

            sessionStorage.setItem("stocknbook_orders", JSON.stringify(updatedOrders));
            setOrders(updatedOrders);

            resetOrderDraft();
        } catch (err) {
            console.error(err);
            alert("Failed to place order.");
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

    const totalProfit = orders.reduce((sum, order) => {
        const orderProfit = order.items.reduce((itemSum, item) => {
            const buyableItem = allBuyableItems.find((p) => p.name === item.name);
            if (!buyableItem) return itemSum;

            const unitProfit =
                Number(buyableItem.salesPrice || 0) -
                Number(buyableItem.originalPrice || 0);

            return itemSum + unitProfit * Number(item.quantity || 0);
        }, 0);

        return sum + orderProfit;
    }, 0);

    const todayProfit = todayOrdersForSales.reduce((sum, order) => {
        const orderProfit = order.items.reduce((itemSum, item) => {
            const buyableItem = allBuyableItems.find((p) => p.name === item.name);
            if (!buyableItem) return itemSum;

            const unitProfit =
                Number(buyableItem.salesPrice || 0) -
                Number(buyableItem.originalPrice || 0);

            return itemSum + unitProfit * Number(item.quantity || 0);
        }, 0);

        return sum + orderProfit;
    }, 0);

    const currentMonth = new Date().toLocaleDateString("en-PH", {
        month: "long",
        year: "numeric",
    });

    function getBranchSales(branch: Branch) {
        const branchBuyableItems = allBuyableItems.filter(
            (p) => String(p.branchId || "") === String(branch.id)
        );

        const branchOrders = orders.filter(
            (order) => String(order.branchId || "") === String(branch.id)
        );

        const sales = branchOrders.reduce(
            (sum, order) => sum + Number(order.total || 0),
            0
        );

        const profit = branchOrders.reduce((sum, order) => {
            const orderProfit = order.items.reduce((itemSum, item) => {
                const buyableItem = branchBuyableItems.find(
                    (p) => p.name === item.name
                );

                if (!buyableItem) return itemSum;

                const unitProfit =
                    Number(buyableItem.salesPrice || 0) -
                    Number(buyableItem.originalPrice || 0);

                return itemSum + unitProfit * Number(item.quantity || 0);
            }, 0);

            return sum + orderProfit;
        }, 0);

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

        role,

        branches,
        selectedSalesBranchId,
        setSelectedSalesBranchId,

        categoryFilter,
        setCategoryFilter,

        search,
        setSearch,

        payment,
        setPayment,

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
        handlePlaceOrder,

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