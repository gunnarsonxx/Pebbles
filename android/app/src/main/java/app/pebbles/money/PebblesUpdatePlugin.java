package app.pebbles.money;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;

/** Downloads a new Pebbles APK from the Releases page and hands it to Android's installer. */
@CapacitorPlugin(name = "PebblesUpdate")
public class PebblesUpdatePlugin extends Plugin {

    @PluginMethod
    public void canInstall(PluginCall call) {
        boolean allowed = Build.VERSION.SDK_INT < 26 || getContext().getPackageManager().canRequestPackageInstalls();
        JSObject ret = new JSObject();
        ret.put("allowed", allowed);
        call.resolve(ret);
    }

    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 26) {
            Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
        }
        call.resolve();
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        final String url = call.getString("url");
        final String sha = call.getString("sha256", "");
        if (url == null || !url.startsWith("https://github.com/")) {
            call.reject("Unexpected update address");
            return;
        }
        new Thread(() -> {
            try {
                File dir = new File(getContext().getCacheDir(), "updates");
                if (!dir.exists() && !dir.mkdirs()) throw new IOException("Could not create a download folder");
                File out = new File(dir, "Pebbles-update.apk");
                MessageDigest md = MessageDigest.getInstance("SHA-256");
                InputStream in = open(url, 0);
                try (FileOutputStream fos = new FileOutputStream(out)) {
                    byte[] buf = new byte[65536];
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        fos.write(buf, 0, n);
                        md.update(buf, 0, n);
                    }
                } finally {
                    in.close();
                }
                String hex = toHex(md.digest());
                if (sha != null && !sha.isEmpty() && !sha.equalsIgnoreCase(hex)) {
                    throw new IOException("The download did not match its checksum, so it was not installed.");
                }
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", out);
                Intent intent = new Intent(Intent.ACTION_VIEW);
                intent.setDataAndType(uri, "application/vnd.android.package-archive");
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "Update failed");
            }
        }).start();
    }

    /** GitHub sends downloads through a redirect to another host; follow it by hand. */
    private InputStream open(String address, int hops) throws IOException {
        if (hops > 5) throw new IOException("Too many redirects");
        HttpURLConnection conn = (HttpURLConnection) new URL(address).openConnection();
        conn.setInstanceFollowRedirects(false);
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(60000);
        int code = conn.getResponseCode();
        if (code >= 300 && code < 400) {
            String next = conn.getHeaderField("Location");
            conn.disconnect();
            if (next == null || !next.startsWith("https://")) throw new IOException("Bad redirect");
            return open(next, hops + 1);
        }
        if (code != 200) throw new IOException("Download failed (HTTP " + code + ")");
        return conn.getInputStream();
    }

    private static String toHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder();
        for (byte b : bytes) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    /** Save a small file (e.g. a .ics calendar) and offer it to the apps that open that type. */
    @PluginMethod
    public void openFile(PluginCall call) {
        String name = call.getString("name", "pebbles.ics");
        String mime = call.getString("mime", "text/calendar");
        String text = call.getString("text", "");
        try {
            File dir = new File(getContext().getCacheDir(), "shared");
            if (!dir.exists()) dir.mkdirs();
            File out = new File(dir, name.replaceAll("[^A-Za-z0-9._-]", "_"));
            try (FileOutputStream fos = new FileOutputStream(out)) {
                fos.write(text.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", out);
            Intent view = new Intent(Intent.ACTION_VIEW);
            view.setDataAndType(uri, mime);
            view.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(view, "Add to calendar");
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getContext().startActivity(chooser);
            call.resolve();
        } catch (Exception e) {
            call.reject("Couldn't open the file: " + e.getMessage());
        }
    }
}
