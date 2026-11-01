package cloud.loom.node;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Path;
import android.graphics.Rect;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.provider.Settings;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.security.SecureRandom;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Lets Loom see and drive the screen WITHOUT adb or root. An AccessibilityService
 * is the one no-root way to read the live UI tree ({@code getRootInActiveWindow}),
 * tap/swipe ({@code dispatchGesture}), type into fields ({@code ACTION_SET_TEXT},
 * so Chinese works with no ADBKeyboard), and — on API 30+ — grab the screen
 * ({@code takeScreenshot}) with no per-use consent dialog.
 *
 * The embedded loom-node daemon runs in a separate process (same uid), so it
 * reaches us over a tiny HTTP server bound to 127.0.0.1. A random token in the
 * app's private files dir (only our uid can read it) guards every request, so no
 * other app on the phone can drive the screen. The agent calls it from the host
 * with: loom-node exec <device> -- 'curl -s "127.0.0.1:8766/..?t=$(cat TOKEN)"'.
 *
 * Limit, same as adb screencap: a window with FLAG_SECURE (banking apps, DRM
 * video) comes back black — by design, not a bug.
 */
public class ControlService extends AccessibilityService {

    static final int PORT = 8766;
    private ServerSocket server;
    private volatile boolean up = false;
    private String token;

    // While installing an update, tap the system installer's confirm button for
    // the user (the one-tap-manual becomes zero-tap). 0 = not installing.
    private volatile long autoConfirmUntil = 0;
    // Button labels the installer shows to proceed — never "取消"/"Cancel".
    private static final String[] CONFIRM = {
            "继续安装", "安装", "更新", "下一步", "继续", "完成", "打开",
            "Install", "Update", "Continue", "Next", "Done", "Open", "OK"};

    @Override protected void onServiceConnected() {
        token = loadOrMakeToken();
        startServer();
    }

    @Override public void onAccessibilityEvent(AccessibilityEvent e) {
        if (autoConfirmUntil == 0 || SystemClock.uptimeMillis() > autoConfirmUntil) return;
        CharSequence pkg = e.getPackageName();
        if (pkg == null) return;
        String p = pkg.toString();
        if (!p.contains("packageinstaller") && !p.contains("installer")) return;
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return;
        if (clickConfirm(root)) {
            // Stop once we reach the terminal screen, so we don't loop.
        }
    }

    private boolean clickConfirm(AccessibilityNodeInfo n) {
        if (n == null) return false;
        CharSequence t = n.getText();
        String s = t == null ? "" : t.toString().trim();
        if (!s.isEmpty() && !s.contains("取消") && !s.equalsIgnoreCase("Cancel")) {
            for (String label : CONFIRM) {
                if (s.equals(label)) {
                    AccessibilityNodeInfo target = n.isClickable() ? n : clickableParent(n);
                    if (target != null && target.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
                        if (s.equals("完成") || s.equals("打开") || s.equalsIgnoreCase("Done")
                                || s.equalsIgnoreCase("Open")) autoConfirmUntil = 0;
                        return true;
                    }
                }
            }
        }
        for (int i = 0; i < n.getChildCount(); i++) {
            if (clickConfirm(n.getChild(i))) return true;
        }
        return false;
    }

    private AccessibilityNodeInfo clickableParent(AccessibilityNodeInfo n) {
        AccessibilityNodeInfo p = n.getParent();
        for (int i = 0; p != null && i < 6; i++) {
            if (p.isClickable()) return p;
            p = p.getParent();
        }
        return null;
    }
    @Override public void onInterrupt() { }

    @Override public boolean onUnbind(Intent intent) {
        stopServer();
        return super.onUnbind(intent);
    }

    @Override public void onDestroy() {
        stopServer();
        super.onDestroy();
    }

    // ── token ────────────────────────────────────────────────────────────

