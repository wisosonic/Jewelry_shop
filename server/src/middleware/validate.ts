import { NextFunction, Request, Response } from "express";
import { ZodError, ZodTypeAny } from "zod";
import { AppError } from "../utils/AppError";

/** Request-validation middleware factory backed by Zod schemas. */

// `ZodTypeAny` (not `AnyZodObject`) so a schema built with `.refine()`/
// `.transform()` (e.g. business.schema.ts's cross-field checks) is
// accepted too - this middleware only ever calls `.parse()`, which every
// Zod schema type supports regardless of how it was composed.
type Schemas = Partial<{ body: ZodTypeAny; params: ZodTypeAny; query: ZodTypeAny }>;

/**
 * Creates middleware that parses/validates `req.body`, `req.params`, and/or
 * `req.query` against the given Zod schemas, replacing each with its parsed
 * (and coerced) value.
 * @throws {AppError} 400 with flattened Zod issues if validation fails.
 */
export function validate(schemas: Schemas) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body);
      if (schemas.params) req.params = schemas.params.parse(req.params) as typeof req.params;
      if (schemas.query) req.query = schemas.query.parse(req.query) as typeof req.query;
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        return next(AppError.badRequest("Validation failed", err.flatten()));
      }
      next(err);
    }
  };
}
