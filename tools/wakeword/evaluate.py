"""Free recognition + the anchored matcher WakeWord.java uses: hits and false alarms."""
import re
import sys

from probe import VOICES, hear, synth

GREETING = r"(?:hey|hi|hay|ok|okay|hello)"
WEAK = r"(?:a|he's|hey's)"
NAMES = {
    'smaran': r"(?:smaran|smart run|small run|some run|summer run|sam ran|smile and|smile run|is marin|s marin|marin|married|morale|my run|smarter|some ran|summer ran)",
    'amarya': r"(?:amarya|a maria|amalia|a mario|a marie|m a year|m\. a year|more year|a more year|amar ya)",
    'myra': r"(?:myra|mira|mirror|maira|my ra)",
    'jarvis': r"(?:jarvis|jervis|jarvi's)",
}
# Anchored at the start of the utterance: an assistant is addressed first.
# "Hey" heard as "he's" or "a" is weak evidence: then the name must be all
# that was said, or be followed straight away by an instruction.
COMMAND = r"(?:play|open|search|call|stop|pause|next|skip|what|tell|set|show|turn|start|close)"
PATTERNS = {
    name: re.compile(rf"^(?:{GREETING}\s+)?{GREETING}\s+{alt}\b|^{WEAK}\s+{alt}(?:$|\s+{COMMAND}\b)")
    for name, alt in NAMES.items()
}
# Jarvis is distinctive enough to be said on its own.
ALONE = re.compile(r"^jarvis\b")


def woken(text):
    t = text.strip()
    for name, pattern in PATTERNS.items():
        if pattern.search(t):
            return name
    return 'jarvis' if ALONE.search(t) else None


POSITIVE = [
    ('Hey Smaran', 'smaran'), ('Hey Smuh run', 'smaran'), ('Hey Smurran', 'smaran'),
    ('Hey Smaran, play music on Spotify', 'smaran'),
    ('Hey Amarya', 'amarya'), ('Hey Uh maar yah', 'amarya'),
    ('Hey Myra', 'myra'), ('Hey Jarvis', 'jarvis'), ('OK Jarvis', 'jarvis'),
]
NEGATIVE = [
    'What is the weather like today', 'Play some music', 'I am going to the market',
    'Hey man how are you', 'Summer is very hot this year', 'My name is Maria',
    'Open the window please', 'Can you call my mother', 'The meeting starts at five',
    'Turn off the lights', 'I will run tomorrow morning', 'That movie was amazing',
    'Hello how is everyone', 'Every year we travel to Goa', 'Look in the mirror',
    'Send the report to Travis', 'She is married now', 'This is a small room',
    'We need more rice', 'Happy birthday to you', 'Hey, are you coming tonight',
    'A mirror fell off the wall', 'He is married to my sister', 'Hi Maria, nice to meet you',
    'Okay, I will do it', 'kya haal hai bhai', 'mujhe bhook lagi hai',
    'aaj mausam bahut accha hai', 'Hey Siri, set an alarm', 'OK Google, what time is it',
]

if __name__ == '__main__':
    hits = total = alarms = 0
    for text, want in POSITIVE:
        for voice in VOICES:
            got = hear(synth(text, voice))
            name = woken(got)
            total += 1
            hits += name == want
            if name != want or '-v' in sys.argv:
                print(f"{'hit ' if name == want else 'MISS'} {text!r} {voice.split()[1]} -> {got!r} ({name})")
    for text in NEGATIVE:
        for voice in VOICES:
            got = hear(synth(text, voice))
            name = woken(got)
            if name:
                alarms += 1
                print(f'FALSE ALARM {text!r} {voice.split()[1]} -> {got!r} ({name})')
            elif '-v' in sys.argv:
                print(f'quiet {text!r} -> {got!r}')
    print(f'hits {hits}/{total}, false alarms {alarms}/{len(NEGATIVE) * len(VOICES)}')
