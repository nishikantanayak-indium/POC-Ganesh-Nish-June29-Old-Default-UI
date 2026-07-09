"""
Dependency injection — workspace-aware service singletons.

Neo4jGraphStore and BGEEmbedder are expensive to initialize, so they are
module-level singletons shared across all workspaces.  QdrantVectorStore
and GraphService are per-workspace (keyed by workspace_id).
"""
from __future__ import annotations

from services.document_service import DocumentService
from services.graph_service import GraphService
from services.qa_service import QAService
from graph.neo4j_store import Neo4jGraphStore
from vector.qdrant_store import QdrantVectorStore
from vector.embedder import BGEEmbedder

_doc_service: DocumentService | None = None
_store: Neo4jGraphStore | None = None
_embedder: BGEEmbedder | None = None
_vector_stores: dict[str, QdrantVectorStore] = {}
_graph_services: dict[str, GraphService] = {}


def get_doc_service() -> DocumentService:
    global _doc_service
    if _doc_service is None:
        _doc_service = DocumentService()
    return _doc_service


def _get_store() -> Neo4jGraphStore:
    global _store
    if _store is None:
        _store = Neo4jGraphStore()
    return _store


def _get_embedder() -> BGEEmbedder:
    global _embedder
    if _embedder is None:
        _embedder = BGEEmbedder()
    return _embedder


def _get_vector_store(workspace_id: str) -> QdrantVectorStore:
    if workspace_id not in _vector_stores:
        # Sanitize workspace_id for use as Qdrant collection name
        safe = workspace_id.replace("-", "_")[:20]
        _vector_stores[workspace_id] = QdrantVectorStore(
            collection_name=f"ws_{safe}",
            embedder=_get_embedder(),
        )
    return _vector_stores[workspace_id]


def get_graph_service(workspace_id: str) -> GraphService:
    if workspace_id not in _graph_services:
        _graph_services[workspace_id] = GraphService(
            workspace_id=workspace_id,
            store=_get_store(),
            vector_store=_get_vector_store(workspace_id),
        )
    return _graph_services[workspace_id]


def get_qa_service(workspace_id: str) -> QAService:
    gs = get_graph_service(workspace_id)
    return QAService(gs.store, gs.builder, gs.vector_store, workspace_id)


# ---------------------------------------------------------------------------
# Synthetic Data Studio services (module-level singletons)
# ---------------------------------------------------------------------------

_gen_service = None
_val_service = None
_qual_service = None
_dataset_service = None
_sme_service = None


def get_generation_service():
    global _gen_service
    if _gen_service is None:
        from synthetic.generation_service import SyntheticDataGenerationService
        _gen_service = SyntheticDataGenerationService()
    return _gen_service


def get_validation_service():
    global _val_service
    if _val_service is None:
        from synthetic.validation_service import SyntheticDataValidationService
        _val_service = SyntheticDataValidationService()
    return _val_service


def get_quality_service():
    global _qual_service
    if _qual_service is None:
        from synthetic.quality_service import SyntheticDataQualityAssessmentService
        _qual_service = SyntheticDataQualityAssessmentService(embedder=_get_embedder())
    return _qual_service


def get_dataset_service():
    global _dataset_service
    if _dataset_service is None:
        from synthetic.dataset_service import SyntheticDatasetManagementService
        _dataset_service = SyntheticDatasetManagementService(
            get_generation_service(), get_validation_service(), get_quality_service(),
        )
    return _dataset_service


def get_sme_service():
    global _sme_service
    if _sme_service is None:
        from synthetic.sme_service import SMEReviewService
        _sme_service = SMEReviewService()
    return _sme_service


_contract_draft_service = None


def get_contract_draft_service():
    global _contract_draft_service
    if _contract_draft_service is None:
        from services.contract_draft_service import ContractDraftService
        _contract_draft_service = ContractDraftService()
    return _contract_draft_service


def evict_workspace(workspace_id: str) -> None:
    """Remove cached service instances for a deleted workspace."""
    _graph_services.pop(workspace_id, None)
    _vector_stores.pop(workspace_id, None)
