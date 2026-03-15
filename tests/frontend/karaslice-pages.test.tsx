import { render, screen } from "@testing-library/react";
import React from "react";


const authMock = vi.fn();
const redirectMock = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});
const cookiesMock = vi.fn();
const recordLoginAndCheckDuplicatesMock = vi.fn(() => Promise.resolve());


function mockKaraslicePageDeps() {
  vi.doMock("@/auth", () => ({
    auth: authMock,
  }));
  vi.doMock("next/navigation", () => ({
    redirect: redirectMock,
    useRouter: () => ({
      refresh: vi.fn(),
    }),
  }));
  vi.doMock("next/headers", () => ({
    cookies: cookiesMock,
  }));
  vi.doMock("@/app/actions/account-actions", () => ({
    recordLoginAndCheckDuplicates: recordLoginAndCheckDuplicatesMock,
  }));
  vi.doMock("@/app/(tools)/karaslice/karaslice-sales", () => ({
    KarasliceSalesPage: () => <div>Karaslice sales page</div>,
  }));
  vi.doMock("@/app/(tools)/karaslice/karaslice-client", () => ({
    KarasliceClient: () => <div>Karaslice app shell</div>,
  }));
  vi.doMock("@/app/(tools)/karaslice/name-gate", () => ({
    NameGate: ({ email }: { email: string }) => <div>Name gate for {email}</div>,
  }));
}


describe("Karaslice route gating", () => {
  beforeEach(() => {
    vi.resetModules();
    authMock.mockReset();
    redirectMock.mockClear();
    cookiesMock.mockReset();
    cookiesMock.mockResolvedValue({
      get: vi.fn(() => undefined),
    });
    recordLoginAndCheckDuplicatesMock.mockClear();
  });

  it("redirects signed-in users from /karaslice to /karaslice/app", async () => {
    mockKaraslicePageDeps();
    authMock.mockResolvedValue({ user: { email: "maker@example.com" } });

    const { default: KaraslicePage } = await import("@/app/(tools)/karaslice/page");

    await expect(KaraslicePage()).rejects.toThrow("REDIRECT:/karaslice/app");
    expect(redirectMock).toHaveBeenCalledWith("/karaslice/app");
  });

  it("renders the sales page for signed-out visitors", async () => {
    mockKaraslicePageDeps();
    authMock.mockResolvedValue(null);

    const { default: KaraslicePage } = await import("@/app/(tools)/karaslice/page");
    render(await KaraslicePage());

    expect(screen.getByText("Karaslice sales page")).toBeInTheDocument();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("redirects signed-out users away from /karaslice/app", async () => {
    mockKaraslicePageDeps();
    authMock.mockResolvedValue(null);

    const { default: KarasliceAppPage } = await import("@/app/(tools)/karaslice/app/page");

    await expect(KarasliceAppPage()).rejects.toThrow("REDIRECT:/karaslice");
    expect(redirectMock).toHaveBeenCalledWith("/karaslice");
  });

  it("renders the name gate when the user name still matches the email", async () => {
    mockKaraslicePageDeps();
    authMock.mockResolvedValue({
      user: {
        email: "maker@example.com",
        name: "maker@example.com",
      },
    });

    const { default: KarasliceAppPage } = await import("@/app/(tools)/karaslice/app/page");
    render(await KarasliceAppPage());

    expect(screen.getByText("Name gate for maker@example.com")).toBeInTheDocument();
  });

  it("renders the app when the cookie has a real display name override", async () => {
    mockKaraslicePageDeps();
    authMock.mockResolvedValue({
      user: {
        email: "maker@example.com",
        name: "maker@example.com",
      },
    });
    cookiesMock.mockResolvedValue({
      get: vi.fn((key: string) => key === "user_display_name" ? { value: "Maya Maker" } : undefined),
    });

    const { default: KarasliceAppPage } = await import("@/app/(tools)/karaslice/app/page");
    render(await KarasliceAppPage());

    expect(screen.getByText("Karaslice app shell")).toBeInTheDocument();
  });

  it("renders the app for users with a real profile name", async () => {
    mockKaraslicePageDeps();
    authMock.mockResolvedValue({
      user: {
        email: "maker@example.com",
        name: "Maya Maker",
      },
    });

    const { default: KarasliceAppPage } = await import("@/app/(tools)/karaslice/app/page");
    render(await KarasliceAppPage());

    expect(screen.getByText("Karaslice app shell")).toBeInTheDocument();
  });
});
