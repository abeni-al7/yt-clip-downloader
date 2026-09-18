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

describe("FormatPicker", () => {
  it("offers all six formats grouped by kind with MP4 selected", async () => {
    mockApi({});
    const user = userEvent.setup();
    render(<App />);
    await loadVideo(user);

    expect(screen.getByRole("group", { name: "Video formats" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Audio formats" })).toBeInTheDocument();
    for (const label of ["MP4", "WebM", "MP3", "M4A", "OGG", "Opus"]) {
      expect(screen.getByRole("radio", { name: new RegExp(`^${label} `) })).toBeInTheDocument();
    }
    expect(screen.getByRole("radio", { name: /^MP4 / })).toBeChecked();
    expect(downloadHref()).toContain("format=mp4");
  });

  it("drops the height from the link when an audio format is chosen", async () => {
    mockApi({});
    const user = userEvent.setup();
    render(<App />);
    await loadVideo(user);

    await user.click(screen.getByRole("radio", { name: /^MP3 / }));

    const href = downloadHref();
    expect(href).toContain("format=mp3");
    expect(href).not.toContain("height=");
    expect(screen.getAllByText(copy.audio_convert_note).length).toBeGreaterThan(0);
  });

  it("uses the WebM resolution list when WebM is chosen", async () => {
    mockApi({});
    const user = userEvent.setup();
    render(<App />);
    await loadVideo(user);

    await user.click(screen.getByRole("radio", { name: /^WebM / }));

    expect(downloadHref()).toContain("format=webm");
    expect(downloadHref()).toContain("height=720");
  });

  it("disables WebM when the video has no VP9/AV1 stream", async () => {
    mockApi({
      resolve: () => jsonResponse({ ...VIDEO, resolutions: { ...VIDEO.resolutions, webm: [] } }),
    });
    const user = userEvent.setup();
    render(<App />);
    await loadVideo(user);

    expect(screen.getByRole("radio", { name: /^WebM / })).toBeDisabled();
    expect(screen.getByText(copy.no_webm)).toBeInTheDocument();
  });

  it("disables audio formats when the video has no audio", async () => {
    mockApi({ resolve: () => jsonResponse({ ...VIDEO, has_audio: false }) });
    const user = userEvent.setup();
    render(<App />);
    await loadVideo(user);

    for (const label of ["MP3", "M4A", "OGG", "Opus"]) {
      expect(screen.getByRole("radio", { name: new RegExp(`^${label} `) })).toBeDisabled();
    }
    expect(screen.getByRole("radio", { name: /^MP4 / })).toBeEnabled();
  });
});
