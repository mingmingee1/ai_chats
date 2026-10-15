package ai.chats.mobile;

import android.app.*;
import android.content.*;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.Icon;
import android.net.Uri;
import android.net.http.SslError;
import android.os.*;
import android.text.InputType;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

/** Installed Android shell. All room UI comes from the live PC server. */
public final class MainActivity extends Activity {
    private static final int GREEN = Color.rgb(20, 125, 100);
    private static final int INK = Color.rgb(28, 41, 37);
    private static final int BACKGROUND = Color.rgb(245, 246, 242);
    private static final int PICK_CONNECTION = 100, PICK_PHOTO = 101;
    private static final String MENU_ACTION = "ai.chats.mobile.MENU", REFRESH_ACTION = "ai.chats.mobile.REFRESH";
    private LinearLayout root;
    private FrameLayout content;
    private WebView web;
    private String origin = "";
    private ValueCallback<Uri[]> photoCallback;
    private boolean pageFailed;
    private boolean setupScreen;
    private int pageColor = BACKGROUND;
    private boolean resumed;
    private String themeScript = "null";
    private final Handler themeHandler = new Handler(Looper.getMainLooper());
    private final Runnable themeWatcher = new Runnable() {
        @Override public void run() {
            if (!resumed) return;
            syncPageColor();
            themeHandler.postDelayed(this, 1000);
        }
    };

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        origin = getPreferences(0).getString("origin", "");
        try { if (!origin.isEmpty()) origin = ConnectionAddress.normalize(origin); }
        catch (Exception e) { origin = ""; }
        pageColor = getPreferences(0).getInt("pageColor", BACKGROUND);
        try (InputStream input = getAssets().open("system-theme.js"); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] bytes = new byte[1024]; int count;
            while ((count = input.read(bytes)) != -1) out.write(bytes, 0, count);
            themeScript = new String(out.toByteArray(), StandardCharsets.UTF_8);
        } catch (IOException ignored) { }
        root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setBackgroundColor(BACKGROUND);
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                android.graphics.Insets keyboard = insets.getInsets(WindowInsets.Type.ime());
                v.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, keyboard.bottom));
            } else v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets;
        });
        content = new FrameLayout(this); root.addView(content, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(root);
        if (origin.isEmpty()) showSetup();
        else {
            createWeb();
            if (saved == null || web.restoreState(saved) == null) web.loadUrl(origin + "/");
        }
        installShortcuts();
        root.post(() -> handleShortcut(getIntent()));
    }

    private void createWeb() {
        if (web != null) { web.stopLoading(); web.destroy(); }
        web = new WebView(this); web.setBackgroundColor(pageColor);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true); s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false); s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setSafeBrowsingEnabled(true); s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setSupportMultipleWindows(false); s.setMediaPlaybackRequiresUserGesture(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setUserAgentString(s.getUserAgentString() + " AIChatsAndroid/1.0.1");
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (ConnectionAddress.sameOrigin(origin, url)) return false;
                if (request.isForMainFrame() && request.hasGesture()) openExternal(request.getUrl());
                return true;
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                pageFailed = false;
            }
            @Override public void onPageFinished(WebView view, String url) {
                CookieManager.getInstance().flush();
                syncPageColor();
            }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel();
                if (ConnectionAddress.sameOrigin(origin, error.getUrl())) {
                    pageFailed = true;
                    connectionError("PC 주소의 인증서를 확인하지 못했어요.",
                        "PC에서 setup-mobile.bat을 완료했는지, 휴대폰의 날짜와 시간이 맞는지 확인해 주세요. 인증서 경고를 무시하는 연결은 사용하지 않습니다.");
                }
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (!request.isForMainFrame()) return;
                pageFailed = true;
                connectionError("PC에 연결하지 못했어요.", "휴대폰과 PC의 Tailscale이 연결돼 있고, PC에서 start.bat이 실행 중인지 확인해 주세요.\n\n" + error.getDescription());
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame() && response.getStatusCode() >= 500) {
                    pageFailed = true;
                    connectionError("채팅 서버가 응답하지 않아요.", "PC에서 실행 중인 서버를 확인해 주세요. 연결 도우미 실행 후에는 start.bat을 다시 켜야 합니다.");
                }
            }
            @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                content.removeView(view); view.destroy(); web = null;
                connectionError("화면을 다시 열어 주세요.", "채팅과 기억은 PC에 저장돼 있습니다."); return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (photoCallback != null) photoCallback.onReceiveValue(null);
                photoCallback = callback;
                Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("image/*").addCategory(Intent.CATEGORY_OPENABLE);
                picker.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                try { startActivityForResult(picker, PICK_PHOTO); }
                catch (ActivityNotFoundException e) { callback.onReceiveValue(null); photoCallback = null; toast("사진 선택 앱을 찾지 못했어요."); }
                return true;
            }
            @Override public void onPermissionRequest(PermissionRequest request) { request.deny(); }
        });
        // Attachments remain protected by the WebView's authenticated session. Arbitrary
        // downloads are not handed to another app with the room's cookies.
        web.setDownloadListener((url, agent, disposition, mime, length) -> toast("첨부 파일 저장은 현재 PC에서 이용해 주세요."));
        showWeb();
    }

    private void showWeb() {
        setupScreen = false; content.removeAllViews();
        if (web != null) content.addView(web, new FrameLayout.LayoutParams(-1, -1));
        applySystemColor(pageColor);
    }
    private LinearLayout card(String heading, String description) {
        LinearLayout card = new LinearLayout(this); card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(26), dp(36), dp(26), dp(24));
        TextView h = text(heading, 26, INK); h.setTypeface(null, Typeface.BOLD); card.addView(h);
        TextView d = text(description, 15, Color.rgb(92, 105, 98)); d.setPadding(0, dp(16), 0, dp(24)); d.setLineSpacing(dp(5), 1); card.addView(d);
        return card;
    }
    private void placeCard(LinearLayout card) {
        content.removeAllViews(); ScrollView scroll = new ScrollView(this); scroll.setFillViewport(true); scroll.addView(card);
        content.addView(scroll, new FrameLayout.LayoutParams(-1, -1)); applySystemColor(BACKGROUND);
    }
    private void showSetup() {
        setupScreen = true;
        LinearLayout card = card("내 PC의 채팅방 연결", "한 번 연결하면 다음부터 앱을 열어 바로 대화할 수 있어요.\n\nPC에서 setup-mobile.bat을 실행하고, 안내된 앱 주소를 입력해 주세요.");
        EditText address = new EditText(this); address.setSingleLine(true); address.setTextSize(15);
        address.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        address.setHint("https://내PC.네트워크.ts.net"); address.setText(origin);
        card.addView(address, new LinearLayout.LayoutParams(-1, dp(56)));
        Button connect = primary("채팅방 열기", () -> {
            try { connect(ConnectionAddress.normalize(address.getText().toString())); }
            catch (Exception e) { address.setError(e.getMessage()); }
        });
        LinearLayout.LayoutParams margin = new LinearLayout.LayoutParams(-1, dp(52)); margin.topMargin = dp(18); card.addView(connect, margin);
        card.addView(button("연결 파일로 설정하기", () -> {
            Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*").addCategory(Intent.CATEGORY_OPENABLE);
            try { startActivityForResult(picker, PICK_CONNECTION); }
            catch (ActivityNotFoundException e) { toast("파일 선택 앱이 없습니다. 연결 주소를 직접 입력해 주세요."); }
        }), new LinearLayout.LayoutParams(-1, dp(52)));
        TextView hint = text("PC와 휴대폰의 Tailscale이 켜져 있어야 해요. 로그인 비밀번호는 기존 채팅방과 같습니다.", 13, Color.GRAY);
        hint.setPadding(0, dp(20), 0, 0); card.addView(hint);
        if (!origin.isEmpty()) card.addView(button("기존 채팅방으로 돌아가기", () -> { if (web == null) createWeb(); showWeb(); web.loadUrl(origin + "/"); }));
        placeCard(card);
    }
    private void connect(String value) {
        origin = value; getPreferences(0).edit().putString("origin", origin).apply();
        createWeb(); web.loadUrl(origin + "/");
    }
    private void connectionError(String heading, String description) {
        if (isFinishing() || setupScreen) return;
        LinearLayout card = card(heading, description);
        card.addView(primary("다시 연결", () -> {
            if (web == null) createWeb(); else showWeb(); web.loadUrl(origin + "/");
        }), new LinearLayout.LayoutParams(-1, dp(52)));
        card.addView(button("연결 주소 확인", this::showSetup), new LinearLayout.LayoutParams(-1, dp(52)));
        placeCard(card);
    }
    private void menu() {
        new AlertDialog.Builder(this).setTitle("AI 단톡방")
            .setItems(new String[]{"최신 화면 불러오기", "채팅방 홈", "연결 주소 변경", "로그아웃", "앱 정보"}, (dialog, which) -> {
                if (which == 2) { showSetup(); return; }
                if (which == 4) { new AlertDialog.Builder(this).setTitle("AI 단톡방 1.0.1")
                    .setMessage("PC의 최신 화면을 불러오는 안드로이드 앱입니다.\n\n대화·프사·설정 변경은 앱 새로고침으로 반영돼요.\n\n앱을 닫아도 PC에서 대화는 계속될 수 있습니다. 현재 버전은 백그라운드 새 메시지 알림을 제공하지 않습니다.")
                    .setPositiveButton("확인", null).show(); return; }
                if (origin.isEmpty()) { showSetup(); return; }
                boolean newlyCreated = web == null;
                if (newlyCreated) createWeb(); else showWeb();
                if (which == 0) { web.clearCache(true); if (newlyCreated) web.loadUrl(origin + "/"); else web.reload(); }
                else web.loadUrl(origin + (which == 3 ? "/logout" : "/"));
            }).show();
    }
    private void syncPageColor() {
        final WebView current = web;
        if (!resumed || setupScreen || pageFailed || current == null || current.getParent() != content
            || !ConnectionAddress.sameOrigin(origin, current.getUrl())) return;
        current.evaluateJavascript(themeScript, value -> {
            if (!resumed || setupScreen || pageFailed || current != web || current.getParent() != content) return;
            try {
                int rgb = Integer.parseInt(value);
                if (rgb < 0 || rgb > 0xFFFFFF) return;
                int color = 0xFF000000 | rgb;
                if (pageColor != color) {
                    pageColor = color;
                    getPreferences(0).edit().putInt("pageColor", color).apply();
                    applySystemColor(color);
                }
            } catch (NumberFormatException ignored) { }
        });
    }
    private void applySystemColor(int color) {
        root.setBackgroundColor(color);
        Window window = getWindow();
        window.setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(color));
        window.setStatusBarColor(color); window.setNavigationBarColor(color);
        if (Build.VERSION.SDK_INT >= 28) window.setNavigationBarDividerColor(color);
        if (Build.VERSION.SDK_INT >= 29) {
            window.setNavigationBarContrastEnforced(false);
            window.setStatusBarContrastEnforced(false);
        }
        // Keep system icons legible when the web page changes theme.
        boolean light = (0.2126 * Color.red(color) + 0.7152 * Color.green(color) + 0.0722 * Color.blue(color)) > 150;
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController controller = window.getInsetsController();
            if (controller != null) {
                int mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                controller.setSystemBarsAppearance(light ? mask : 0, mask);
            }
        } else {
            View decor = window.getDecorView();
            int mask = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            decor.setSystemUiVisibility(light ? decor.getSystemUiVisibility() | mask : decor.getSystemUiVisibility() & ~mask);
        }
    }
    private void installShortcuts() {
        try {
            ShortcutManager manager = getSystemService(ShortcutManager.class);
            if (manager == null) return;
            Icon icon = Icon.createWithResource(this, R.drawable.app_icon);
            manager.setDynamicShortcuts(Arrays.asList(
                new ShortcutInfo.Builder(this, "app-menu").setShortLabel("앱 설정").setIcon(icon)
                    .setIntent(shortcutIntent(MENU_ACTION)).build(),
                new ShortcutInfo.Builder(this, "refresh").setShortLabel("새로고침").setIcon(icon)
                    .setIntent(shortcutIntent(REFRESH_ACTION)).build()));
        } catch (RuntimeException ignored) { }
    }
    private Intent shortcutIntent(String action) {
        return new Intent(this, MainActivity.class).setAction(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    }
    private void handleShortcut(Intent intent) {
        String action = intent.getAction();
        intent.setAction(Intent.ACTION_MAIN);
        if (MENU_ACTION.equals(action)) menu();
        else if (REFRESH_ACTION.equals(action) && !origin.isEmpty()) {
            if (web == null) createWeb(); else showWeb();
            web.clearCache(true); web.loadUrl(origin + "/");
        }
    }
    @Override protected void onNewIntent(Intent intent) { super.onNewIntent(intent); setIntent(intent); handleShortcut(intent); }
    private void openExternal(Uri uri) {
        String scheme = uri.getScheme();
        if (!"https".equals(scheme) && !"http".equals(scheme) && !"mailto".equals(scheme)) { toast("지원하지 않는 링크입니다."); return; }
        new AlertDialog.Builder(this).setTitle("외부 링크 열기").setMessage(uri.toString())
            .setPositiveButton("열기", (d, w) -> { try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (ActivityNotFoundException e) { toast("링크를 열 앱이 없습니다."); } })
            .setNegativeButton("취소", null).show();
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == PICK_PHOTO && photoCallback != null) {
            Uri[] picked = null;
            if (result == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    ClipData clips = data.getClipData(); picked = new Uri[Math.min(clips.getItemCount(), 10)];
                    for (int i = 0; i < picked.length; i++) picked[i] = clips.getItemAt(i).getUri();
                } else if (data.getData() != null) picked = new Uri[]{data.getData()};
            }
            photoCallback.onReceiveValue(picked); photoCallback = null;
        }
        if (request == PICK_CONNECTION && result == RESULT_OK && data != null && data.getData() != null) {
            try (InputStream input = getContentResolver().openInputStream(data.getData()); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[1024]; int count;
                while ((count = input.read(buffer)) != -1) { out.write(buffer, 0, count); if (out.size() > 8192) throw new IOException("연결 파일이 너무 큽니다."); }
                JSONObject config = new JSONObject(new String(out.toByteArray(), StandardCharsets.UTF_8));
                if (!"ai-chats-mobile".equals(config.optString("format")) || config.optInt("version") != 1) throw new IOException("올바른 연결 파일이 아닙니다.");
                String value = ConnectionAddress.normalize(config.getString("url"));
                new AlertDialog.Builder(this).setTitle("이 PC에 연결할까요?").setMessage(value)
                    .setPositiveButton("연결", (d, w) -> connect(value)).setNegativeButton("취소", null).show();
            } catch (Exception e) { toast("연결 파일을 읽지 못했어요. " + e.getMessage()); }
        }
    }
    @Override public void onBackPressed() {
        if (setupScreen && !origin.isEmpty()) { if (web == null) { createWeb(); web.loadUrl(origin + "/"); } else showWeb(); }
        else if (!setupScreen && web != null && web.canGoBack()) { showWeb(); web.goBack(); }
        else moveTaskToBack(true);
    }
    @Override protected void onSaveInstanceState(Bundle state) { super.onSaveInstanceState(state); if (web != null) web.saveState(state); }
    @Override protected void onPause() { resumed = false; themeHandler.removeCallbacks(themeWatcher); if (web != null) web.onPause(); CookieManager.getInstance().flush(); super.onPause(); }
    @Override protected void onResume() { super.onResume(); resumed = true; if (web != null) web.onResume(); themeHandler.removeCallbacks(themeWatcher); themeHandler.post(themeWatcher); }
    @Override protected void onDestroy() {
        resumed = false; themeHandler.removeCallbacks(themeWatcher);
        if (photoCallback != null) photoCallback.onReceiveValue(null);
        if (web != null) { content.removeView(web); web.stopLoading(); web.destroy(); }
        super.onDestroy();
    }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private TextView text(String value, int size, int color) { TextView t = new TextView(this); t.setText(value); t.setTextSize(size); t.setTextColor(color); return t; }
    private Button button(String value, Runnable action) { Button b = new Button(this); b.setText(value); b.setAllCaps(false); b.setTextColor(GREEN); b.setBackgroundColor(Color.TRANSPARENT); b.setOnClickListener(v -> action.run()); return b; }
    private Button primary(String value, Runnable action) { Button b = button(value, action); b.setTextColor(Color.WHITE); GradientDrawable bg = new GradientDrawable(); bg.setColor(GREEN); bg.setCornerRadius(dp(14)); b.setBackground(bg); return b; }
    private void toast(String value) { Toast.makeText(this, value, Toast.LENGTH_LONG).show(); }
}
