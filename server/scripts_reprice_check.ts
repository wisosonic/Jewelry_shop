import { repriceAllProducts } from "../src/modules/products/products.service";
import { prisma } from "../src/db/prisma";

async function main() {
  await repriceAllProducts();
  const bullion = await prisma.product.findMany({
    where: { productType: "BULLION" },
    select: { sku: true, currentPriceCents: true, makingChargeCents: true },
  });
  console.log(JSON.stringify(bullion, null, 2));
}

main().finally(() => prisma.$disconnect());
