![Discover tab listing plugins from a team market](preview.svg)

A team publishes its plugins in a market index; anyone who adds the index can install them from DSH. No market is built in.

## How to use

- Open **Plugins**, select **Discover**, click **Add index source**, enter the market's **Index URL**, and click **Add**. To add another market later, open the market menu and choose **Manage index sources…**.
- Click a plugin to read its details, then click **Install** and confirm.
- A plugin you have shows **Installed**, or **Update available** when the market recommends a newer version; click it to open the plugin under **Installed**.

## Good to know

- DSH contacts a market only after you add it.
- Market plugins come from third parties and run with your permissions. Add only markets you trust.
- To update a plugin installed from npm, use **Update** in its **Versions** section under **Installed**; installing another npm version from the market fails until you uninstall it. A plugin installed from Git has no **Versions** section; to change its version, uninstall it and install it again from the market.
- Plugin details come from public npm file services (jsDelivr, unpkg, npmmirror) or the plugin's Git repository, with your Git credentials for private ones. Icons load directly from the addresses in the index, so those servers see your IP address.
- In **Creator mode**, the agent also gets a read-only `plugin_market` tool, which adds a few tokens to each request.
- Turning this off removes **Discover** and the `plugin_market` tool; your index sources and installed plugins stay.
