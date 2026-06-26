"""Sidebar component — infrastructure status and session controls."""

import streamlit as st


def render_sidebar(get_graph_service, get_doc_service) -> None:
    with st.sidebar:
        st.title("🕸️ GraphRAG POC")
        st.markdown("---")

        # ── Infrastructure status ──────────────────────────────────────────
        st.markdown("### Infrastructure Status")

        try:
            gs = get_graph_service()
            n = gs.get_node_count()
            st.success(f"✅ Neo4j connected ({n} nodes)")
        except Exception as e:
            st.error(f"❌ Neo4j: {str(e)[:60]}")

        try:
            from qdrant_client import QdrantClient
            from config.settings import settings
            qc = QdrantClient(host=settings.qdrant_host, port=settings.qdrant_port)
            qc.get_collections()
            st.success("✅ Qdrant connected")
        except Exception as e:
            st.error(f"❌ Qdrant: {str(e)[:60]}")

        st.markdown("---")

        # ── Session summary ────────────────────────────────────────────────
        st.markdown("### Session")

        if st.session_state.get("elements"):
            st.info(f"📊 {len(st.session_state.elements)} elements extracted")
        if st.session_state.get("relationships"):
            st.info(f"🔗 {len(st.session_state.relationships)} relationships")
        if st.session_state.get("graph_built"):
            st.info("🕸️ Graph built")

        # ── Reset ──────────────────────────────────────────────────────────
        if st.button("🔄 Reset Session", type="secondary"):
            for key in [
                "uploaded_files", "parsed_docs", "elements",
                "relationships", "coverage_results", "chat_history",
            ]:
                st.session_state[key] = []
            st.session_state["graph_built"] = False
            try:
                get_graph_service().store.clear()
                get_graph_service().vector_store.clear()
            except Exception:
                pass
            st.rerun()

        st.markdown("---")
        st.caption("GPT-4o · Neo4j · Qdrant · Graphiti · BGE-M3")
