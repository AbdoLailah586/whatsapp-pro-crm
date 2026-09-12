// ============================================================
// Multi-tenant context propagation
// ------------------------------------------------------------
// Every signed-in account ("tenant") gets its own isolated data:
// its own Postgres schema (or its own SQLite file), and its own
// WhatsApp connection. Rather than threading a `userId` parameter
// through every single database/whatsapp function call, we use
// Node's AsyncLocalStorage to carry "which tenant is this?" through
// the whole async call chain automatically - exactly the same way
// request-tracing libraries carry a request id.
//
// How it's wired in:
//   - server.js runs `tenantContext.run({ userId }, next)` right
//     after auth resolves the signed-in user, for every HTTP request
//     and every Socket.io event.
//   - whatsapp.js runs `tenantContext.run({ userId }, ...)` around
//     its Baileys event handlers, since those fire outside of any
//     HTTP request.
//   - database.js reads `tenantContext.getStore()` to know which
//     tenant's schema/file to read and write.
//
// LEGACY_TENANT is a special id: the very first account ever
// registered on this deployment is assigned this id instead of a
// fresh random one, so all the data that already existed before
// multi-tenancy (the owner's existing contacts, campaigns, saved
// presets, WhatsApp session, ...) becomes that first account's data
// with zero migration/copying needed.
// ============================================================

const { AsyncLocalStorage } = require("async_hooks");

const LEGACY_TENANT = "legacy";

const tenantContext = new AsyncLocalStorage();

function currentUserId() {
  const store = tenantContext.getStore();
  return store ? store.userId : null;
}

function runAsTenant(userId, fn) {
  return tenantContext.run({ userId: userId || LEGACY_TENANT }, fn);
}

module.exports = {
  LEGACY_TENANT,
  tenantContext,
  currentUserId,
  runAsTenant,
};
