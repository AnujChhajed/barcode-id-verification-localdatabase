import { isValidAccessDeclaration } from "../auth/middleware.js";
import { badRequest } from "../lib/errors.js";

export function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function formatIssues(error) {
  return error.issues.map((issue) => ({
    path: issue.path.join(".") || "(body)",
    message: issue.message,
  }));
}

export function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) {
      return next(badRequest("Request body is invalid.", formatIssues(result.error)));
    }
    req.body = result.data;
    return next();
  };
}

export function validateParams(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.params ?? {});
    if (!result.success) {
      return next(badRequest("Path parameters are invalid.", formatIssues(result.error)));
    }
    req.validatedParams = result.data;
    return next();
  };
}

export function validateQuery(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.query ?? {});
    if (!result.success) {
      return next(badRequest("Query parameters are invalid.", formatIssues(result.error)));
    }
    req.validatedQuery = result.data;
    return next();
  };
}

/**
 * Declarative route registration.
 *
 * A route cannot exist without an explicit `access` declaration, so the default
 * for anything unregistered is "does not exist". The authorization middleware
 * is always the FIRST guard, before validation, so an unauthenticated caller
 * never gets validation feedback about the shape of a protected request.
 */
export function createRouteRegistrar({ router, authorize }) {
  const inventory = [];
  const registered = new Set();

  function defineRoute({ method, path, access, params, body, query, handler }) {
    if (!isValidAccessDeclaration(access)) {
      throw new Error(
        `Route ${method} ${path} must declare a valid access level, received ${JSON.stringify(access)}`,
      );
    }

    const key = `${method.toUpperCase()} ${path}`;
    if (registered.has(key)) throw new Error(`Duplicate route registration: ${key}`);
    registered.add(key);

    const chain = [authorize(access)];
    if (params) chain.push(validateParams(params));
    if (body) chain.push(validateBody(body));
    if (query) chain.push(validateQuery(query));
    chain.push(asyncHandler(handler));

    router[method.toLowerCase()](path, ...chain);
    inventory.push({ method: method.toUpperCase(), path, access });
  }

  return { defineRoute, inventory };
}
