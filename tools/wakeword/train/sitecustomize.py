"""Loaded automatically by Python because train.sh puts this folder on PYTHONPATH.

openWakeWord builds its near-miss phrases from CMUdict pronunciations. For
words the dictionary lacks, it downloads a DeepPhonemizer model - whose host
now answers "AllAccessDisabled". The only unknown words here are the spellings
of SMARAN, so their pronunciations are added to the dictionary directly
(ARPAbet, as CMUdict writes them) and the download is never needed.
"""
try:
    import pronouncing

    EXTRA = {
        "smaran": "S M AE1 R AH0 N",
        "smarun": "S M AA1 R AH0 N",
        "smuh": "S M AH1",
        "smarn": "S M AA1 R N",
        "amarya": "AH0 M AA1 R Y AH0",
        "samaran": "S AE1 M ER0 AE2 N",
        "sharan": "SH AA1 R AH0 N",
        "maran": "M AA1 R AH0 N",
        "karan": "K AA1 R AH0 N",
        # "hey, smaran" (a pause after hey) is split on spaces, comma included.
        "hey,": "HH EY1",
    }
    pronouncing.init_cmu()
    for word, phones in EXTRA.items():
        if word not in pronouncing.lookup:
            pronouncing.lookup[word] = [phones]
            pronouncing.pronunciations.append((word, phones))
except ImportError:
    pass
