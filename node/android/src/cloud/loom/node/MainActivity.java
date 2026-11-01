package cloud.loom.node;

import android.app.Activity;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileWriter;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** One screen: paste the Devices install command, tap 连接. We fetch the
 *  one-time install script (same URL curl|sh would hit), pull URL+TOKEN out of
 *  it, write the daemon's config, ask to be exempted from battery optimisation
 *  (a one-tap system dialog a plain app may show — Termux cannot), and start the
 *  foreground service that supervises the daemon. */
public class MainActivity extends Activity {

    private final Handler ui = new Handler(Looper.getMainLooper());
    private EditText input;
    private TextView status;
    private Button connect, stop, paste, control;

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        setContentView(R.layout.main);
        input = findViewById(R.id.input);
        status = findViewById(R.id.status);
        connect = findViewById(R.id.connect);
        stop = findViewById(R.id.stop);
        paste = findViewById(R.id.paste);
        control = findViewById(R.id.control);

        connect.setOnClickListener(v -> onConnect());
        stop.setOnClickListener(v -> disconnect());
        paste.setOnClickListener(v -> pasteFromClipboard());
        control.setOnClickListener(v -> {
            try {
                startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));
            } catch (Exception ignored) {}
        });

        if (Build.VERSION.SDK_INT >= 33) {
            requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 1);
        }
        refresh();
    }

    @Override protected void onResume() {
        super.onResume();
        refresh();
    }

    private void refresh() {
        boolean screen = controlEnabled();
        control.setText(screen ? "屏幕控制：已开启（点此管理）" : "开启屏幕控制");
        if (Config.configured(this)) {
            input.setVisibility(View.GONE);
            paste.setVisibility(View.GONE);
            connect.setVisibility(View.GONE);
            stop.setVisibility(View.VISIBLE);
            control.setVisibility(View.VISIBLE);
            // Idempotent, and run while the activity is in the foreground (so a
            // foreground-service start is allowed on Android 14): this is how
            // the node recovers if it was ever left not running.
            NodeService.start(this);
            setStatus("已配置。节点在后台运行，Loom 的 Devices 里应显示绿点。\n"
                    + "屏幕控制：" + (screen ? "已开启" : "未开启（如需 Loom 看屏幕/点按，点上面的按钮开启无障碍）")
                    + "\n日志：" + Config.logFile(this));
        } else {
            input.setVisibility(View.VISIBLE);
            paste.setVisibility(View.VISIBLE);
            connect.setVisibility(View.VISIBLE);
            connect.setText("连接");
            stop.setVisibility(View.GONE);
            control.setVisibility(View.GONE);
            setStatus("未连接。");
        }
    }

    private boolean controlEnabled() {
        String flat = Settings.Secure.getString(
                getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        return flat != null && flat.contains(getPackageName() + "/" + ControlService.class.getName());
    }

    private void pasteFromClipboard() {
        ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        if (cm != null && cm.hasPrimaryClip() && cm.getPrimaryClip().getItemCount() > 0) {
            CharSequence t = cm.getPrimaryClip().getItemAt(0).coerceToText(this);
            if (t != null) input.setText(t.toString().trim());
        } else {
            setStatus("剪贴板是空的，先在 Devices 里复制 code。");
        }
    }

    // Accept either a bare install code (built against the baked-in join origin)
    // or a full install URL / the whole curl line pasted in.
    private String resolveInstallUrl(String raw) {
        Matcher m = Pattern.compile("(https?://[^\\s'\"|]+/node/install/[^\\s'\"|/]+)").matcher(raw);
        if (m.find()) return m.group(1);
        if (!raw.isEmpty() && !raw.contains("://") && !raw.contains(" ")) {
            String base = getString(R.string.join_origin).trim().replaceAll("/+$", "");
            if (!base.isEmpty()) return base + "/node/install/" + raw;
        }
        return null;
    }

    private void onConnect() {
        final String installUrl = resolveInstallUrl(input.getText().toString().trim());
        if (installUrl == null) {
            setStatus("没认出这串 code。到 Devices 选 Android，复制那串 code 再粘进来。");
            return;
        }
        setStatus("连接中…");
        connect.setEnabled(false);
        new Thread(() -> {
            try {
                String script = httpGet(installUrl);
                String url = extract(script, "URL='([^']+)'");
                String token = extract(script, "TOKEN='([^']+)'");
                if (url == null || token == null)
                    throw new Exception("链接返回里没有 url/token（可能已被用过，去 Devices 重新生成）");
                writeConfig(url, token);
                ui.post(() -> {
                    // Start the service while we are still foreground — Android 14
                    // forbids starting a foreground service from the background,
                    // and the battery dialog below pushes us there. Order matters.
                    try {
                        NodeService.start(MainActivity.this);
                    } catch (Exception e) {
                        setStatus("服务启动失败：" + e.getMessage());
                    }
                    connect.setEnabled(true);
                    refresh();
                    // Last, because it backgrounds us; declining it is harmless.
                    askIgnoreBatteryOptimizations();
                });
            } catch (Exception e) {
                ui.post(() -> {
                    connect.setEnabled(true);
                    setStatus("失败：" + e.getMessage());
                });
            }
        }).start();
    }

    private void disconnect() {
        NodeService.stop(this);
        Config.configFile(this).delete();
        refresh();
        setStatus("已停止并删除本机 token。去 Loom 的 Devices 里把这个设备也移除。");
    }

    private void writeConfig(String url, String token) throws Exception {
        File f = Config.configFile(this);
        f.getParentFile().mkdirs();
        String json = "{\n  \"url\": \"" + url.replaceAll("/+$", "")
                + "\",\n  \"token\": \"" + token
                + "\",\n  \"shell\": \"/system/bin/sh\"\n}\n";
        try (FileWriter w = new FileWriter(f)) { w.write(json); }
    }

    private void askIgnoreBatteryOptimizations() {
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null && !pm.isIgnoringBatteryOptimizations(getPackageName())) {
            try {
                Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                        Uri.parse("package:" + getPackageName()));
                startActivity(i);
            } catch (Exception ignored) {}
        }
    }

    private static String httpGet(String u) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(u).openConnection();
        c.setConnectTimeout(15000);
        c.setReadTimeout(15000);
        c.setInstanceFollowRedirects(true);
        try (BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream()))) {
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = r.readLine()) != null) sb.append(line).append('\n');
            return sb.toString();
        } finally {
            c.disconnect();
        }
    }

    private static String extract(String s, String re) {
        Matcher m = Pattern.compile(re).matcher(s);
        return m.find() ? m.group(1) : null;
    }

    private void setStatus(String s) { status.setText(s); }
}
