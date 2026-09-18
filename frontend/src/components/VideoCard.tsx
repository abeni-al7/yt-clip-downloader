import type { VideoInfo } from "../api/client";
import { toHms } from "../lib/format";

export function VideoCard({ video }: { video: VideoInfo }) {
  return (
    <div className="video-card">
      <img className="video-card__thumb" src={video.thumbnail_url} alt={video.title} />
      <div className="video-card__meta">
        <h2 className="video-card__title">{video.title}</h2>
        <p className="note">
          {video.channel && <span>{video.channel} · </span>}
          <span>Length {toHms(video.duration_s)}</span>
        </p>
      </div>
    </div>
  );
}
