import { Request, Response } from "express";
import * as businessService from "./business.service";

/** HTTP handlers for business contact info, weekly hours, holiday exceptions, and the emergency override banner. */

/** Returns everything the footer/banner and the admin business page need. Public - no auth. */
export async function get(_req: Request, res: Response) {
  res.json(await businessService.getBusinessInfo());
}

/** Updates contact details and/or the emergency override banner (admin only). */
export async function update(req: Request, res: Response) {
  res.json(await businessService.updateBusinessInfo(req.body));
}

/** Replaces the whole week's regular hours at once (admin only). */
export async function setHours(req: Request, res: Response) {
  res.json({ hours: await businessService.setBusinessHours(req.body) });
}

/** Adds a dated holiday/exception (admin only). */
export async function addHoliday(req: Request, res: Response) {
  res.status(201).json({ holiday: await businessService.addBusinessHoliday(req.body) });
}

/** Removes a holiday/exception by id (admin only). */
export async function removeHoliday(req: Request, res: Response) {
  await businessService.deleteBusinessHoliday(req.params.id);
  res.status(204).send();
}
