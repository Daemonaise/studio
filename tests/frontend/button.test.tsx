import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

import { Button, buttonVariants } from "@/components/ui/button";


describe("Button", () => {
  it("renders children and default button semantics", () => {
    render(<Button>Launch</Button>);

    const button = screen.getByRole("button", { name: "Launch" });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute("type", "button");
    expect(button.className).toContain("btn-3d");
  });

  it("applies variant and size classes", () => {
    render(<Button variant="destructive" size="lg">Delete</Button>);

    const button = screen.getByRole("button", { name: "Delete" });
    expect(button.className).toContain("bg-destructive");
    expect(button.className).toContain("h-11");
  });

  it("supports click handlers", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    render(<Button onClick={onClick}>Save</Button>);
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("exposes buttonVariants for class composition", () => {
    expect(buttonVariants({ variant: "outline", size: "sm" })).toContain("border");
    expect(buttonVariants({ variant: "outline", size: "sm" })).toContain("h-9");
  });
});
