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

    @Test
    public void wordsStillArrivingWakeOnAStrongGreetingAndAName() {
        // Over a song the utterance never ends, so the name comes mid-stream.
        assertEquals("smaran", WakeWord.matchPartial("the music is loud today hey small run").name);
        assertEquals("myra", WakeWord.matchPartial("okay so hey mirror").name);
        assertEquals("jarvis", WakeWord.matchPartial("blah blah ok jarvis play").name);
        assertEquals("amarya", WakeWord.matchPartial("hello a maria").name);
    }

    @Test
    public void wordsStillArrivingStayQuietOtherwise() {
        String[] quiet = {
            "look in the mirror", "every year we travel to go", "hey man how are you",
            "hi maria nice to meet you", "he's married to my sister", "a small run in the park",
            "send the report to travis", "",
        };
        for (String text : quiet) assertNull(text, WakeWord.matchPartial(text));
    }

    @Test
    public void shortGreetingLikeUtterancesGetASecondLook() {
        // What the model wrote for "Hey SMARAN" in the owner's voice.
        for (String text : new String[] {"hey", "a salad and", "here's my run", "here's my", "a small", "a and"}) {
            assertEquals(text, true, WakeWord.worthSecondLook(text));
        }
        for (String text : new String[] {"what is the weather like today", "play some music", "", "people",
                "hey what time is it now please"}) {
            assertEquals(text, false, WakeWord.worthSecondLook(text));
        }
    }

    @Test
    public void onlyASmaranPhraseFromTheSecondLookWakes() {
        assertEquals(true, WakeWord.secondLookSaysSmaran("[unk] hey small run"));
        assertEquals(true, WakeWord.secondLookSaysSmaran("here's my run"));
        // "hey man" came back as Myra in testing; the other names are not taken from here.
        assertEquals(false, WakeWord.secondLookSaysSmaran("hey myra"));
        assertEquals(false, WakeWord.secondLookSaysSmaran("[unk]"));
        assertEquals(false, WakeWord.secondLookSaysSmaran("[unk] hey"));
    }

    @Test
    public void theOwnersHeyMyraWithTheHeyLost() {
        assertEquals("myra", WakeWord.match("myra").name);
        // A lone greeting, then the second look finds the name.
        assertEquals("myra", WakeWord.secondLookName("hey myra", "hello"));
        assertEquals("jarvis", WakeWord.secondLookName("[unk] hey jarvis", "hey"));
        // Two words heard first ("hey man"): only SMARAN may come from the second look.
        assertNull(WakeWord.secondLookName("hey myra", "hey man"));
        assertEquals("smaran", WakeWord.secondLookName("hey small run", "hey man"));
        assertNull(WakeWord.match("my ra is here"));
    }

    @Test
    public void theOwnersVoiceSaidSmaranAsHeresMoreOn() {
        assertEquals("smaran", WakeWord.match("here's more on").name);
        assertEquals("smaran", WakeWord.match("he's more on").name);
        // A news anchor carries on; only the phrase on its own counts, never mid-stream.
        assertNull(WakeWord.match("here's more on that story"));
        assertNull(WakeWord.matchPartial("here's more on"));
    }
}
