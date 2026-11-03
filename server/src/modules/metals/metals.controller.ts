import { Request, Response } from "express";
import * as metalsService from "./metals.service";

/** HTTP handlers for reading and (admin-only) manually refreshing metal spot prices. */

/** Returns the most recently stored gold and silver prices. */
export async function latest(_req: Request, res: Response) {
  res.json(await metalsService.getLatestPrices());
}

/**
 * Triggers an on-demand metal price refresh. Always `force: true` - an
 * admin explicitly clicking "Refresh now" is a deliberate request for
 * up-to-date prices right now, not something that should be silently
 * throttled by the same rate-limit floor that protects the *automatic*
 * scheduler's API usage. See `refreshMetalPrices()`'s doc comment.
 */
export async function refresh(_req: Request, res: Response) {
  res.json(await metalsService.refreshMetalPrices({ force: true }));
}
