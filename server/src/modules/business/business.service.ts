import { prisma } from "../../db/prisma";

/** Business logic for the storefront's public contact info, weekly hours, holiday exceptions, and emergency override banner. */

const DEFAULT_HOURS = Array.from({ length: 7 }, (_, dayOfWeek) => ({
  dayOfWeek,
  // Sensible out-of-the-box default: closed Sunday (0), open the rest of the week.
  isOpen: dayOfWeek !== 0,
  openTime: "09:00",
  closeTime: "18:00",
}));

/** Fetches the singleton business-info row, creating it (and the 7 default BusinessHours rows) if they don't exist yet. */
async function getOrCreateInfo() {
  const info = await prisma.businessInfo.findUnique({ where: { id: 1 } });
  if (info) return info;

  return prisma.$transaction(async (tx) => {
    const created = await tx.businessInfo.create({ data: { id: 1 } });
    const hoursCount = await tx.businessHours.count();
    if (hoursCount === 0) {
      await tx.businessHours.createMany({ data: DEFAULT_HOURS });
    }
    return created;
  });
}

/**
 * Fetches everything the storefront footer/banner and the admin business-
 * info page need in one call: contact details, the override banner state,
 * the full week's regular hours (sorted Sunday-first), and every holiday
 * exception (soonest first) - the client decides which of the latter are
 * still upcoming, since "today" is a display concern, not a query concern.
 */
export async function getBusinessInfo() {
  // Must run before the hours/holidays reads below, not alongside them in a
  // Promise.all - getOrCreateInfo() seeds the 7 default BusinessHours rows
  // on first call, and running the read concurrently with that seed is a
  // race that can return an empty hours list if the read wins.
  const info = await getOrCreateInfo();
  const [hours, holidays] = await Promise.all([
    prisma.businessHours.findMany({ orderBy: { dayOfWeek: "asc" } }),
    prisma.businessHoliday.findMany({ orderBy: { date: "asc" } }),
  ]);

  return { ...info, hours, holidays };
}

/** Updates contact details and/or the emergency override banner. */
export async function updateBusinessInfo(input: {
  address?: string;
  phone?: string;
  overrideActive?: boolean;
  overrideMessage?: string;
}) {
  await getOrCreateInfo();
  return prisma.businessInfo.update({ where: { id: 1 }, data: input });
}

/** Replaces the whole week's regular hours at once (always all 7 days together, so the schedule can never be left with a missing day). */
export async function setBusinessHours(
  days: { dayOfWeek: number; isOpen: boolean; openTime: string; closeTime: string }[]
) {
  await prisma.$transaction(
    days.map((day) =>
      prisma.businessHours.upsert({
        where: { dayOfWeek: day.dayOfWeek },
        update: day,
        create: day,
      })
    )
  );
  return prisma.businessHours.findMany({ orderBy: { dayOfWeek: "asc" } });
}

/** Adds a dated holiday/exception to the regular schedule. */
export async function addBusinessHoliday(input: {
  date: string;
  label: string;
  isClosed: boolean;
  openTime?: string;
  closeTime?: string;
}) {
  return prisma.businessHoliday.create({
    data: { ...input, date: new Date(input.date) },
  });
}

/** Removes a holiday/exception by id (idempotent - deleting one that's already gone is a no-op, not an error). */
export async function deleteBusinessHoliday(id: string) {
  await prisma.businessHoliday.deleteMany({ where: { id } });
}
