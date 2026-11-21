package mcbp;

import net.lenni0451.lambdaevents.EventHandler;
import net.raphimc.viaproxy.ViaProxy;
import net.raphimc.viaproxy.plugins.ViaProxyPlugin;
import net.raphimc.viaproxy.plugins.events.JoinServerRequestEvent;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Lets Minecraft Bot Panel bots join online-mode servers through ViaProxy.
 *
 * ViaProxy only performs the Mojang session "join" for accounts saved inside
 * ViaProxy itself. For every other client it fires JoinServerRequestEvent.
 * This plugin forwards the server id hash to the panel over a loopback HTTP
 * call (URL + per-session secret passed as system properties); the panel does
 * the join with the bot's own Microsoft session, so no token ever reaches
 * ViaProxy. Cancelling the event tells ViaProxy the join succeeded.
 */
public final class AuthBridgePlugin extends ViaProxyPlugin {

    @Override
    public void onEnable() {
        ViaProxy.EVENT_MANAGER.register(this);
    }

    @EventHandler
    public void onJoinServerRequest(final JoinServerRequestEvent event) {
        final String url = System.getProperty("mcbp.auth.url");
        final String secret = System.getProperty("mcbp.auth.secret", "");
        if (url == null || url.isEmpty()) return;
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(3000);
            conn.setReadTimeout(20000);
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "text/plain; charset=utf-8");
            conn.setRequestProperty("X-MCBP-Secret", secret);
            try (OutputStream out = conn.getOutputStream()) {
                out.write(event.getServerIdHash().getBytes(StandardCharsets.UTF_8));
            }
            final int code = conn.getResponseCode();
            if (code >= 200 && code < 300) {
                event.setCancelled(true);
            } else {
                System.err.println("[MCBP-Auth] Panel refused session join (HTTP " + code + ")");
            }
        } catch (Throwable t) {
            System.err.println("[MCBP-Auth] Session join via panel failed: " + t);
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}
