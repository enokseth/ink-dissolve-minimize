Pixel Dissolve Ink — quick checks

- To run a GJS syntax check (requires `gjs` in PATH):

```bash
./tools/check-syntax.sh
```

If `gjs` is missing, install it via your distribution package manager (e.g. `sudo apt install gjs` on Debian/Ubuntu).

This repo includes fallback paths inside `extension.js` to avoid shader/Clutter API failures on older systems.


```bash
cmd :
cp -r ./* ~/.local/share/gnome-shell/extensions/pixel-dissolve-ink@enokseth/
glib-compile-schemas ~/.local/share/gnome-shell/extensions/pixel-dissolve-ink@enokseth/schemas
killall -3 gnome-shell
# reload the extension (toggle off then on). Replace the UUID if different.
gnome-extensions disable pixel-dissolve-ink@enokseth
gnome-extensions enable  pixel-dissolve-ink@enokseth
# remove old folder if it exists
rm -rf ~/.local/share/gnome-shell/extensions/pixel-dissolve-ink@enokseth

# create a symlink pointing to your repo
ln -s ~/gnome-shell-extensions/pixel-dissolve-ink ~/.local/share/gnome-shell/extensions/pixel-dissolve-ink@enokseth

# compile schemas if needed (run once or after schema changes)
glib-compile-schemas ~/.local/share/gnome-shell/extensions/pixel-dissolve-ink@enokseth/schemas

# copy the extension into the correctly named folder
cp -r ~/gnome-shell-extensions/pixel-dissolve-ink/* ~/.local/share/gnome-shell/extensions/pixel-dissolve-ink@enokseth/

# compile schemas (only if you modified schemas/)
glib-compile-schemas ~/.local/share/gnome-shell/extensions/pixel-dissolve-ink@enokseth/schemas

Developer helper
----------------

Use the included `dev-setup.sh` to symlink or copy the extension into your local GNOME extensions folder, compile schemas and reload the extension. Example:

```bash
./dev-setup.sh link
./dev-setup.sh compile-schemas
./dev-setup.sh reload

./dev-setup.sh install
./dev-setup.sh compile-schemas
./dev-setup.sh reload
```

The script reads the UUID from `metadata.json` so it will place files in the correctly named folder.
```