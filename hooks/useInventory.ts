/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import * as XLSX from "xlsx";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
    type Branch,
    type Category,
    type InventoryRole,
    type PendingProductSave,
    type Product,
    type ProductSaveData,
    type ProductVariantSave,
    getApiErrorMessage,
    getTokenOrAlert,
    normalizeCat,
    normalizeProduct,
    safeParseResponse,
} from "@/components/inventory/_shared";

type CategoryApiResponse = {
    success?: boolean;
    category?: Category;
    categories?: Category[];
    id?: number;
    categoryName?: string;
    error?: string;
};

type ProductsApiResponse = {
    success?: boolean;
    product?: Product;
    products?: Product[];
    error?: string;
};

type BranchesApiResponse = {
    branches?: any[];
    error?: string;
};

type FormSubmitEvent = { preventDefault: () => void };

export type ProductFormVariant = {
    id?: number;
    variantValues: Record<string, string>;
    stock: string;
    alertLevel: string;
    originalPrice: string;
    salesPrice: string;
};

export type ImportPreviewProduct = ProductSaveData & {
    tempId: string;
};

function cleanImportCell(value: unknown) {
    return String(value ?? "").trim();
}

function parseImportNumber(value: unknown) {
    const text = String(value ?? "")
        .replace(/[₱,\s]/g, "")
        .replace(/pesos/gi, "")
        .trim();

    const match = text.match(/-?\d+(\.\d+)?/);
    return match ? Number(match[0]) : 0;
}

function normalizeImportHeader(value: unknown) {
    const key = cleanImportCell(value).toLowerCase().replace(/[^a-z0-9]/g, "");

    if (["product", "products", "name"].includes(key) || key === "product" + "name") return "product";
    if (["category", "categories"].includes(key)) return "category";
    if (["variant", "variants", "variation", "variations"].includes(key)) return "variants";
    if (["stock", "stocks", "quantity", "qty"].includes(key)) return "stock";
    if (["alert"].includes(key) || key === "alert" + "level" || key === "reorder" + "level") return "alert";
    if (["original", "cost"].includes(key) || key === "original" + "price" || key === "cost" + "price") return "original";
    if (["sales", "price"].includes(key) || key === "sales" + "price" || key === "selling" + "price") return "sales";

    return "";
}

function isImportYes(value: unknown) {
    const text = cleanImportCell(value).toLowerCase();
    return ["yes", "y", "true", "1"].includes(text);
}

function variantTextToValues(value: unknown): Record<string, string> {
    const text = cleanImportCell(value);

    if (!text) return {};

    const parts = text
        .split(/[,/|]/g)
        .map((part) => part.trim())
        .filter(Boolean);

    if (parts.length === 0) {
        return { option1: text };
    }

    return Object.fromEntries(
        parts.map((part, index) => [`option${index + 1}`, part])
    );
}

function recalculateImportProduct(product: ImportPreviewProduct): ImportPreviewProduct {
    const variants = product.variants || [];

    if (!product.hasVariants || variants.length === 0) {
        return {
            ...product,
            stock: Number(product.stock || 0),
            alertLevel: Number(product.alertLevel || 0),
            originalPrice: Number(product.originalPrice || 0),
            salesPrice: Number(product.salesPrice || 0),
            variants: [],
        };
    }

    const stock = variants.reduce(
        (sum, variant) => sum + Number(variant.stock || 0),
        0
    );

    const alertLevel = variants.reduce(
        (sum, variant) => sum + Number(variant.alertLevel || 0),
        0
    );

    const originalPrices = variants.map((variant) =>
        Number(variant.originalPrice || 0)
    );

    const salesPrices = variants.map((variant) =>
        Number(variant.salesPrice || 0)
    );

    return {
        ...product,
        stock,
        alertLevel,
        originalPrice: originalPrices.length ? Math.min(...originalPrices) : 0,
        salesPrice: salesPrices.length ? Math.min(...salesPrices) : 0,
        variants,
    };
}

