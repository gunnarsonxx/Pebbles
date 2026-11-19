package app.pebbles.money;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PebblesUpdatePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
