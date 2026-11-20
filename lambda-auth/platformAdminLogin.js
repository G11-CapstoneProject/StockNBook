// lambda-auth/platformAdminLogin.js
//
// Copy this file into your existing lambda-auth folder.
// It is a helper file, not a replacement for your current lambda-auth/index.js.
//
// Required npm plans in lambda-auth:
// bcryptjs, jsonwebtoken

const jwt = require("jsonwebtoken");

async function tryPlatformAdminLogin({
                                         connection,
                                         email,
                                         password,
                                     }) {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const enteredPassword = String(password || "");

    if (!normalizedEmail || !enteredPassword) {
        return null;
    }

    // Use the same account-level limiter as index.js so this legacy entry point
    // cannot bypass the failed-password counter or temporary account lockout.
    // Require lazily to avoid changing application initialization order.
    const { authenticateAccount, releaseAuthLocks } = require("./index.js");
    try {
        const authenticated = await authenticateAccount(
            connection,
            "platform_admins",
            normalizedEmail,
            enteredPassword
        );

        if (!authenticated) {
            return null;
        }

        // Keep the original helper's account field names and return contract.
        const admin = {
            platform_admin_id: authenticated.id,
            full_name: authenticated.full_name,
            email: authenticated.email,
            role: authenticated.role,
        };

        const token = jwt.sign(
            {
                platform_admin_id: admin.platform_admin_id,
                email: admin.email,
                full_name: admin.full_name,
                role: "PLATFORM_ADMIN",
            },
            process.env.JWT_SECRET,
            { expiresIn: "8h" }
        );

        return {
            token,
            user: {
                id: admin.platform_admin_id,
                platform_admin_id: admin.platform_admin_id,
                full_name: admin.full_name,
                email: admin.email,
                role: "PLATFORM_ADMIN",
            },
        };
    } finally {
        // The caller owns the connection. Release only our authentication locks.
        if (!(await releaseAuthLocks(connection))) {
            connection.destroy();
        }
    }
}

module.exports = {
    tryPlatformAdminLogin,
};
