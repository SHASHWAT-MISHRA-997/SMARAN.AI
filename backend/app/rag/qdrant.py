import logging
import os
import uuid
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct, Filter, FieldCondition, MatchValue

logger = logging.getLogger(__name__)

class QdrantManager:
    def __init__(self):
        qdrant_url = os.getenv("QDRANT_URL", "http://qdrant:6333")
        self.client = QdrantClient(url=qdrant_url, timeout=30)
        logger.info(f"Initialized Qdrant client pointing to {qdrant_url}")

    def _get_collection_name(self, collection_id: int) -> str:
        return f"collection_{collection_id}"

    def add_chunks(self, collection_id: int, document_id: int, chunk_ids: list[str], texts: list[str], embeddings: list[list[float]]):
        try:
            col_name = self._get_collection_name(collection_id)
            vector_size = len(embeddings[0])
            
            # Check if collection exists, if not create it
            if not self.client.collection_exists(col_name):
                self.client.create_collection(
                    collection_name=col_name,
                    vectors_config=VectorParams(size=vector_size, distance=Distance.COSINE)
                )
                logger.info(f"Created Qdrant collection: {col_name}")

            points = []
            for idx, (cid, text, vector) in enumerate(zip(chunk_ids, texts, embeddings)):
                # Convert string ID to a valid UUID namespace
                try:
                    point_id = str(uuid.UUID(cid))
                except ValueError:
                    point_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, cid))

                points.append(
                    PointStruct(
                        id=point_id,
                        vector=vector,
                        payload={
                            "document_id": document_id,
                            "chunk_index": idx,
                            "text": text
                        }
                    )
                )

            self.client.upsert(
                collection_name=col_name,
                points=points
            )
            logger.info(f"Added {len(texts)} chunks to Qdrant collection '{col_name}'")
        except Exception as e:
            logger.error(f"Error adding chunks to Qdrant: {e}")
            raise e

    def query_collection(self, collection_id: int, query_embedding: list[float], n_results: int = 10) -> list[dict]:
        try:
            col_name = self._get_collection_name(collection_id)
            if not self.client.collection_exists(col_name):
                return []

            search_result = self.client.search(
                collection_name=col_name,
                query_vector=query_embedding,
                limit=n_results
            )

            formatted_results = []
            for hit in search_result:
                formatted_results.append({
                    "id": hit.id,
                    "document_id": hit.payload.get("document_id"),
                    "chunk_index": hit.payload.get("chunk_index"),
                    "text": hit.payload.get("text"),
                    "distance": hit.score,
                    "score": hit.score  # similarity score
                })
            return formatted_results
        except Exception as e:
            logger.error(f"Error querying Qdrant collection {collection_id}: {e}")
            return []

    def delete_document(self, collection_id: int, document_id: int):
        try:
            col_name = self._get_collection_name(collection_id)
            if not self.client.collection_exists(col_name):
                return

            self.client.delete(
                collection_name=col_name,
                points_selector=Filter(
                    must=[
                        FieldCondition(
                            key="document_id",
                            match=MatchValue(value=document_id)
                        )
                    ]
                )
            )
            logger.info(f"Deleted chunks for document {document_id} from Qdrant collection '{col_name}'")
        except Exception as e:
            logger.error(f"Error deleting document {document_id} from Qdrant: {e}")

    def delete_collection(self, collection_id: int):
        try:
            col_name = self._get_collection_name(collection_id)
            if self.client.collection_exists(col_name):
                self.client.delete_collection(collection_name=col_name)
                logger.info(f"Deleted Qdrant collection '{col_name}'")
        except Exception as e:
            logger.error(f"Error deleting collection {collection_id} from Qdrant: {e}")
