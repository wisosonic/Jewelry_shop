import { z } from "zod";

/** Validation schemas for the business-info module (contact details, weekly hours, holiday exceptions, and the emergency override banner). */

/** "HH:MM" 24-hour local time, e.g. "09:00" or "18:30". */
const timeStringSchema = z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Expected a 24-hour HH:MM time");

/**
 * Request body schema for updating contact details and/or the emergency
 * override banner. If `overrideActive` is `true`, `overrideMessage` must be
 * a non-empty string - a banner with no text to show would be pointless.
 */
export const updateBusinessInfoSchema = z
  .object({
    address: z.string().optional(),
    phone: z.string().optional(),
    overrideActive: z.boolean().optional(),
    overrideMessage: z.string().max(500).optional(),
  })
  .refine((data) => !data.overrideActive || !!data.overrideMessage?.trim(), {
    message: "overrideMessage is required when overrideActive is true",
    path: ["overrideMessage"],
  });

/** One day's regular hours, as part of the full-week `updateBusinessHoursSchema` array. */
const businessHoursDaySchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  isOpen: z.boolean(),
  openTime: timeStringSchema,
  closeTime: timeStringSchema,
});

/** Request body schema for replacing the whole week's regular hours at once - always exactly 7 entries, one per day, with no duplicate day. */
export const updateBusinessHoursSchema = z
  .array(businessHoursDaySchema)
  .length(7)
  .refine((days) => new Set(days.map((d) => d.dayOfWeek)).size === 7, {
    message: "Each day of the week (0-6) must appear exactly once",
  });

/** Request body schema for adding a dated holiday/exception. */
export const createBusinessHolidaySchema = z
  .object({
    date: z.string().refine((value) => !Number.isNaN(Date.parse(value)), "Invalid date"),
    label: z.string().min(1).max(200),
    isClosed: z.boolean().default(true),
    openTime: timeStringSchema.optional(),
    closeTime: timeStringSchema.optional(),
  })
  .refine((data) => data.isClosed || (!!data.openTime && !!data.closeTime), {
    message: "openTime and closeTime are required when the exception isn't a full closure",
  });

/** Validates a route `:id` path param. */
export const idParamSchema = z.object({ id: z.string().min(1) });
