import Darwin
import Foundation

/// UDP sockets for helm's link, used by the Capacitor plugin (the app) and by the hidden web view of the background task. Each socket is one
/// IPv6 socket that also takes IPv4 (those addresses are reached as v4-mapped ones), bound to any free port. Reading is event driven;
/// sending happens off the caller's thread because resolving a name can block.
final class HelmUdp {
    typealias Listener = (_ id: Int, _ data: Data, _ host: String, _ port: Int) -> Void

    private var sockets: [Int: Int32] = [:]
    private var sources: [Int: DispatchSourceRead] = [:]
    private var next = 1
    private let lock = NSLock()
    private let queue = DispatchQueue(label: "app.helm.udp", attributes: .concurrent)
    private let listener: Listener

    init(listener: @escaping Listener) { self.listener = listener }

    private var posixError: NSError { NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }

    /// Opens a socket. `wanted` is an id the caller already handed out (the background page numbers its own sockets).
    @discardableResult
    func bind(as wanted: Int? = nil) throws -> Int {
        let fd = socket(AF_INET6, SOCK_DGRAM, 0)
        guard fd >= 0 else { throw posixError }
        var off: Int32 = 0
        setsockopt(fd, IPPROTO_IPV6, IPV6_V6ONLY, &off, socklen_t(MemoryLayout<Int32>.size))
        var any = sockaddr_in6()
        any.sin6_len = UInt8(MemoryLayout<sockaddr_in6>.size)
        any.sin6_family = sa_family_t(AF_INET6)
        any.sin6_addr = in6addr_any
        let rc = withUnsafePointer(to: &any) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in6>.size)) }
        }
        guard rc == 0 else { let e = posixError; Darwin.close(fd); throw e }
        _ = fcntl(fd, F_SETFL, fcntl(fd, F_GETFL) | O_NONBLOCK)

        lock.lock()
        let id = wanted ?? next
        next = max(next, id) + 1
        sockets[id] = fd
        lock.unlock()

        let source = DispatchSource.makeReadSource(fileDescriptor: fd, queue: queue)
        source.setEventHandler { [weak self] in self?.drain(id: id, fd: fd) }
        source.setCancelHandler { Darwin.close(fd) }
        lock.lock(); sources[id] = source; lock.unlock()
        source.resume()
        return id
    }

    private func drain(id: Int, fd: Int32) {
        var buffer = [UInt8](repeating: 0, count: 2048)
        while true {
            var from = sockaddr_storage()
            var length = socklen_t(MemoryLayout<sockaddr_storage>.size)
            let n = withUnsafeMutablePointer(to: &from) {
                $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { recvfrom(fd, &buffer, buffer.count, 0, $0, &length) }
            }
            if n <= 0 { return }
            var host = ""
            var port = 0
            if Int32(from.ss_family) == AF_INET6 {
                withUnsafePointer(to: &from) {
                    $0.withMemoryRebound(to: sockaddr_in6.self, capacity: 1) { p in
                        var addr = p.pointee.sin6_addr
                        var text = [CChar](repeating: 0, count: Int(INET6_ADDRSTRLEN))
                        inet_ntop(AF_INET6, &addr, &text, socklen_t(INET6_ADDRSTRLEN))
                        host = String(cString: text)
                        port = Int(UInt16(bigEndian: p.pointee.sin6_port))
                    }
                }
            }
            if host.lowercased().hasPrefix("::ffff:") { host = String(host.dropFirst(7)) }
            if let zone = host.firstIndex(of: "%") { host = String(host[..<zone]) }
            listener(id, Data(buffer[0..<n]), host, port)
        }
    }

    /// An address or name as an IPv6 socket address: IPv4 becomes its v4-mapped form.
    private func resolve(_ host: String, _ port: Int) -> sockaddr_in6? {
        var out = sockaddr_in6()
        out.sin6_len = UInt8(MemoryLayout<sockaddr_in6>.size)
        out.sin6_family = sa_family_t(AF_INET6)
        out.sin6_port = UInt16(port).bigEndian
        if inet_pton(AF_INET6, host, &out.sin6_addr) == 1 { return out }
        var v4 = in_addr()
        if inet_pton(AF_INET, host, &v4) == 1 {
            var mapped = [UInt8](repeating: 0, count: 10) + [0xff, 0xff] + withUnsafeBytes(of: &v4) { Array($0) }
            memcpy(&out.sin6_addr, &mapped, 16)
            return out
        }
        var hints = addrinfo()
        hints.ai_family = AF_INET6
        hints.ai_socktype = SOCK_DGRAM
        hints.ai_flags = AI_V4MAPPED | AI_ALL
        var found: UnsafeMutablePointer<addrinfo>?
        guard getaddrinfo(host, nil, &hints, &found) == 0, let first = found else { return nil }
        defer { freeaddrinfo(found) }
        first.pointee.ai_addr.withMemoryRebound(to: sockaddr_in6.self, capacity: 1) { out.sin6_addr = $0.pointee.sin6_addr }
        return out
    }

    func send(id: Int, data: Data, host: String, port: Int) {
        lock.lock(); let fd = sockets[id]; lock.unlock()
        guard let fd = fd else { return }
        queue.async { [weak self] in
            guard var to = self?.resolve(host, port) else { return }
            _ = data.withUnsafeBytes { bytes in
                withUnsafePointer(to: &to) {
                    $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { sendto(fd, bytes.baseAddress, data.count, 0, $0, socklen_t(MemoryLayout<sockaddr_in6>.size)) }
                }
            }
        }
    }

    func close(id: Int) {
        lock.lock(); let source = sources.removeValue(forKey: id); sockets.removeValue(forKey: id); lock.unlock()
        source?.cancel()
    }

    func closeAll() {
        lock.lock(); let ids = Array(sockets.keys); lock.unlock()
        ids.forEach(close)
    }
}
