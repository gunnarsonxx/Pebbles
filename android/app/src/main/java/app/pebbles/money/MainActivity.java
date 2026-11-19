package app.pebbles.money;

import android.os.Bundle;
import android.webkit.WebSettings;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PebblesUpdatePlugin.class);
        super.onCreate(savedInstanceState);
        // An app, not a web page: no pinch zoom and no overscroll glow.
        if (getBridge() != null && getBridge().getWebView() != null) {
            WebSettings ws = getBridge().getWebView().getSettings();
            ws.setSupportZoom(false);
            ws.setBuiltInZoomControls(false);
            ws.setDisplayZoomControls(false);
            getBridge().getWebView().setOverScrollMode(android.view.View.OVER_SCROLL_NEVER);
        }
    }
}
