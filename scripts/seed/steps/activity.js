/* eslint-disable @typescript-eslint/no-require-imports */
/** employee_actions for store setup: invites, categories, products, equipment and packages. */

function setupActions({ ctx, catalog, packages }) {
    const { store, branches, users, owner } = ctx;
    const main = branches[0];
    const actions = [];
    const push = (branchId, userId, module, action, entityType, entityId, refNo, message, at) => actions.push({
        store_id: store.id, branch_id: branchId, user_id: userId, user_name: ctx.userName(userId), user_role: ctx.userRoleLabel(userId),
        module, action, entity_type: entityType, entity_id: entityId, reference_number: refNo,
        details: JSON.stringify(message), ip_address: null, created_at: at });

    for (const u of users) {
        if (u.role === "manager") push(u.branch_id, owner.id, "Staff Management", "Invited manager", "user", u.id, u.employee_code,
            `Invited ${u.full_name} as Manager`, u.created_at);
        if (u.role === "staff") push(u.branch_id, u.invited_by, "Staff Management", "Invited staff", "user", u.id, u.employee_code,
            `Invited ${u.full_name} as Staff`, u.created_at);
    }
    // Same wording and shape as the team's Inventory module rows.
    for (const c of catalog.categories)
        push(main.id, main.managerId, "Inventory", "Added category", null, c.id, `CAT-${String(c.id).padStart(6, "0")}`,
            `Added ${c.category_name} to categories`, c.created_at);
    for (const p of catalog.products)
        push(main.id, main.managerId, "Inventory", "Added product", null, p.id, p.product_number, `Added ${p.product_name} to inventory`, p.created_at);
    for (const e of catalog.equipment)
        push(main.id, main.managerId, "Inventory", "Added equipment", null, e.id, e.equipment_number, `Added ${e.equipment_name} to rental equipment`, e.created_at);
    for (const pkg of packages)
        push(pkg.branch_id, pkg.updated_by, "Packages", "Created package", "package", pkg.id, pkg.package_code, `Created ${pkg.package_name}`, pkg.created_at);
    return actions;
}

module.exports = { setupActions };
