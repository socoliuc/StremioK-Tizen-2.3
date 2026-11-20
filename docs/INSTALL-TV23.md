# Install StremioK on a Samsung Tizen 2.3 TV

The simplest tested route uses a computer on the same network as the TV. Set up Developer Mode and a Samsung TV certificate profile once. For updates, use the same computer and profile to sign and send each new widget.

A signed development build of 2.5.6 installed and played a 1080p video on a Samsung UE40JU6000 with Tizen 2.3, ARM and firmware T-HKM6DEUC-1570.0. The public download is an unsigned build from the release source. Installation and playback can vary with the model, firmware and certificate profile.

## Set up the TV and computer

1. Install [Tizen Studio with the Samsung TV and Certificate extensions](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/installing-tv-sdk.html).
2. Open the TV's **Apps** screen, enter **12345**, and turn **Developer Mode** on. Enter your computer's local IPv4 address in **Host PC IP**. On Windows, `ipconfig` shows the IPv4 address for the network adapter you are using. Confirm the keyboard entry, choose **OK**, and restart the TV.
3. Find the TV's own IPv4 address in its network settings. In Tizen Studio Device Manager, add and connect to that address. See [Samsung's TV device setup](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-device.html).
4. Create a **Samsung TV** profile in Certificate Manager. Add your TV's device ID (DUID) to the distributor certificate from the connected device list. You can also enter it manually from **Menu → Support → Contact Samsung → Unique Device ID**. Keep the profile and author certificate for future updates. See [Samsung's certificate guide](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/creating-certificates.html).
5. Use **Permit to install applications** for the connected TV if your SDK or certificate profile requires it. See [Samsung's certificate permission instructions](https://forum.developer.samsung.com/t/detail?id=9137-Samsung-Certificate-Manager-Update).

Keep the TV and computer on the same local network. If the connection stops working after a router restart or a change of computer, check both addresses again.

## Download, sign and install

1. Download `StremioK-Tizen-2.3-unsigned.wgt` and `SHA256SUMS.txt` from the same [GitHub release](https://github.com/socoliuc/StremioK-Tizen-2.3/releases). Compare the output of this command with the published checksum before extracting the widget.

   ```powershell
   Get-FileHash -Algorithm SHA256 .\StremioK-Tizen-2.3-unsigned.wgt
   ```

2. Extract the widget as a ZIP archive into a fresh folder named `widget`. Check that `widget\config.xml` is directly inside that folder.
3. Sign the extracted folder with your Samsung TV certificate profile. Use `sdb devices` to find the TV target name. In the example, replace `YOUR_PROFILE`, `YOUR_SIGNED_FILE.wgt` and `YOUR_TV_TARGET` with your values. Use the signed filename and directory printed by `tizen package`.

   ```powershell
   tizen package -t wgt -s 'YOUR_PROFILE' -- .\widget
   tizen install -n 'YOUR_SIGNED_FILE.wgt' -t 'YOUR_TV_TARGET' -- .\widget
   ```

   If the signed file is in a different directory, replace `.\widget` in the install command with that directory. See [Samsung's TV command-line reference](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/command-line-interface.html).

4. Launch **StremioK TV23** under Apps. To connect your account, open **Settings → Stremio account** and approve the QR sign-in in a browser. See the [playback guide](PLAYBACK-TV23.md) for add-ons, subtitles and source selection.

## USB sticks and download links

| Method | What is available for this project |
| --- | --- |
| **Computer and Developer Mode** | Install the signed widget over the local network. This is the documented route for the GitHub release. |
| **USB stick** | Consumer Samsung TVs cannot install a plain Tizen `.wgt` from USB. Samsung documents a Seller Office USB Demo Packaging Tool that creates a separate `.tmg` package and license. This project has no verified USB demo package for the tested model. |
| **Download link on the TV** | GitHub supplies the widget file. Opening the link does not install or sign it. |
| **Samsung Apps** | Installation from the TV's app catalog requires Samsung distribution and certification. StremioK TV23 is currently distributed through GitHub. |

See [Samsung's application installation FAQ](https://developer.samsung.com/smarttv/develop/faq/application-installation.html) and [TV app publication process](https://developer.samsung.com/tv-seller-office/guides/applications/tv-app-publication-process.html).

## Update or recover an installation

- Keep a copy of the last signed build that worked on your TV and the certificate profile. A clean reinstall can erase TV-only settings, viewing history and resume positions. Before updating, note any local settings and resume positions you want to recreate. Keep certificates, passwords and TV identifiers private.
- Download and verify the next release, extract it to a fresh folder, and sign it with the same profile. Install it through the existing Developer Mode connection.
- On the tested TV, an update failed partway through and the installed app disappeared. Reinstalling the verified widget restored the app. A clean reinstall clears local storage. Reconnect with the QR code to restore account-synced library, progress and add-ons. Re-enter any TV-only settings as needed. [Samsung's application installation FAQ](https://developer.samsung.com/smarttv/develop/faq/application-installation.html)
- If installation stops with a signing error, confirm that the profile is for a Samsung TV, includes your TV's DUID, and uses a distributor certificate the firmware trusts. The tested 2015 TV accepted a legacy Samsung-compatible profile. Newer profiles can behave differently on older firmware.
