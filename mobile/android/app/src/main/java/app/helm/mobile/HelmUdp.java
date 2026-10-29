package app.helm.mobile;

import java.io.IOException;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.SocketException;
import java.util.Arrays;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * UDP sockets for helm's link, used by the Capacitor plugin (the app) and by the hidden web view of the background task. One socket reaches
 * IPv4 and IPv6 addresses (Java opens it dual-stack), on any free port. Receiving is a thread per socket; sending is off the caller's thread,
 * since resolving a name can block.
 */
final class HelmUdp {
    interface Listener { void onDatagram(int id, byte[] data, String host, int port); }

    private static final AtomicInteger NEXT = new AtomicInteger(1);
    private static final ExecutorService SENDER = Executors.newCachedThreadPool();
    private final Map<Integer, DatagramSocket> sockets = new ConcurrentHashMap<>();
    private final Listener listener;

    HelmUdp(Listener listener) { this.listener = listener; }

    int bind() throws SocketException {
        final DatagramSocket socket = new DatagramSocket(null);
        socket.bind(new InetSocketAddress((InetAddress) null, 0));
        final int id = NEXT.getAndIncrement();
        sockets.put(id, socket);
        Thread reader = new Thread(() -> {
            byte[] buffer = new byte[2048];
            DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
            while (!socket.isClosed()) {
                try {
                    packet.setLength(buffer.length);
                    socket.receive(packet);
                    String host = packet.getAddress().getHostAddress();
                    int scope = host.indexOf('%');
                    if (scope >= 0) host = host.substring(0, scope);
                    listener.onDatagram(id, Arrays.copyOfRange(buffer, 0, packet.getLength()), host, packet.getPort());
                } catch (IOException e) {
                    if (socket.isClosed()) break;
                }
            }
        }, "helm-udp-" + id);
        reader.setDaemon(true);
        reader.start();
        return id;
    }

    void send(int id, byte[] data, String host, int port) {
        final DatagramSocket socket = sockets.get(id);
        if (socket == null) return;
        SENDER.execute(() -> {
            try {
                InetAddress to = InetAddress.getByName(host);
                socket.send(new DatagramPacket(data, data.length, to, port));
            } catch (IOException e) {
                // Unreachable for now: the link retries.
            }
        });
    }

    void close(int id) {
        DatagramSocket socket = sockets.remove(id);
        if (socket != null) socket.close();
    }

    void closeAll() {
        for (Integer id : sockets.keySet()) close(id);
    }
}
