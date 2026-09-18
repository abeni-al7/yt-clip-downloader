"""POST /api/videos/resolve — canonicalise a link and describe what can be cut from it."""

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from ytclip.domain.models import VideoInfo
from ytclip.domain.video_info import build_video_info
from ytclip.domain.youtube_url import parse_youtube_url
from ytclip.media.extractor import resolve_info

router = APIRouter(prefix="/api/videos", tags=["videos"])


class ResolveRequest(BaseModel):
    url: str = Field(min_length=1, max_length=2048)


@router.post("/resolve", response_model=VideoInfo)
async def resolve_video(body: ResolveRequest, request: Request) -> VideoInfo:
    parsed = parse_youtube_url(body.url)
    state = request.app.state
    info = await resolve_info(state.cache, state.extractor, parsed.video_id)
    return build_video_info(info, parsed)
