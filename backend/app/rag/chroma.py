import logging
import chromadb
from app.config import settings

logger = logging.getLogger(__name__)

class ChromaManager:
    def __init__(self):
        self.client = chromadb.PersistentClient(path=settings.CHROMA_DIR)

    def _get_collection_name(self, collection_id: int) -> str:
        # Chroma collection names must be 3-63 chars, start/end with alphanumeric, 
        # and contain only alphanumeric, underscores, or hyphens.
        return f"collection-{collection_id}"

    def add_chunks(self, collection_id: int, document_id: int, chunk_ids: list[str], texts: list[str], embeddings: list[list[float]]):
        try:
            col_name = self._get_collection_name(collection_id)
            collection = self.client.get_or_create_collection(name=col_name)
            
            metadatas = [{"document_id": document_id, "chunk_index": idx} for idx in range(len(texts))]
            
            collection.add(
                ids=chunk_ids,
                embeddings=embeddings,
                metadatas=metadatas,
                documents=texts
            )
            logger.info(f"Added {len(texts)} chunks to Chroma vector collection '{col_name}'")
        except Exception as e:
            logger.error(f"Error adding chunks to Chroma: {e}")
            raise e

    def query_collection(self, collection_id: int, query_embedding: list[float], n_results: int = 10) -> list[dict]:
        try:
            col_name = self._get_collection_name(collection_id)
            # Check if collection exists
            try:
                collection = self.client.get_collection(name=col_name)
            except ValueError:
                # Collection does not exist in Chroma (empty)
                return []
                
            results = collection.query(
                query_embeddings=[query_embedding],
                n_results=n_results
            )
            
            formatted_results = []
            if results and results["documents"]:
                docs = results["documents"][0]
                ids = results["ids"][0]
                metadatas = results["metadatas"][0]
                distances = results["distances"][0] if "distances" in results else [0.0] * len(docs)
                
                for idx in range(len(docs)):
                    formatted_results.append({
                        "id": ids[idx],
                        "document_id": metadatas[idx]["document_id"],
                        "chunk_index": metadatas[idx]["chunk_index"],
                        "text": docs[idx],
                        "distance": distances[idx],
                        "score": 1.0 / (1.0 + distances[idx])  # convert distance to a similarity score
                    })
            return formatted_results
        except Exception as e:
            logger.error(f"Error querying Chroma collection: {e}")
            return []

    def delete_document(self, collection_id: int, document_id: int):
        try:
            col_name = self._get_collection_name(collection_id)
            try:
                collection = self.client.get_collection(name=col_name)
                # Delete chunks matching document_id
                collection.delete(where={"document_id": document_id})
                logger.info(f"Deleted chunks for document {document_id} from Chroma collection '{col_name}'")
            except ValueError:
                # Collection does not exist
                pass
        except Exception as e:
            logger.error(f"Error deleting document from Chroma: {e}")

    def delete_collection(self, collection_id: int):
        try:
            col_name = self._get_collection_name(collection_id)
            try:
                self.client.delete_collection(name=col_name)
                logger.info(f"Deleted Chroma collection '{col_name}'")
            except ValueError:
                pass
        except Exception as e:
            logger.error(f"Error deleting collection from Chroma: {e}")
