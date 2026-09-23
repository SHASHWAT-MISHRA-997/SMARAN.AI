package ai.smaran.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** Only a Skip button is ever pressed; nothing that merely contains the word. */
public class SkipAdTest {

    @Test
    public void skipLabelsAreRecognised() {
        for (String label : new String[] {"Skip", "Skip ad", "Skip ads", "Skip Ads ›", "skip ad", "Skip video"}) {
            assertTrue(label, SmaranAccessibility.isSkipLabel(label));
        }
    }

    @Test
    public void nothingElseIsEverPressed() {
        for (String label : new String[] {"Buy now", "Pay", "Skip to checkout", "Subscribe", "Add to cart",
                "Learn more", "Skip the queue - pay now", "", null}) {
            assertFalse(String.valueOf(label), SmaranAccessibility.isSkipLabel(label));
        }
    }

    @Test
    public void theCommandIsRecognised() {
        for (String said : new String[] {"skip ad", "Skip the ad", "ad skip karo", "ad hatao"}) {
            assertEquals(said, "skip_ad", DeviceActions.detect(said).action);
        }
        assertEquals("next", DeviceActions.detect("skip this song").argument);
        assertEquals("next", DeviceActions.detect("skip").argument);
    }
}
