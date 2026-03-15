import { NextRequest } from "next/server";

const authMock = vi.fn();
const sanitizeNameMock = vi.fn();
const nameUpdateLimiterCheckMock = vi.fn();
const apiLimiterCheckMock = vi.fn();
const getAdminFirestoreMock = vi.fn();

function mockRouteDeps() {
  vi.doMock("@/auth", () => ({
    auth: authMock,
  }));
  vi.doMock("@/lib/security", () => ({
    sanitizeName: sanitizeNameMock,
    nameUpdateLimiter: { check: nameUpdateLimiterCheckMock },
    apiLimiter: { check: apiLimiterCheckMock },
  }));
  vi.doMock("@/lib/firebase-admin", () => ({
    getAdminFirestore: getAdminFirestoreMock,
  }));
}

describe("API routes", () => {
  beforeEach(() => {
    vi.resetModules();
    authMock.mockReset();
    sanitizeNameMock.mockReset();
    nameUpdateLimiterCheckMock.mockReset();
    apiLimiterCheckMock.mockReset();
    getAdminFirestoreMock.mockReset();
    nameUpdateLimiterCheckMock.mockReturnValue({ allowed: true });
    apiLimiterCheckMock.mockReturnValue({ allowed: true });
  });

  it("sanitizes display names and sets the cookie in update-name", async () => {
    mockRouteDeps();
    authMock.mockResolvedValue({ user: { email: "maker@example.com" } });
    sanitizeNameMock.mockReturnValue({ valid: true, sanitized: "Jane Doe" });

    const { POST } = await import("@/app/api/auth/update-name/route");
    const response = await POST(new NextRequest("http://localhost/api/auth/update-name", {
      method: "POST",
      body: JSON.stringify({ name: "<b>Jane</b> Doe" }),
      headers: { "Content-Type": "application/json" },
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, name: "Jane Doe" });
    expect(response.headers.get("set-cookie")).toContain("user_display_name=Jane%20Doe");
  });

  it("returns 429 when update-name hits the rate limiter", async () => {
    mockRouteDeps();
    authMock.mockResolvedValue({ user: { email: "maker@example.com" } });
    nameUpdateLimiterCheckMock.mockReturnValue({ allowed: false, retryAfterMs: 1000 });

    const { POST } = await import("@/app/api/auth/update-name/route");
    const response = await POST(new NextRequest("http://localhost/api/auth/update-name", {
      method: "POST",
      body: JSON.stringify({ name: "Jane Doe" }),
      headers: { "Content-Type": "application/json" },
    }));

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({ error: "Too many requests — please wait" });
  });

  it("rejects invalid repair job ids before touching Firestore", async () => {
    mockRouteDeps();

    const { GET } = await import("@/app/api/repair-job/[jobId]/route");
    const response = await GET(
      new NextRequest("http://localhost/api/repair-job/bad%2Fid"),
      { params: Promise.resolve({ jobId: "bad/id" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid jobId format" });
    expect(getAdminFirestoreMock).not.toHaveBeenCalled();
  });

  it("whitelists repair job PATCH fields before updating Firestore", async () => {
    mockRouteDeps();

    const updateMock = vi.fn().mockResolvedValue(undefined);
    const getMock = vi.fn().mockResolvedValue({ exists: true });
    const docMock = vi.fn(() => ({ get: getMock, update: updateMock }));
    const collectionMock = vi.fn(() => ({ doc: docMock }));
    getAdminFirestoreMock.mockReturnValue({ collection: collectionMock });

    const { PATCH } = await import("@/app/api/repair-job/[jobId]/route");
    const response = await PATCH(
      new NextRequest("http://localhost/api/repair-job/job-1", {
        method: "PATCH",
        body: JSON.stringify({
          status: "finished",
          stepMessage: "Done",
          injected: "nope",
        }),
        headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.10" },
      }),
      { params: Promise.resolve({ jobId: "job-1" }) },
    );

    expect(response.status).toBe(200);
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock.mock.calls[0][0]).toMatchObject({
      status: "finished",
      stepMessage: "Done",
    });
    expect(updateMock.mock.calls[0][0]).not.toHaveProperty("injected");
    expect(updateMock.mock.calls[0][0]).toHaveProperty("updatedAt");
  });
});