    private String loadOrMakeToken() {
        File f = new File(getFilesDir(), ".config/loom-node/control.token");
        try {
            if (f.exists() && f.length() > 0) {
                try (BufferedReader r = new BufferedReader(new java.io.FileReader(f))) {
                    String t = r.readLine();
                    if (t != null && !t.trim().isEmpty()) return t.trim();
                }
            }
            f.getParentFile().mkdirs();
            byte[] b = new byte[18];
            new SecureRandom().nextBytes(b);
            String t = android.util.Base64.encodeToString(b, android.util.Base64.URL_SAFE | android.util.Base64.NO_WRAP | android.util.Base64.NO_PADDING);
            try (FileOutputStream o = new FileOutputStream(f)) { o.write(t.getBytes("UTF-8")); }
            return t;
        } catch (Exception e) {
            return "loom";
        }
    }

    // ── HTTP server (loopback, one connection at a time) ──────────────────

    private void startServer() {
        if (up) return;
        up = true;
        new Thread(() -> {
            try {
                server = new ServerSocket(PORT, 8, InetAddress.getByName("127.0.0.1"));
                while (up) {
                    Socket s = server.accept();
                    try { handle(s); } catch (Exception ignored) {} finally { try { s.close(); } catch (Exception ignored) {} }
                }
            } catch (Exception ignored) {
            }
        }, "loom-control-http").start();
    }

    private void stopServer() {
        up = false;
        if (server != null) try { server.close(); } catch (Exception ignored) {}
        server = null;
    }

    private void handle(Socket s) throws Exception {
        BufferedReader in = new BufferedReader(new InputStreamReader(s.getInputStream(), "UTF-8"));
        String line = in.readLine();
        if (line == null) return;
        String[] parts = line.split(" ");
        if (parts.length < 2) { write(s, 400, "text/plain", "bad request".getBytes("UTF-8")); return; }
        String target = parts[1];
        String path = target, query = "";
        int q = target.indexOf('?');
        if (q >= 0) { path = target.substring(0, q); query = target.substring(q + 1); }
        // drain headers
        while ((line = in.readLine()) != null && !line.isEmpty()) { }

        if (!token.equals(param(query, "t"))) { write(s, 403, "text/plain", "forbidden".getBytes("UTF-8")); return; }

        try {
            route(s, path, query);
        } catch (Exception e) {
            write(s, 500, "application/json", json("error", String.valueOf(e.getMessage())).getBytes("UTF-8"));
        }
    }