async function parseImportFileToPreviewProducts({
                                                    file,
                                                    storeId,
                                                    branchId,
                                                    branchName,
                                                }: {
    file: File;
    storeId: string;
    branchId: string;
    branchName: string | null;
}): Promise<ImportPreviewProduct[]> {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const firstSheetName = workbook.SheetNames[0];

    if (!firstSheetName) {
        throw new Error("The uploaded file has no worksheet.");
    }

    const worksheet = workbook.Sheets[firstSheetName];

    const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
        header: 1,
        ["def" + "val"]: "",
    });

    const headerIndex = rows.findIndex((row) => {
        const headers = row.map(normalizeImportHeader);
        return headers.includes("product") && headers.includes("category");
    });

    if (headerIndex < 0) {
        throw new Error("Cannot find Product and Category headers in the file.");
    }

    const headerRow = rows[headerIndex];
    const headerMap: Partial<Record<string, number>> = {};

    headerRow.forEach((cell, index) => {
        const key = normalizeImportHeader(cell);
        if (key) headerMap[key] = index;
    });

    const getValue = (row: unknown[], key: string) => {
        const index = headerMap[key];
        return index === undefined ? "" : row[index];
    };

    const products: ImportPreviewProduct[] = [];
    let currentVariantProduct: ImportPreviewProduct | null = null;

    const pushCurrentVariantProduct = () => {
        if (!currentVariantProduct) return;

        products.push(recalculateImportProduct(currentVariantProduct));
        currentVariantProduct = null;
    };

    rows.slice(headerIndex + 1).forEach((row, rowIndex) => {
        const productName = cleanImportCell(getValue(row, "product"));
        const category = cleanImportCell(getValue(row, "category"));
        const variantsCell = cleanImportCell(getValue(row, "variants"));

        const stock = parseImportNumber(getValue(row, "stock"));
        const alertLevel = parseImportNumber(getValue(row, "alert"));
        const originalPrice = parseImportNumber(getValue(row, "original"));
        const salesPrice = parseImportNumber(getValue(row, "sales"));

        const rowIsBlank =
            !productName &&
            !category &&
            !variantsCell &&
            stock === 0 &&
            alertLevel === 0 &&
            originalPrice === 0 &&
            salesPrice === 0;

        if (rowIsBlank) return;

        if (productName) {
            pushCurrentVariantProduct();

            const hasVariants = isImportYes(variantsCell);

            const product: ImportPreviewProduct = {
                tempId: `import-${Date.now()}-${rowIndex}`,
                storeId: storeId ? Number(storeId) : null,
                branchId: Number(branchId),
                branchName,
                name: productName,
                category,
                stock,
                alertLevel,
                originalPrice,
                salesPrice,
                hasVariants,
                variants: hasVariants ? [] : [],
            };

            if (hasVariants) {
                currentVariantProduct = product;
                return;
            }

            products.push(product);
            return;
        }

        if (currentVariantProduct && variantsCell) {
            currentVariantProduct.variants = [
                ...(currentVariantProduct.variants || []),
                {
                    variantValues: variantTextToValues(variantsCell),
                    stock,
                    alertLevel,
                    originalPrice,
                    salesPrice,
                },
            ];
        }
    });

    pushCurrentVariantProduct();

    return products.filter(
        (product) => product.name.trim() && product.category.trim()
    );
}

function getSessionSnapshot() {
    if (typeof window === "undefined") {
        return {
            role: "" as InventoryRole,
            storeId: "",
            branchId: "",
            branchName: "",
            storeName: "Store Name",
        };
    }

    const role = (sessionStorage.getItem("role") || "").toLowerCase() as InventoryRole;

    const storeId =
        sessionStorage.getItem("store_id") ||
        sessionStorage.getItem("stocknbook_store_id") ||
        "";

    const branchId =
        sessionStorage.getItem("branch_id") ||
        sessionStorage.getItem("stocknbook_branch_id") ||
        "";

    const branchName =
        sessionStorage.getItem("branch_name") ||
        sessionStorage.getItem("stocknbook_branch_name") ||
        "";

    const storeName =
        sessionStorage.getItem("store_name") ||
        sessionStorage.getItem("stocknbook_store_name") ||
        "Store Name";

    return { role, storeId, branchId, branchName, storeName };
}

const LEGACY_VARIANT_KEY_MAP: Record<string, string> = {
    option1: "size",
    option2: "packaging",
    option3: "color",
    option4: "material",
    option5: "type",
};

function isLegacyVariantKey(key: string) {
    return /^option\d+$/i.test(String(key || "").trim());
}

function normalizeVariantKey(key: string) {
    const cleanKey = String(key || "").trim();
    const lowerKey = cleanKey.toLowerCase();

    return LEGACY_VARIANT_KEY_MAP[lowerKey] || lowerKey;
}

function normalizeVariantValuesForEdit(
    values: Record<string, string> | undefined
): Record<string, string> {
    const normalized: Record<string, string> = {};

    const entries = Object.entries(values || {}).sort(([keyA], [keyB]) => {
        const aIsLegacy = isLegacyVariantKey(keyA);
        const bIsLegacy = isLegacyVariantKey(keyB);

        if (aIsLegacy && !bIsLegacy) return 1;
        if (!aIsLegacy && bIsLegacy) return -1;

        return 0;
    });

    entries.forEach(([rawKey, rawValue]) => {
        const key = normalizeVariantKey(rawKey);
        const value = String(rawValue || "").trim();

        if (!key || !value) return;

        if (!normalized[key]) {
            normalized[key] = value;
        }
    });

    return normalized;
}

function normalizeVariantForSave(v: ProductFormVariant): ProductVariantSave {
    const normalizedValues = normalizeVariantValuesForEdit(v.variantValues);

    const variantValues = Object.fromEntries(
        Object.entries(normalizedValues)
            .map(([key, value]) => [key, String(value || "").trim()])
            .filter(([, value]) => value.length > 0)
    );

    return {
        ...(v.id ? { id: v.id } : {}),
        variantValues,
        stock: Number(v.stock || 0),
        alertLevel: Number(v.alertLevel || 0),
        originalPrice: Number(v.originalPrice || 0),
        salesPrice: Number(v.salesPrice || 0),
    };
}

function normalizeDuplicateText(value: unknown) {
    return String(value ?? "")
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase();
}

