import { Request, Response } from "express";
import * as settingsService from "./settings.service";

/** HTTP handlers for reading and updating global app settings (admin only). */

/** Returns the current app settings. */
export async function get(_req: Request, res: Response) {
  res.json({ settings: await settingsService.getSettings() });
}

/** Updates app settings (e.g. commission surcharges, currency) and reprices products accordingly. */
export async function update(req: Request, res: Response) {
  res.json({ settings: await settingsService.updateSettings(req.body) });
}
