package ai.smaran.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

/**
 * Transcripts are what vosk-model-small-en-in actually produced for each
 * sentence, spoken by the Windows voices (see WakeWord's comment).
 */
public class WakeWordTest {

    @Test
    public void theNamesAsTheModelHearsThem() {
        String[][] heard = {
            {"he's married", "smaran"}, {"he's morale", "smaran"}, {"hey small run", "smaran"},
            {"hey smile and", "smaran"}, {"he's marin", "smaran"}, {"he's my run", "smaran"},
            {"hey m. a year", "amarya"}, {"hey amalia", "amarya"},
            {"a mirror", "myra"}, {"hey mirror", "myra"},
            {"jarvis", "jarvis"}, {"okay jarvis", "jarvis"},
        };
        for (String[] row : heard) {
            WakeWord.Heard h = WakeWord.match(row[0]);
            assertEquals(row[0], row[1], h == null ? null : h.name);
        }
    }

    @Test
    public void whatWasSaidAfterTheNameIsKept() {
        WakeWord.Heard h = WakeWord.match("he's morale play music on spotify");
        assertEquals("smaran", h.name);
        assertEquals("play music on spotify", h.rest);
        assertEquals("open youtube", WakeWord.match("hey small run open youtube").rest);
        assertEquals("", WakeWord.match("hey mirror").rest);
    }

    @Test
    public void ordinarySpeechNeverWakesIt() {
        String[] quiet = {
            "what is the weather like today", "hey man how are you", "summer is very hot this year",
            "my name is maria", "every year we travel to go", "look in the mirror",
            "send the report to travis", "she is married now", "this is a small room",
            "we need more rice", "a mirror fell off the wall", "he is married to my sister",
            "hi maria nice to meet you", "hey siri set an alarm", "okay google what time is it",
            "how high bar", "[unk] ok jarvis", "every year hey travis", "", "[unk]",
        };
        for (String text : quiet) assertNull(text, WakeWord.match(text));
    }
}