function getProductBranchId(value: unknown) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function findExistingProductByName(
    productList: Product[],
    productName: string,
    branchId: string | number | null,
    excludeProductId?: number | null
) {
    const cleanName = normalizeDuplicateText(productName);
    const cleanBranchId = getProductBranchId(branchId);

    if (!cleanName || !cleanBranchId) return undefined;

    return productList.find((product) => {
        const sameName = normalizeDuplicateText(product.name) === cleanName;
        const sameBranch =
            getProductBranchId(product.branchId) === cleanBranchId;
        const notCurrentProduct =
            !excludeProductId || Number(product.id) !== Number(excludeProductId);

        return sameName && sameBranch && notCurrentProduct;
    });
}

function getVariantSignature(values: Record<string, string> | undefined) {
    const normalizedValues = normalizeVariantValuesForEdit(values);

    const entries = Object.entries(normalizedValues)
        .map(([key, value]) => [
            normalizeDuplicateText(key),
            normalizeDuplicateText(value),
        ])
        .filter(([, value]) => value.length > 0)
        .sort(([keyA, valueA], [keyB, valueB]) => {
            const keyCompare = keyA.localeCompare(keyB);
            return keyCompare !== 0 ? keyCompare : valueA.localeCompare(valueB);
        });

    if (entries.length === 0) return "";

    return entries.map(([key, value]) => `${key}:${value}`).join("|");
}

function getVariantDisplayName(values: Record<string, string> | undefined) {
    return (
        Object.values(normalizeVariantValuesForEdit(values))
            .map((value) => String(value || "").trim())
            .filter(Boolean)
            .join(", ") || "Unnamed variant"
    );
}

function getDuplicateVariantError(
    productName: string,
    variantList: ProductVariantSave[]
) {
    const seen = new Map<string, string>();

    for (const variant of variantList) {
        const signature = getVariantSignature(variant.variantValues);
        if (!signature) continue;

        const displayName = getVariantDisplayName(variant.variantValues);

        if (seen.has(signature)) {
            return `❌ Variant "${displayName}" already exists in ${productName}.`;
        }

        seen.set(signature, displayName);
    }

    return "";
}

function getImportDuplicateError(
    importProducts: ImportPreviewProduct[],
    existingProducts: Product[]
) {
    const seenImportProducts = new Map<string, string>();

    for (const product of importProducts) {
        const productData = recalculateImportProduct(product);
        const cleanName = productData.name.trim();
        const branchId = getProductBranchId(productData.branchId);
        const importKey = `${branchId}|${normalizeDuplicateText(cleanName)}`;

        const existingProduct = findExistingProductByName(
            existingProducts,
            cleanName,
            branchId
        );

        if (existingProduct) {
            return `❌ Product "${cleanName}" already exists in this branch.`;
        }

        if (seenImportProducts.has(importKey)) {
            return `❌ Product "${cleanName}" is duplicated in the Excel file.`;
        }

        seenImportProducts.set(importKey, cleanName);

        if (productData.hasVariants) {
            const duplicateVariantError = getDuplicateVariantError(
                cleanName,
                productData.variants || []
            );

            if (duplicateVariantError) return duplicateVariantError;
        }
    }

    return "";
}

