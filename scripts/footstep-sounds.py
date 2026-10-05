"""Cut the Boots footsteps lib/footsteps.ts plays, into public/footsteps/boots.wav.

    python scripts/footstep-sounds.py

A RECORDING, cut from a CC0 sound on Freesound. The file is a SPRITE:
SLOT-second slots, one take per slot, softest take first — the layout lib/footsteps.ts reads. A take is one whole
footstep lifted out of a longer recording of someone walking in heels.

LEFT ALONE, as far as possible. The first sets were cut hard — the brightest
contacts only, held 30ms and faded in 20, high-passed at 80Hz — and the result
was a dry tick the user called plastic: the click of a heel with none of what
makes it a heel. What reads as a real, close footstep is the BODY under the
click (the floor answering, 100-400Hz) and the natural die-away after it, a
quarter of a second or more. So a take now:

    is a step whose energy is mostly body and mid, not a contact picked for
        being bright
    starts 2ms before its onset, so the attack is whole and nothing precedes it
    keeps its own decay for LEN seconds; only the last FADE of it is faded
    loses only what is under 40Hz (handling rumble, not floor)
    is peak-normalised: loudness is applied at playback, so a take only brings
        the TIMBRE of a soft or a hard step

The takes all come from one recording — same shoes, floor, room and
microphone — so a row of footsteps sounds like one dancer. They were chosen by
measurement, not by ear (analysis/footsteps/sounds/pick.py): at least 45dB over
the recording's noise, and a SINGLE contact, with nothing within 20dB of it for
0.4s after. That last rule is why there is no set from the best-sounding wooden
floors tried: a walking step in heels is heel then sole a tenth of a second
apart, and played under a footstep that is two sounds for one landing.

Downloads go through Freesound's preview files (OGG; the WAV originals need a
login) into analysis/footsteps/sounds/, and decoding through the ffmpeg that
imageio-ffmpeg ships.
"""

import os
import subprocess
import urllib.request
import wave

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "analysis", "footsteps", "sounds")
OUT = os.path.join(ROOT, "public", "footsteps")
SR = 48000
SLOT = 0.45  # seconds per take; lib/footsteps.ts has the same number
LEN = 0.42  # seconds of each take kept
FADE = 0.12  # seconds at its end that are faded out
PRE = 0.002

# name: (preview URL, onset times in the source — softest first)
SETS = {
    # Heels, slow pace, on a hard floor — studio-quiet (70dB over its noise),
    # tight, with a short clean tail.
    "boots": (
        "https://cdn.freesound.org/previews/218/218294_1480854-hq.ogg",
        [3.480, 4.823, 26.235, 24.929, 1.297, 28.694, 31.238],
    ),
}


def source(name, url):
    """The recording as 48kHz mono float, downloaded and decoded once."""
    ogg = os.path.join(CACHE, f"{name}.ogg")
    wav = os.path.join(CACHE, f"{name}.wav")
    if not os.path.exists(wav):
        if not os.path.exists(ogg):
            print("fetching", url)
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            open(ogg, "wb").write(urllib.request.urlopen(req).read())
        import imageio_ffmpeg

        subprocess.run(
            [imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error", "-i", ogg, "-ar", str(SR), "-ac", "1", wav],
            check=True,
        )
    with wave.open(wav) as w:
        return np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768


def highpass(x, fc=40):
    spec = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    spec *= 1 / np.sqrt(1 + (fc / np.maximum(f, 1e-9)) ** 4)
    return np.fft.irfft(spec, len(x))


def take(x, t):
    # The onset: the first sample at a tenth of the step's peak.
    a = int((t - 0.004) * SR)
    w = np.abs(x[a : a + int(0.03 * SR)])
    start = a + int(np.argmax(w > 0.1 * w.max())) - int(PRE * SR)
    pad = 4800  # so the filter's edges fall outside the take
    seg = highpass(x[start - pad : start + int(LEN * SR) + pad].copy())[pad:-pad]
    fade_in = int(0.001 * SR)
    seg[:fade_in] *= np.linspace(0, 1, fade_in)
    fade_out = int(FADE * SR)
    seg[-fade_out:] *= np.cos(np.linspace(0, np.pi / 2, fade_out)) ** 2
    return seg * (0.9 / np.abs(seg).max())


def main():
    os.makedirs(CACHE, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    slot = int(SLOT * SR)
    for name, (url, times) in SETS.items():
        x = source(name, url)
        sprite = np.zeros(slot * len(times), np.float32)
        for k, t in enumerate(times):
            seg = take(x, t)
            sprite[k * slot : k * slot + len(seg)] = seg
        path = os.path.join(OUT, f"{name}.wav")
        with wave.open(path, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(SR)
            w.writeframes((np.clip(sprite, -1, 1) * 32767).astype(np.int16).tobytes())
        print(name, len(times), "takes,", os.path.getsize(path), "bytes")


if __name__ == "__main__":
    main()
