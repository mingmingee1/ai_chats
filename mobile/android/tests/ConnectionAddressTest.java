package ai.chats.mobile;

public final class ConnectionAddressTest {
    private static void check(boolean value) { if (!value) throw new AssertionError(); }
    public static void main(String[] args) {
        String expected = "https://desktop.tail123.ts.net";
        check(ConnectionAddress.normalize("desktop.tail123.ts.net").equals(expected));
        check(ConnectionAddress.normalize("HTTPS://DESKTOP.tail123.ts.net:443/").equals(expected));
        check(ConnectionAddress.sameOrigin(expected, expected + "/work.html?q=1#tab"));
        check(ConnectionAddress.sameOrigin(expected, expected + ":443/developer.html"));
        for (String bad : new String[]{"http://desktop.tail123.ts.net", "https://100.124.222.73:18321", "https://desktop.tail123.ts.net.evil.test", "https://attacker@desktop.tail123.ts.net", "https://desktop.tail123.ts.net:8443", "https://desktop.tail123.ts.net/?to=evil", "file:///etc/passwd", "javascript:alert(1)", "https://desktop.tail123.ts.net/path", "https://desktop.tail123.ts.net#x"}) {
            try { ConnectionAddress.normalize(bad); throw new AssertionError("Accepted " + bad); }
            catch (IllegalArgumentException expectedFailure) { }
        }
        for (String bad : new String[]{"http://desktop.tail123.ts.net/a", "https://evil.test", "https://desktop.tail123.ts.net.evil.test/", "https://x@desktop.tail123.ts.net/", "https://desktop.tail123.ts.net:8443/", "content://something"})
            check(!ConnectionAddress.sameOrigin(expected, bad));
        System.out.println("ConnectionAddress: origin validation and navigation tests passed");
    }
}
