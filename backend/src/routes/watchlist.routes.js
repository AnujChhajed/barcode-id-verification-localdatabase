import {
  deactivateWatchlistEntry,
  findWatchlistEntryById,
  insertWatchlistEntry,
  listWatchlist,
  toWatchlistView,
} from "../data/watchlist.js";
import { findPersonById } from "../data/people.js";
import { writeAudit } from "../lib/audit.js";
import { badRequest, notFound } from "../lib/errors.js";
import {
  createWatchlistSchema,
  idParamSchema,
  listWatchlistQuerySchema,
} from "../validation/schemas.js";

/**
 * The watchlist.
 *
 * Every gate operator can read it — they are the ones who need to recognise a
 * flagged person. Only an administrator can add or withdraw an entry, because
 * flagging a named individual is a serious step that must be attributed.
 *
 * The gate itself is alerted separately, from the gate verification handler.
 */
const GATE_ROLES = ["administrator", "security_staff"];
const ADMINISTRATOR_ONLY = ["administrator"];

export function registerWatchlistRoutes({ registrar, db }) {
  registrar.defineRoute({
    method: "GET",
    path: "/api/watchlist",
    access: GATE_ROLES,
    query: listWatchlistQuerySchema,
    handler: (req, res) => {
      const { includeInactive, level, limit } = req.validatedQuery;
      res.json({
        entries: listWatchlist(db, { includeInactive, level, limit }).map(toWatchlistView),
      });
    },
  });

  registrar.defineRoute({
    method: "POST",
    path: "/api/watchlist",
    access: ADMINISTRATOR_ONLY,
    body: createWatchlistSchema,
    handler: (req, res, next) => {
      const input = req.body;

      if (input.personId && !findPersonById(db, input.personId)) {
        return next(badRequest("The person to link does not exist."));
      }

      const id = insertWatchlistEntry(db, input, req.user.id);

      writeAudit(db, {
        actorUserId: req.user.id,
        action: "watchlist.create",
        entityType: "watchlist",
        entityId: id,
        newValue: { fullName: input.fullName, level: input.level, reason: input.reason },
      });

      res.status(201).json({ entry: toWatchlistView(findWatchlistEntryById(db, id)) });
    },
  });

  registrar.defineRoute({
    method: "POST",
    path: "/api/watchlist/:id/deactivate",
    access: ADMINISTRATOR_ONLY,
    params: idParamSchema,
    handler: (req, res, next) => {
      const { id } = req.validatedParams;
      if (!findWatchlistEntryById(db, id))
        return next(notFound("That watchlist entry does not exist."));

      deactivateWatchlistEntry(db, id);

      writeAudit(db, {
        actorUserId: req.user.id,
        action: "watchlist.deactivate",
        entityType: "watchlist",
        entityId: id,
      });

      res.json({ entry: toWatchlistView(findWatchlistEntryById(db, id)) });
    },
  });
}