export function useInventoryController() {
    const session = getSessionSnapshot();

    const [formMode, setFormMode] = useState<"product" | "category">("product");

    const [products, setProducts] = useState<Product[]>([]);
    const [manualCategories, setManualCategories] = useState<Category[]>([]);
    const [branches, setBranches] = useState<Branch[]>([]);

    const [storeName] = useState(session.storeName);
    const [storeId] = useState(session.storeId);
    const [role] = useState<InventoryRole>(session.role);
    const [assignedBranchId] = useState(session.branchId);
    const [assignedBranchName] = useState(session.branchName);

    const [search, setSearch] = useState("");
    const [selectedCategory, setSelectedCategory] = useState("All");
    const [selectedBranchId, setSelectedBranchId] = useState("");

    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState<number | null>(null);

    const [name, setName] = useState("");
    const [category, setCategory] = useState("");
    const [stock, setStock] = useState("");
    const [alertLevel, setAlertLevel] = useState("");
    const [originalPrice, setOriginalPrice] = useState("");
    const [salesPrice, setSalesPrice] = useState("");

    const [hasVariants, setHasVariants] = useState(false);
    const [variants, setVariants] = useState<ProductFormVariant[]>([]);

    const [productBranchId, setProductBranchId] = useState(
        session.role === "manager" || session.role === "staff" ? session.branchId : ""
    );

    const [editingCategory, setEditingCategory] = useState<string | null>(null);
    const [editCategoryValue, setEditCategoryValue] = useState("");

    const [showDeleteProductDialog, setShowDeleteProductDialog] = useState(false);
    const [productToDelete, setProductToDelete] = useState<Product | null>(null);

    const [showConfirmProductSaveDialog, setShowConfirmProductSaveDialog] =
        useState(false);
    const [pendingProductSave, setPendingProductSave] =
        useState<PendingProductSave | null>(null);

    const [showImportDialog, setShowImportDialog] = useState(false);
    const [showImportConfirmDialog, setShowImportConfirmDialog] = useState(false);
    const [selectedImportFile, setSelectedImportFile] = useState<File | null>(null);
    const [importPreviewProducts, setImportPreviewProducts] = useState<ImportPreviewProduct[]>([]);
    const [isImporting, setIsImporting] = useState(false);

    const isOwner = role === "owner";
    const isBranchUser = role === "manager" || role === "staff";

    const loadProducts = useCallback(async () => {
        const token = sessionStorage.getItem("token");

        if (!token) {
            setProducts([]);
            return;
        }

        const payload: Record<string, unknown> = {
            action: "get_products",
            include_variants: true,
        };

        if (storeId) payload.store_id = Number(storeId);
        if (isBranchUser && assignedBranchId) payload.branch_id = Number(assignedBranchId);

        try {
            const res = await fetch("/api/products", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify(payload),
            });

            const { data } = await safeParseResponse<ProductsApiResponse>(res);

            setProducts(
                res.ok && Array.isArray(data.products)
                    ? data.products.map(normalizeProduct)
                    : []
            );
        } catch {
            setProducts([]);
        }
    }, [assignedBranchId, isBranchUser, storeId]);

    const loadCategories = useCallback(async () => {
        const token = sessionStorage.getItem("token");

        if (!token) {
            setManualCategories([]);
            return;
        }

        try {
            const res = await fetch("/api/categories", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    action: "get_categories",
                    ...(storeId ? { store_id: Number(storeId) } : {}),
                }),
            });

            const { data } = await safeParseResponse<CategoryApiResponse>(res);

            if (!res.ok) {
                console.warn(
                    "Categories fetch failed:",
                    getApiErrorMessage(data, "Failed to fetch categories")
                );
                setManualCategories([]);
                return;
            }

            setManualCategories(Array.isArray(data.categories) ? data.categories : []);
        } catch {
            setManualCategories([]);
        }
    }, [storeId]);

    const loadBranches = useCallback(async () => {
        const token = sessionStorage.getItem("token");

        if (!token) {
            setBranches([]);
            return;
        }

        try {
            const res = await fetch("/api/branches", {
                method: "GET",
                headers: { Authorization: `Bearer ${token}` },
            });

            const { data } = await safeParseResponse<BranchesApiResponse>(res);

            if (!res.ok || !Array.isArray(data.branches)) {
                setBranches([]);
                return;
            }

            const mapped = data.branches.map((b: any) => ({
                id: Number(b.id ?? b.branch_id ?? b.branchId),
                branchName: b.branchName ?? b.branch_name ?? b.name ?? "Unnamed Branch",
            }));

            setBranches(mapped.filter((b) => b.id));
        } catch {
            setBranches([]);
        }
    }, []);

    const refreshAll = useCallback(async () => {
        await Promise.all([loadProducts(), loadCategories(), loadBranches()]);
    }, [loadBranches, loadCategories, loadProducts]);

    useEffect(() => {
        void refreshAll();
    }, [refreshAll]);

    const branchGroups = useMemo(() => {
        const groups: Record<string, Product[]> = {};

        products.forEach((product) => {
            const key = product.branchId ? String(product.branchId) : "unassigned";
            if (!groups[key]) groups[key] = [];
            groups[key].push(product);
        });

        return groups;
    }, [products]);

    const categories = useMemo(() => {
        const productCats = products.map((p) => p.category.trim());
        const manualCats = manualCategories.map((c) => c.categoryName.trim());

        return [...new Set([...productCats, ...manualCats])]
            .filter(Boolean)
            .sort((a, b) => a.localeCompare(b));
    }, [products, manualCategories]);

    const selectedBranch = useMemo(
        () => branches.find((b) => String(b.id) === selectedBranchId) || null,
        [branches, selectedBranchId]
    );

    const baseProducts = useMemo(
        () => (isOwner ? branchGroups[selectedBranchId] || [] : products),
        [branchGroups, isOwner, products, selectedBranchId]
    );

    const filteredProducts = useMemo(() => {
        const q = search.trim().toLowerCase();

        return baseProducts.filter((p) => {
            const variantText =
                p.variants
                    ?.map((v) => Object.values(v.variantValues || {}).join(" "))
                    .join(" ")
                    .toLowerCase() || "";

            const matchesCategory = selectedCategory === "All" || p.category === selectedCategory;

            const matchesSearch =
                q.length === 0 ||
                p.name.toLowerCase().includes(q) ||
                p.category.toLowerCase().includes(q) ||
                (p.branchName || "").toLowerCase().includes(q) ||
                variantText.includes(q);

            return matchesCategory && matchesSearch;
        });
    }, [baseProducts, selectedCategory, search]);

    const filteredCategoriesForManage = useMemo(() => {
        const q = category.trim().toLowerCase();
        if (!q) return categories;
        return categories.filter((c) => c.toLowerCase().includes(q));
    }, [categories, category]);

    function clearProductForm() {
        setName("");
        setCategory("");
        setStock("");
        setAlertLevel("");
        setOriginalPrice("");
        setSalesPrice("");
        setHasVariants(false);
        setVariants([]);
        setProductBranchId(isBranchUser ? assignedBranchId : selectedBranchId || "");
    }

    function clearCategoryForm() {
        setCategory("");
        setEditingCategory(null);
        setEditCategoryValue("");
    }

    function openManageCategories() {
        clearCategoryForm();
        setFormMode("category");
        setShowForm(true);
    }

    function openAddProduct() {
        clearProductForm();
        setEditingId(null);
        setFormMode("product");
        setShowForm(true);
    }

    function openImportDialog() {
        setSelectedImportFile(null);
        setShowImportDialog(true);
    }

    function closeImportDialog() {
        setSelectedImportFile(null);
        setShowImportDialog(false);
        setShowImportConfirmDialog(false);
        setImportPreviewProducts([]);
    }

    async function ensureCategoriesExist(categoryNames: Array<string | null | undefined>) {
        const token = getTokenOrAlert();
        if (!token) return false;

        const uniqueCategories = Array.from(
            new Map(
                categoryNames
                    .map((value) => normalizeCat(value || ""))
                    .filter(Boolean)
                    .map((value) => [value.toLowerCase(), value])
            ).values()
        );

        if (uniqueCategories.length === 0) return true;

        const existingCategoryKeys = new Set(
            manualCategories.map((cat) =>
                normalizeCat(cat.categoryName).toLowerCase()
            )
        );

        const missingCategories = uniqueCategories.filter(
            (catName) => !existingCategoryKeys.has(catName.toLowerCase())
        );

        if (missingCategories.length === 0) return true;

        const createdCategories: Category[] = [];

        for (const catName of missingCategories) {
            try {
                const res = await fetch("/api/categories", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                        action: "create_category",
                        categoryName: catName,
                        description: "",
                        ...(storeId ? { store_id: Number(storeId) } : {}),
                    }),
                });

                const { data } = await safeParseResponse<CategoryApiResponse>(res);

                if (!res.ok) {
                    const message = data?.error || "";

                    // If backend says it already exists, just continue.
                    if (/exist|duplicate/i.test(message)) {
                        continue;
                    }

                    alert(`❌ Failed to save category "${catName}".`);
                    return false;
                }

                const created = data.category ?? {
                    id: data.id ?? Date.now() + createdCategories.length,
                    categoryName: data.categoryName ?? catName,
                    description: "",
                };

                createdCategories.push(created);
            } catch {
                alert(`❌ Failed to save category "${catName}".`);
                return false;
            }
        }

        if (createdCategories.length > 0) {
            setManualCategories((prev) => {
                const existingKeys = new Set(
                    prev.map((cat) =>
                        normalizeCat(cat.categoryName).toLowerCase()
                    )
                );

                const nextCategories = createdCategories.filter(
                    (cat) =>
                        !existingKeys.has(
                            normalizeCat(cat.categoryName).toLowerCase()
                        )
                );

                return [...prev, ...nextCategories];
            });
        }

        await loadCategories();

        return true;
    }

    function getImportTargetBranch() {
        const targetBranchId = isBranchUser ? assignedBranchId : selectedBranchId;
        const branchLabel =
            branches.find((b) => String(b.id) === String(targetBranchId))?.branchName ||
            assignedBranchName ||
            null;

        return { targetBranchId, branchLabel };
    }

    async function importProductsFromExcel() {
        if (!selectedImportFile) {
            alert("❌ Please select an Excel file.");
            return;
        }

        const { targetBranchId, branchLabel } = getImportTargetBranch();

        if (!targetBranchId) {
            alert("❌ Please select a branch before importing.");
            return;
        }

        if (!storeId) {
            alert("❌ Missing store ID.");
            return;
        }

        try {
            setIsImporting(true);

            const previewProducts = await parseImportFileToPreviewProducts({
                file: selectedImportFile,
                storeId,
                branchId: targetBranchId,
                branchName: branchLabel,
            });

            if (previewProducts.length === 0) {
                alert("❌ No valid products found in the file.");
                return;
            }

            const duplicateError = getImportDuplicateError(previewProducts, products);

            if (duplicateError) {
                alert(duplicateError);
                return;
            }

            setImportPreviewProducts(previewProducts);
            setShowImportDialog(false);
            setShowImportConfirmDialog(true);
        } catch (error) {
            console.error("Import preview failed:", error);
            alert(
                error instanceof Error
                    ? `❌ ${error.message}`
                    : "❌ Failed to preview import file."
            );
        } finally {
            setIsImporting(false);
        }
    }

    async function confirmImportProducts() {
        if (importPreviewProducts.length === 0) {
            alert("❌ No products to import.");
            return;
        }

        const duplicateError = getImportDuplicateError(importPreviewProducts, products);

        if (duplicateError) {
            alert(duplicateError);
            return;
        }

        const token = getTokenOrAlert();
        if (!token) return;

        const importCategoriesOk = await ensureCategoriesExist(
            importPreviewProducts.map((product) =>
                recalculateImportProduct(product).category
            )
        );

        if (!importCategoriesOk) return;

        try {
            setIsImporting(true);

            for (const product of importPreviewProducts) {
                const productData = recalculateImportProduct(product);

                if (!productData.name.trim() || !productData.category.trim()) {
                    alert("❌ Product name and category are required.");
                    return;
                }

                if (
                    productData.hasVariants &&
                    (!productData.variants || productData.variants.length === 0)
                ) {
                    alert(
                        `❌ ${productData.name} is marked as variant product but has no variants.`
                    );
                    return;
                }

                const serializedVariants = (productData.variants || []).map((variant) => ({
                    variantValues: variant.variantValues || {},
                    variant_values: variant.variantValues || {},
                    stock: Number(variant.stock || 0),
                    alertLevel: Number(variant.alertLevel || 0),
                    alert_level: Number(variant.alertLevel || 0),
                    originalPrice: Number(variant.originalPrice || 0),
                    original_price: Number(variant.originalPrice || 0),
                    salesPrice: Number(variant.salesPrice || 0),
                    sales_price: Number(variant.salesPrice || 0),
                }));

                const res = await fetch("/api/products", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                        action: "create_product",
                        store_id: productData.storeId,
                        storeId: productData.storeId,
                        branch_id: Number(productData.branchId),
                        branchId: Number(productData.branchId),
                        name: productData.name,
                        category: productData.category,
                        stock: Number(productData.stock || 0),
                        alertLevel: Number(productData.alertLevel || 0),
                        alert_level: Number(productData.alertLevel || 0),
                        originalPrice: Number(productData.originalPrice || 0),
                        original_price: Number(productData.originalPrice || 0),
                        salesPrice: Number(productData.salesPrice || 0),
                        sales_price: Number(productData.salesPrice || 0),
                        hasVariants: productData.hasVariants,
                        has_variants: productData.hasVariants ? 1 : 0,
                        variants: productData.hasVariants ? serializedVariants : [],
                    }),
                });

                const { data } = await safeParseResponse<ProductsApiResponse>(res);

                if (!res.ok) {
                    alert(`❌ ${data?.error || `Failed to import ${productData.name}`}`);
                    return;
                }
            }

            await refreshAll();

            alert("✅ Products imported successfully.");
            closeImportDialog();
        } catch (error) {
            console.error("Import failed:", error);
            alert("❌ Failed to import products.");
        } finally {
            setIsImporting(false);
        }
    }

    function addVariantRow() {
        setVariants((prev) => [
            ...prev,
            {
                variantValues: {},
                stock: "",
                alertLevel: "",
                originalPrice: "",
                salesPrice: "",
            },
        ]);
    }

    function removeVariantRow(index: number) {
        setVariants((prev) => prev.filter((_, i) => i !== index));
    }

    function updateVariantValue(index: number, key: string, value: string) {
        setVariants((prev) =>
            prev.map((variant, i) =>
                i === index
                    ? {
                        ...variant,
                        variantValues: {
                            ...variant.variantValues,
                            [key]: value,
                        },
                    }
                    : variant
            )
        );
    }

    function updateVariantField(
        index: number,
        field: "stock" | "alertLevel" | "originalPrice" | "salesPrice",
        value: string
    ) {
        setVariants((prev) =>
            prev.map((variant, i) => (i === index ? { ...variant, [field]: value } : variant))
        );
    }

    function handleSubmitProduct(e: FormSubmitEvent) {
        e.preventDefault();

        const cleanName = name.trim();
        const cleanCategory = category.trim();

        if (!cleanName) {
            alert("❌ Please enter a product name.");
            return;
        }

        if (!cleanCategory) {
            alert("❌ Please select a category first.");
            return;
        }

        const targetBranchId = isBranchUser ? assignedBranchId : productBranchId;

        if (!targetBranchId) {
            alert("❌ Please select a branch for this product.");
            return;
        }

        const existingProduct = findExistingProductByName(
            products,
            cleanName,
            targetBranchId,
            editingId
        );

        if (existingProduct) {
            alert(`❌ Product "${cleanName}" already exists in this branch.`);
            return;
        }

        if (hasVariants && variants.length === 0) {
            alert("❌ Please add at least one variant.");
            return;
        }

        const cleanedVariants = variants.map(normalizeVariantForSave);

        if (hasVariants) {
            const hasInvalidVariant = cleanedVariants.some((variant) => {
                const values = Object.values(variant.variantValues || {})
                    .map((value) => String(value || "").trim())
                    .filter(Boolean);

                return values.length === 0;
            });

            if (hasInvalidVariant) {
                alert("❌ Each variant must have at least one value, like size or color.");
                return;
            }

            const duplicateVariantError = getDuplicateVariantError(
                cleanName,
                cleanedVariants
            );

            if (duplicateVariantError) {
                alert(duplicateVariantError);
                return;
            }
        }

        const variantStock = cleanedVariants.reduce((sum, v) => sum + Number(v.stock || 0), 0);
        const variantAlert = cleanedVariants.reduce((sum, v) => sum + Number(v.alertLevel || 0), 0);
        const firstVariant = cleanedVariants[0];

        const branchLabel =
            branches.find((b) => String(b.id) === String(targetBranchId))?.branchName ||
            assignedBranchName ||
            null;

        const after = {
            storeId: storeId ? Number(storeId) : null,
            branchId: Number(targetBranchId),
            branchName: branchLabel,
            name: cleanName,
            category: cleanCategory,
            stock: hasVariants ? variantStock : Number(stock || 0),
            alertLevel: hasVariants ? variantAlert : Number(alertLevel || 0),
            originalPrice: hasVariants ? Number(firstVariant?.originalPrice || 0) : Number(originalPrice || 0),
            salesPrice: hasVariants ? Number(firstVariant?.salesPrice || 0) : Number(salesPrice || 0),
            hasVariants,
            variants: hasVariants ? cleanedVariants : [],
        };

        if (editingId) {
            const before = products.find((p) => p.id === editingId);
            if (!before) return;
            setPendingProductSave({ mode: "edit", editingId, before, after });
        } else {
            setPendingProductSave({ mode: "add", data: after });
        }

        setShowConfirmProductSaveDialog(true);
    }

    async function confirmSaveProduct() {
        if (!pendingProductSave) return;

        const token = getTokenOrAlert();
        if (!token) return;

        const productData =
            pendingProductSave.mode === "edit" ? pendingProductSave.after : pendingProductSave.data;

        if (!productData.branchId) {
            alert("❌ Missing branch for product.");
            return;
        }

        const categoriesOk = await ensureCategoriesExist([
            productData.category,
            ...(pendingProductSave.mode === "edit"
                ? [pendingProductSave.before.category]
                : []),
        ]);

        if (!categoriesOk) return;

        const serializedVariants = (productData.variants || []).map((variant) => ({
            ...(variant.id ? { id: Number(variant.id) } : {}),
            variantValues: variant.variantValues || {},
            variant_values: variant.variantValues || {},
            stock: Number(variant.stock || 0),
            alertLevel: Number(variant.alertLevel || 0),
            alert_level: Number(variant.alertLevel || 0),
            originalPrice: Number(variant.originalPrice || 0),
            original_price: Number(variant.originalPrice || 0),
            salesPrice: Number(variant.salesPrice || 0),
            sales_price: Number(variant.salesPrice || 0),
        }));

        const payload = {
            action: pendingProductSave.mode === "edit" ? "update_product" : "create_product",
            ...(pendingProductSave.mode === "edit" ? { id: pendingProductSave.editingId } : {}),
            store_id: productData.storeId,
            storeId: productData.storeId,
            branch_id: Number(productData.branchId),
            branchId: Number(productData.branchId),
            name: productData.name,
            category: productData.category,
            stock: productData.stock,
            alertLevel: productData.alertLevel,
            alert_level: productData.alertLevel,
            originalPrice: productData.originalPrice,
            original_price: productData.originalPrice,
            salesPrice: productData.salesPrice,
            sales_price: productData.salesPrice,
            hasVariants: productData.hasVariants,
            has_variants: productData.hasVariants ? 1 : 0,
            variants: productData.hasVariants ? serializedVariants : [],
        };

        try {
            const res = await fetch("/api/products", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify(payload),
            });

            const { data } = await safeParseResponse<ProductsApiResponse>(res);

            if (!res.ok) {
                console.error("Save product failed response:", data);
                alert(`❌ ${data?.error || "Failed to save product"}`);
                return;
            }

            await refreshAll();
            setSelectedCategory(productData.category);
            setPendingProductSave(null);
            setShowConfirmProductSaveDialog(false);
            clearProductForm();
            setEditingId(null);
            setShowForm(false);
        } catch (error) {
            console.error("Save product request crashed:", error);
            alert(error instanceof Error ? `❌ ${error.message}` : "❌ Failed to save product");
        }
    }

    function closeConfirmProductSaveDialog() {
        setPendingProductSave(null);
        setShowConfirmProductSaveDialog(false);
    }

    function handleEditProduct(p: Product) {
        setEditingId(p.id);
        setName(p.name);
        setCategory(p.category);
        setStock(String(p.stock));
        setAlertLevel(String(p.alertLevel));
        setOriginalPrice(String(p.originalPrice));
        setSalesPrice(String(p.salesPrice));
        setHasVariants(Boolean(p.hasVariants) || (Array.isArray(p.variants) && p.variants.length > 0));
        setProductBranchId(String(p.branchId || assignedBranchId || ""));

        setVariants(
            Array.isArray(p.variants)
                ? p.variants.map((v) => ({
                    id: v.id,
                    variantValues: normalizeVariantValuesForEdit(v.variantValues || {}),
                    stock: String(v.stock),
                    alertLevel: String(v.alertLevel),
                    originalPrice: String(v.originalPrice),
                    salesPrice: String(v.salesPrice),
                }))
                : []
        );

        setFormMode("product");
        setShowForm(true);
    }

    function requestDeleteProduct(p: Product) {
        setProductToDelete(p);
        setShowDeleteProductDialog(true);
    }

    async function confirmDeleteProduct() {
        if (!productToDelete) return;

        const token = getTokenOrAlert();
        if (!token) return;

        try {
            const res = await fetch("/api/products", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    action: "delete_product",
                    id: productToDelete.id,
                    ...(productToDelete.branchId ? { branch_id: Number(productToDelete.branchId) } : {}),
                }),
            });

            const { data } = await safeParseResponse<ProductsApiResponse>(res);

            if (!res.ok) {
                alert(`❌ ${data?.error || "Failed to delete product"}`);
                return;
            }

            setProducts((prev) => prev.filter((p) => p.id !== productToDelete.id));
            setShowDeleteProductDialog(false);
            setProductToDelete(null);
        } catch {
            alert("❌ Failed to delete product");
        }
    }

    function closeDeleteProductDialog() {
        setShowDeleteProductDialog(false);
        setProductToDelete(null);
    }

    async function addCategoryNow(nextValue: string) {
        const token = getTokenOrAlert();
        if (!token) return;

        const next = normalizeCat(nextValue);
        if (!next) return;

        try {
            const res = await fetch("/api/categories", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    action: "create_category",
                    categoryName: next,
                    description: "",
                    ...(storeId ? { store_id: Number(storeId) } : {}),
                }),
            });

            const { data } = await safeParseResponse<CategoryApiResponse>(res);

            if (!res.ok) {
                alert(`❌ ${data?.error || "Failed to save category"}`);
                return;
            }

            const created = data.category ?? {
                id: data.id ?? Date.now(),
                categoryName: data.categoryName ?? next,
                description: "",
            };

            setManualCategories((prev) => {
                const exists = prev.some(
                    (c) =>
                        c.categoryName.trim().toLowerCase() ===
                        created.categoryName.trim().toLowerCase()
                );

                return exists ? prev : [...prev, created];
            });

            setSelectedCategory(created.categoryName);
            setCategory("");
        } catch {
            alert("❌ Failed to save category");
        }
    }

    async function updateCategoryNow(oldCat: string, nextValue: string) {
        const token = getTokenOrAlert();
        if (!token) return;

        const next = normalizeCat(nextValue);
        if (!next) return;

        const target = manualCategories.find((c) => c.categoryName === oldCat);

        if (!target) {
            alert("❌ Category ID not found");
            return;
        }

        try {
            const res = await fetch("/api/categories", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    action: "update_category",
                    category_id: target.id,
                    categoryName: next,
                    description: "",
                }),
            });

            const { data } = await safeParseResponse<CategoryApiResponse>(res);

            if (!res.ok) {
                alert(`❌ ${data?.error || "Failed to update category"}`);
                return;
            }

            setManualCategories((prev) =>
                prev.map((c) => (c.id === target.id ? { ...c, categoryName: next } : c))
            );

            setProducts((prev) =>
                prev.map((p) => (p.category === oldCat ? { ...p, category: next } : p))
            );

            if (selectedCategory === oldCat) setSelectedCategory(next);

            setEditingCategory(null);
            setEditCategoryValue("");
        } catch {
            alert("❌ Failed to update category");
        }
    }

    async function deleteCategoryNow(cat: string) {
        const stillHasProducts = products.some((p) => p.category === cat);

        if (stillHasProducts) {
            alert("❌ Cannot delete category with products.");
            return;
        }

        const token = getTokenOrAlert();
        if (!token) return;

        const target = manualCategories.find((c) => c.categoryName === cat);

        if (!target) {
            alert("❌ Category ID not found");
            return;
        }

        try {
            const res = await fetch("/api/categories", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    action: "delete_category",
                    category_id: target.id,
                }),
            });

            const { data } = await safeParseResponse<CategoryApiResponse>(res);

            if (!res.ok) {
                alert(`❌ ${data?.error || "Failed to delete category"}`);
                return;
            }

            setManualCategories((prev) => prev.filter((x) => x.id !== target.id));

            if (selectedCategory === cat) setSelectedCategory("All");
        } catch {
            alert("❌ Failed to delete category");
        }
    }

    return {
        formMode,
        setFormMode,

        products,
        setProducts,
        manualCategories,
        setManualCategories,
        branches,

        storeName,
        storeId,
        role,
        assignedBranchId,
        assignedBranchName,

        search,
        setSearch,
        selectedCategory,
        setSelectedCategory,
        selectedBranchId,
        setSelectedBranchId,

        showForm,
        setShowForm,
        editingId,

        name,
        setName,
        category,
        setCategory,
        stock,
        setStock,
        alertLevel,
        setAlertLevel,
        originalPrice,
        setOriginalPrice,
        salesPrice,
        setSalesPrice,

        hasVariants,
        setHasVariants,
        variants,
        setVariants,
        addVariantRow,
        removeVariantRow,
        updateVariantValue,
        updateVariantField,

        productBranchId,
        setProductBranchId,

        editingCategory,
        editCategoryValue,
        setEditCategoryValue,

        showDeleteProductDialog,
        productToDelete,
        showConfirmProductSaveDialog,
        pendingProductSave,

        showImportDialog,
        setShowImportDialog,
        selectedImportFile,
        setSelectedImportFile,
        isImporting,
        openImportDialog,
        closeImportDialog,
        importProductsFromExcel,
        showImportConfirmDialog,
        setShowImportConfirmDialog,
        importPreviewProducts,
        confirmImportProducts,

        isOwner,
        isBranchUser,

        branchGroups,
        categories,
        selectedBranch,
        baseProducts,
        filteredProducts,
        filteredCategoriesForManage,

        openManageCategories,
        openAddProduct,

        handleSubmitProduct,
        confirmSaveProduct,
        closeConfirmProductSaveDialog,

        handleEditProduct,
        requestDeleteProduct,
        confirmDeleteProduct,
        closeDeleteProductDialog,

        addCategoryNow,
        updateCategoryNow,
        deleteCategoryNow,

        refreshAll,
    };
}

export type InventoryController = ReturnType<typeof useInventoryController>;