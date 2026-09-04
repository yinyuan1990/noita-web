"""OpenMontage clip-factory recut of the qigong beam comparison.

Follows vendor/OpenMontage skills/pipelines/clip-factory/edit-director.md:
start on motion, hook in the first 2s, clean cuts, mobile-readable captions, BGM.
Uses OpenMontage tools: video_trimmer, video_stitch, subtitle_gen,
pixabay_music, video_compose.burn_subtitles, audio_mixer.segmented_music.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(r"e:\soft\xiaoshuodongtai")
OM = ROOT / "vendor" / "OpenMontage"
SRC = ROOT / "气功波四模型对比_抖音竖屏.mp4"
WORK = ROOT / "record" / "openmontage_work"
OUT = ROOT / "气功波四模型对比_OpenMontage.mp4"

sys.path.insert(0, str(OM))


def ensure_ffmpeg():
    if shutil.which("ffmpeg") and shutil.which("ffprobe"):
        return
    extra = [
        ROOT / "web" / "node_modules" / "ffmpeg-static",
        Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "WinGet" / "Packages",
        Path(r"C:\ffmpeg\bin"),
    ]
    found = []
    for base in extra:
        if not base.exists():
            continue
        found.extend(base.rglob("ffmpeg.exe"))
    if found:
        os.environ["PATH"] = str(found[0].parent) + os.pathsep + os.environ.get("PATH", "")
    if not shutil.which("ffmpeg"):
        raise SystemExit("ffmpeg not on PATH")
    print("ffmpeg:", shutil.which("ffmpeg"))
    print("ffprobe:", shutil.which("ffprobe"))


def add_silent_audio(video: Path, dest: Path) -> Path:
    """Silent source has no audio; OpenMontage mixer needs [0:a]."""
    cmd = [
        "ffmpeg", "-y",
        "-i", str(video),
        "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
        "-c:v", "copy", "-c:a", "aac", "-shortest",
        str(dest),
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return dest


def main():
    ensure_ffmpeg()
    WORK.mkdir(parents=True, exist_ok=True)

    from tools.video.video_trimmer import VideoTrimmer
    from tools.video.video_stitch import VideoStitch
    from tools.video.video_compose import VideoCompose
    from tools.audio.pixabay_music import PixabayMusic
    from tools.audio.audio_mixer import AudioMixer

    trimmer = VideoTrimmer()
    stitch = VideoStitch()
    compose = VideoCompose()
    music_tool = PixabayMusic()
    mixer = AudioMixer()

    # Start on motion (skip 3s title). Each model: beam body, not charge idle.
    cuts = [
        ("hook",   6.2,  8.4),   # Fable 光束爆发当钩子
        ("fable",  7.8, 10.8),
        ("sonnet", 15.2, 18.4),
        ("opus",   24.0, 27.2),
        ("grok",   33.6, 36.8),
        ("grid",   41.6, 45.2),
        ("cta",    49.2, 51.6),
    ]

    clip_paths = []
    for name, start, end in cuts:
        out = WORK / f"{name}.mp4"
        print(f"cut {name} {start}-{end}")
        r = trimmer.execute({
            "operation": "cut",
            "input_path": str(SRC),
            "output_path": str(out),
            "start_seconds": start,
            "end_seconds": end,
            "codec": "libx264",
        })
        if not r.success or not out.exists():
            # 源片无音轨，OpenMontage 默认 -c:a aac 会失败；改成纯视频切
            subprocess.run([
                "ffmpeg", "-y",
                "-ss", str(start), "-to", str(end),
                "-i", str(SRC),
                "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "19",
                "-r", "30", "-s", "1080x1920",
                str(out),
            ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        clip_paths.append(str(out))

    stitched = WORK / "stitched.mp4"
    print("stitch")
    r = stitch.execute({
        "operation": "stitch",
        "clips": clip_paths,
        "output_path": str(stitched),
        "transition": "cut",
        "auto_normalize": True,
        "target_resolution": "1080x1920",
        "target_fps": 30,
        "codec": "libx264",
        "crf": 19,
        "preset": "fast",
    })
    if not r.success:
        raise SystemExit(f"stitch failed: {r.error}")

    with_audio = add_silent_audio(stitched, WORK / "stitched_a.mp4")

    # 每段一条字幕。不走 subtitle_gen 的跨段拼 cue，避免 Fable/Sonnet 粘在一起。
    durs = [e - s for _, s, e in cuts]
    texts = [
        "同一提示词  四个模型",
        "Fable 5",
        "Sonnet 5",
        "Opus 5",
        "Grok 4.6",
        "",  # 同屏段原片已有标题，不再叠字
        "哪个最强？评论区告诉我",
    ]

    def ts(sec: float) -> str:
        ms = int(round(sec * 1000))
        h, ms = divmod(ms, 3600000)
        m, ms = divmod(ms, 60000)
        s, ms = divmod(ms, 1000)
        return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

    srt_lines = []
    t = 0.0
    idx = 1
    for text, dur in zip(texts, durs):
        if text:
            srt_lines.append(f"{idx}\n{ts(t)} --> {ts(t + dur)}\n{text}\n")
            idx += 1
        t += dur
    total = t
    srt_path = WORK / "captions.srt"
    srt_path.write_text("\n".join(srt_lines) + "\n", encoding="utf-8-sig")
    print("subtitles", idx - 1, "cues")

    captioned = WORK / "captioned.mp4"
    print("burn subtitles")
    r = compose.execute({
        "operation": "burn_subtitles",
        "input_path": str(with_audio),
        "subtitle_path": str(srt_path),
        "output_path": str(captioned),
        "codec": "libx264",
        "crf": 19,
        "subtitle_style": {
            "font": "Microsoft YaHei",
            "font_size": 32,
            "primary_color": "&H00FFE08A",
            "outline_color": "&H00000000",
            "outline_width": 3,
            "shadow": 1,
            "alignment": 2,
            "margin_v": 96,
            "bold": True,
        },
    })
    if not r.success:
        raise SystemExit(f"burn failed: {r.error}")

    music_path = WORK / "bgm.mp3"
    if music_path.exists() and music_path.stat().st_size > 1000:
        print("reuse music", music_path)
    else:
        print("pixabay music")
        r = music_tool.execute({
            "query": "epic electronic action",
            "min_duration": 20,
            "max_duration": 180,
            "output_path": str(music_path),
        })
        if not r.success:
            print("pixabay failed:", r.error)
            subprocess.run([
                "ffmpeg", "-y", "-f", "lavfi",
                "-i", "sine=frequency=110:sample_rate=44100:duration=25",
                str(music_path.with_suffix(".wav")),
            ], check=True)
            music_path = music_path.with_suffix(".wav")
        else:
            print("music:", r.data)

    print("mix music")
    r = mixer.execute({
        "operation": "segmented_music",
        "video_path": str(captioned),
        "music_path": str(music_path),
        "music_volume": 0.28,
        "fade_duration": 0.4,
        "segments": [{"start": 0, "end": total}],
        "output_path": str(OUT),
    })
    if not r.success:
        raise SystemExit(f"mix failed: {r.error}")

    print("DONE", OUT, f"{total:.1f}s")


if __name__ == "__main__":
    main()
