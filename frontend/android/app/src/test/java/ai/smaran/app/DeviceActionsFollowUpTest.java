package ai.smaran.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

/**
 * The background listener's copy of "which song?" - the same behaviour the
 * page has (tests/device-commands-music-apps.test.mjs), because when SMARAN is
 * listening from the notification the page's copy is not running.
 */
public class DeviceActionsFollowUpTest {

    @Test
    public void musicWithNoSongNamedAsksWhichOne() {
        DeviceActions.Command spotify = DeviceActions.detect("Hey SMARAN play music for me on Spotify");
        assertEquals("ask", spotify.action);
        assertEquals("Spotify", spotify.app);
        assertEquals("Which song should I play on Spotify?", spotify.argument);

        assertEquals("Spotify par kaunsa gaana chalaun?",
            DeviceActions.detect("spotify par gaana bajao").argument);
        assertEquals("Kaunsa gaana sunna hai?", DeviceActions.detect("gaana bajao").argument);
    }

    @Test
    public void aNamedSongStillPlaysAtOnce() {
        DeviceActions.Command named = DeviceActions.detect("play kesariya on spotify");
        assertEquals("music", named.action);
        assertEquals("kesariya", named.argument);
        assertEquals("Spotify", named.app);
    }

    @Test
    public void theAnswerCompletesTheQuestion() {
        DeviceActions.Command asked = DeviceActions.detect("play music on spotify");

        DeviceActions.Command song = DeviceActions.answer(asked, "Kesariya");
        assertEquals("music", song.action);
        assertEquals("Kesariya", song.argument);
        assertEquals("Spotify", song.app);

        assertEquals("tum hi ho", DeviceActions.answer(asked, "tum hi ho bajao").argument);
        assertEquals("cancelled", DeviceActions.answer(asked, "rehne do").action);
        assertEquals("", DeviceActions.answer(asked, "kuch bhi").argument);
        assertEquals("media", DeviceActions.answer(asked, "pause").action);
        assertNull(DeviceActions.answer(asked, "what is the weather today"));

        DeviceActions.Command anywhere = DeviceActions.detect("gaana bajao");
        assertEquals("youtube_play", DeviceActions.answer(anywhere, "kesariya").action);
    }

    @Test
    public void youTubeWithPerKoAndTheVerbFirst() {
        for (String said : new String[] {
                "Sada Shiv boliye ko play karo YouTube per",
                "Sada Shiv boliye YouTube per play karo",
                "Sada Shiv boliye ko YouTube par chalao"}) {
            DeviceActions.Command c = DeviceActions.detect(said);
            assertEquals(said, "youtube_play", c.action);
            assertEquals(said, "Sada Shiv boliye", c.argument);
        }
    }
}
