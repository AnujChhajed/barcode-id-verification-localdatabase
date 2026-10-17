import { PUBLIC } from "../auth/middleware.js";
import { lookupCardStatus } from "../data/public-check.js";
import { siteToday } from "../data/settings.js";
import { checkCodeParamSchema } from "../validation/schemas.js";

/**
 * The public card-status page.
 *
 * This is the ONE unauthenticated read in the whole API, so it is kept as small
 * as it can be: a single opaque code in, a status out. It cannot write, it
 * cannot list, and it cannot search — a caller has to already hold the code,
 * which is the value printed as the QR payload on the card itself.
 *
 * `GET /api/check/:code` must also appear in `BASE_PUBLIC_ROUTES` in `app.js`,
 * or the application refuses to start.
 */
export function registerCheckRoutes({ registrar, db }) {
  registrar.defineRoute({
    method: "GET",
    path: "/api/check/:code",
    access: PUBLIC,
    params: checkCodeParamSchema,
    handler: (req, res) => {
      const { code } = req.validatedParams;
      res.json({ card: lookupCardStatus(db, code, siteToday(db)) });
    },
  });
}
