package ai.chats.mobile;

import java.net.URI;
import java.util.Locale;

/** Only a trusted HTTPS origin is stored; paths never become app permissions. */
public final class ConnectionAddress {
    public static String normalize(String text) {
        try {
            String value = text.trim();
            if (!value.contains("://")) value = "https://" + value;
            URI uri = new URI(value);
            String host = uri.getHost();
            if (!"https".equalsIgnoreCase(uri.getScheme()) || host == null
                || !host.matches("(?i)[a-z0-9-]+(?:\\.[a-z0-9-]+)+\\.ts\\.net")
                || uri.getRawUserInfo() != null || (uri.getPort() != -1 && uri.getPort() != 443)
                || uri.getRawQuery() != null || uri.getRawFragment() != null
                || !(uri.getRawPath().isEmpty() || "/".equals(uri.getRawPath()))) throw new Exception();
            return "https://" + host.toLowerCase(Locale.ROOT);
        } catch (Exception e) {
            throw new IllegalArgumentException("PC 연결 도우미가 알려준 https://기기.네트워크.ts.net 주소를 입력해 주세요.");
        }
    }
    public static boolean sameOrigin(String origin, String value) {
        try {
            URI expected = new URI(origin), actual = new URI(value);
            return "https".equalsIgnoreCase(actual.getScheme()) && actual.getRawUserInfo() == null
                && expected.getHost().equalsIgnoreCase(actual.getHost())
                && (actual.getPort() == -1 || actual.getPort() == 443);
        } catch (Exception e) { return false; }
    }
}
