function registerAuthRoutes(routes, handlers) {
  routes.set('POST /api/login', handlers.handleLogin);
  routes.set('POST /api/logout', handlers.handleLogout);
  routes.set('GET /api/me', handlers.handleMe);
  routes.set('POST /api/change-password', handlers.handleChangePassword);
}

function registerAdminRoutes(routes, handlers) {
  routes.set('POST /api/internal-users', handlers.handleInternalUsers);
  routes.set('DELETE /api/internal-users', handlers.handleDeleteInternalUser);
  routes.set('GET /api/admin/brands', handlers.handleAdminBrands);
  routes.set('GET /api/admin/team', handlers.handleAdminTeam);
}

function registerBrandRoutes(routes, handlers) {
  routes.set('POST /api/update-data', handlers.handleUpdateData);
  routes.set('POST /api/add-brand', handlers.handleAddBrand);
  routes.set('GET /api/brands', handlers.handleGetBrands);
  routes.set('PATCH /api/brands', handlers.handlePatchBrand);
  routes.set('PATCH /api/brands/logo', handlers.handleReplaceBrandLogo);
  routes.set('DELETE /api/brands', handlers.handleDeleteBrand);
}

function registerClientRoutes(routes, handlers) {
  routes.set('POST /api/client-login', handlers.handleClientLogin);
}

function buildApiRoutes(handlers) {
  const routes = new Map();
  registerAuthRoutes(routes, handlers);
  registerAdminRoutes(routes, handlers);
  registerBrandRoutes(routes, handlers);
  registerClientRoutes(routes, handlers);
  return routes;
}

module.exports = { buildApiRoutes };
