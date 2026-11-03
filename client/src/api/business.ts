import { api } from "../lib/api";
import type { BusinessHoliday, BusinessHours, BusinessInfo } from "../types";

/** API wrappers for the storefront's contact info, weekly hours, holiday exceptions, and emergency override banner. */

/** Fetches everything the footer and site-wide banner need. Public - no auth required. */
export async function fetchBusinessInfo() {
  const { data } = await api.get<BusinessInfo>("/business");
  return data;
}

/** Updates contact details and/or the emergency override banner (admin only). */
export async function updateBusinessInfo(input: {
  address?: string;
  phone?: string;
  overrideActive?: boolean;
  overrideMessage?: string;
}) {
  const { data } = await api.patch<BusinessInfo>("/business", input);
  return data;
}

/** Replaces the whole week's regular hours at once - always all 7 days together (admin only). */
export async function updateBusinessHours(days: BusinessHours[]) {
  const { data } = await api.put<{ hours: BusinessHours[] }>("/business/hours", days);
  return data.hours;
}

/** Adds a dated holiday/exception (admin only). */
export async function addBusinessHoliday(input: {
  date: string;
  label: string;
  isClosed: boolean;
  openTime?: string;
  closeTime?: string;
}) {
  const { data } = await api.post<{ holiday: BusinessHoliday }>("/business/holidays", input);
  return data.holiday;
}

/** Removes a holiday/exception by id (admin only). */
export async function deleteBusinessHoliday(id: string) {
  await api.delete(`/business/holidays/${id}`);
}
