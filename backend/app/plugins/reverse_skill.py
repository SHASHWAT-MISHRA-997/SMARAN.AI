"""
Reverse Skill
=============
A skill that provides reverse operations on various data types with additional utilities.

This has nothing to do with the reverse-skill project on GitHub. That one
(zhaoxuya520/reverse-skill, MIT, PowerShell) is a router for reverse
engineering and authorised penetration-testing tooling. This file reverses
strings and checks palindromes, which somebody arrived at by reading
"reverse" as "reverse a string". The functions work; only the name and the
credit were wrong, and both are now gone.
"""

from app.plugin_system import SkillPlugin, PluginMetadata, PluginConfig, PluginType
import logging
from typing import List, Dict, Any
import json
import re

logger = logging.getLogger("reverse_skill")

class ReverseSkill(SkillPlugin):
    """Skill for reverse operations"""
    
    def __init__(self, config: PluginConfig, metadata: PluginMetadata):
        super().__init__(config, metadata)
        self.available = False
        self._load_patterns()
    
    def _load_patterns(self):
        """Load common patterns for reverse operations."""
        # Common patterns that benefit from reverse operations
        self.palindromic_patterns = [
            r'^(\w+)\s+\w+\s+\1$',  # Repeated word pattern
            r'^([^\\s]+)([^\\s])\\2\\1$',  # Character mirror
        ]
        
        self.common_reversibles = {
            "strings": ["palindrome", "mirror", "reverse", "backwards"],
            "numbers": [12321, 1234321, 11111, 98789],
            "dates": ["2020-02-02", "2021-12-02"],  # Palindromic dates
        }
        
        self.available = True
        logger.info("Reverse skill loaded with pattern detection capabilities")
    
    async def initialize(self, app_context: Dict[str, Any]) -> bool:
        """Initialize the skill."""
        if not self.available:
            self._load_patterns()
        
        if self.available:
            logger.info("Reverse skill initialized")
            return True
        else:
            logger.error("Failed to initialize Reverse skill")
            return False
    
    async def shutdown(self) -> bool:
        """Cleanup"""
        self.available = False
        return True
    
    def get_skills(self) -> List[Dict]:
        """Return the skills provided by this plugin."""
        if not self.available:
            return []
        
        return [
            {
                "name": "reverse_string",
                "description": "Reverse a given string and analyze its properties",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "text": {
                            "type": "string",
                            "description": "The string to reverse"
                        },
                        "analyze": {
                            "type": "boolean",
                            "default": False,
                            "description": "Whether to perform additional analysis on the reversed string"
                        }
                    },
                    "required": ["text"]
                }
            },
            {
                "name": "reverse_list",
                "description": "Reverse a given list and provide statistics",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "items": {
                            "type": "array",
                            "description": "The list to reverse"
                        },
                        "preserve_order_equals": {
                            "type": "boolean",
                            "default": False,
                            "description": "Whether to check if the list is equal to its reverse (palindrome check)"
                        }
                    },
                    "required": ["items"]
                }
            },
            {
                "name": "reverse_words",
                "description": "Reverse the order of words in a sentence while preserving word internal order",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "sentence": {
                            "type": "string",
                            "description": "The sentence to reverse word order"
                        },
                        "preserve_punctuation": {
                            "type": "boolean",
                            "default": True,
                            "description": "Whether to preserve punctuation positioning"
                        }
                    },
                    "required": ["sentence"]
                }
            },
            {
                "name": "is_palindrome",
                "description": "Check if a string or sequence is a palindrome",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "input": {
                            "oneOf": [
                                {"type": "string"},
                                {"type": "array"}
                            ],
                            "description": "The string or list to check for palindrome properties"
                        },
                        "ignore_case": {
                            "type": "boolean",
                            "default": True,
                            "description": "Whether to ignore case when checking strings"
                        },
                        "ignore_non_alphanumeric": {
                            "type": "boolean",
                            "default": True,
                            "description": "Whether to ignore non-alphanumeric characters when checking strings"
                        }
                    },
                    "required": ["input"]
                }
            },
            {
                "name": "reverse_and_encode",
                "description": "Reverse a string and apply various encoding transformations",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "text": {
                            "type": "string",
                            "description": "The string to reverse and encode"
                        },
                        "encoding": {
                            "type": "string",
                            "enum": ["base64", "hex", "rot13", "none"],
                            "default": "none",
                            "description": "Encoding to apply after reversing"
                        }
                    },
                    "required": ["text"]
                }
            }
        ]
    
    async def execute_skill(self, skill_name: str, context: Dict) -> Any:
        """Execute a skill by name."""
        if not self.available:
            raise RuntimeError("Reverse skill not available")
        
        if skill_name == "reverse_string":
            text = context.get("text", "")
            analyze = context.get("analyze", False)
            
            reversed_text = text[::-1]
            
            result = {
                "original": text,
                "reversed": reversed_text,
                "length": len(text),
                "reversed_length": len(reversed_text)
            }
            
            if analyze:
                # Perform additional analysis
                result["analysis"] = {
                    "is_palindrome": text == reversed_text,
                    "common_prefix_length": self._common_prefix_length(text, reversed_text),
                    "common_suffix_length": self._common_suffix_length(text, reversed_text),
                    "longest_common_subsequence": self._longest_common_subsequence_length(text, reversed_text),
                    "character_frequency_change": self._character_frequency_change(text, reversed_text),
                    "contains_palindromic_substring": self._contains_palindromic_substring(text),
                    "word_count_preserved": len(text.split()) == len(reversed_text.split()) if text.strip() and reversed_text.strip() else True
                }
                
                # Add linguistic observations
                if len(text) > 2:
                    result["analysis"]["linguistic_observations"] = []
                    if text.lower() == reversed_text.lower():
                        result["analysis"]["linguistic_observations"].append("Case-insensitive palindrome")
                    
                    # Check for interesting patterns
                    words = text.split()
                    reversed_words = reversed_text.split()
                    if len(words) == len(reversed_words) and all(w == rw[::-1] for w, rw in zip(words, reversed_words)):
                        result["analysis"]["linguistic_observations"].append("Each word is individually reversed")
                    
                    if text == " ".join(reversed_words):
                        result["analysis"]["linguistic_observations"].append("Word order reversed but words unchanged")
            
            logger.info(f"Reversed string: {text[:30]}... -> {reversed_text[:30]}...")
            return result
        
        elif skill_name == "reverse_list":
            items = context.get("items", [])
            preserve_order_equals = context.get("preserve_order_equals", False)
            
            reversed_items = list(reversed(items))
            
            result = {
                "original": items,
                "reversed": reversed_items,
                "length": len(items),
                "reversed_length": len(reversed_items)
            }
            
            if preserve_order_equals:
                result["is_palindromic"] = items == reversed_items
                if items == reversed_items:
                    result["palindrome_type"] = "exact"
                else:
                    # Check for other types of palindromes
                    result["palindrome_type"] = "not_palindromic"
            
            # Add list statistics
            if items:
                result["statistics"] = {
                    "sum": sum(items) if all(isinstance(x, (int, float)) for x in items) else None,
                    "product": self._safe_product(items) if all(isinstance(x, (int, float)) for x in items) else None,
                    "mean": sum(items)/len(items) if all(isinstance(x, (int, float)) for x in items) and len(items) > 0 else None,
                    "min": min(items) if items and all(isinstance(x, (int, float)) for x in items) else None,
                    "max": max(items) if items and all(isinstance(x, (int, float)) for x in items) else None,
                    "unique_elements": len(set(str(x) for x in items)) if items else 0,
                    "element_type_diversity": len(set(type(x).__name__ for x in items)) if items else 0
                }
            
            logger.info(f"Reversed list of length {len(items)}")
            return result
        
        elif skill_name == "reverse_words":
            sentence = context.get("sentence", "")
            preserve_punctuation = context.get("preserve_punctuation", True)
            
            if preserve_punctuation:
                # More sophisticated word reversal that preserves punctuation
                # Split by words but keep track of punctuation
                words_with_punct = re.findall(r'\\w+|[^\\w\\s]+', sentence, re.UNICODE)
                reversed_words_with_punct = list(reversed(words_with_punct))
                reversed_sentence = ''.join(reversed_words_with_punct)
            else:
                # Simple word reversal
                words = sentence.split()
                reversed_sentence = ' '.join(reversed(words))
            
            result = {
                "original": sentence,
                "reversed": reversed_sentence,
                "word_count": len(sentence.split()) if sentence.strip() else 0,
                "reversed_word_count": len(reversed_sentence.split()) if reversed_sentence.strip() else 0,
                "preserve_punctuation": preserve_punctuation
            }
            
            logger.info(f"Reversed words in sentence: {sentence[:30]}...")
            return result
        
        elif skill_name == "is_palindrome":
            input_data = context.get("input")
            ignore_case = context.get("ignore_case", True)
            ignore_non_alphanumeric = context.get("ignore_non_alphanumeric", True)
            
            if isinstance(input_data, str):
                # String palindrome check
                processed = input_data
                if ignore_case:
                    processed = processed.lower()
                if ignore_non_alphanumeric:
                    processed = re.sub(r'[^a-zA-Z0-9]', '', processed)
                
                reversed_processed = processed[::-1]
                is_pal = processed == reversed_processed
                
                return {
                    "input": input_data,
                    "processed_for_check": processed,
                    "is_palindrome": is_pal,
                    "method": "string",
                    "ignore_case": ignore_case,
                    "ignore_non_alphanumeric": ignore_non_alphanumeric
                }
            
            elif isinstance(input_data, list):
                # List palindrome check
                processed = input_data.copy()
                is_pal = processed == list(reversed(processed))
                
                return {
                    "input": input_data,
                    "is_palindrome": is_pal,
                    "method": "list",
                    "length": len(input_data)
                }
            
            else:
                raise ValueError("Input must be a string or list")
        
        elif skill_name == "reverse_and_encode":
            text = context.get("text", "")
            encoding = context.get("encoding", "none")
            
            reversed_text = text[::-1]
            
            # Apply encoding
            if encoding == "base64":
                import base64
                encoded = base64.b64encode(reversed_text.encode('utf-8')).decode('utf-8')
            elif encoding == "hex":
                encoded = reversed_text.encode('utf-8').hex()
            elif encoding == "rot13":
                encoded = reversed_text.translate(
                    str.maketrans(
                        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
                        "NOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklm"
                    )
                )
            else:  # none
                encoded = reversed_text
            
            return {
                "original": text,
                "reversed": reversed_text,
                "encoded": encoded,
                "encoding_applied": encoding,
                "lengths": {
                    "original": len(text),
                    "reversed": len(reversed_text),
                    "encoded": len(encoded)
                }
            }
        
        else:
            raise ValueError(f"Unknown skill: {skill_name}")
    
    def _common_prefix_length(self, s1: str, s2: str) -> int:
        """Calculate the length of the common prefix between two strings."""
        min_len = min(len(s1), len(s2))
        for i in range(min_len):
            if s1[i] != s2[i]:
                return i
        return min_len
    
    def _common_suffix_length(self, s1: str, s2: str) -> int:
        """Calculate the length of the common suffix between two strings."""
        # Reverse both strings and find common prefix
        return self._common_prefix_length(s1[::-1], s2[::-1])
    
    def _longest_common_subsequence_length(self, s1: str, s2: str) -> int:
        """Calculate the length of the longest common subsequence."""
        m, n = len(s1), len(s2)
        dp = [[0] * (n + 1) for _ in range(m + 1)]
        
        for i in range(1, m + 1):
            for j in range(1, n + 1):
                if s1[i-1] == s2[j-1]:
                    dp[i][j] = dp[i-1][j-1] + 1
                else:
                    dp[i][j] = max(dp[i-1][j], dp[i][j-1])
        
        return dp[m][n]
    
    def _character_frequency_change(self, s1: str, s2: str) -> Dict[str, int]:
        """Calculate how character frequencies change between two strings."""
        from collections import Counter
        freq1 = Counter(s1)
        freq2 = Counter(s2)
        
        # Calculate difference
        change = {}
        all_chars = set(freq1.keys()) | set(freq2.keys())
        for char in all_chars:
            change[char] = freq2.get(char, 0) - freq1.get(char, 0)
        
        return dict(change)
    
    def _contains_palindromic_substring(self, s: str, min_length: int = 3) -> bool:
        """Check if the string contains any palindromic substring of minimum length."""
        for i in range(len(s) - min_length + 1):
            for j in range(i + min_length, len(s) + 1):
                substr = s[i:j]
                if substr == substr[::-1]:
                    return True
        return False
    
    def _safe_product(self, items: List[float]) -> float:
        """Safely calculate the product of a list of numbers."""
        if not items:
            return 0
        product = 1
        for item in items:
            product *= item
        return product

# Plugin metadata
metadata = PluginMetadata(
    name="text-reverse",
    version="1.0.0",
    description=(
        "Reverses strings, lists and word order, and checks palindromes. "
        "Unrelated to the reverse-skill project, despite the old name."
    ),
    # Written for SMARAN.AI. This was called reverse-skill and credited
    # zhaoxuya520, whose project of that name is a reverse *engineering* and
    # authorised-pentesting skill router written in PowerShell. Somebody read
    # "reverse" as "reverse a string". There is no relationship between the
    # two, so the attribution and the links are gone rather than corrected.
    author="SMARAN.AI",
    plugin_type=PluginType.SKILL,
    entry_point="reverse_skill:ReverseSkill",
    dependencies=[],
    config_schema={},
    tags=["string", "list", "utility", "palindrome"],
    license="MIT"
)