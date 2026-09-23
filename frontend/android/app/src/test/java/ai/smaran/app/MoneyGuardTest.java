package ai.smaran.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** Payment and shopping apps are opened on request; paying and buying never happen. */
public class MoneyGuardTest {

    @Test
    public void payingOrBuyingOpensTheAppAndDoesNothingElse() {
        String[][] cases = {
            {"send 500 rupees to Rahul on gpay", "Google Pay"},
            {"paytm par 200 bhejo", "Paytm"},
            {"gpay se 100 rupees bhej do", "Google Pay"},
            {"buy this on amazon", "Amazon"},
            {"order a phone on flipkart", "Flipkart"},
        };
        for (String[] c : cases) {
            DeviceActions.Command cmd = DeviceActions.detect(c[0]);
            assertEquals(c[0], "app", cmd.action);
            assertEquals(c[0], c[1], cmd.argument);
            assertTrue(c[0], cmd.money);
        }
    }

    @Test
    public void withNoAppNamedItOnlySaysSo() {
        for (String said : new String[] {"Rahul ko 500 bhejo", "add to cart", "recharge karo", "pay Rahul"}) {
            DeviceActions.Command cmd = DeviceActions.detect(said);
            assertEquals(said, "say", cmd.action);
            assertEquals(said, DeviceActions.MONEY_LINE, cmd.argument);
        }
    }

    @Test
    public void justOpeningAPaymentAppIsNotAPayment() {
        DeviceActions.Command cmd = DeviceActions.detect("open gpay");
        assertEquals("app", cmd.action);
        assertEquals(false, cmd.money);
    }
}
