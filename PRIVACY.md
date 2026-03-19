# Privacy Policy — AdBlock-Fast Controller

**Last updated:** 2026-03-18

## What this extension does

AdBlock-Fast Controller is a Chrome extension that communicates with the adblock-fast service on your OpenWrt router. It allows you to start, stop, and pause ad-blocking from the browser toolbar.

## Data collected

This extension stores the following data locally in your browser:

- **Router URL** — the address of your OpenWrt router
- **Login credentials** — username and password for the router's RPC API
- **Poll interval** — how often the extension checks the service status

This data is stored using Chrome's built-in `storage.local` API and never leaves your browser except to authenticate with the router you configured.

## Network communication

The extension communicates **only** with the router URL you provide in the settings. It makes JSON-RPC calls to your router's `/ubus` endpoint to:

- Log in and obtain a session token
- Check the adblock-fast service status
- Send start, stop, or pause commands

No data is sent to any other server, third party, or analytics service.

## Data sharing

This extension does not collect, transmit, or share any data with the developer or any third party.

## Permissions

- **`storage`** — to save your router connection settings locally
- **`alarms`** — to periodically poll the router for service status
- **`host_permissions` (`*/ubus`)** — to communicate with your router's RPC endpoint

## Contact

If you have questions about this privacy policy, please open an issue at:
https://github.com/mossdef-org/chrome-adblock-fast/issues
