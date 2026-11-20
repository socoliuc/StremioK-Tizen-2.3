# Playback on Tizen 2.3

This guide covers the Tizen 2.3 fork. Start with the [installation guide](INSTALL-TV23.md) if the app is missing from your TV's Apps screen.

## Connect Stremio and find sources

1. Open **Settings → Stremio account → Sign in with QR code**. Approve the sign-in on Stremio's website with the account you want to use.
2. Open **Library** from Home to find your collection and supported resume positions. In **Settings → Stremio account**, choose **Sync library, progress and addons** when you want to refresh the account data. Stremio sync reads the account. Playback progress recorded on this TV is stored locally.
3. Open a movie or episode and look at its source list. Use **Addon** or **Resolution** to narrow the list when those buttons are available. Source selection depends on the add-ons you have configured. A catalog can show a title even when your add-ons return no playable sources.

You can manage add-ons under **Settings → Content → Addons**. Account sync imports supported add-ons. A clean reinstall can also require you to re-enter any add-on settings kept only on the TV.

## Pick a source likely to start

- Try a source labeled **H.264 or x264** with **AAC** audio in MP4 or MKV when comparing 720p and 1080p options. A 1080p video played on the tested UE40JU6000. Codec profiles, audio tracks and containers still vary by source. See [Samsung's 2015 TV video specifications](https://developer.samsung.com/smarttv/develop/specifications/media-specifications/2015-tv-video-specifications.html).
- **Settings → Playback → Formats → Hide incompatible sources** is on by default. It hides sources with clear AV1 or 10-bit H.264 tags and keeps them out of automatic playback and fallback. Turn it off to inspect or manually try filtered sources. The check uses filename and add-on metadata and can only classify the information supplied.
- **Settings → Playback → Source ranking** lets you move **Torrent availability** ahead of **Resolution** to prioritize availability. The app uses add-on-reported seed counts and recent playback results. The startup screen shows peers currently connected to the TV.

## Read the startup status

| Message | What is happening |
| --- | --- |
| **Connecting to torrent peers…** | The native engine is starting the selected torrent. |
| **Waiting for torrent metadata…** with a peer count | The app is waiting for the torrent's file information. A count of zero means the TV has no connected peers at that point. |
| **Preparing torrent file…** | The engine has the metadata and is preparing a file for playback. |
| **Opening video…** | Samsung AVPlay has been asked to open the stream. If this stalls, the player may be waiting for enough video data or having trouble opening the media. |
| **Torrent setup did not finish** | Setup ended before the player opened the stream. Try a different source or check the peer count during the next attempt. |
| **TV player rejected this format** | AVPlay explicitly reported an unsupported file or format. Try a source with a different video codec, audio format or container. |

Resolution alone does not determine whether a source starts. During buffering, playback depends on video bitrate and actual download speed. File size gives a rough estimate of bitrate when you also know the runtime. BitTorrent peers can exchange torrent metadata before transferring video pieces. This release displays peer status during playback startup. [BitTorrent metadata specification](https://www.bittorrent.org/beps/bep_0009.html)

## English subtitles

English is the first-choice subtitle language by default. The player can use embedded tracks or subtitle files supplied for the source. If a title opens without English subtitles, look for a track in the player's subtitle menu or try a different source. Change the default in **Settings → Playback → Subtitles**.

## Report a problem

Share the TV model, firmware, app version and exact status shown on screen. For playback issues, include the reported resolution and codec, the live peer count if it appeared, and whether **Opening video** appeared. For artwork delays, share which screen was slow and whether the images eventually loaded. Remove serial numbers, QR codes, account details and private add-on URLs from screenshots and logs. [Privacy notes](PRIVACY.md)
