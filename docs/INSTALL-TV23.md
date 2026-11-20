# Install StremioK on a Samsung Tizen 2.3 TV

An earlier build of this port was tested on a Samsung UE40JU6000 with Tizen 2.3 and firmware T-HKM6DEUC-1570.0. The downloadable preview was rebuilt from the public source. Other model and firmware combinations need their own installation and playback check.

1. Get the unsigned widget from [GitHub Releases](https://github.com/socoliuc/StremioK-Tizen-2.3/releases) or [build it from source](BUILD-TV23.md).
2. Install [Tizen Studio with the Samsung TV and Certificate extensions](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/installing-tv-sdk.html). Create a Samsung TV certificate profile for your TV, including its device ID when required by the distributor certificate.
3. Open the TV's Apps screen, enter **12345**, turn Developer Mode on and enter your computer's LAN IP address. Restart the TV. Connect to it using Tizen Studio Device Manager. Right-click a folder in the file browser for the connected TV and select **Permit to install applications**. See the [Samsung Smart TV team instructions](https://forum.developer.samsung.com/t/detail?id=9137-Samsung-Certificate-Manager-Update).
4. Extract the unsigned WGT into a fresh folder with an archive tool. Sign that folder with your certificate profile, then install the signed WGT. See [Samsung's TV CLI documentation](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/command-line-interface.html) for command syntax and target selection.

   ```powershell
   tizen package -t wgt -s YOUR_PROFILE -- .\widget
   tizen install -n YOUR_SIGNED_FILE.wgt -t YOUR_TV_TARGET -- .\widget
   ```

5. Open **StremioK TV23** under Apps. In **Settings → Stremio account**, approve the QR sign-in through Stremio on your phone to import your library and progress. Add your own compatible sources in Settings.

Keep your author certificate for future upgrades. Before an upgrade, export any settings you need to keep. On the tested TV, the package manager failed during an in-place update and the app had to be installed again.

The successful hardware installation used a legacy Samsung-compatible distributor certificate. Some older firmware versions reject profiles generated with newer tools. The exact signing and install workflow depends on your firmware and certificate profile. Keep certificate files and passwords private.
