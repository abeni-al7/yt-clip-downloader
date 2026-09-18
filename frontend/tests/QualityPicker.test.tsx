import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../src/App";
import { copy } from "../src/copy";
import { VIDEO, jsonResponse, mockApi } from "./fixtures";

const LINK = `https://youtu.be/${VIDEO.video_id}`;

async function loadVideo(user: ReturnType<typeof userEvent.setup>) {
  const input = await screen.findByLabelText("YouTube link");
  await waitFor(() => expect(input).toBeEnabled());
  await user.type(input, `${LINK}{Enter}`);
  await screen.findByRole("heading", { level: 2, name: VIDEO.title });
}

function downloadHref(): string {
  return screen.getByRole("link", { name: /Download/ }).getAttribute("href")!;
}

afterEach(() => vi.restoreAllMocks());

describe("QualityPicker", () => {
  it("lists the video's MP4 heights with the highest pre-selected", async () => {
    mockApi({});
    const user = userEvent.setup();
    render(<App />);
    await loadVideo(user);

    const group = screen.getByRole("radiogroup", { name: "Quality" });
    const options = Array.from(group.querySelectorAll("input")).map((i) => i.value);
    expect(options).toEqual(["1080", "720", "360"]);
    expect(screen.getByRole("radio", { name: "1080p" })).toBeChecked();
    expect(downloadHref()).toContain("height=1080");
  });

  it("changes the download link when another height is chosen", async () => {
    mockApi({});
    const user = userEvent.setup();
    render(<App />);
    await loadVideo(user);

    await user.click(screen.getByRole("radio", { name: "720p" }));

    expect(downloadHref()).toContain("height=720");
    expect(downloadHref()).toContain("format=mp4");
  });

  it("is hidden for audio formats and comes back for video formats", async () => {
    mockApi({});
    const user = userEvent.setup();
    render(<App />);
    await loadVideo(user);

    await user.click(screen.getByRole("radio", { name: /^MP3 / }));
    expect(screen.queryByRole("radiogroup", { name: "Quality" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /^WebM / }));
    expect(screen.getByRole("radiogroup", { name: "Quality" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "720p" })).toBeChecked();
  });

  it("explains the codec for MP4 above 1080p", async () => {
    mockApi({
      resolve: () =>
        jsonResponse({
          ...VIDEO,
          resolutions: {
            mp4: [
              { height: 2160, fps: 30, vcodec: "vp9", video_kbps: 12000 },
              ...VIDEO.resolutions.mp4,
            ],
            webm: VIDEO.resolutions.webm,
          },
        }),
    });
    const user = userEvent.setup();
    render(<App />);
    await loadVideo(user);

    expect(screen.getByRole("radio", { name: "2160p" })).toBeChecked();
    expect(screen.getByText(copy.mp4_hi_res_note)).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "1080p" }));
    expect(screen.queryByText(copy.mp4_hi_res_note)).not.toBeInTheDocument();
  });
});
