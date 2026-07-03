package com.zhurongkftech.beauty;

import android.view.Window;
import android.view.WindowManager;
import android.view.MotionEvent;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        keepContentInsideSystemBars();
        super.onCreate(savedInstanceState);
        keepContentInsideSystemBars();
        disableWebViewZoom();
    }

    @Override
    public void onStart() {
        super.onStart();
        keepContentInsideSystemBars();
        disableWebViewZoom();
    }

    @Override
    public void onResume() {
        super.onResume();
        keepContentInsideSystemBars();
        disableWebViewZoom();
    }

    private void keepContentInsideSystemBars() {
        Window window = getWindow();
        if (window == null) return;

        window.clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        WindowCompat.setDecorFitsSystemWindows(window, true);
    }

    private void disableWebViewZoom() {
        WebView webView = getBridge() == null ? null : getBridge().getWebView();
        if (webView == null) return;

        WebSettings settings = webView.getSettings();
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setTextZoom(100);
        webView.setInitialScale(100);
        webView.setOnTouchListener((view, event) -> {
            if (event.getPointerCount() > 1) {
                if (event.getActionMasked() == MotionEvent.ACTION_POINTER_DOWN || event.getActionMasked() == MotionEvent.ACTION_MOVE) {
                    return true;
                }
            }
            return false;
        });
    }
}
