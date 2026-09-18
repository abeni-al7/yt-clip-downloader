import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../src/App";
import { copy } from "../src/copy";
import { VIDEO, jsonResponse, mockApi, neverResolves } from "./fixtures";

const LINK = `https://youtu.be/${VIDEO.video_id}?t=60`;

async function loadVideo(user: ReturnType<typeof userEvent.setup>) {
  const input = await screen.findByLabelText("YouTube link");
  await waitFor(() => expect(input).toBeEnabled());
  await user.clear(input);
  await user.type(input, `${LINK}{Enter}`);
  await screen.findByRole("heading", { level: 2, name: VIDEO.title });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("HomePage", () => {
  it("hides the banner when the server answers and loads a video from a link", async () => {
    mockApi({});
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    await loadVideo(user);

    expect(screen.getByText(/Rick Astley/)).toBeInTheDocument();
    expect(screen.getByText(/Length 00:03:32/)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Start" })).toHaveValue("00:01:00");
    expect(screen.getByRole("textbox", { name: "End" })).toHaveValue("00:03:32");
    expect(screen.getByText(copy.boundary_notice)).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Start" })).toHaveValue("60");
  });

  it("disables Download and explains when the end is before the start", async () => {
    mockApi({});
    const user = userEvent.setup();
    render(<App />);
    await loadVideo(user);

    const end = screen.getByRole("textbox", { name: "End" });
    await user.clear(end);
    await user.type(end, "00:00:30{Enter}");

    expect(screen.getByText(copy.end_before_start)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Download/ })).toBeDisabled();
    expect(screen.queryByRole("link", { name: /Download/ })).not.toBeInTheDocument();
  });

  it("builds the download link for the chosen range at the highest resolution", async () => {
    mockApi({});
    const user = userEvent.setup();
    render(<App />);
    await loadVideo(user);

    const end = screen.getByRole("textbox", { name: "End" });
    await user.clear(end);
    await user.type(end, "00:01:30{Enter}");

    const link = await screen.findByRole("link", { name: "Download 30 s clip" });
    expect(link).toHaveAttribute("target", "_blank");
    const href = link.getAttribute("href")!;
    expect(href).toContain("/api/clip?");
    expect(href).toContain(`v=${VIDEO.video_id}`);
    expect(href).toContain("start=60");
    expect(href).toContain("end=90");
    expect(href).toContain("format=mp4");
    expect(href).toContain("height=1080");
    expect(screen.getByTestId("size-estimate")).toHaveTextContent(/≈ /);

    await user.click(link);
    expect(screen.getByText(copy.download_hint)).toBeInTheDocument();
  });

  it("clamps an end beyond the video length and says so", async () => {
    mockApi({});
    const user = userEvent.setup();
    render(<App />);
    await loadVideo(user);

    const end = screen.getByRole("textbox", { name: "End" });
    await user.clear(end);
    await user.type(end, "10:00{Enter}");

    expect(end).toHaveValue("00:03:32");
    expect(screen.getByText(copy.end_clamped("00:03:32"))).toBeInTheDocument();
  });

  it("shows the server's message for a private video", async () => {
    mockApi({
      resolve: () => jsonResponse({ code: "private", message: "This video is private." }, 422),
    });
    const user = userEvent.setup();
    render(<App />);
    const input = await screen.findByLabelText("YouTube link");
    await waitFor(() => expect(input).toBeEnabled());
    await user.type(input, `${LINK}{Enter}`);

    expect(await screen.findByRole("alert")).toHaveTextContent("This video is private.");
  });

  it("rejects non-YouTube links instantly without calling the server", async () => {
    const api = mockApi({});
    const user = userEvent.setup();
    render(<App />);
    const input = await screen.findByLabelText("YouTube link");
    await waitFor(() => expect(input).toBeEnabled());
    await user.type(input, "https://example.com/video{Enter}");

    expect(screen.getByRole("alert")).toHaveTextContent(copy.not_youtube);
    expect(api.calls.filter((c) => c.url.includes("/api/videos/resolve"))).toHaveLength(0);
  });

  it("shows the waking banner when the server does not answer within 3 s", async () => {
    vi.useFakeTimers();
    mockApi({ health: neverResolves });
    render(<App />);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(3_100);
    });

    expect(screen.getByRole("status")).toHaveTextContent(copy.server_waking);
  });
});
