import math
import re
from typing import List, Dict, Any

class BM25Searcher:
    def __init__(self, corpus: List[Dict[str, Any]], k1: float = 1.5, b: float = 0.75):
        """
        corpus: List of dicts, each containing 'id', 'text', 'document_id', 'chunk_index'
        """
        self.corpus = corpus
        self.k1 = k1
        self.b = b
        self.corpus_size = len(corpus)
        self.doc_lengths = []
        self.doc_term_frequencies = []
        self.doc_ids = []
        self.vocab = set()
        
        # document frequency
        self.df = {}
        self.avg_doc_len = 0.0
        
        self._initialize()

    def _tokenize(self, text: str) -> List[str]:
        # Lowercase and extract alphanumeric sequences (keeps code strings, node names etc.)
        text = text.lower()
        # Find alphanumeric characters, underscores, and hyphens (helps with ROS2 node names e.g., standard_pub_node)
        tokens = re.findall(r'[a-zA-Z0-9_\-]+', text)
        return tokens

    def _initialize(self):
        if not self.corpus:
            return
            
        total_len = 0
        for doc in self.corpus:
            tokens = self._tokenize(doc["text"])
            self.doc_lengths.append(len(tokens))
            self.doc_ids.append(doc["id"])
            total_len += len(tokens)
            
            # Compute term frequency for this document
            tf = {}
            for token in tokens:
                tf[token] = tf.get(token, 0) + 1
                self.vocab.add(token)
            self.doc_term_frequencies.append(tf)
            
            # Increment document frequencies
            for token in tf.keys():
                self.df[token] = self.df.get(token, 0) + 1
                
        self.avg_doc_len = total_len / self.corpus_size if self.corpus_size > 0 else 0.0

    def _get_idf(self, term: str) -> float:
        df_t = self.df.get(term, 0)
        # Standard BM25 IDF formula with smoothing to avoid negative values
        numerator = self.corpus_size - df_t + 0.5
        denominator = df_t + 0.5
        return math.log(max(numerator / denominator, 0.0001) + 1.0)

    def search(self, query: str, n_results: int = 10) -> List[Dict[str, Any]]:
        if not self.corpus:
            return []
            
        query_tokens = self._tokenize(query)
        scores = [0.0] * self.corpus_size
        
        for q_token in query_tokens:
            if q_token not in self.vocab:
                continue
                
            idf = self._get_idf(q_token)
            
            for idx in range(self.corpus_size):
                tf = self.doc_term_frequencies[idx].get(q_token, 0)
                doc_len = self.doc_lengths[idx]
                
                # BM25 term score component
                numerator = tf * (self.k1 + 1.0)
                denominator = tf + self.k1 * (1.0 - self.b + self.b * (doc_len / self.avg_doc_len))
                
                scores[idx] += idf * (numerator / denominator)
                
        # Combine corpus index with scores
        results = []
        for idx, score in enumerate(scores):
            if score > 0.0:  # Only return chunks with keyword overlap
                results.append({
                    "id": self.corpus[idx]["id"],
                    "document_id": self.corpus[idx]["document_id"],
                    "chunk_index": self.corpus[idx]["chunk_index"],
                    "text": self.corpus[idx]["text"],
                    "score": score
                })
                
        # Sort desc by score
        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:n_results]
