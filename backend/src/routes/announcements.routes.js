import {
  deactivateAnnouncement,
  findAnnouncementById,
  insertAnnouncement,
  listAnnouncements,
  toAnnouncementView,
} from "../data/announcements.js";
import { writeAudit } from "../lib/audit.js";
import { notFound } from "../lib/errors.js";
import {
  createAnnouncementSchema,
  idParamSchema,
  listAnnouncementsQuerySchema,
} from "../validation/schemas.js";

/**
 * Announcements from the security office.
 *
 * Everyone at the gate can READ them, because keeping the guard informed is the
 * point. Only an administrator can post or withdraw one, because a notice shown
 * to every operator carries the authority of the security office.
 */
const GATE_ROLES = ["administrator", "security_staff"];
const ADMINISTRATOR_ONLY = ["administrator"];

export function registerAnnouncementRoutes({ registrar, db }) {
  registrar.defineRoute({
    method: "GET",
    path: "/api/announcements",
    access: GATE_ROLES,
    query: listAnnouncementsQuerySchema,
    handler: (req, res) => {
      const { includeInactive, limit } = req.validatedQuery;
      res.json({
        announcements: listAnnouncements(db, { includeInactive, limit }).map(toAnnouncementView),
      });
    },
  });

  registrar.defineRoute({
    method: "POST",
    path: "/api/announcements",
    access: ADMINISTRATOR_ONLY,
    body: createAnnouncementSchema,
    handler: (req, res) => {
      const input = req.body;
      const id = insertAnnouncement(db, input, req.user.id);

      writeAudit(db, {
        actorUserId: req.user.id,
        action: "announcement.create",
        entityType: "announcement",
        entityId: id,
        newValue: { title: input.title, severity: input.severity },
      });

      res.status(201).json({ announcement: toAnnouncementView(findAnnouncementById(db, id)) });
    },
  });

  registrar.defineRoute({
    method: "POST",
    path: "/api/announcements/:id/deactivate",
    access: ADMINISTRATOR_ONLY,
    params: idParamSchema,
    handler: (req, res, next) => {
      const { id } = req.validatedParams;
      if (!findAnnouncementById(db, id)) return next(notFound("That announcement does not exist."));

      deactivateAnnouncement(db, id);

      writeAudit(db, {
        actorUserId: req.user.id,
        action: "announcement.deactivate",
        entityType: "announcement",
        entityId: id,
      });

      res.json({ announcement: toAnnouncementView(findAnnouncementById(db, id)) });
    },
  });
}
