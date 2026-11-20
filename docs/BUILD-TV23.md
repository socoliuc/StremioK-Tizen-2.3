# Build StremioK for Tizen 2.3

The build uses Windows, Node.js 22 or later, npm, Git, and the ARM newlib compiler from **Samsung Pepper 37**. The web app runs as ES5. The native module embeds QuickJS for the torrent engine.

## Get the build inputs

From the repository root, create a `.build` directory and lay out the inputs below. An existing local copy of each input can be linked into that directory.

| Location | Input |
| --- | --- |
| `.build/pepper_37/` | [Samsung NaCl SDK Pepper 37](https://developer.samsung.com/smarttv/develop/extension-libraries/nacl/download.html). Use the `pepper_37` directory from the extracted Samsung SDK. It must contain `include/` and `toolchain/win_arm_newlib/bin/arm-nacl-gcc.exe`. |
| `.build/quickjs-2026-06-04/` | [QuickJS 2026-06-04 source archive](https://bellard.org/quickjs/quickjs-2026-06-04.tar.xz). SHA-256 `b376e839b322978313d929fd20663b11ba58b75df5a46c126dd19ea2fa70ad2a`. |
| `.build/bearssl/` | [BearSSL](https://www.bearssl.org/git/BearSSL) at commit `7bea48e5e850ab4cafbe68d3765cdaba13a86d6f`. |
| `.build/jstorrent/` | [JSTorrent TypeScript](https://github.com/kzahel/jstorrent-typescript) at commit `6d1cf807e2c80a1667f1ad18163f8391e0005d9c`. |

```powershell
New-Item -ItemType Directory -Force .build
git clone https://www.bearssl.org/git/BearSSL .build/bearssl
git -C .build/bearssl checkout --detach 7bea48e5e850ab4cafbe68d3765cdaba13a86d6f
git clone https://github.com/kzahel/jstorrent-typescript.git .build/jstorrent
git -C .build/jstorrent checkout --detach 6d1cf807e2c80a1667f1ad18163f8391e0005d9c
```

Check the QuickJS archive with `Get-FileHash -Algorithm SHA256`, then extract it into `.build`. Place Samsung's extracted `pepper_37` directory there too.

## Build and test

```powershell
npm ci
npm test
npm run build:widget
Get-FileHash -Algorithm SHA256 .\dist\StremioK-Tizen-2.3-unsigned.wgt
```

`build:native` compiles QuickJS and BearSSL, bundles the pinned TypeScript engine, generates public CA trust anchors from Node's bundled roots, and links `native/host_arm.nexe`. The bundle applies the port's scheduler, integrity-checking and buffer-ownership adaptations at build time. Build output can vary by toolchain and Node root certificate set.

`build:widget` rebuilds the native module and packages only the files listed in `scripts/widget-files.txt` into `dist/StremioK-Tizen-2.3-unsigned.wgt`. Sign a freshly extracted copy with your own certificate as described in the [installation guide](INSTALL-TV23.md).

## Verify a build

`npm test` checks ES5 syntax and the Tizen 2.3 boot sequence, Stremio history import, torrent source ranking, background image work, episode artwork and source compatibility. It also checks the playback status poll and verifies that connection timeouts do not teach the app to mark a format as unsupported.

Before sharing a widget, compare its contents with `scripts/widget-files.txt`, verify the version in `config.xml` and publish a SHA-256 checksum for the exact file. Keep device-signed packages, certificate profiles and local test data private. A hardware check should record the TV model, firmware, build version and the features tested. See the [playback guide](PLAYBACK-TV23.md) for the status messages to record.
