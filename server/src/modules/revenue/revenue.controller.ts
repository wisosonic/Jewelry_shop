import { Request, Response } from "express";
import * as revenueService from "./revenue.service";

/** HTTP handler for the admin revenue report. */

/**
 * Returns total/category/trend revenue, split into earned vs pending, for
 * the admin revenue page. `fromDate`/`toDate` (always given together, or
 * not at all - see `revenueSummaryQuerySchema`) scope the trend to that
 * exact date range instead of the trailing `months`-month window.
 */
export async function summary(req: Request, res: Response) {
  const { months, fromDate, toDate } = req.query as unknown as { months: number; fromDate?: Date; toDate?: Date };
  const dateFilter = fromDate !== undefined && toDate !== undefined ? { fromDate, toDate } : undefined;
  res.json(await revenueService.getRevenueSummary(months, dateFilter));
}