    private void route(Socket s, String path, String query) throws Exception {
        switch (path) {
            case "/ping":
                write(s, 200, "application/json", json("ok", "true").getBytes("UTF-8"));
                return;
            case "/screenshot": {
                File out = new File(getCacheDir(), "screen.png");
                int[] wh = screenshot(out);
                write(s, 200, "application/json",
                        ("{\"path\":\"" + out.getAbsolutePath() + "\",\"w\":" + wh[0] + ",\"h\":" + wh[1] + "}").getBytes("UTF-8"));
                return;
            }
            case "/dump": {
                StringBuilder sb = new StringBuilder();
                AccessibilityNodeInfo root = getRootInActiveWindow();
                if (root == null) { write(s, 200, "application/json", "{\"nodes\":[]}".getBytes("UTF-8")); return; }
                sb.append("{\"nodes\":[");
                int[] n = {0};
                dump(root, sb, n, 0);
                sb.append("]}");
                write(s, 200, "application/json", sb.toString().getBytes("UTF-8"));
                return;
            }
            case "/tap": {
                float x = Float.parseFloat(param(query, "x")), y = Float.parseFloat(param(query, "y"));
                boolean ok = tap(x, y);
                write(s, 200, "application/json", json("ok", String.valueOf(ok)).getBytes("UTF-8"));
                return;
            }
            case "/swipe": {
                float x1 = Float.parseFloat(param(query, "x1")), y1 = Float.parseFloat(param(query, "y1"));
                float x2 = Float.parseFloat(param(query, "x2")), y2 = Float.parseFloat(param(query, "y2"));
                int ms = query.contains("ms=") ? Integer.parseInt(param(query, "ms")) : 300;
                boolean ok = swipe(x1, y1, x2, y2, ms);
                write(s, 200, "application/json", json("ok", String.valueOf(ok)).getBytes("UTF-8"));
                return;
            }
            case "/text": {
                String txt = param(query, "s");
                boolean ok = setText(txt);
                write(s, 200, "application/json", json("ok", String.valueOf(ok)).getBytes("UTF-8"));
                return;
            }
            case "/key": {
                String name = param(query, "name");
                int action;
                switch (name) {
                    case "home": action = GLOBAL_ACTION_HOME; break;
                    case "recents": action = GLOBAL_ACTION_RECENTS; break;
                    case "notifications": action = GLOBAL_ACTION_NOTIFICATIONS; break;
                    case "back": default: action = GLOBAL_ACTION_BACK; break;
                }
                boolean ok = performGlobalAction(action);
                write(s, 200, "application/json", json("ok", String.valueOf(ok)).getBytes("UTF-8"));
                return;
            }
            case "/update": {
                // The agent has already written the new APK to filesDir/update.apk
                // (loom-node write <dev> update.apk). We hand it to the system
                // installer via our FileProvider and auto-tap the confirm button.
                File apk = new File(getFilesDir(), ApkProvider.APK_NAME);
                if (!apk.exists() || apk.length() == 0) {
                    write(s, 404, "application/json", json("error", "no update.apk; write it to the home dir first").getBytes("UTF-8"));
                    return;
                }
                if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
                    try {
                        Intent g = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                Uri.parse("package:" + getPackageName()));
                        g.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(g);
                    } catch (Exception ignored) {}
                    write(s, 200, "application/json",
                            "{\"ok\":\"false\",\"need\":\"allow-unknown-sources\"}".getBytes("UTF-8"));
                    return;
                }
                Intent i = new Intent(Intent.ACTION_VIEW);
                i.setDataAndType(ApkProvider.uri(), "application/vnd.android.package-archive");
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                autoConfirmUntil = SystemClock.uptimeMillis() + 120000;
                startActivity(i);
                write(s, 200, "application/json", "{\"ok\":\"true\",\"installing\":\"true\"}".getBytes("UTF-8"));
                return;
            }
            case "/launch": {
                String pkg = param(query, "pkg");
                Intent i = getPackageManager().getLaunchIntentForPackage(pkg);
                if (i == null) { write(s, 404, "application/json", json("error", "no such package").getBytes("UTF-8")); return; }
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(i);
                write(s, 200, "application/json", json("ok", "true").getBytes("UTF-8"));
                return;
            }
            default:
                write(s, 404, "text/plain", "not found".getBytes("UTF-8"));
        }
    }

    // ── actions ───────────────────────────────────────────────────────────

    private int[] screenshot(File out) throws Exception {
        final AtomicReference<Bitmap> bmp = new AtomicReference<>();
        final CountDownLatch latch = new CountDownLatch(1);
        takeScreenshot(android.view.Display.DEFAULT_DISPLAY, Executors.newSingleThreadExecutor(),
                new TakeScreenshotCallback() {
                    @Override public void onSuccess(ScreenshotResult r) {
                        try {
                            Bitmap b = Bitmap.wrapHardwareBuffer(r.getHardwareBuffer(), r.getColorSpace());
                            if (b != null) bmp.set(b.copy(Bitmap.Config.ARGB_8888, false));
                            r.getHardwareBuffer().close();
                        } catch (Exception ignored) {}
                        latch.countDown();
                    }
                    @Override public void onFailure(int err) { latch.countDown(); }
                });
        latch.await(8, TimeUnit.SECONDS);
        Bitmap b = bmp.get();
        if (b == null) throw new Exception("screenshot failed (FLAG_SECURE window, or not permitted)");
        try (FileOutputStream o = new FileOutputStream(out)) { b.compress(Bitmap.CompressFormat.PNG, 90, o); }
        return new int[]{b.getWidth(), b.getHeight()};
    }

    private boolean tap(float x, float y) {
        Path p = new Path();
        p.moveTo(x, y);
        GestureDescription g = new GestureDescription.Builder()
                .addStroke(new GestureDescription.StrokeDescription(p, 0, 60)).build();
        return dispatchGesture(g, null, null);
    }

    private boolean swipe(float x1, float y1, float x2, float y2, int ms) {
        Path p = new Path();
        p.moveTo(x1, y1);
        p.lineTo(x2, y2);
        GestureDescription g = new GestureDescription.Builder()
                .addStroke(new GestureDescription.StrokeDescription(p, 0, Math.max(1, ms))).build();
        return dispatchGesture(g, null, null);
    }

    private boolean setText(String txt) {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return false;
        AccessibilityNodeInfo node = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
        if (node == null) node = firstEditable(root);
        if (node == null) return false;
        Bundle args = new Bundle();
        args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, txt);
        return node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args);
    }

    private AccessibilityNodeInfo firstEditable(AccessibilityNodeInfo n) {
        if (n == null) return null;
        if (n.isEditable()) return n;
        for (int i = 0; i < n.getChildCount(); i++) {
            AccessibilityNodeInfo r = firstEditable(n.getChild(i));
            if (r != null) return r;
        }
        return null;
    }

    // ── UI dump ─────────────────────────────────────────────────────────

    private void dump(AccessibilityNodeInfo n, StringBuilder sb, int[] count, int depth) {
        if (n == null || depth > 40 || count[0] > 1200) return;
        boolean interesting = n.isClickable() || n.isEditable() || n.isCheckable()
                || n.isLongClickable() || n.isScrollable()
                || (n.getText() != null && n.getText().length() > 0)
                || (n.getContentDescription() != null && n.getContentDescription().length() > 0);
        if (interesting) {
            Rect b = new Rect();
            n.getBoundsInScreen(b);
            if (b.width() > 0 && b.height() > 0) {
                if (count[0] > 0) sb.append(',');
                count[0]++;
                sb.append('{')
                  .append("\"cls\":\"").append(esc(simpleName(n.getClassName()))).append('"')
                  .append(",\"text\":\"").append(esc(str(n.getText()))).append('"')
                  .append(",\"desc\":\"").append(esc(str(n.getContentDescription()))).append('"')
                  .append(",\"id\":\"").append(esc(str(n.getViewIdResourceName()))).append('"')
                  .append(",\"bounds\":[").append(b.left).append(',').append(b.top).append(',').append(b.right).append(',').append(b.bottom).append(']')
                  .append(",\"cx\":").append(b.centerX()).append(",\"cy\":").append(b.centerY())
                  .append(",\"clickable\":").append(n.isClickable())
                  .append(",\"editable\":").append(n.isEditable())
                  .append(",\"scrollable\":").append(n.isScrollable())
                  .append('}');
            }
        }
        for (int i = 0; i < n.getChildCount(); i++) dump(n.getChild(i), sb, count, depth + 1);
    }

    private static String simpleName(CharSequence cls) {
        if (cls == null) return "";
        String s = cls.toString();
        int d = s.lastIndexOf('.');
        return d >= 0 ? s.substring(d + 1) : s;
    }

    private static String str(CharSequence c) { return c == null ? "" : c.toString(); }

    private static String esc(String s) {
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '\t': b.append("\\t"); break;
                default: if (c < 0x20) b.append(String.format("\\u%04x", (int) c)); else b.append(c);
            }
        }
        return b.toString();
    }

    // ── tiny HTTP helpers ─────────────────────────────────────────────────

    private static String param(String query, String key) {
        for (String kv : query.split("&")) {
            int i = kv.indexOf('=');
            String k = i >= 0 ? kv.substring(0, i) : kv;
            if (k.equals(key)) {
                String v = i >= 0 ? kv.substring(i + 1) : "";
                try { return URLDecoder.decode(v, "UTF-8"); } catch (Exception e) { return v; }
            }
        }
        return "";
    }

    private static String json(String k, String v) {
        return "{\"" + k + "\":\"" + esc(v) + "\"}";
    }

    private static void write(Socket s, int code, String type, byte[] body) throws Exception {
        OutputStream o = s.getOutputStream();
        String head = "HTTP/1.0 " + code + " OK\r\n"
                + "Content-Type: " + type + "\r\n"
                + "Content-Length: " + body.length + "\r\n"
                + "Connection: close\r\n\r\n";
        o.write(head.getBytes("UTF-8"));
        o.write(body);
        o.flush();
    }
}
