package app.helm.mobile;

import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** The page's UDP socket (see mobile-app/src/native.ts). Datagrams arrive as "message" events with base64 data. */
@CapacitorPlugin(name = "HelmUdp")
public class HelmUdpPlugin extends Plugin {
    private HelmUdp udp;

    @Override
    public void load() {
        udp = new HelmUdp((id, data, host, port) -> {
            JSObject message = new JSObject();
            message.put("id", id);
            message.put("data", Base64.encodeToString(data, Base64.NO_WRAP));
            message.put("host", host);
            message.put("port", port);
            notifyListeners("message", message);
        });
    }

    @PluginMethod
    public void bind(PluginCall call) {
        try {
            JSObject result = new JSObject();
            result.put("id", udp.bind());
            call.resolve(result);
        } catch (Exception e) {
            call.reject(String.valueOf(e.getMessage()));
        }
    }

    @PluginMethod
    public void send(PluginCall call) {
        Integer id = call.getInt("id");
        String data = call.getString("data");
        String host = call.getString("host");
        Integer port = call.getInt("port");
        if (id == null || data == null || host == null || port == null) {
            call.reject("bad arguments");
            return;
        }
        udp.send(id, Base64.decode(data, Base64.NO_WRAP), host, port);
        call.resolve();
    }

    @PluginMethod
    public void close(PluginCall call) {
        Integer id = call.getInt("id");
        if (id != null) udp.close(id);
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        udp.closeAll();
    }
}
