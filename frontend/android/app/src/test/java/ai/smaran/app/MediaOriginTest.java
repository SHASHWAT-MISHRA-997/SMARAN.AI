package ai.smaran.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class MediaOriginTest {
    @Test public void localPageAndDefaultPortMatch() {
        assertTrue(MainActivity.sameOrigin("https://localhost", "https://localhost/"));
        assertTrue(MainActivity.sameOrigin("https://LOCALHOST:443", "https://localhost/"));
    }
    @Test public void differentHostsSchemesAndPortsAreDenied() {
        assertFalse(MainActivity.sameOrigin("https://localhost.attacker.example", "https://localhost"));
        assertFalse(MainActivity.sameOrigin("https://localhost@attacker.example", "https://localhost"));
        assertFalse(MainActivity.sameOrigin("http://localhost", "https://localhost"));
        assertFalse(MainActivity.sameOrigin("https://localhost:8443", "https://localhost"));
    }
    @Test public void malformedAndOpaqueOriginsAreDenied() {
        assertFalse(MainActivity.sameOrigin(null, "https://localhost"));
        assertFalse(MainActivity.sameOrigin("not a URL", "https://localhost"));
        assertFalse(MainActivity.sameOrigin("data:text/html,test", "https://localhost"));
    }
}
