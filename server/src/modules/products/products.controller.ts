import { Request, Response } from "express";
import * as productsService from "./products.service";

/** HTTP handlers for browsing and (admin-only) managing the product catalog. */

/**
 * Lists products, applying pagination/filtering from the query string.
 * `includeInactive` is only ever honored for a recognized admin - see
 * `optionalAuthenticate` in this route's registration and
 * `listProducts()`'s handling of `viewerRole`.
 */
export async function list(req: Request, res: Response) {
  res.json(await productsService.listProducts(req.query as never, req.user?.role));
}

/** Fetches a single product by id. */
export async function get(req: Request, res: Response) {
  res.json({ product: await productsService.getProduct(req.params.id) });
}

/** Fetches a handful of other products in the same category, for a "you might also like" section. */
export async function related(req: Request, res: Response) {
  res.json({ products: await productsService.getRelatedProducts(req.params.id) });
}

/** Creates a new product, pricing it from current metal rates. */
export async function create(req: Request, res: Response) {
  res.status(201).json({ product: await productsService.createProduct(req.body) });
}

/** Updates a product and recomputes its cached price. */
export async function update(req: Request, res: Response) {
  res.json({ product: await productsService.updateProduct(req.params.id, req.body) });
}

/** Deletes a product. */
export async function remove(req: Request, res: Response) {
  await productsService.deleteProduct(req.params.id);
  res.status(204).send();
}

/** Activates or deactivates several products at once. */
export async function bulkSetActive(req: Request, res: Response) {
  await productsService.bulkSetActive(req.body.ids, req.body.isActive);
  res.status(204).send();
}

/** Deletes several products at once. */
export async function bulkDelete(req: Request, res: Response) {
  await productsService.bulkDeleteProducts(req.body.ids);
  res.status(204).send();
}
