# StremioK for Older Samsung TVs (Tizen 2.3)

An open-source Stremio addon client for older Samsung Smart TVs. This community fork of [StremioK by Kepler75](https://github.com/Kepler75/StremioK) brings the app to **Tizen 2.3** and runs the BitTorrent engine on the TV.

| Compatibility | Status |
| --- | --- |
| Samsung UE40JU6000 (2015), Tizen 2.3, ARM, firmware T-HKM6DEUC-1570.0 | A signed development build of 2.5.6 installed and played a 1080p video |
| Other 2015 Samsung Tizen 2.3 TVs | Compatibility varies by model and firmware. Test on your device. |
| Samsung Tizen 3.0 and later | See the [upstream StremioK project](https://github.com/Kepler75/StremioK) for its supported models. |

## What this port adds

- **Native torrent playback** through an ARM Pepper 37 module with JSTorrent. It streams verified pieces to Samsung AVPlay through a local connection on the TV. After installation, playback runs without a PC, NAS, or phone.
- **Stremio library and Continue Watching** through QR sign-in. The TV imports library entries, resume positions and watched episode markers. Stremio sync reads account data. If you connect Trakt, the app can send eligible viewing progress to Trakt.
- **Remote-friendly Home** with faster navigation, prioritized episode images, and a layout focused on movies, series and personal libraries.
- **English subtitles by default** when an English track is available. Subtitle preferences remain configurable.
- **Torrent availability ranking** using addon-reported seed counts and recent playback results on the TV.
- **Video compatibility filtering** for sources clearly tagged AV1 or 10-bit H.264, with live peer counts during native torrent startup.

## Install on a TV

Download the [2.5.6 Preview](https://github.com/socoliuc/StremioK-Tizen-2.3/releases/tag/v2.5.6-tv23-preview) on your computer. Use the [installation guide](docs/INSTALL-TV23.md) to verify the download, sign the widget with your Samsung TV certificate profile, and send it to your TV in Developer Mode. The guide explains the USB and browser-link options.

- [Playback and troubleshooting](docs/PLAYBACK-TV23.md) covers source selection, peer counts, subtitle defaults and account recovery.
- [Build from source](docs/BUILD-TV23.md) lists the Windows ARM toolchain, pinned dependencies and checks.
- [Changelog](CHANGELOG.md) records the changes in this preview.

The port uses Samsung's public Developer Mode and Pepper APIs with the TV's existing firmware. Playback depends on addon availability, torrent peers and formats supported by your TV. The app hosts no media.

## Source and license

The application is licensed under the [MIT License](LICENSE). The native module's dependency notices are in [native/LICENSES.txt](native/LICENSES.txt). The repository retains upstream history and attribution. The [privacy notes](docs/PRIVACY.md) explain what the app stores on the TV and how it uses network services.

This is an independent community project for the Stremio addon ecosystem.
