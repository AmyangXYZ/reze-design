"""Cut the first N seconds off an MP3, frame by frame.

    python scripts/cut-mp3.py <in.mp3> <out.mp3> <seconds>

No ffmpeg and no re-encode: MP3 is a stream of self-contained frames, each with
its own header, so trimming is a matter of finding the frame boundary nearest
the cut and keeping everything after it. Re-encoding would be worse than
pointless here -- it would cost a generation of quality to remove silence.

WHAT IT KEEPS AND DROPS. An ID3v2 tag at the head is carried over (it is the
title and artist, and nothing in it describes length). A Xing/Info frame is
DROPPED: it holds a frame count and a seek table for the file that was, and a
stale one makes a player report the wrong duration and seek to the wrong place
-- worse than the absence it leaves, which players handle by scaling from size.

THE CUT LANDS ON A FRAME, so it cannot be exact. A frame is 1152 samples --
26.1ms at 44.1kHz -- and this reports the error rather than hiding it: at a
tenth of a video frame, matching a motion cut to the nearest audio frame is
inaudible, but it is the kind of thing worth being able to check.
"""

import sys

BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0]
BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0]
RATES = {3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000]}


def frame_info(b, i):
    """(size, samples, rate, bitrate) for the frame at i, or None if not one."""
    if i + 4 > len(b) or b[i] != 0xFF or (b[i + 1] & 0xE0) != 0xE0:
        return None
    ver = (b[i + 1] >> 3) & 3  # 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
    layer = (b[i + 1] >> 1) & 3  # 1 = Layer III
    if ver == 1 or layer != 1:
        return None
    bitrate_i = (b[i + 2] >> 4) & 15
    rate_i = (b[i + 2] >> 2) & 3
    if bitrate_i in (0, 15) or rate_i == 3:
        return None
    bitrate = (BITRATES_V1_L3 if ver == 3 else BITRATES_V2_L3)[bitrate_i] * 1000
    rate = RATES[ver][rate_i]
    pad = (b[i + 2] >> 1) & 1
    samples = 1152 if ver == 3 else 576
    size = int(samples / 8 * bitrate / rate) + pad
    return size, samples, rate, bitrate


def main():
    src, dst, secs = sys.argv[1], sys.argv[2], float(sys.argv[3])
    b = open(src, "rb").read()

    head = 0
    if b[:3] == b"ID3":
        # Syncsafe: seven bits per byte, the eighth always zero.
        size = (b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9]
        head = 10 + size + (10 if b[5] & 0x10 else 0)
        print(f"ID3v2 tag: {head} bytes, kept")

    i = head
    while i < len(b) and frame_info(b, i) is None:
        i += 1
    if i != head:
        print(f"skipped {i - head} bytes of junk before the first frame")

    frames = []
    total = 0.0
    rates, bitrates = set(), set()
    while True:
        info = frame_info(b, i)
        if info is None:
            break
        size, samples, rate, bitrate = info
        frames.append((i, size, samples / rate))
        rates.add(rate)
        bitrates.add(bitrate)
        total += samples / rate
        i += size

    tail = len(b) - i
    print(f"frames: {len(frames)}   duration: {total:.3f}s   rates: {sorted(rates)}   "
          f"bitrates: {sorted(k // 1000 for k in bitrates)}kbps  ({'CBR' if len(bitrates) == 1 else 'VBR'})")
    if tail:
        print(f"trailing {tail} bytes after the last frame (ID3v1 or padding), dropped")

    start = 0
    # A Xing/Info/VBRI frame is not audio; it describes the file.
    first, fsize, _ = frames[0]
    chunk = b[first : first + fsize]
    if b"Xing" in chunk or b"Info" in chunk or b"VBRI" in chunk:
        print("dropped the Xing/Info header frame — it describes the file that was")
        start = 1

    kept = start
    dropped = 0.0
    while kept < len(frames) and dropped + frames[kept][2] <= secs:
        dropped += frames[kept][2]
        kept += 1

    out = bytearray(b[:head])
    for off, size, _ in frames[kept:]:
        out += b[off : off + size]
    open(dst, "wb").write(out)

    left = sum(f[2] for f in frames[kept:])
    print(f"{src} -> {dst}")
    print(f"  cut {dropped:.3f}s of {secs:.3f}s asked   (error {(dropped - secs) * 1000:+.1f}ms, "
          f"{abs(dropped - secs) * 30:.2f} video frames at 30fps)")
    print(f"  {len(frames) - kept} frames left, {left:.3f}s, {len(out)} bytes "
          f"(was {len(b)}, {total:.3f}s)")


main()
