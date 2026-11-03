import { describe, expect, it, vi } from "vitest";
import type { User } from "../types";
import { api, refreshAccessToken } from "./api";

const USER: User = {
  id: "u1",
  email: "shopper@test.com",
  name: "Shopper",
  role: "CUSTOMER",
  phone: null,
  address: null,
  isVerified: true,
  isBlocked: false,
  createdAt: "2024-01-01T00:00:00.000Z",
};

// refreshAccessToken() exists specifically to close a real bug: React
// StrictMode double-invokes AuthContext.tsx's mount effect in dev, and
// multiple components can independently 401 around the same moment too -
// either way, two concurrent callers would otherwise each POST
// /auth/refresh with the same not-yet-rotated refresh cookie, and the
// loser could be misidentified server-side as a stolen-token replay,
// revoking the whole session (see auth.service.ts's rotateRefreshToken()).
describe("refreshAccessToken", () => {
  it("shares a single in-flight request across concurrent callers", async () => {
    const postSpy = vi.spyOn(api, "post").mockResolvedValue({ data: { accessToken: "new-token", user: USER } });

    const [first, second] = await Promise.all([refreshAccessToken(), refreshAccessToken()]);

    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postSpy).toHaveBeenCalledWith("/auth/refresh");
    expect(first).toEqual({ accessToken: "new-token", user: USER });
    expect(second).toBe(first);

    postSpy.mockRestore();
  });

  it("issues a fresh request the next time, once the previous one has settled", async () => {
    const postSpy = vi
      .spyOn(api, "post")
      .mockResolvedValueOnce({ data: { accessToken: "token-1", user: USER } })
      .mockResolvedValueOnce({ data: { accessToken: "token-2", user: USER } });

    const first = await refreshAccessToken();
    const second = await refreshAccessToken();

    expect(postSpy).toHaveBeenCalledTimes(2);
    expect(first.accessToken).toBe("token-1");
    expect(second.accessToken).toBe("token-2");

    postSpy.mockRestore();
  });

  it("clears the in-flight request on failure too, so a later call can retry rather than reusing a rejected promise", async () => {
    const postSpy = vi
      .spyOn(api, "post")
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce({ data: { accessToken: "token-1", user: USER } });

    await expect(refreshAccessToken()).rejects.toThrow("network error");
    const retried = await refreshAccessToken();

    expect(postSpy).toHaveBeenCalledTimes(2);
    expect(retried.accessToken).toBe("token-1");

    postSpy.mockRestore();
  });
});
