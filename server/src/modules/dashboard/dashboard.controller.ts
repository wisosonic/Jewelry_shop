import { Request, Response } from "express";
import * as dashboardService from "./dashboard.service";

/** HTTP handler for the admin dashboard's summary metrics. */

/** Returns aggregate metrics (counts, revenue, recent orders) for the admin dashboard. */
export async function summary(_req: Request, res: Response) {
  res.json(await dashboardService.getSummary());
}
