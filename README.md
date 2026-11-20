# StremioK for Older Samsung TVs (Tizen 2.3)

An open-source Stremio addon client for older Samsung Smart TVs. This community fork of [StremioK by Kepler75](https://github.com/Kepler75/StremioK) brings the app to **Tizen 2.3** and runs the BitTorrent engine on the TV.

| Compatibility | Status |
| --- | --- |
| Samsung UE40JU6000 (2015), Tizen 2.3, ARM, firmware T-HKM6DEUC-1570.0 | Tested on hardware |
| Other 2015 Samsung Tizen 2.3 TVs | Compatibility varies by model and firmware. Test on your device. |
| Samsung Tizen 3.0 and later | See the [upstream StremioK project](https://github.com/Kepler75/StremioK) for its supported models. |

## What this port adds

- **Native torrent playback** through an ARM Pepper 37 module with JSTorrent. It streams verified pieces to Samsung AVPlay through a local connection on the TV. After installation, playback runs without a PC, NAS, or phone.
- **Stremio library and Continue Watching** through QR sign-in. The TV imports library entries, resume positions and watched episode markers. Stremio sync reads account data. If you connect Trakt, the app can send eligible viewing progress to Trakt.
- **Remote-friendly Home** with larger posters, focused previews, and prioritized episode images.
- **English subtitles by default** when an English track is available. Subtitle preferences remain configurable.
- **Torrent availability ranking** using addon-reported seed counts and recent playback results on the TV.

## Install on a TV

Download the unsigned widget from [2.5.0 Preview](https://github.com/socoliuc/StremioK-Tizen-2.3/releases/tag/v2.5.0-tv23-preview). Use the [installation and signing guide](docs/INSTALL-TV23.md) to sign it with your own Samsung TV certificate profile and install it in Developer Mode. [Build from source](docs/BUILD-TV23.md) documents the Windows ARM toolchain and dependencies.

The port uses Samsung's public Developer Mode and Pepper APIs. It works with your existing TV firmware. Playback depends on addon availability, torrent peers and formats supported by your TV. The app hosts no media.

## Source and license

The application is licensed under the [MIT License](LICENSE). The native module's dependency notices are in [native/LICENSES.txt](native/LICENSES.txt). The repository retains upstream history and attribution. The [privacy notes](docs/PRIVACY.md) explain what the app stores on the TV and how it uses network services.

This is an independent community project for the Stremio addon ecosystem.
